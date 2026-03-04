/**
 * lsp-manager.ts — Multi-server LSP orchestrator.
 *
 * Routes files to the correct LSP server based on file extension,
 * lazily spawns servers on first use, and handles crash recovery.
 */

import { LspClient } from "./lsp-client";
import type { LspConfig, LspServerConfig } from "./types";
import { isActiveServerConfig, MAX_RESTART_ATTEMPTS } from "./types";
import { extname } from "path";

/**
 * Singleton orchestrator that manages multiple LSP server connections.
 *
 * Usage:
 *   LspManager.configure(lspConfig, rootPath);
 *   const client = await LspManager.getClientForFile("src/index.ts");
 *   if (client) { await client.touchFile(...); }
 *   await LspManager.stopAll();
 */
export class LspManager {
  private static instance: LspManager | null = null;

  private config: LspConfig = {};
  private rootPath = "";
  private clients = new Map<string, LspClient>(); // serverName → LspClient
  private extensionToServer = new Map<string, string>(); // ".ts" → "typescript-language-server"

  private constructor() {}

  // ─── Static API ────────────────────────────────────────────────────────────

  /** Configure or reconfigure the LSP manager. Safe to call multiple times. */
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
          // Normalize: ensure leading dot
          const normalizedExt = ext.startsWith(".") ? ext : `.${ext}`;
          mgr.extensionToServer.set(normalizedExt, serverName);
        }
      }
    }
  }

  /** Check if the manager has been configured. */
  static isConfigured(): boolean {
    return (
      LspManager.instance !== null &&
      Object.keys(LspManager.instance.config).length > 0
    );
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
    LspManager.instance = null;
  }
}