/**
 * hashline-diff.ts — Unified diff utility for hashline_edit dry-run mode.
 *
 * Produces standard unified diff output using an LCS-based algorithm.
 * No external dependencies.
 */

// ─── Public Types ─────────────────────────────────────────────────────────────

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

// ─── Internal Types ───────────────────────────────────────────────────────────

type DiffChange =
  | { type: "equal"; oldIndex: number; newIndex: number }
  | { type: "delete"; oldIndex: number }
  | { type: "insert"; newIndex: number };

interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

// ─── LCS Algorithm ───────────────────────────────────────────────────────────

/**
 * Compute the Longest Common Subsequence DP table for two string arrays.
 * dp[i][j] = LCS length of a[0..i-1] and b[0..j-1].
 */
function computeLCS(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp;
}

/**
 * Backtrack through the LCS table to produce an ordered diff sequence.
 * Each entry is tagged as equal, delete (in old only), or insert (in new only).
 */
function backtrack(
  dp: number[][],
  a: string[],
  b: string[],
): DiffChange[] {
  const changes: DiffChange[] = [];
  let i = a.length;
  let j = b.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      changes.unshift({ type: "equal", oldIndex: i - 1, newIndex: j - 1 });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      changes.unshift({ type: "insert", newIndex: j - 1 });
      j--;
    } else {
      changes.unshift({ type: "delete", oldIndex: i - 1 });
      i--;
    }
  }

  return changes;
}

// ─── Hunk Building ────────────────────────────────────────────────────────────

/**
 * Group the flat diff sequence into hunks with context lines.
 * Adjacent change groups separated by <= contextLines*2 equal lines are merged.
 */
function buildHunks(
  changes: DiffChange[],
  oldLines: string[],
  newLines: string[],
  contextLines: number,
): Hunk[] {
  // Collect indices of non-equal changes
  const changeIndices: number[] = [];
  for (let i = 0; i < changes.length; i++) {
    if (changes[i].type !== "equal") {
      changeIndices.push(i);
    }
  }

  if (changeIndices.length === 0) return [];

  // Group into clusters: split when equal gap between changes > contextLines*2
  const clusters: Array<{ start: number; end: number }> = [];
  let clusterStart = changeIndices[0];
  let clusterEnd = changeIndices[0];

  for (let i = 1; i < changeIndices.length; i++) {
    // All entries between two consecutive change indices are equal
    const equalsBetween = changeIndices[i] - clusterEnd - 1;
    if (equalsBetween > contextLines * 2) {
      clusters.push({ start: clusterStart, end: clusterEnd });
      clusterStart = changeIndices[i];
    }
    clusterEnd = changeIndices[i];
  }
  clusters.push({ start: clusterStart, end: clusterEnd });

  // Build a Hunk for each cluster
  const hunks: Hunk[] = [];

  for (const cluster of clusters) {
    const hunkStart = Math.max(0, cluster.start - contextLines);
    const hunkEnd = Math.min(changes.length - 1, cluster.end + contextLines);
    const hunkChanges = changes.slice(hunkStart, hunkEnd + 1);

    // Determine oldStart and newStart (1-indexed line positions in original files)
    let oldStart = -1;
    let newStart = -1;

    for (const c of hunkChanges) {
      if (oldStart === -1 && (c.type === "equal" || c.type === "delete")) {
        oldStart = c.oldIndex + 1;
      }
      if (newStart === -1 && (c.type === "equal" || c.type === "insert")) {
        newStart = c.newIndex + 1;
      }
      if (oldStart !== -1 && newStart !== -1) break;
    }

    // Pure-insert hunk (e.g. file creation): oldStart = 0 (standard convention)
    if (oldStart === -1) oldStart = 0;
    // Pure-delete hunk (e.g. file deletion): newStart = 0
    if (newStart === -1) newStart = 0;

    // Build prefixed lines and count old/new line contributions
    const lines: string[] = [];
    let oldCount = 0;
    let newCount = 0;

    for (const c of hunkChanges) {
      if (c.type === "equal") {
        lines.push(" " + oldLines[c.oldIndex]);
        oldCount++;
        newCount++;
      } else if (c.type === "delete") {
        lines.push("-" + oldLines[c.oldIndex]);
        oldCount++;
      } else {
        lines.push("+" + newLines[c.newIndex]);
        newCount++;
      }
    }

    hunks.push({ oldStart, oldCount, newStart, newCount, lines });
  }

  return hunks;
}

// ─── Unified Diff Formatting ──────────────────────────────────────────────────

/**
 * Format a single hunk range for the `@@ -old +new @@` header.
 * Standard unified diff omits the count when it is 1, and uses `start,0`
 * when count is 0 (no lines — insertion point indicator).
 */
function formatRange(start: number, count: number): string {
  if (count === 0) return `${start},0`;
  if (count === 1) return `${start}`;
  return `${start},${count}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

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
export function buildUnifiedDiff(options: UnifiedDiffOptions): string {
  const { oldPath, newPath, oldLines, newLines, contextLines = 3 } = options;

  // Both empty — nothing to diff
  if (oldLines.length === 0 && newLines.length === 0) return "";

  // Identical content — no diff
  if (
    oldLines.length === newLines.length &&
    oldLines.every((line, i) => line === newLines[i])
  ) {
    return "";
  }

  // Compute LCS and derive change sequence
  const dp = computeLCS(oldLines, newLines);
  const changes = backtrack(dp, oldLines, newLines);
  const hunks = buildHunks(changes, oldLines, newLines, contextLines);

  if (hunks.length === 0) return "";

  // Build diff headers
  const isCreation = oldLines.length === 0;
  const isDeletion = newLines.length === 0;

  const oldHeader = isCreation ? "--- /dev/null" : `--- a/${oldPath}`;
  const newHeader = isDeletion ? "+++ /dev/null" : `+++ b/${newPath}`;

  const parts: string[] = [oldHeader, newHeader];

  for (const hunk of hunks) {
    const oldRange = formatRange(hunk.oldStart, hunk.oldCount);
    const newRange = formatRange(hunk.newStart, hunk.newCount);
    parts.push(`@@ -${oldRange} +${newRange} @@`);
    parts.push(...hunk.lines);
  }

  return parts.join("\n");
}