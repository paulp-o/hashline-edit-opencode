import { describe, it, expect } from "bun:test";
import { stripNewLinePrefixes } from "../lib/hashline-strip";

describe("stripNewLinePrefixes", () => {
  it("strips prefixes when >50% of non-empty lines match", () => {
    const input = ["1#ZZ:hello", "2#PP:world", ""];
    const result = stripNewLinePrefixes(input);
    expect(result).toEqual(["hello", "world", ""]);
  });

  it("does NOT strip when <=50% of non-empty lines match", () => {
    const input = ["1#ZZ:hello", "plain text", "another plain", "more plain"];
    const result = stripNewLinePrefixes(input);
    // Only 1 out of 4 non-empty lines matches — below threshold
    expect(result).toEqual(input);
  });

  it("preserves markdown list lines", () => {
    // >50% hashline lines trigger stripping, but "- item" is not a hashline
    const input = ["1#ZZ:hello", "2#PP:world", "- item"];
    const result = stripNewLinePrefixes(input);
    // Stripping triggers (2/3 = 66%), hashline lines get stripped
    // "- item" doesn't match HASHLINE_PREFIX_RE so passes through unchanged
    expect(result).toEqual(["hello", "world", "- item"]);
  });

  it("mixed content: only hashline-patterned lines get stripped", () => {
    const input = ["1#ZZ:first", "2#PP:second", "normal line", ""];
    // 2 out of 3 non-empty lines match (66%) → stripping triggers
    const result = stripNewLinePrefixes(input);
    expect(result).toEqual(["first", "second", "normal line", ""]);
  });
});
