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
/**
 * Detect and strip accidental LINE#HASH: prefixes from LLM output.
 *
 * @param lines - array of line strings from LLM's `lines` parameter
 * @returns array with prefixes stripped (or original if threshold not met)
 */
export declare function stripNewLinePrefixes(lines: string[]): string[];
//# sourceMappingURL=hashline-strip.d.ts.map