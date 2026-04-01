/**
 * lsp-client.ts — Single LSP server connection manager.
 *
 * Spawns an LSP server as a child process, communicates via JSON-RPC over stdio,
 * and caches diagnostics received from textDocument/publishDiagnostics notifications.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node";
import type {
  LspServerConfig,
  FormattedDiagnostic,
  DiagnosticSeverity,
} from "./types";
import {
  getLanguageId,
  DIAGNOSTICS_TIMEOUT_MS,
  DIAGNOSTICS_DEBOUNCE_MS,
  LSP_INITIALIZE_TIMEOUT_MS,
} from "./types";

// ─── Constants ───────────────────────────────────────────────────────────────

/** LSP DiagnosticSeverity enum values → our string labels */
const LSP_SEVERITY_MAP: Record<number, DiagnosticSeverity> = {
  1: "ERROR",
  2: "WARN",
  3: "INFO",
  4: "HINT",
};

// ─── LspClient ──────────────────────────────────────────────────────────────

/**
 * Manages a single LSP server connection.
 *
 * Lifecycle:
 *   1. construct(serverName, config, rootPath)
 *   2. await start()          — spawn + initialize handshake
 *   3. await touchFile(path)  — notify server, wait for diagnostics
 *   4. getDiagnostics(path)   — read cached diagnostics
 *   5. await stop()           — graceful shutdown
 */
export class LspClient {
  readonly serverName: string;
  readonly config: LspServerConfig;
  private rootPath: string;

  private process: ChildProcess | null = null;
  private connection: MessageConnection | null = null;
  private diagnosticsCache = new Map<string, FormattedDiagnostic[]>();
  private openedFiles = new Set<string>();
  private fileVersions = new Map<string, number>();
  private _isRunning = false;
  restartAttempts = 0;

  // Callbacks for diagnostic waiters
  private diagnosticWaiters = new Map<string, Array<() => void>>();

  constructor(serverName: string, config: LspServerConfig, rootPath: string) {
    this.serverName = serverName;
    this.config = config;
    this.rootPath = rootPath;
  }

  get isRunning(): boolean {
    return (
      this._isRunning &&
      this.process !== null &&
      this.process.exitCode === null
    );
  }

  /** Tear down a failed or timed-out start before `initialized` completes. */
  private abortStartup(): void {
    try {
      this.connection?.dispose();
    } catch {
      /* ignore */
    }
    this.connection = null;
    try {
      this.process?.kill();
    } catch {
      /* ignore */
    }
    this.process = null;
    this._isRunning = false;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.isRunning) return;

    const [cmd, ...args] = this.config.command;
    if (!cmd) {
      throw new Error(`LSP server "${this.serverName}" has empty command`);
    }

    this.process = spawn(cmd, args, {
      cwd: this.rootPath,
      env: { ...process.env, ...this.config.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (!this.process.stdout || !this.process.stdin) {
      throw new Error(
        `LSP server "${this.serverName}" failed to create stdio pipes`,
      );
    }

    this.connection = createMessageConnection(
      new StreamMessageReader(this.process.stdout),
      new StreamMessageWriter(this.process.stdin),
    );

    // Handle publishDiagnostics notifications
    this.connection.onNotification(
      "textDocument/publishDiagnostics",
      (params: any) => {
        const uri: string = params.uri;
        const rawDiags: any[] = params.diagnostics || [];

        const formatted: FormattedDiagnostic[] = rawDiags.map((d: any) => ({
          severity: LSP_SEVERITY_MAP[d.severity ?? 1] ?? "ERROR",
          line: (d.range?.start?.line ?? 0) + 1,
          col: (d.range?.start?.character ?? 0) + 1,
          message: d.message ?? "",
          source: d.source,
        }));

        this.diagnosticsCache.set(uri, formatted);

        // Notify waiters for this URI
        const waiters = this.diagnosticWaiters.get(uri);
        if (waiters) {
          for (const cb of waiters) cb();
        }
      },
    );

    // Handle common server-initiated requests
    this.connection.onRequest(
      "workspace/configuration",
      async () => [this.config.initialization ?? {}],
    );
    this.connection.onRequest(
      "window/workDoneProgress/create",
      () => null,
    );
    this.connection.onRequest(
      "client/registerCapability",
      async () => {},
    );
    this.connection.onRequest(
      "workspace/workspaceFolders",
      async () => [
        {
          name: "workspace",
          uri: pathToFileURL(this.rootPath).href,
        },
      ],
    );

    this.connection.listen();

    // Initialize handshake (with timeout — hung servers must not block forever)
    const rootUri = pathToFileURL(this.rootPath).href;
    const initParams = {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ name: "workspace", uri: rootUri }],
      capabilities: {
        textDocument: {
          synchronization: {
            didOpen: true,
            didChange: true,
            willSave: false,
            willSaveWaitUntil: false,
            didSave: true,
            dynamicRegistration: false,
          },
          publishDiagnostics: {
            relatedInformation: true,
            versionSupport: true,
          },
        },
        workspace: {
          configuration: true,
          workspaceFolders: true,
        },
      },
      initializationOptions: this.config.initialization ?? {},
    };

    try {
      await Promise.race([
        this.connection.sendRequest("initialize", initParams),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(
              new Error(
                `LSP server "${this.serverName}" initialize timed out after ${LSP_INITIALIZE_TIMEOUT_MS}ms`,
              ),
            );
          }, LSP_INITIALIZE_TIMEOUT_MS);
        }),
      ]);
      await this.connection.sendNotification("initialized", {});
    } catch (err) {
      this.abortStartup();
      if (err instanceof Error) throw err;
      throw new Error(String(err));
    }

    this._isRunning = true;
    this.restartAttempts = 0;

    // Handle process exit
    this.process.on("exit", () => {
      this._isRunning = false;
      this.connection?.dispose();
      this.connection = null;
      this.process = null;
    });

    // Suppress stderr (LSP servers often log debug info there)
    this.process.stderr?.resume();
  }

  /** Gracefully shut down the LSP server. */
  async stop(): Promise<void> {
    if (!this.connection || !this.process) return;

    try {
      await this.connection.sendRequest("shutdown");
      await this.connection.sendNotification("exit");
    } catch {
      // Server may already be dead
    }

    this.connection.dispose();
    this.process.kill();
    this._isRunning = false;
    this.connection = null;
    this.process = null;
    this.diagnosticsCache.clear();
    this.openedFiles.clear();
    this.fileVersions.clear();
    this.diagnosticWaiters.clear();
  }

  // ─── File operations ─────────────────────────────────────────────────────────

  /**
   * Notify the LSP server about a file change and optionally wait for diagnostics.
   *
   * On first call for a file, sends textDocument/didOpen.
   * On subsequent calls, sends textDocument/didChange with full content.
   */
  async touchFile(
    filePath: string,
    waitForDiagnostics = true,
  ): Promise<void> {
    if (!this.isRunning || !this.connection) return;

    const uri = pathToFileURL(filePath).href;
    const content = await Bun.file(filePath).text();
    const languageId = getLanguageId(filePath);

    if (!this.openedFiles.has(uri)) {
      // First time: didOpen
      this.openedFiles.add(uri);
      this.fileVersions.set(uri, 1);
      await this.connection.sendNotification("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId,
          version: 1,
          text: content,
        },
      });
    } else {
      // Subsequent: didChange with full content
      const version = (this.fileVersions.get(uri) ?? 1) + 1;
      this.fileVersions.set(uri, version);
      await this.connection.sendNotification("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text: content }],
      });
    }

    if (waitForDiagnostics) {
      await this.waitForDiagnostics(uri);
    }
  }

  // ─── Diagnostics ────────────────────────────────────────────────────────────

  /** Get cached diagnostics for a specific file. */
  getDiagnostics(filePath: string): FormattedDiagnostic[] {
    const uri = pathToFileURL(filePath).href;
    return this.diagnosticsCache.get(uri) ?? [];
  }

  /** Get all cached diagnostics (URI → diagnostics). */
  getAllDiagnostics(): Map<string, FormattedDiagnostic[]> {
    return new Map(this.diagnosticsCache);
  }

  /**
   * Wait for publishDiagnostics notification with debounce and timeout.
   *
   * Debounce: wait DIAGNOSTICS_DEBOUNCE_MS after LAST notification.
   * Timeout: give up after DIAGNOSTICS_TIMEOUT_MS total.
   */
  private waitForDiagnostics(uri: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const startTime = Date.now();
      let debounceTimer: ReturnType<typeof setTimeout> | undefined;
      let resolved = false;

      const finish = () => {
        if (resolved) return;
        resolved = true;
        if (debounceTimer) clearTimeout(debounceTimer);
        // Remove this waiter
        const waiters = this.diagnosticWaiters.get(uri);
        if (waiters) {
          const idx = waiters.indexOf(onDiagnostic);
          if (idx >= 0) waiters.splice(idx, 1);
          if (waiters.length === 0) this.diagnosticWaiters.delete(uri);
        }
        resolve();
      };

      const onDiagnostic = () => {
        if (debounceTimer) clearTimeout(debounceTimer);

        // Check if we've exceeded total timeout
        if (Date.now() - startTime >= DIAGNOSTICS_TIMEOUT_MS) {
          finish();
          return;
        }

        // Debounce: wait for quiet period after last notification
        debounceTimer = setTimeout(finish, DIAGNOSTICS_DEBOUNCE_MS);
      };

      // Register waiter
      if (!this.diagnosticWaiters.has(uri)) {
        this.diagnosticWaiters.set(uri, []);
      }
      this.diagnosticWaiters.get(uri)!.push(onDiagnostic);

      // Overall timeout
      setTimeout(finish, DIAGNOSTICS_TIMEOUT_MS);
    });
  }
}