/**
 * lsp-client.ts — Single LSP server connection manager.
 *
 * Spawns an LSP server as a child process, communicates via JSON-RPC over stdio,
 * and caches diagnostics received from textDocument/publishDiagnostics notifications.
 */
import type { LspServerConfig, FormattedDiagnostic } from "./types";
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
export declare class LspClient {
    readonly serverName: string;
    readonly config: LspServerConfig;
    private rootPath;
    private process;
    private connection;
    private diagnosticsCache;
    private openedFiles;
    private fileVersions;
    private _isRunning;
    restartAttempts: number;
    private diagnosticWaiters;
    constructor(serverName: string, config: LspServerConfig, rootPath: string);
    get isRunning(): boolean;
    /** Tear down a failed or timed-out start before `initialized` completes. */
    private abortStartup;
    start(): Promise<void>;
    /** Gracefully shut down the LSP server. */
    stop(): Promise<void>;
    /**
     * Notify the LSP server about a file change and optionally wait for diagnostics.
     *
     * On first call for a file, sends textDocument/didOpen.
     * On subsequent calls, sends textDocument/didChange with full content.
     */
    touchFile(filePath: string, waitForDiagnostics?: boolean): Promise<void>;
    /** Get cached diagnostics for a specific file. */
    getDiagnostics(filePath: string): FormattedDiagnostic[];
    /** Get all cached diagnostics (URI → diagnostics). */
    getAllDiagnostics(): Map<string, FormattedDiagnostic[]>;
    /**
     * Wait for publishDiagnostics notification with debounce and timeout.
     *
     * Debounce: wait DIAGNOSTICS_DEBOUNCE_MS after LAST notification.
     * Timeout: give up after DIAGNOSTICS_TIMEOUT_MS total.
     */
    private waitForDiagnostics;
}
//# sourceMappingURL=lsp-client.d.ts.map