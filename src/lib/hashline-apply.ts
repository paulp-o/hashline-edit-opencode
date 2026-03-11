/**
 * hashline-apply.ts — Edit application engine for the HashLine Edit plugin.
 *
 * Orchestrates the full edit lifecycle:
 *   1. Parse & normalize edit operations
 *   2. Deduplicate identical edits
 *   3. Validate ALL hashes before ANY mutation (atomic gate)
 *   4. Sort edits bottom-up (highest line first)
 *   5. Detect no-ops and collect warnings
 *   6. Apply edits sequentially on a working copy
 *   7. Write result atomically
 */

import { computeLineHash, parseTag, formatLineTag } from "./hashline-core";
import { HashlineMismatchError, type MismatchInfo } from "./hashline-errors";
import { stripNewLinePrefixes } from "./hashline-strip";
import { mkdir } from "fs/promises";
import { dirname } from "path";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EditOperation {
  op: "replace" | "append" | "prepend";
  pos?: string;   // "N#ID" anchor
  end?: string;   // "M#ID" anchor for range
  lines: string[] | string | null;
}

/** Internal normalized form after parsing. */
interface NormalizedEdit {
  op: "replace" | "append" | "prepend";
  posLine?: number;
  posHash?: string;
  endLine?: number;
  endHash?: string;
  lines: string[];
}

export interface ApplyResult {
  content: string;
  lineCountDelta: number;
  warnings: string[];
  /** Original file lines before edits were applied. */
  originalLines: string[];
}

// ─── Utility Functions ───────────────────────────────────────────────────────

/**
 * Normalize the `lines` parameter from an EditOperation.
 *
 * - null/undefined → []
 * - string → [string]
 * - array → array as-is
 */
function normalizeLines(lines: string[] | string | null | undefined): string[] {
  if (lines == null) return [];
  if (typeof lines === "string") return [lines];
  return lines;
}

// ─── Collection & Parsing ────────────────────────────────────────────────────

/**
 * Parse raw EditOperations into normalized internal form.
 *
 * - Parses pos/end via parseTag()
 * - Normalizes lines via normalizeLines() then stripNewLinePrefixes()
 * - Validates: replace requires pos; end without pos is invalid
 */
export function collectEdits(edits: EditOperation[]): NormalizedEdit[] {
  const result: NormalizedEdit[] = [];

  for (const edit of edits) {
    const normalized: NormalizedEdit = {
      op: edit.op,
      lines: stripNewLinePrefixes(normalizeLines(edit.lines)),
    };

    // Parse pos anchor
    if (edit.pos != null) {
      const parsed = parseTag(edit.pos);
      if (!parsed) {
        throw new Error(`Invalid pos reference: "${edit.pos}"`);
      }
      normalized.posLine = parsed.line;
      normalized.posHash = parsed.hash;
    }

    // Parse end anchor
    if (edit.end != null) {
      const parsed = parseTag(edit.end);
      if (!parsed) {
        throw new Error(`Invalid end reference: "${edit.end}"`);
      }
      if (normalized.posLine == null) {
        throw new Error(`"end" anchor provided without "pos": end="${edit.end}"`);
      }
      normalized.endLine = parsed.line;
      normalized.endHash = parsed.hash;
    }

    // Validate: replace requires pos
    if (edit.op === "replace" && normalized.posLine == null) {
      throw new Error(`"replace" operation requires a "pos" anchor`);
    }

    result.push(normalized);
  }

  return result;
}

// ─── Deduplication ───────────────────────────────────────────────────────────

/**
 * Remove duplicate identical edit operations.
 *
 * Two edits are identical when they share the same op, pos, end, and lines.
 */
export function deduplicateEdits(edits: NormalizedEdit[]): NormalizedEdit[] {
  const seen = new Map<string, NormalizedEdit>();

  for (const edit of edits) {
    const key = `${edit.op}|${edit.posLine ?? ""}#${edit.posHash ?? ""}|${edit.endLine ?? ""}#${edit.endHash ?? ""}|${JSON.stringify(edit.lines)}`;
    if (!seen.has(key)) {
      seen.set(key, edit);
    }
  }

  return Array.from(seen.values());
}

// ─── Hash Validation ─────────────────────────────────────────────────────────

/**
 * Validate ALL hash references in edits against actual file content.
 *
 * Collects ALL mismatches (does not stop at first), then throws
 * HashlineMismatchError if any are found. This is the "validate ALL
 * before ANY mutation" gate.
 */
export function validateAllHashes(
  edits: NormalizedEdit[],
  fileLines: string[],
): void {
  const mismatches: MismatchInfo[] = [];

  for (const edit of edits) {
    // Validate pos anchor
    if (edit.posLine != null && edit.posHash != null) {
      if (edit.posLine < 1 || edit.posLine > fileLines.length) {
        mismatches.push({
          line: edit.posLine,
          expected: edit.posHash,
          actual: "(out of range)",
          content: "",
        });
      } else {
        const actual = computeLineHash(fileLines[edit.posLine - 1], edit.posLine);
        if (actual !== edit.posHash) {
          mismatches.push({
            line: edit.posLine,
            expected: edit.posHash,
            actual,
            content: fileLines[edit.posLine - 1],
          });
        }
      }
    }

    // Validate end anchor
    if (edit.endLine != null && edit.endHash != null) {
      if (edit.endLine < 1 || edit.endLine > fileLines.length) {
        mismatches.push({
          line: edit.endLine,
          expected: edit.endHash,
          actual: "(out of range)",
          content: "",
        });
      } else {
        const actual = computeLineHash(fileLines[edit.endLine - 1], edit.endLine);
        if (actual !== edit.endHash) {
          mismatches.push({
            line: edit.endLine,
            expected: edit.endHash,
            actual,
            content: fileLines[edit.endLine - 1],
          });
        }
      }
    }
  }

  if (mismatches.length > 0) {
    throw new HashlineMismatchError(mismatches, fileLines, formatLineTag);
  }
}

// ─── Sorting ─────────────────────────────────────────────────────────────────

/**
 * Sort edits bottom-up for safe sequential application.
 *
 * - Primary: posLine descending (highest line first)
 * - Secondary (same line): replace(0) < append(1) < prepend(2) precedence
 * - Anchorless append (no pos): treated as Infinity → applied first
 * - Anchorless prepend (no pos): treated as 0 → applied last
 */
export function sortEditsBottomUp(edits: NormalizedEdit[]): NormalizedEdit[] {
  const OP_PRECEDENCE: Record<string, number> = {
    replace: 0,
    append: 1,
    prepend: 2,
  };

  return [...edits].sort((a, b) => {
    const aLine = getEffectiveLine(a);
    const bLine = getEffectiveLine(b);

    // Primary: descending by line number
    if (aLine !== bLine) return bLine - aLine;

    // Secondary: by op precedence (ascending within same line)
    return OP_PRECEDENCE[a.op] - OP_PRECEDENCE[b.op];
  });
}

/**
 * Get the effective line number for sorting.
 * Anchorless append → Infinity (applied first in bottom-up)
 * Anchorless prepend → 0 (applied last in bottom-up)
 */
function getEffectiveLine(edit: NormalizedEdit): number {
  if (edit.posLine != null) return edit.posLine;
  if (edit.op === "append") return Infinity;
  if (edit.op === "prepend") return 0;
  return 0;
}

// ─── No-Op Detection ─────────────────────────────────────────────────────────

/**
 * Detect if an edit produces identical content (no-op).
 *
 * @returns Warning string if identical, null otherwise.
 */
export function detectNoOp(
  edit: NormalizedEdit,
  fileLines: string[],
): string | null {
  if (edit.op !== "replace") return null;
  if (edit.posLine == null) return null;

  if (edit.endLine != null) {
    // Range replace: compare slice
    const original = fileLines.slice(edit.posLine - 1, edit.endLine);
    if (
      original.length === edit.lines.length &&
      original.every((line, i) => line === edit.lines[i])
    ) {
      return `No-op: replace range ${edit.posLine}-${edit.endLine} produces identical content`;
    }
  } else {
    // Single line replace
    if (
      edit.lines.length === 1 &&
      fileLines[edit.posLine - 1] === edit.lines[0]
    ) {
      return `No-op: replace at line ${edit.posLine} produces identical content`;
    }
  }

  return null;
}

// ─── Apply Operations ────────────────────────────────────────────────────────

/**
 * Apply a replace operation.
 *
 * - Single line: splice(posLine-1, 1, ...lines)
 * - Range: splice(posLine-1, endLine-posLine+1, ...lines)
 * - Delete (lines=[]): splice with 0 replacements
 */
function applyReplace(edit: NormalizedEdit, lines: string[]): string[] {
  const result = [...lines];
  const pos = edit.posLine!; // validated earlier

  if (edit.endLine != null) {
    // Range replace
    const count = edit.endLine - pos + 1;
    result.splice(pos - 1, count, ...edit.lines);
  } else {
    // Single line replace (or delete if edit.lines is empty)
    result.splice(pos - 1, 1, ...edit.lines);
  }

  return result;
}

/**
 * Apply an append operation.
 *
 * - With pos: insert AFTER posLine
 * - Without pos (EOF): push to end
 */
function applyAppend(edit: NormalizedEdit, lines: string[]): string[] {
  const result = [...lines];

  if (edit.posLine != null) {
    // Insert after posLine
    result.splice(edit.posLine, 0, ...edit.lines);
  } else {
    // EOF append
    result.push(...edit.lines);
  }

  return result;
}

/**
 * Apply a prepend operation.
 *
 * - With pos: insert BEFORE posLine
 * - Without pos (BOF): unshift to beginning
 */
function applyPrepend(edit: NormalizedEdit, lines: string[]): string[] {
  const result = [...lines];

  if (edit.posLine != null) {
    // Insert before posLine
    result.splice(edit.posLine - 1, 0, ...edit.lines);
  } else {
    // BOF prepend
    result.unshift(...edit.lines);
  }

  return result;
}

// ─── Main Orchestrator ───────────────────────────────────────────────────────

/**
 * Apply hashline edits to a file.
 *
 * Full lifecycle:
 *   1. Read file (or start with "" for new file via anchorless append)
 *   2. Split into lines
 *   3. collectEdits → deduplicateEdits → validateAllHashes → sortEditsBottomUp
 *   4. Collect no-op warnings
 *   5. Apply edits sequentially (each returns new array)
 *   6. Write result atomically
 *   7. Return { content, lineCountDelta, warnings }
 */
export async function applyHashlineEdits(
  filePath: string,
  edits: EditOperation[],
  options?: { dryRun?: boolean },
): Promise<ApplyResult> {
  // Step 1: Read file content
  let fileContent: string;
  try {
    fileContent = await Bun.file(filePath).text();
  } catch {
    // Check if we have only anchorless appends (file creation)
    const hasOnlyAnchorlessAppends = edits.every(
      (e) => e.op === "append" && e.pos == null,
    );
    if (hasOnlyAnchorlessAppends) {
      fileContent = "";
    } else {
      throw new Error(`File not found: ${filePath}`);
    }
  }

  // Step 2: Split into lines
  const fileLines = fileContent.length === 0 ? [] : fileContent.split("\n");
  const originalLineCount = fileLines.length;

  // Step 3: Pipeline — collect → deduplicate → validate → sort
  const collected = collectEdits(edits);
  const deduplicated = deduplicateEdits(collected);
  validateAllHashes(deduplicated, fileLines);
  const sorted = sortEditsBottomUp(deduplicated);

  // Step 4: Collect no-op warnings
  const warnings: string[] = [];
  for (const edit of sorted) {
    const warning = detectNoOp(edit, fileLines);
    if (warning) {
      warnings.push(warning);
    }
  }

  // Step 5: Apply edits sequentially on a working copy
  let working = [...fileLines];
  for (const edit of sorted) {
    switch (edit.op) {
      case "replace":
        working = applyReplace(edit, working);
        break;
      case "append":
        working = applyAppend(edit, working);
        break;
      case "prepend":
        working = applyPrepend(edit, working);
        break;
    }
  }

  // Step 6: Write result — skip when dry-run mode is active
  const result = working.join("\n");
  if (!options?.dryRun) {
    await mkdir(dirname(filePath), { recursive: true });
    await Bun.write(filePath, result);
  }

  // Step 7: Return result
  return {
    content: result,
    lineCountDelta: working.length - originalLineCount,
    warnings,
    originalLines: fileLines,
  };
}
