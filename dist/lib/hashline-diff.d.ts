/**
 * hashline-diff.ts — Unified diff utility for hashline_edit dry-run mode.
 *
 * Produces standard unified diff output using an LCS-based algorithm.
 * No external dependencies.
 */
export interface UnifiedDiffOptions {
    /** Path label used in the `--- a/<oldPath>` header. */
    oldPath: string;
    /** Path label used in the `+++ b/<newPath>` header. */
    newPath: string;
    /** Original file lines (before edits). */
    oldLines: string[];
    /** New file lines (after edits). */
    newLines: string[];
    /** Lines of context around each change (default 3). */
    contextLines?: number;
}
/**
 * Build a unified diff string between two arrays of lines.
 *
 * Header rules:
 * - Normal edit:     `--- a/<oldPath>` / `+++ b/<newPath>`
 * - File creation:   `--- /dev/null`   / `+++ b/<newPath>`
 * - File deletion:   `--- a/<oldPath>` / `+++ /dev/null`
 * - Edit + move:     `--- a/<oldPath>` / `+++ b/<newPath>` (different paths)
 *
 * @returns Unified diff string, or empty string if there are no differences.
 */
export declare function buildUnifiedDiff(options: UnifiedDiffOptions): string;
//# sourceMappingURL=hashline-diff.d.ts.map