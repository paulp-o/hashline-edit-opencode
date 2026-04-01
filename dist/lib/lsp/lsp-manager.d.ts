/**
 * lsp-manager.ts — Multi-server LSP orchestrator.
 *
 * Routes files to the correct LSP server based on file extension,
 * lazily spawns servers on first use, and handles crash recovery.
 *
 * Supports automatic LSP server detection: scans project files,
 * checks PATH for known LSP servers, and registers them for lazy startup.
 */
import { LspClient } from "./lsp-client";
import type { LspConfig, LspDetectionResult } from "./types";
/**
 * Singleton orchestrator that manages multiple LSP server connections.
 *
 * Usage:
 *   const result = await LspManager.autoConfigure(projectRoot);
 *   const client = await LspManager.getClientForFile("src/index.ts");
 *   if (client) { await client.touchFile(...); }
 *   await LspManager.stopAll();
 */
export declare class LspManager {
    private static instance;
    private config;
    private rootPath;
    private clients;
    private extensionToServer;
    private detectionResult;
    private constructor();
    /**
     * Scan project files to discover which file extensions are present.
     * Tries `git ls-files` first (fast, respects .gitignore), falls back
     * to a shallow directory scan.
     */
    private scanProjectFiles;
    /**
     * Scan a single directory (non-recursively) and collect file extensions.
     */
    private scanDirectory;
    /**
     * Check which LSP servers from the registry are available in PATH,
     * filtered to only languages whose extensions were detected.
     */
    private checkServerAvailability;
    /**
     * Auto-detect LSP servers for the project and register them for lazy startup.
     *
     * Does **not** spawn LSP processes here — that used to block OpenCode plugin load
     * indefinitely when `initialize` hung. Servers start on first diagnostic use via
     * `getClientForFile()`.
     *
     * 1. Scans project files to discover file extensions
     * 2. Matches extensions against the built-in LSP registry
     * 3. Checks PATH for available LSP server executables
     * 4. Builds config and extension map for available servers
     * 5. Records which servers were found on PATH (`detected[].started` is always false — lazy)
     *
     * @returns Detection result with available and missing servers
     */
    static autoConfigure(projectRoot: string): Promise<LspDetectionResult>;
    /** Keep configure() for backward compatibility / testing. */
    static configure(config: LspConfig, rootPath: string): void;
    /** Check if the manager has been configured (via configure or autoConfigure). */
    static isConfigured(): boolean;
    /** Get the detection result from the last autoConfigure() call. */
    static getDetectionResult(): LspDetectionResult | undefined;
    /**
     * Get (or lazily create) the LSP client responsible for a given file.
     * Returns null if no LSP server is configured for this file type.
     */
    static getClientForFile(filePath: string): Promise<LspClient | null>;
    /** Get ALL active LSP clients (for collecting project-wide diagnostics). */
    static getActiveClients(): LspClient[];
    /** Stop all LSP servers and reset state. */
    static stopAll(): Promise<void>;
    /** Full reset — stop all servers and clear singleton. */
    static reset(): Promise<void>;
}
//# sourceMappingURL=lsp-manager.d.ts.map