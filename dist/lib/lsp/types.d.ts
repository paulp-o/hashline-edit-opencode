/**
 * LSP diagnostics types and constants for the HashLine Edit plugin.
 */
export interface LspServerConfig {
    command: string[];
    extensions?: string[];
    disabled?: boolean;
    env?: Record<string, string>;
    initialization?: Record<string, unknown>;
}
export type LspConfig = Record<string, {
    disabled: true;
} | LspServerConfig>;
/** Info for an auto-detectable LSP server */
export interface LspServerInfo {
    command: string[];
    extensions: string[];
}
/** Result of automatic LSP server detection */
export interface LspDetectionResult {
    /** Servers found on PATH for this project; `started` is always false (lazy connect on first use). */
    detected: Array<{
        language: string;
        server: string;
        started: boolean;
    }>;
    missing: Array<{
        language: string;
        server: string;
        installHint: string;
    }>;
}
export type DiagnosticSeverity = "ERROR" | "WARN" | "INFO" | "HINT";
export interface FormattedDiagnostic {
    severity: DiagnosticSeverity;
    line: number;
    col: number;
    message: string;
    source?: string;
}
/** Maximum diagnostics to show per file before truncating */
export declare const MAX_DIAGNOSTICS_PER_FILE = 20;
/** Maximum number of other project files to report diagnostics for */
export declare const MAX_OTHER_FILES = 5;
/** Timeout for waiting for LSP diagnostics after file touch (ms) */
export declare const DIAGNOSTICS_TIMEOUT_MS = 3000;
/** Debounce period — wait this long after last diagnostic notification before collecting (ms) */
export declare const DIAGNOSTICS_DEBOUNCE_MS = 150;
/** Max time to wait for LSP `initialize` handshake before giving up (ms) */
export declare const LSP_INITIALIZE_TIMEOUT_MS = 15000;
/** Map file extensions to LSP language IDs */
export declare const EXTENSION_LANGUAGE_MAP: Record<string, string>;
/** Built-in registry of known LSP servers for auto-detection */
export declare const LSP_REGISTRY: Record<string, LspServerInfo>;
/** Get language ID for a file path, defaults to the extension without the dot */
export declare function getLanguageId(filePath: string): string;
/** Type guard: check if a config entry is an active server config (not disabled) */
export declare function isActiveServerConfig(config: {
    disabled: true;
} | LspServerConfig): config is LspServerConfig;
/** Max restart attempts for a crashed LSP server */
export declare const MAX_RESTART_ATTEMPTS = 3;
//# sourceMappingURL=types.d.ts.map