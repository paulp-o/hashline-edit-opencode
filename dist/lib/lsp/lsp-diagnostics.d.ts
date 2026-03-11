/**
 * lsp-diagnostics.ts — Diagnostics collection and formatting.
 *
 * Collects LSP diagnostics after file edits and formats them
 * to match OpenCode's built-in edit tool output format:
 *
 *   <diagnostics file="src/index.ts">
 *   ERROR [12:5] 'foo' is not defined
 *   WARN [30:1] Unused import
 *   </diagnostics>
 */
import type { FormattedDiagnostic } from "./types";
/**
 * Format a single diagnostic line: "SEVERITY [line:col] message"
 * If source is present, prefix message with "[source] "
 */
declare function formatDiagnosticLine(d: FormattedDiagnostic): string;
/**
 * Format diagnostics for a single file into the XML-wrapped format.
 *
 * @param filePath Relative file path for display
 * @param diagnostics Array of formatted diagnostics
 * @param maxCount Maximum diagnostics to include before truncating
 */
declare function formatFileDiagnostics(filePath: string, diagnostics: FormattedDiagnostic[], maxCount?: number): string;
/**
 * Collect and format diagnostics after a file edit.
 *
 * This is the main entry point called from hashline_edit after a successful edit.
 *
 * Steps:
 * 1. Touch the edited file on its LSP server (triggers re-analysis + waits for diagnostics)
 * 2. Collect diagnostics for the edited file
 * 3. Collect diagnostics from other project files (up to MAX_OTHER_FILES)
 * 4. Format everything into OpenCode's XML diagnostic format
 *
 * @param editedFilePath Absolute path of the file that was just edited
 * @param baseDir Project root for making paths relative
 * @returns Formatted diagnostics string, or empty string if no diagnostics
 */
export declare function collectAndFormatDiagnostics(editedFilePath: string, baseDir: string): Promise<string>;
export { formatDiagnosticLine, formatFileDiagnostics };
//# sourceMappingURL=lsp-diagnostics.d.ts.map