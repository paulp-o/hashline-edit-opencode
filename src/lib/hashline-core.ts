/**
 * hashline-core.ts — Core hashing, formatting, and validation for HashLine Edit.
 *
 * Uses Bun's built-in xxHash32 to compute 2-character content hashes for each line.
 * These hashes let the LLM reference lines unambiguously without reproducing content.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** Custom nibble alphabet — avoids ambiguous chars (0/O, 1/l/I). */
export const NIBBLE_STR = "ZPMQVRWSNKTXJBYH";

/** Set of valid hash characters for fast membership checks. */
export const VALID_HASH_CHARS: Set<string> = new Set(NIBBLE_STR);

/**
 * 256-entry lookup table mapping a byte value to its 2-character hash string.
 * Entry i → NIBBLE_STR[i >>> 4] + NIBBLE_STR[i & 0x0f]
 */
export const DICT: readonly string[] = Array.from({ length: 256 }, (_, i) => {
  const h = i >>> 4;
  const l = i & 0x0f;
  return `${NIBBLE_STR[h]}${NIBBLE_STR[l]}`;
});

// ─── Types ───────────────────────────────────────────────────────────────────

/** Parsed result of a "LINE#HASH" tag reference. */
export interface ParsedTag {
  line: number;
  hash: string;
}

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Normalize a line for hashing: strip trailing \r, then remove ALL whitespace.
 */
export function normalizeLine(line: string): string {
  return line.replace(/\r$/, "").replace(/\s+/g, "");
}

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
export function computeLineHash(content: string, lineIndex: number): string {
  const normalized = normalizeLine(content);
  const isSymbolOnly = !/[\p{L}\p{N}]/u.test(normalized);
  const seed = isSymbolOnly ? lineIndex : 0;
  return DICT[Bun.hash.xxHash32(normalized, seed) & 0xFF];
}

/**
 * Format a single line tag: "N#HASH".
 *
 * @param lineNum 1-indexed line number.
 * @param content Raw line content.
 */
export function formatLineTag(lineNum: number, content: string): string {
  return `${lineNum}#${computeLineHash(content, lineNum)}`;
}

/**
 * Format an entire text block with hashline annotations.
 *
 * Each line becomes "N#HASH:content". Lines are 1-indexed by default.
 *
 * @param text   Multi-line text (newline-separated).
 * @param startLine Starting line number (default 1).
 */
export function formatHashLines(text: string, startLine: number = 1): string {
  const lines = text.split("\n");
  return lines
    .map((line, i) => {
      const lineNum = startLine + i;
      return `${lineNum}#${computeLineHash(line, lineNum)}:${line}`;
    })
    .join("\n");
}

// ─── Tag Parsing ─────────────────────────────────────────────────────────────

/**
 * Regex for extracting a "LINE#HASH" reference.
 *
 * Strips optional:
 *  - surrounding quotes (single or double)
 *  - diff/markdown prefixes: >, +, -, whitespace
 *
 * Captures: (digits) # (two uppercase letters)
 */
const TAG_RE = /^["']?\s*[>+\-\s]*(\d+)#([A-Z]{2})\s*["']?$/;

/**
 * Parse a "N#ID" tag from a string.
 *
 * Handles forms like:
 *   "23#XY"  |  "> 23#XY"  |  '"23#XY"'  |  "'23#XY'"
 *
 * Returns null if the format is invalid, line < 1, or hash chars not in NIBBLE_STR.
 */
export function parseTag(ref: string): ParsedTag | null {
  const m = TAG_RE.exec(ref.trim());
  if (!m) return null;

  const line = parseInt(m[1], 10);
  const hash = m[2];

  if (line < 1) return null;
  if (!VALID_HASH_CHARS.has(hash[0]) || !VALID_HASH_CHARS.has(hash[1])) return null;

  return { line, hash };
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a hash reference against current file content.
 *
 * @param ref       Tag string like "23#XY".
 * @param fileLines Array of file lines (0-indexed internally; ref is 1-indexed).
 * @returns true if the hash matches, false otherwise.
 */
export function validateLineRef(ref: string, fileLines: string[]): boolean {
  const parsed = parseTag(ref);
  if (!parsed) return false;

  const { line, hash } = parsed;
  if (line < 1 || line > fileLines.length) return false;

  const currentHash = computeLineHash(fileLines[line - 1], line);
  return currentHash === hash;
}
