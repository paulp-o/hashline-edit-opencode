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
export interface EditOperation {
    op: "replace" | "append" | "prepend";
    pos?: string;
    end?: string;
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
}
/**
 * Parse raw EditOperations into normalized internal form.
 *
 * - Parses pos/end via parseTag()
 * - Normalizes lines via normalizeLines() then stripNewLinePrefixes()
 * - Validates: replace requires pos; end without pos is invalid
 */
export declare function collectEdits(edits: EditOperation[]): NormalizedEdit[];
/**
 * Remove duplicate identical edit operations.
 *
 * Two edits are identical when they share the same op, pos, end, and lines.
 */
export declare function deduplicateEdits(edits: NormalizedEdit[]): NormalizedEdit[];
/**
 * Validate ALL hash references in edits against actual file content.
 *
 * Collects ALL mismatches (does not stop at first), then throws
 * HashlineMismatchError if any are found. This is the "validate ALL
 * before ANY mutation" gate.
 */
export declare function validateAllHashes(edits: NormalizedEdit[], fileLines: string[]): void;
/**
 * Sort edits bottom-up for safe sequential application.
 *
 * - Primary: posLine descending (highest line first)
 * - Secondary (same line): replace(0) < append(1) < prepend(2) precedence
 * - Anchorless append (no pos): treated as Infinity → applied first
 * - Anchorless prepend (no pos): treated as 0 → applied last
 */
export declare function sortEditsBottomUp(edits: NormalizedEdit[]): NormalizedEdit[];
/**
 * Detect if an edit produces identical content (no-op).
 *
 * @returns Warning string if identical, null otherwise.
 */
export declare function detectNoOp(edit: NormalizedEdit, fileLines: string[]): string | null;
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
export declare function applyHashlineEdits(filePath: string, edits: EditOperation[]): Promise<ApplyResult>;
export {};
//# sourceMappingURL=hashline-apply.d.ts.map