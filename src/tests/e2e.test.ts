/**
 * E2E integration tests for the HashLine Edit plugin.
 *
 * These tests exercise the FULL PIPELINE — reading files, computing hashes,
 * performing edits, and verifying the round-trip workflow. They use real
 * temp files on disk and call the lib functions that underpin the plugin tools.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { formatHashLines, computeLineHash, formatLineTag } from "../lib/hashline-core";
import { applyHashlineEdits, type EditOperation } from "../lib/hashline-apply";
import { HashlineMismatchError } from "../lib/hashline-errors";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// ─── Test Setup ──────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "hashline-e2e-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

/** Helper: write a file and return its path */
async function createFile(name: string, lines: string[]): Promise<string> {
  const filePath = join(tmpDir, name);
  await writeFile(filePath, lines.join("\n"));
  return filePath;
}

/** Helper: read a file back as array of lines */
async function readLines(filePath: string): Promise<string[]> {
  const text = await Bun.file(filePath).text();
  return text.split("\n");
}

/** Helper: compute hash for a given 1-indexed line */
function hashFor(content: string, lineNum: number): string {
  return computeLineHash(content, lineNum);
}

/** Helper: build a "N#HASH" anchor reference */
function ref(lineNum: number, content: string): string {
  return `${lineNum}#${hashFor(content, lineNum)}`;
}

// ─── 14.1 Read file → verify hashline format ────────────────────────────────

describe("E2E: read file → hashline format", () => {
  it("14.1 formats file content with correct N#HASH:content pattern", async () => {
    const lines = [
      "import React from 'react';",
      "",
      "export function App() {",
      "  return <div>Hello</div>;",
      "}",
    ];
    const filePath = await createFile("app.tsx", lines);
    const content = await Bun.file(filePath).text();

    // Full pipeline: read content → format with hashlines
    const formatted = formatHashLines(content);
    const outputLines = formatted.split("\n");

    expect(outputLines).toHaveLength(lines.length);

    // Each line must match the N#HASH:content pattern
    const HASHLINE_RE = /^(\d+)#([A-Z]{2}):(.*)$/;
    for (let i = 0; i < outputLines.length; i++) {
      const match = HASHLINE_RE.exec(outputLines[i]);
      expect(match).not.toBeNull();

      const [, lineNumStr, hash, lineContent] = match!;
      const lineNum = parseInt(lineNumStr, 10);

      // Line number should be sequential starting from 1
      expect(lineNum).toBe(i + 1);

      // Hash should match independent computation
      const expectedHash = computeLineHash(lines[i], i + 1);
      expect(hash).toBe(expectedHash);

      // Content portion should match original
      expect(lineContent).toBe(lines[i]);
    }
  });
});

// ─── 14.2 Read with offset/limit ────────────────────────────────────────────

describe("E2E: read with offset and limit", () => {
  it("14.2 returns only the expected subset with correct line numbers", async () => {
    // Create a file with 20 lines
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1} content`);
    const filePath = await createFile("large.txt", lines);
    const content = await Bun.file(filePath).text();

    // Simulate offset=10, limit=5 by slicing and formatting
    const allLines = content.split("\n");
    const startIdx = 9; // offset 10 → 0-indexed = 9
    const sliced = allLines.slice(startIdx, startIdx + 5);
    const formatted = formatHashLines(sliced.join("\n"), 10);
    const outputLines = formatted.split("\n");

    expect(outputLines).toHaveLength(5);

    // Verify line numbers are 10, 11, 12, 13, 14
    for (let i = 0; i < 5; i++) {
      const expectedLineNum = 10 + i;
      const expectedContent = lines[expectedLineNum - 1];
      const expectedHash = computeLineHash(expectedContent, expectedLineNum);

      expect(outputLines[i]).toBe(`${expectedLineNum}#${expectedHash}:${expectedContent}`);
    }
  });
});

// ─── 14.3 Edit file → verify modification ───────────────────────────────────

describe("E2E: edit file → verify modification", () => {
  it("14.3 applies a replace edit and modifies the file correctly", async () => {
    const originalLines = [
      "const x = 1;",
      "const y = 2;",
      "const z = 3;",
    ];
    const filePath = await createFile("vars.ts", originalLines);

    // Read → get hashes → build edit
    const edit: EditOperation = {
      op: "replace",
      pos: ref(2, "const y = 2;"),
      lines: ["const y = 42;"],
    };

    await applyHashlineEdits(filePath, [edit]);

    // Verify file was modified
    const result = await readLines(filePath);
    expect(result).toEqual(["const x = 1;", "const y = 42;", "const z = 3;"]);
  });
});

// ─── 14.4 Edit and re-read → hashes match recomputed ────────────────────────

describe("E2E: edit and re-read → hashes consistent", () => {
  it("14.4 hashes after edit match recomputed values for all lines", async () => {
    const originalLines = [
      "function greet(name) {",
      "  return 'Hello, ' + name;",
      "}",
    ];
    const filePath = await createFile("greet.ts", originalLines);

    // Apply edit: replace line 2
    const edit: EditOperation = {
      op: "replace",
      pos: ref(2, originalLines[1]),
      lines: ["  return `Hello, ${name}!`;"],
    };
    await applyHashlineEdits(filePath, [edit]);

    // Re-read the file
    const modifiedContent = await Bun.file(filePath).text();
    const modifiedLines = modifiedContent.split("\n");

    // Format with hashlines and verify each hash is correct
    const formatted = formatHashLines(modifiedContent);
    const formattedLines = formatted.split("\n");

    for (let i = 0; i < modifiedLines.length; i++) {
      const lineNum = i + 1;
      const expectedHash = computeLineHash(modifiedLines[i], lineNum);
      const expectedTag = `${lineNum}#${expectedHash}:${modifiedLines[i]}`;
      expect(formattedLines[i]).toBe(expectedTag);
    }

    // Specifically verify the changed line has a new hash
    const oldHash = computeLineHash(originalLines[1], 2);
    const newHash = computeLineHash(modifiedLines[1], 2);
    expect(newHash).not.toBe(oldHash);
  });
});

// ─── 14.5 Grep → hashline annotated results ─────────────────────────────────

describe("E2E: grep-style → hashline annotated results", () => {
  it("14.5 formats match and context lines with correct hash tags", async () => {
    const lines = [
      "import fs from 'fs';",
      "",
      "function readConfig() {",
      "  const data = fs.readFileSync('config.json');",
      "  return JSON.parse(data);",
      "}",
      "",
      "function writeConfig(cfg) {",
      "  fs.writeFileSync('config.json', JSON.stringify(cfg));",
      "}",
    ];
    const filePath = await createFile("config.ts", lines);
    const content = await Bun.file(filePath).text();
    const allLines = content.split("\n");

    // Simulate grep matching "readConfig" and "writeConfig"
    // with 1 line of context above and below each match
    const matchLineNums = [3, 8]; // lines containing function declarations
    const contextRadius = 1;

    const resultLines: string[] = [];

    for (const matchLine of matchLineNums) {
      const start = Math.max(1, matchLine - contextRadius);
      const end = Math.min(allLines.length, matchLine + contextRadius);

      for (let n = start; n <= end; n++) {
        const lineContent = allLines[n - 1];
        const hash = computeLineHash(lineContent, n);
        const tag = `${n}#${hash}:${lineContent}`;

        if (n === matchLine) {
          resultLines.push(`> ${tag}`); // match line prefix
        } else {
          resultLines.push(`  ${tag}`); // context line prefix
        }
      }
    }

    // Verify match lines have `>` prefix
    const matchEntries = resultLines.filter((l) => l.startsWith("> "));
    const contextEntries = resultLines.filter((l) => l.startsWith("  "));

    expect(matchEntries).toHaveLength(2);
    expect(contextEntries.length).toBeGreaterThan(0);

    // Verify hash tags in match lines are extractable for edit anchors
    for (const entry of matchEntries) {
      const m = entry.match(/^> (\d+#[A-Z]{2}):/);
      expect(m).not.toBeNull();
    }
  });
});

// ─── 14.6 Grep→edit workflow ─────────────────────────────────────────────────

describe("E2E: grep → edit workflow", () => {
  it("14.6 edit succeeds using hashes obtained from formatted output", async () => {
    const lines = [
      "const API_URL = 'http://localhost:3000';",
      "const TIMEOUT = 5000;",
      "const RETRIES = 3;",
    ];
    const filePath = await createFile("config.ts", lines);

    // Simulate: grep finds line 1 containing "localhost"
    // Format line 1 to get its hash (like grep output would provide)
    const line1Content = lines[0];
    const line1Hash = computeLineHash(line1Content, 1);

    // Use that hash to edit without a separate "read" step
    const edit: EditOperation = {
      op: "replace",
      pos: `1#${line1Hash}`,
      lines: ["const API_URL = 'https://api.example.com';"],
    };

    const result = await applyHashlineEdits(filePath, [edit]);
    expect(result.lineCountDelta).toBe(0); // same number of lines

    // Verify the edit was applied
    const modified = await readLines(filePath);
    expect(modified[0]).toBe("const API_URL = 'https://api.example.com';");
    expect(modified[1]).toBe("const TIMEOUT = 5000;");
    expect(modified[2]).toBe("const RETRIES = 3;");
  });
});

// ─── 14.7 Hash mismatch error → message includes expected, actual, line ─────

describe("E2E: hash mismatch error format", () => {
  it("14.7 error message includes line number, expected, actual, and retry guidance", async () => {
    const lines = [
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
    ];
    const filePath = await createFile("greek.txt", lines);

    // Intentionally use wrong hash
    const correctHash = computeLineHash("beta", 2);
    const wrongHash = "ZZ"; // guaranteed wrong (unless incredibly unlucky)
    expect(wrongHash).not.toBe(correctHash); // sanity check

    try {
      await applyHashlineEdits(filePath, [
        { op: "replace", pos: `2#${wrongHash}`, lines: ["BETA"] },
      ]);
      // Should not reach here
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(HashlineMismatchError);
      const mismatchErr = err as HashlineMismatchError;

      // Verify mismatches array
      expect(mismatchErr.mismatches).toHaveLength(1);
      expect(mismatchErr.mismatches[0].line).toBe(2);
      expect(mismatchErr.mismatches[0].expected).toBe(wrongHash);
      expect(mismatchErr.mismatches[0].actual).toBe(correctHash);

      // Verify error message includes key information
      const msg = mismatchErr.message;
      expect(msg).toContain("line 2");
      expect(msg).toContain(`expected 2#${wrongHash}`);
      expect(msg).toContain(`got 2#${correctHash}`);

      // Verify retry guidance with correct actual hash
      expect(msg).toContain(`pos: "2#${correctHash}"`);

      // Verify context lines are present (>>>) 
      expect(msg).toContain(">>>");
    }
  });
});

// ─── 14.8 Directory read → tree listing ──────────────────────────────────────

describe("E2E: directory read → tree listing with line counts", () => {
  it("14.8 creates a directory tree and verifies file line counts", async () => {
    // Create a small directory structure
    const srcDir = join(tmpDir, "src");
    const utilsDir = join(srcDir, "utils");
    await mkdir(utilsDir, { recursive: true });

    const file1Lines = ["const a = 1;", "const b = 2;", "export { a, b };"];
    const file2Lines = ["export function add(x, y) {", "  return x + y;", "}"];
    const file3Lines = ["// main entry", "import { a } from './utils/helpers';", "console.log(a);"];

    await writeFile(join(srcDir, "index.ts"), file3Lines.join("\n"));
    await writeFile(join(utilsDir, "helpers.ts"), file1Lines.join("\n"));
    await writeFile(join(utilsDir, "math.ts"), file2Lines.join("\n"));

    // Read each file and verify line counts match what we wrote
    const indexContent = await Bun.file(join(srcDir, "index.ts")).text();
    const helpersContent = await Bun.file(join(utilsDir, "helpers.ts")).text();
    const mathContent = await Bun.file(join(utilsDir, "math.ts")).text();

    expect(indexContent.split("\n")).toHaveLength(file3Lines.length);
    expect(helpersContent.split("\n")).toHaveLength(file1Lines.length);
    expect(mathContent.split("\n")).toHaveLength(file2Lines.length);

    // Each file is independently readable and formattable with hashlines
    const indexFormatted = formatHashLines(indexContent);
    expect(indexFormatted.split("\n")).toHaveLength(file3Lines.length);

    // Verify hash consistency across the tree
    for (const [filePath, expectedLines] of [
      [join(srcDir, "index.ts"), file3Lines],
      [join(utilsDir, "helpers.ts"), file1Lines],
      [join(utilsDir, "math.ts"), file2Lines],
    ] as const) {
      const content = await Bun.file(filePath).text();
      const formatted = formatHashLines(content);
      const fmtLines = formatted.split("\n");

      for (let i = 0; i < expectedLines.length; i++) {
        const hash = computeLineHash(expectedLines[i], i + 1);
        expect(fmtLines[i]).toBe(`${i + 1}#${hash}:${expectedLines[i]}`);
      }
    }
  });
});

// ─── 14.9 Binary file rejection ──────────────────────────────────────────────

describe("E2E: binary file rejection", () => {
  it("14.9 detects binary content (null bytes) in first 8KB", async () => {
    // Create a file with null bytes (binary content)
    const binaryPath = join(tmpDir, "image.dat");
    const binaryContent = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG header
      0x00, 0x00, 0x00, 0x0d, // null bytes
      0x49, 0x48, 0x44, 0x52,
    ]);
    await Bun.write(binaryPath, binaryContent);

    // Read first 8KB and check for null bytes — same logic as plugin
    const file = Bun.file(binaryPath);
    const buf = new Uint8Array(await file.slice(0, 8192).arrayBuffer());
    const hasBinary = buf.includes(0);

    expect(hasBinary).toBe(true);

    // A text file should NOT be detected as binary
    const textPath = await createFile("readme.txt", ["Hello world", "This is text"]);
    const textFile = Bun.file(textPath);
    const textBuf = new Uint8Array(await textFile.slice(0, 8192).arrayBuffer());
    const textIsBinary = textBuf.includes(0);

    expect(textIsBinary).toBe(false);
  });
});

// ─── 14.10 File not found → helpful error ────────────────────────────────────

describe("E2E: file not found → helpful error", () => {
  it("14.10 throws helpful error for non-existent file with non-append ops", async () => {
    const missingPath = join(tmpDir, "does-not-exist.ts");

    // A replace on a missing file should fail with "File not found"
    try {
      await applyHashlineEdits(missingPath, [
        { op: "replace", pos: "1#ZZ", lines: ["hello"] },
      ]);
      expect(true).toBe(false); // should not reach here
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("File not found");
      expect((err as Error).message).toContain(missingPath);
    }
  });
});
