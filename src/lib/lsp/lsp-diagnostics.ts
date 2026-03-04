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

import { LspManager } from "./lsp-manager";
import type { FormattedDiagnostic } from "./types";
import { MAX_DIAGNOSTICS_PER_FILE, MAX_OTHER_FILES } from "./types";
import { relative, isAbsolute } from "path";
import { fileURLToPath } from "node:url";

/**
 * Format a single diagnostic line: "SEVERITY [line:col] message"
 * If source is present, prefix message with "[source] "
 */
function formatDiagnosticLine(d: FormattedDiagnostic): string {
  const source = d.source ? `[${d.source}] ` : "";
  return `${d.severity} [${d.line}:${d.col}] ${source}${d.message}`;
}

/**
 * Format diagnostics for a single file into the XML-wrapped format.
 *
 * @param filePath Relative file path for display
 * @param diagnostics Array of formatted diagnostics
 * @param maxCount Maximum diagnostics to include before truncating
 */
function formatFileDiagnostics(
  filePath: string,
  diagnostics: FormattedDiagnostic[],
  maxCount: number = MAX_DIAGNOSTICS_PER_FILE,
): string {
  if (diagnostics.length === 0) return "";

  // Sort by severity (ERROR first), then by line number
  const sorted = [...diagnostics].sort((a, b) => {
    const severityOrder: Record<string, number> = { ERROR: 0, WARN: 1, INFO: 2, HINT: 3 };
    const sa = severityOrder[a.severity] ?? 4;
    const sb = severityOrder[b.severity] ?? 4;
    if (sa !== sb) return sa - sb;
    return a.line - b.line;
  });

  const truncated = sorted.slice(0, maxCount);
  const lines = truncated.map(formatDiagnosticLine);

  if (sorted.length > maxCount) {
    lines.push(`... and ${sorted.length - maxCount} more diagnostics`);
  }

  return `<diagnostics file="${filePath}">\n${lines.join("\n")}\n</diagnostics>`;
}

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
export async function collectAndFormatDiagnostics(
  editedFilePath: string,
  baseDir: string,
): Promise<string> {
  // Get the LSP client for this file type
  const client = await LspManager.getClientForFile(editedFilePath);
  if (!client) return "";

  // Touch the file — this sends didOpen/didChange and waits for publishDiagnostics
  try {
    await client.touchFile(editedFilePath, true);
  } catch {
    return ""; // LSP failure should never block the edit
  }

  const sections: string[] = [];

  // 1. Diagnostics for the edited file
  const editedRelPath = makeRelative(editedFilePath, baseDir);
  const editedDiags = client.getDiagnostics(editedFilePath);
  if (editedDiags.length > 0) {
    sections.push(formatFileDiagnostics(editedRelPath, editedDiags));
  }

  // 2. Diagnostics from other project files (from ALL active LSP clients)
  const otherFileSections: string[] = [];
  const allClients = LspManager.getActiveClients();

  for (const c of allClients) {
    const allDiags = c.getAllDiagnostics();
    for (const [uri, diags] of allDiags) {
      // Convert URI to file path
      let filePath: string;
      try {
        filePath = fileURLToPath(uri);
      } catch {
        continue; // Skip non-file URIs
      }

      // Skip the edited file (already handled above)
      if (filePath === editedFilePath) continue;

      // Only include files with errors or warnings
      const significant = diags.filter(
        (d) => d.severity === "ERROR" || d.severity === "WARN",
      );
      if (significant.length === 0) continue;

      const relPath = makeRelative(filePath, baseDir);
      otherFileSections.push(
        formatFileDiagnostics(relPath, significant),
      );

      if (otherFileSections.length >= MAX_OTHER_FILES) break;
    }

    if (otherFileSections.length >= MAX_OTHER_FILES) break;
  }

  sections.push(...otherFileSections);

  if (sections.length === 0) return "";
  return "\n\n" + sections.join("\n\n");
}

/** Make a path relative to baseDir for display. */
function makeRelative(filePath: string, baseDir: string): string {
  if (isAbsolute(filePath)) {
    return relative(baseDir, filePath);
  }
  return filePath;
}

// Export for testing
export { formatDiagnosticLine, formatFileDiagnostics };