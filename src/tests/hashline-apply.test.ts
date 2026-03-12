import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  applyHashlineEdits,
  type EditOperation,
} from "../lib/hashline-apply";
import { computeLineHash } from "../lib/hashline-core";
import { HashlineMismatchError } from "../lib/hashline-errors";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// ─── Test Helpers ────────────────────────────────────────────────────────────

let tmpDir: string;
let testFile: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "hashline-apply-test-"));
  testFile = join(tmpDir, "test.ts");
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

/**
 * Create a test file and return a hash map for each 1-indexed line.
 */
async function setupFile(lines: string[]): Promise<Map<number, string>> {
  await writeFile(testFile, lines.join("\n"));
  const hashes = new Map<number, string>();
  lines.forEach((line, i) => {
    hashes.set(i + 1, computeLineHash(line, i + 1));
  });
  return hashes;
}

/** Build a "N#HASH" reference string. */
function ref(lineNum: number, hash: string): string {
  return `${lineNum}#${hash}`;
}

// ─── Replace Tests ───────────────────────────────────────────────────────────

describe("applyHashlineEdits — replace", () => {
  it("12.1 replaces a single line", async () => {
    const h = await setupFile(["line1", "line2", "line3"]);
    await applyHashlineEdits(testFile, [
      { op: "replace", pos: ref(2, h.get(2)!), lines: ["replaced"] },
    ]);
    const result = (await Bun.file(testFile).text()).split("\n");
    expect(result).toEqual(["line1", "replaced", "line3"]);
  });

  it("12.2 replaces a range of lines", async () => {
    const h = await setupFile(["line1", "line2", "line3", "line4"]);
    await applyHashlineEdits(testFile, [
      {
        op: "replace",
        pos: ref(2, h.get(2)!),
        end: ref(3, h.get(3)!),
        lines: ["new_middle"],
      },
    ]);
    const result = (await Bun.file(testFile).text()).split("\n");
    expect(result).toEqual(["line1", "new_middle", "line4"]);
  });

  it("12.3 deletes a line when lines=[]", async () => {
    const h = await setupFile(["line1", "line2", "line3"]);
    await applyHashlineEdits(testFile, [
      { op: "replace", pos: ref(2, h.get(2)!), lines: [] },
    ]);
    const result = (await Bun.file(testFile).text()).split("\n");
    expect(result).toEqual(["line1", "line3"]);
  });

  it("12.4 deletes a range when lines=[]", async () => {
    const h = await setupFile(["line1", "line2", "line3", "line4"]);
    await applyHashlineEdits(testFile, [
      {
        op: "replace",
        pos: ref(2, h.get(2)!),
        end: ref(3, h.get(3)!),
        lines: [],
      },
    ]);
    const result = (await Bun.file(testFile).text()).split("\n");
    expect(result).toEqual(["line1", "line4"]);
  });

  it("12.5 clears a line when lines=['']", async () => {
    const h = await setupFile(["line1", "line2", "line3"]);
    await applyHashlineEdits(testFile, [
      { op: "replace", pos: ref(2, h.get(2)!), lines: [""] },
    ]);
    const result = (await Bun.file(testFile).text()).split("\n");
    expect(result).toEqual(["line1", "", "line3"]);
    expect(result).toHaveLength(3); // line count unchanged
  });
});

// ─── Append Tests ────────────────────────────────────────────────────────────

describe("applyHashlineEdits — append", () => {
  it("12.6 appends after a specific line", async () => {
    const h = await setupFile(["line1", "line2", "line3"]);
    await applyHashlineEdits(testFile, [
      { op: "append", pos: ref(2, h.get(2)!), lines: ["inserted"] },
    ]);
    const result = (await Bun.file(testFile).text()).split("\n");
    expect(result).toEqual(["line1", "line2", "inserted", "line3"]);
  });

  it("12.7 appends at EOF when no pos given", async () => {
    const h = await setupFile(["line1", "line2"]);
    await applyHashlineEdits(testFile, [
      { op: "append", lines: ["appended"] },
    ]);
    const result = (await Bun.file(testFile).text()).split("\n");
    expect(result).toEqual(["line1", "line2", "appended"]);
  });

  it("12.8 creates a new file via anchorless append", async () => {
    const newFile = join(tmpDir, "new-file.ts");
    await applyHashlineEdits(newFile, [
      { op: "append", lines: ["first", "second"] },
    ]);
    const result = (await Bun.file(newFile).text()).split("\n");
    expect(result).toEqual(["first", "second"]);
  });
});

// ─── Prepend Tests ───────────────────────────────────────────────────────────

describe("applyHashlineEdits — prepend", () => {
  it("12.9 prepends before a specific line", async () => {
    const h = await setupFile(["line1", "line2", "line3"]);
    await applyHashlineEdits(testFile, [
      { op: "prepend", pos: ref(2, h.get(2)!), lines: ["inserted"] },
    ]);
    const result = (await Bun.file(testFile).text()).split("\n");
    expect(result).toEqual(["line1", "inserted", "line2", "line3"]);
  });

  it("12.10 prepends at BOF when no pos given", async () => {
    const h = await setupFile(["line1", "line2"]);
    await applyHashlineEdits(testFile, [
      { op: "prepend", lines: ["prepended"] },
    ]);
    const result = (await Bun.file(testFile).text()).split("\n");
    expect(result).toEqual(["prepended", "line1", "line2"]);
  });
});

// ─── Hash Mismatch Tests ────────────────────────────────────────────────────

describe("applyHashlineEdits — hash mismatch", () => {
  it("12.11 throws HashlineMismatchError for single mismatch", async () => {
    await setupFile(["line1", "line2", "line3"]);
    try {
      await applyHashlineEdits(testFile, [
        { op: "replace", pos: "2#ZZ", lines: ["replaced"] },
      ]);
      expect(true).toBe(false); // should not reach
    } catch (e) {
      expect(e).toBeInstanceOf(HashlineMismatchError);
    }
  });

  it("12.12 reports all mismatches in error", async () => {
    await setupFile(["line1", "line2", "line3"]);
    try {
      await applyHashlineEdits(testFile, [
        { op: "replace", pos: "1#ZZ", lines: ["a"] },
        { op: "replace", pos: "3#ZZ", lines: ["b"] },
      ]);
      expect(true).toBe(false); // should not reach
    } catch (e) {
      expect(e).toBeInstanceOf(HashlineMismatchError);
      expect((e as HashlineMismatchError).mismatches).toHaveLength(2);
    }
  });

  it("12.13 blocks ALL edits when any hash is invalid", async () => {
    const h = await setupFile(["line1", "line2", "line3"]);

    // One valid edit + one invalid edit
    try {
      await applyHashlineEdits(testFile, [
        { op: "replace", pos: ref(1, h.get(1)!), lines: ["changed"] },
        { op: "replace", pos: "3#ZZ", lines: ["bad"] },
      ]);
      expect(true).toBe(false); // should not reach
    } catch (e) {
      expect(e).toBeInstanceOf(HashlineMismatchError);
    }

    // File should be UNCHANGED — no edits applied
    const result = (await Bun.file(testFile).text()).split("\n");
    expect(result).toEqual(["line1", "line2", "line3"]);
  });
});

// ─── Bottom-up, Dedup, No-op Tests ──────────────────────────────────────────

describe("applyHashlineEdits — ordering & dedup", () => {
  it("12.14 applies edits bottom-up, preserving correct indices", async () => {
    const h = await setupFile(["line1", "line2", "line3", "line4", "line5"]);

    // Edit line 1 and line 4 — both should be applied correctly
    // even though editing line 1 would shift indices if done first
    await applyHashlineEdits(testFile, [
      { op: "replace", pos: ref(1, h.get(1)!), lines: ["first_changed"] },
      { op: "replace", pos: ref(4, h.get(4)!), lines: ["fourth_changed"] },
    ]);
    const result = (await Bun.file(testFile).text()).split("\n");
    expect(result).toEqual([
      "first_changed",
      "line2",
      "line3",
      "fourth_changed",
      "line5",
    ]);
  });

  it("12.15 deduplicates identical edits", async () => {
    const h = await setupFile(["line1", "line2", "line3"]);

    // Send same edit twice — should only apply once
    const edit: EditOperation = {
      op: "replace",
      pos: ref(2, h.get(2)!),
      lines: ["replaced"],
    };
    await applyHashlineEdits(testFile, [edit, { ...edit }]);

    const result = (await Bun.file(testFile).text()).split("\n");
    expect(result).toEqual(["line1", "replaced", "line3"]);
  });

  it("12.16 detects no-op edits and returns a warning", async () => {
    const h = await setupFile(["line1", "line2", "line3"]);

    const result = await applyHashlineEdits(testFile, [
      { op: "replace", pos: ref(2, h.get(2)!), lines: ["line2"] },
    ]);

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("No-op");
  });
});
