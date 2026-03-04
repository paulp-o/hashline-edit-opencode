/**
 * hashline-core.ts — Core hashing, formatting, and validation for HashLine Edit.
 *
 * Uses Bun's built-in xxHash32 to compute 2-character content hashes for each line.
 * These hashes let the LLM reference lines unambiguously without reproducing content.
 */
/** Custom nibble alphabet — avoids ambiguous chars (0/O, 1/l/I). */
export declare const NIBBLE_STR = "ZPMQVRWSNKTXJBYH";
/** Set of valid hash characters for fast membership checks. */
export declare const VALID_HASH_CHARS: Set<string>;
/**
 * 256-entry lookup table mapping a byte value to its 2-character hash string.
 * Entry i → NIBBLE_STR[i >>> 4] + NIBBLE_STR[i & 0x0f]
 */
export declare const DICT: readonly string[];
/** Parsed result of a "LINE#HASH" tag reference. */
export interface ParsedTag {
    line: number;
    hash: string;
}
/**
 * Normalize a line for hashing: strip trailing \r, then remove ALL whitespace.
 */
export declare function normalizeLine(line: string): string;
/**
 * Compute a 2-character hash for a line.
 *
 * Algorithm:
 *  1. Normalize the content (strip whitespace).
 *  2. If the normalized string has no letters or digits (symbol-only / empty),
 *     use lineIndex as seed to prevent hash collisions on lines like "}", "//".
 *  3. Otherwise seed = 0.
 *  4. Return DICT[xxHash32(normalized, seed) & 0xFF].
 */
export declare function computeLineHash(content: string, lineIndex: number): string;
/**
 * Format a single line tag: "N#HASH".
 *
 * @param lineNum 1-indexed line number.
 * @param content Raw line content.
 */
export declare function formatLineTag(lineNum: number, content: string): string;
/**
 * Format an entire text block with hashline annotations.
 *
 * Each line becomes "N#HASH:content". Lines are 1-indexed by default.
 *
 * @param text   Multi-line text (newline-separated).
 * @param startLine Starting line number (default 1).
 */
export declare function formatHashLines(text: string, startLine?: number): string;
/**
 * Parse a "N#ID" tag from a string.
 *
 * Handles forms like:
 *   "23#XY"  |  "> 23#XY"  |  '"23#XY"'  |  "'23#XY'"
 *
 * Returns null if the format is invalid, line < 1, or hash chars not in NIBBLE_STR.
 */
export declare function parseTag(ref: string): ParsedTag | null;
/**
 * Validate a hash reference against current file content.
 *
 * @param ref       Tag string like "23#XY".
 * @param fileLines Array of file lines (0-indexed internally; ref is 1-indexed).
 * @returns true if the hash matches, false otherwise.
 */
export declare function validateLineRef(ref: string, fileLines: string[]): boolean;
//# sourceMappingURL=hashline-core.d.ts.map