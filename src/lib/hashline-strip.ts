/**
 * Prefix stripping module for HashLine Edit plugin.
 *
 * Detect and strip accidental LINE#HASH: prefixes from LLM output.
 * When LLMs are instructed to provide new content for edits, they sometimes
 * accidentally echo the hashline format (e.g., "23#XY:function hello()").
 *
 * This function detects when >50% of non-empty lines have hashline prefixes
 * and strips them, returning clean content.
 */

const HASHLINE_PREFIX_RE = /^\d+#[A-Z]{2}:/;

/**
 * Detect and strip accidental LINE#HASH: prefixes from LLM output.
 *
 * @param lines - array of line strings from LLM's `lines` parameter
 * @returns array with prefixes stripped (or original if threshold not met)
 */
export function stripNewLinePrefixes(lines: string[]): string[] {
  if (lines.length === 0) return lines;

  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  const nonEmptyCount = nonEmptyLines.length;

  if (nonEmptyCount === 0) return lines;

  const matchCount = nonEmptyLines.filter((line) =>
    HASHLINE_PREFIX_RE.test(line),
  ).length;

  // Only strip if >50% of non-empty lines have hashline prefixes
  if (matchCount / nonEmptyCount > 0.5) {
    return lines.map((line) => line.replace(HASHLINE_PREFIX_RE, ""));
  }

  return lines;
}
