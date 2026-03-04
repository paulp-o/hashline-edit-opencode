/**
 * LSP diagnostics types and constants for the HashLine Edit plugin.
 */

// ─── Config types (mirrors opencode.json lsp schema) ────────────────────────

export interface LspServerConfig {
  command: string[];
  extensions?: string[];
  disabled?: boolean;
  env?: Record<string, string>;
  initialization?: Record<string, unknown>;
}

export type LspConfig = Record<string, { disabled: true } | LspServerConfig>;

// ─── Diagnostic types ────────────────────────────────────────────────────────

export type DiagnosticSeverity = "ERROR" | "WARN" | "INFO" | "HINT";

export interface FormattedDiagnostic {
  severity: DiagnosticSeverity;
  line: number;
  col: number;
  message: string;
  source?: string;
}

// ─── Constants (matching OpenCode's behavior) ────────────────────────────────

/** Maximum diagnostics to show per file before truncating */
export const MAX_DIAGNOSTICS_PER_FILE = 20;

/** Maximum number of other project files to report diagnostics for */
export const MAX_OTHER_FILES = 5;

/** Timeout for waiting for LSP diagnostics after file touch (ms) */
export const DIAGNOSTICS_TIMEOUT_MS = 3000;

/** Debounce period — wait this long after last diagnostic notification before collecting (ms) */
export const DIAGNOSTICS_DEBOUNCE_MS = 150;

/** Map file extensions to LSP language IDs */
export const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
  ".kt": "kotlin",
  ".scala": "scala",
  ".lua": "lua",
  ".zig": "zig",
  ".vue": "vue",
  ".svelte": "svelte",
  ".css": "css",
  ".scss": "scss",
  ".html": "html",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".md": "markdown",
};

/** Get language ID for a file path, defaults to the extension without the dot */
export function getLanguageId(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return EXTENSION_LANGUAGE_MAP[ext] ?? ext.slice(1);
}

/** Type guard: check if a config entry is an active server config (not disabled) */
export function isActiveServerConfig(
  config: { disabled: true } | LspServerConfig,
): config is LspServerConfig {
  return !("disabled" in config && config.disabled === true);
}

/** Max restart attempts for a crashed LSP server */
export const MAX_RESTART_ATTEMPTS = 3;