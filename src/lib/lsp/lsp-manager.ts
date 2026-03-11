/**
 * lsp-manager.ts — Multi-server LSP orchestrator.
 *
 * Routes files to the correct LSP server based on file extension,
 * lazily spawns servers on first use, and handles crash recovery.
 *
 * Supports automatic LSP server detection: scans project files,
 * checks PATH for known LSP servers, and auto-starts available ones.
 */

import { LspClient } from "./lsp-client";
import type {
  LspConfig,
  LspServerConfig,
  LspServerInfo,
  LspDetectionResult,
} from "./types";
import { isActiveServerConfig, MAX_RESTART_ATTEMPTS, LSP_REGISTRY } from "./types";
import { extname, join } from "path";
import { readdir } from "fs/promises";
import { $ } from "bun";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Directories to exclude when scanning for project files */
const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "out",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  "target",
  ".idea",
  ".vscode",
]);

/** Common subdirectories to scan for source files (shallow scan fallback) */
const SCAN_SUBDIRS = ["src", "lib", "app", "pages", "components", "packages"];

/** Install hints for known LSP servers */
const INSTALL_HINTS: Record<string, string> = {
  typescript: "npm install -g typescript-language-server typescript",
  python: "pip install pyright",
  rust: "rustup component add rust-analyzer",
  go: "go install golang.org/x/tools/gopls@latest",
  "c-cpp": "apt install clangd (Linux) / brew install llvm (macOS)",
  java: "See https://github.com/eclipse-jdtls/eclipse.jdt.ls",
  ruby: "gem install ruby-lsp",
  php: "npm install -g intelephense",
  csharp: "dotnet tool install -g csharp-ls",
  swift: "Included with Xcode",
  kotlin: "See https://github.com/fwcd/kotlin-language-server",
  scala: "See https://scalameta.org/metals/docs/editors/new-editor",
  zig: "See https://github.com/zigtools/zls",
  vue: "npm install -g @vue/language-server",
  svelte: "npm install -g svelte-language-server",
  lua: "See https://github.com/LuaLS/lua-language-server",
  yaml: "npm install -g yaml-language-server",
  css: "npm install -g vscode-langservers-extracted",
  html: "npm install -g vscode-langservers-extracted",
  json: "npm install -g vscode-langservers-extracted",
  toml: "cargo install taplo-cli",
};

/**
 * Singleton orchestrator that manages multiple LSP server connections.
 *
 * Usage:
 *   const result = await LspManager.autoConfigure(projectRoot);
 *   const client = await LspManager.getClientForFile("src/index.ts");
 *   if (client) { await client.touchFile(...); }
 *   await LspManager.stopAll();
 */
export class LspManager {
  private static instance: LspManager | null = null;

  private config: LspConfig = {};
  private rootPath = "";
  private clients = new Map<string, LspClient>(); // serverName → LspClient
  private extensionToServer = new Map<string, string>(); // ".ts" → "typescript"
  private detectionResult: LspDetectionResult | undefined;

  private constructor() {}

  // ─── Project File Scanning ────────────────────────────────────────────────

  /**
   * Scan project files to discover which file extensions are present.
   * Tries `git ls-files` first (fast, respects .gitignore), falls back
   * to a shallow directory scan.
   */
  private async scanProjectFiles(
    projectRoot: string,
  ): Promise<Set<string>> {
    const extensions = new Set<string>();

    // Strategy 1: git ls-files (fastest, most accurate)
    try {
      const result = await $`git ls-files`.cwd(projectRoot).text();
      const files = result.trim().split("\n").filter(Boolean);
      for (const file of files) {
        const ext = extname(file).toLowerCase();
        if (ext) extensions.add(ext);
      }
      if (extensions.size > 0) return extensions;
    } catch {
      // git not available or not a git repo — fall through to shallow scan
    }

    // Strategy 2: Shallow scan of root + common subdirectories
    await this.scanDirectory(projectRoot, extensions, false);

    for (const subdir of SCAN_SUBDIRS) {
      const subdirPath = join(projectRoot, subdir);
      try {
        await this.scanDirectory(subdirPath, extensions, false);
      } catch {
        // Directory doesn't exist — skip
      }
    }

    // Also scan packages/*/ for monorepos
    try {
      const packagesDir = join(projectRoot, "packages");
      const packageEntries = await readdir(packagesDir, {
        withFileTypes: true,
      });
      for (const entry of packageEntries) {
        if (entry.isDirectory() && !EXCLUDED_DIRS.has(entry.name)) {
          const pkgPath = join(packagesDir, entry.name);
          await this.scanDirectory(pkgPath, extensions, false);
          // Also scan src/ inside each package
          try {
            await this.scanDirectory(
              join(pkgPath, "src"),
              extensions,
              false,
            );
          } catch {
            // No src/ in this package
          }
        }
      }
    } catch {
      // No packages/ directory
    }

    return extensions;
  }

  /**
   * Scan a single directory (non-recursively) and collect file extensions.
   */
  private async scanDirectory(
    dirPath: string,
    extensions: Set<string>,
    _recursive: boolean,
  ): Promise<void> {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) continue; // shallow — skip subdirs
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      const ext = extname(entry.name).toLowerCase();
      if (ext) extensions.add(ext);
    }
  }

  // ─── PATH Detection ──────────────────────────────────────────────────────

  /**
   * Check which LSP servers from the registry are available in PATH,
   * filtered to only languages whose extensions were detected.
   */
  private async checkServerAvailability(
    detectedExtensions: Set<string>,
  ): Promise<{
    available: Array<{ language: string; serverInfo: LspServerInfo }>;
    missing: Array<{ language: string; serverInfo: LspServerInfo }>;
  }> {
    // Find which registry entries match detected extensions
    const candidates: Array<{ language: string; serverInfo: LspServerInfo }> =
      [];

    for (const [language, serverInfo] of Object.entries(LSP_REGISTRY)) {
      const hasMatchingExtension = serverInfo.extensions.some((ext) =>
        detectedExtensions.has(ext),
      );
      if (hasMatchingExtension) {
        candidates.push({ language, serverInfo });
      }
    }

    // Check PATH for each candidate in parallel
    const results = await Promise.all(
      candidates.map(async (candidate) => {
        const command = candidate.serverInfo.command[0];
        const path = Bun.which(command);
        return { ...candidate, inPath: path !== null };
      }),
    );

    const available = results
      .filter((r) => r.inPath)
      .map(({ language, serverInfo }) => ({ language, serverInfo }));
    const missing = results
      .filter((r) => !r.inPath)
      .map(({ language, serverInfo }) => ({ language, serverInfo }));

    return { available, missing };
  }

  // ─── Static API ────────────────────────────────────────────────────────────

  /**
   * Auto-detect LSP servers for the project and start available ones.
   *
   * 1. Scans project files to discover file extensions
   * 2. Matches extensions against the built-in LSP registry
   * 3. Checks PATH for available LSP server executables
   * 4. Builds config and extension map for available servers
   * 5. Auto-starts available servers
   *
   * @returns Detection result with available and missing servers
   */
  static async autoConfigure(
    projectRoot: string,
  ): Promise<LspDetectionResult> {
    if (!LspManager.instance) {
      LspManager.instance = new LspManager();
    }
    const mgr = LspManager.instance;
    mgr.rootPath = projectRoot;
    mgr.config = {};
    mgr.extensionToServer.clear();

    // Step 1: Scan project files
    const detectedExtensions = await mgr.scanProjectFiles(projectRoot);

    // Step 2: Check server availability
    const { available, missing } =
      await mgr.checkServerAvailability(detectedExtensions);

    // Step 3: Build config and extension map for available servers
    for (const { language, serverInfo } of available) {
      const serverConfig: LspServerConfig = {
        command: serverInfo.command,
        extensions: serverInfo.extensions,
      };
      mgr.config[language] = serverConfig;

      for (const ext of serverInfo.extensions) {
        const normalizedExt = ext.startsWith(".") ? ext : `.${ext}`;
        mgr.extensionToServer.set(normalizedExt, language);
      }
    }

    // Step 4: Auto-start available servers by triggering lazy init
    const detected: LspDetectionResult["detected"] = [];
    const startPromises = available.map(async ({ language, serverInfo }) => {
      // Pick a representative extension to trigger getClientForFile
      const representativeExt = serverInfo.extensions[0];
      const fakePath = `__lsp_probe__${representativeExt}`;
      try {
        const client = await LspManager.getClientForFile(fakePath);
        detected.push({
          language,
          server: serverInfo.command[0],
          started: client !== null,
        });
      } catch {
        detected.push({
          language,
          server: serverInfo.command[0],
          started: false,
        });
      }
    });
    await Promise.all(startPromises);

    // Step 5: Build missing server list
    const missingResult: LspDetectionResult["missing"] = missing.map(
      ({ language, serverInfo }) => ({
        language,
        server: serverInfo.command[0],
        installHint:
          INSTALL_HINTS[language] ?? `Install ${serverInfo.command[0]}`,
      }),
    );

    // Store result
    const result: LspDetectionResult = {
      detected,
      missing: missingResult,
    };
    mgr.detectionResult = result;

    return result;
  }

  /** Keep configure() for backward compatibility / testing. */
  static configure(config: LspConfig, rootPath: string): void {
    if (!LspManager.instance) {
      LspManager.instance = new LspManager();
    }
    const mgr = LspManager.instance;
    mgr.config = config;
    mgr.rootPath = rootPath;

    // Build extension → server mapping
    mgr.extensionToServer.clear();
    for (const [serverName, serverConfig] of Object.entries(config)) {
      if (!isActiveServerConfig(serverConfig)) continue;
      const sc = serverConfig as LspServerConfig;
      if (sc.extensions) {
        for (const ext of sc.extensions) {
          const normalizedExt = ext.startsWith(".") ? ext : `.${ext}`;
          mgr.extensionToServer.set(normalizedExt, serverName);
        }
      }
    }
  }

  /** Check if the manager has been configured (via configure or autoConfigure). */
  static isConfigured(): boolean {
    return (
      LspManager.instance !== null &&
      Object.keys(LspManager.instance.config).length > 0
    );
  }

  /** Get the detection result from the last autoConfigure() call. */
  static getDetectionResult(): LspDetectionResult | undefined {
    return LspManager.instance?.detectionResult;
  }

  /**
   * Get (or lazily create) the LSP client responsible for a given file.
   * Returns null if no LSP server is configured for this file type.
   */
  static async getClientForFile(
    filePath: string,
  ): Promise<LspClient | null> {
    const mgr = LspManager.instance;
    if (!mgr) return null;

    const ext = extname(filePath).toLowerCase();
    const serverName = mgr.extensionToServer.get(ext);
    if (!serverName) return null;

    const serverConfig = mgr.config[serverName];
    if (!serverConfig || !isActiveServerConfig(serverConfig)) return null;

    // Return existing running client
    const existing = mgr.clients.get(serverName);
    if (existing?.isRunning) return existing;

    // Check if we've exceeded restart attempts
    if (existing && existing.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      return null; // Give up on this server
    }

    // Spawn new client (or restart crashed one)
    try {
      const client = new LspClient(
        serverName,
        serverConfig as LspServerConfig,
        mgr.rootPath,
      );
      if (existing) {
        client.restartAttempts = existing.restartAttempts + 1;
      }
      await client.start();
      mgr.clients.set(serverName, client);
      return client;
    } catch {
      // LSP server failed to start — don't block the edit
      return null;
    }
  }

  /** Get ALL active LSP clients (for collecting project-wide diagnostics). */
  static getActiveClients(): LspClient[] {
    const mgr = LspManager.instance;
    if (!mgr) return [];
    return Array.from(mgr.clients.values()).filter((c) => c.isRunning);
  }

  /** Stop all LSP servers and reset state. */
  static async stopAll(): Promise<void> {
    const mgr = LspManager.instance;
    if (!mgr) return;
    const stops = Array.from(mgr.clients.values()).map((c) =>
      c.stop().catch(() => {}),
    );
    await Promise.all(stops);
    mgr.clients.clear();
  }

  /** Full reset — stop all servers and clear singleton. */
  static async reset(): Promise<void> {
    await LspManager.stopAll();
    if (LspManager.instance) {
      LspManager.instance.detectionResult = undefined;
    }
    LspManager.instance = null;
  }
}
