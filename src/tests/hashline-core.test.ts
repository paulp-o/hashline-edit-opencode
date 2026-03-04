import { describe, it, expect } from "bun:test";
import {
  computeLineHash,
  formatHashLines,
  formatLineTag,
  parseTag,
  validateLineRef,
  normalizeLine,
  NIBBLE_STR,
  VALID_HASH_CHARS,
} from "../lib/hashline-core";

describe("computeLineHash", () => {
  it("returns 2-char hash from NIBBLE_STR for normal text", () => {
    const hash = computeLineHash("function hello() {", 1);
    expect(hash).toHaveLength(2);
    expect(VALID_HASH_CHARS.has(hash[0])).toBe(true);
    expect(VALID_HASH_CHARS.has(hash[1])).toBe(true);
  });

  it("whitespace variations produce same hash", () => {
    const h1 = computeLineHash("hello", 1);
    const h2 = computeLineHash("  hello  ", 1);
    const h3 = computeLineHash("hello  ", 1);
    expect(h1).toBe(h2);
    expect(h1).toBe(h3);
  });

  it("symbol-only lines at different indices produce different hashes", () => {
    const h5 = computeLineHash("}", 5);
    const h10 = computeLineHash("}", 10);
    expect(h5).not.toBe(h10);
  });

  it("CRLF handling strips trailing \\r", () => {
    const withCR = computeLineHash("hello\r", 1);
    const withoutCR = computeLineHash("hello", 1);
    expect(withCR).toBe(withoutCR);
  });

  it("empty string returns valid hash and is deterministic", () => {
    const h1 = computeLineHash("", 1);
    const h2 = computeLineHash("", 1);
    expect(h1).toHaveLength(2);
    expect(VALID_HASH_CHARS.has(h1[0])).toBe(true);
    expect(VALID_HASH_CHARS.has(h1[1])).toBe(true);
    expect(h1).toBe(h2);
  });
});

describe("formatHashLines", () => {
  it("single line formats as '1#XY:content'", () => {
    const result = formatHashLines("hello");
    const expectedHash = computeLineHash("hello", 1);
    expect(result).toBe(`1#${expectedHash}:hello`);
  });

  it("multi-line produces sequential numbering", () => {
    const result = formatHashLines("a\nb\nc");
    const lines = result.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toStartWith("1#");
    expect(lines[1]).toStartWith("2#");
    expect(lines[2]).toStartWith("3#");
  });

  it("offset parameter shifts starting line number", () => {
    const result = formatHashLines("a\nb", 10);
    const lines = result.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toStartWith("10#");
    expect(lines[1]).toStartWith("11#");
    // Verify hashes are computed with correct line indices
    const hashA = computeLineHash("a", 10);
    const hashB = computeLineHash("b", 11);
    expect(lines[0]).toBe(`10#${hashA}:a`);
    expect(lines[1]).toBe(`11#${hashB}:b`);
  });
});

describe("parseTag", () => {
  it("extracts {line, hash} from valid tag", () => {
    // Use computeLineHash to get a real hash
    const hash = computeLineHash("some content", 23);
    const tag = `23#${hash}`;
    const result = parseTag(tag);
    expect(result).not.toBeNull();
    expect(result!.line).toBe(23);
    expect(result!.hash).toBe(hash);
  });

  it("handles prefixed tags like '> 23#XY'", () => {
    const hash = computeLineHash("some content", 23);
    const tag = `> 23#${hash}`;
    const result = parseTag(tag);
    expect(result).not.toBeNull();
    expect(result!.line).toBe(23);
    expect(result!.hash).toBe(hash);
  });

  it("returns null for invalid formats", () => {
    expect(parseTag("invalid")).toBeNull();
    expect(parseTag("23")).toBeNull();
    expect(parseTag("#XY")).toBeNull();
    expect(parseTag("23#X")).toBeNull(); // 1-char hash
    expect(parseTag("abc#XY")).toBeNull(); // non-numeric line
  });

  it("rejects line 0 and invalid hash characters", () => {
    // Line 0 is invalid
    expect(parseTag("0#ZZ")).toBeNull();
    // A and B are NOT in NIBBLE_STR "ZPMQVRWSNKTXJBYH"
    expect(parseTag("1#AB")).toBeNull();
  });
});

describe("validateLineRef", () => {
  it("returns true for matching hash", () => {
    const fileLines = ["first line", "second line", "third line"];
    const hash = computeLineHash("second line", 2);
    const ref = `2#${hash}`;
    expect(validateLineRef(ref, fileLines)).toBe(true);
  });

  it("returns false for mismatched hash", () => {
    const fileLines = ["first line", "second line", "third line"];
    // Use a hash computed for different content
    const wrongHash = computeLineHash("totally different", 2);
    const ref = `2#${wrongHash}`;
    expect(validateLineRef(ref, fileLines)).toBe(false);
  });

  it("returns false for out of range line", () => {
    const fileLines = ["first", "second", "third"];
    const hash = computeLineHash("phantom", 100);
    const ref = `100#${hash}`;
    expect(validateLineRef(ref, fileLines)).toBe(false);
  });
});
