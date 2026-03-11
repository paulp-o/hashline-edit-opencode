import { describe, it, expect } from "bun:test";
import { buildUnifiedDiff } from "../lib/hashline-diff";

// ─── Helper ──────────────────────────────────────────────────────────────────

/** Split a unified diff into lines for easier assertion. */
function diffLines(diff: string): string[] {
  return diff.split("\n");
}

// ─── Basic Diff Tests ────────────────────────────────────────────────────────

describe("buildUnifiedDiff — headers", () => {
  it("uses a/b headers for normal edit", () => {
    const diff = buildUnifiedDiff({
      oldPath: "src/app.ts",
      newPath: "src/app.ts",
      oldLines: ["hello"],
      newLines: ["world"],
    });
    const lines = diffLines(diff);
    expect(lines[0]).toBe("--- a/src/app.ts");
    expect(lines[1]).toBe("+++ b/src/app.ts");
  });

  it("uses /dev/null header for file creation", () => {
    const diff = buildUnifiedDiff({
      oldPath: "src/new.ts",
      newPath: "src/new.ts",
      oldLines: [],
      newLines: ["line1", "line2"],
    });
    const lines = diffLines(diff);
    expect(lines[0]).toBe("--- /dev/null");
    expect(lines[1]).toBe("+++ b/src/new.ts");
  });

  it("uses /dev/null header for file deletion", () => {
    const diff = buildUnifiedDiff({
      oldPath: "src/old.ts",
      newPath: "src/old.ts",
      oldLines: ["line1", "line2"],
      newLines: [],
    });
    const lines = diffLines(diff);
    expect(lines[0]).toBe("--- a/src/old.ts");
    expect(lines[1]).toBe("+++ /dev/null");
  });

  it("uses different old/new headers for move (edit+move)", () => {
    const diff = buildUnifiedDiff({
      oldPath: "src/old.ts",
      newPath: "src/new.ts",
      oldLines: ["hello"],
      newLines: ["world"],
    });
    const lines = diffLines(diff);
    expect(lines[0]).toBe("--- a/src/old.ts");
    expect(lines[1]).toBe("+++ b/src/new.ts");
  });
});

// ─── No-change Cases ─────────────────────────────────────────────────────────

describe("buildUnifiedDiff — no differences", () => {
  it("returns empty string for identical content", () => {
    const diff = buildUnifiedDiff({
      oldPath: "src/app.ts",
      newPath: "src/app.ts",
      oldLines: ["line1", "line2", "line3"],
      newLines: ["line1", "line2", "line3"],
    });
    expect(diff).toBe("");
  });

  it("returns empty string for both empty", () => {
    const diff = buildUnifiedDiff({
      oldPath: "src/app.ts",
      newPath: "src/app.ts",
      oldLines: [],
      newLines: [],
    });
    expect(diff).toBe("");
  });
});

// ─── Single-line Change ───────────────────────────────────────────────────────

describe("buildUnifiedDiff — single line replacement", () => {
  it("produces correct unified diff for single-line replacement", () => {
    const diff = buildUnifiedDiff({
      oldPath: "src/app.ts",
      newPath: "src/app.ts",
      oldLines: ["const x = 1;", "const y = 2;", "const z = 3;"],
      newLines: ["const x = 1;", "const y = 99;", "const z = 3;"],
    });
    const lines = diffLines(diff);
    // Should have headers + hunk header + context + change + context
    expect(lines).toContain("-const y = 2;");
    expect(lines).toContain("+const y = 99;");
    // Context lines present
    expect(lines).toContain(" const x = 1;");
    expect(lines).toContain(" const z = 3;");
    // Hunk header format: @@ -N +N @@
    const hunkLine = lines.find(l => l.startsWith("@@"));
    expect(hunkLine).toBeDefined();
    expect(hunkLine).toMatch(/^@@ -\d+,?\d* \+\d+,?\d* @@$/);
  });

  it("hunk range omits count when count=1", () => {
    const diff = buildUnifiedDiff({
      oldPath: "src/app.ts",
      newPath: "src/app.ts",
      // Only one line total — count=1 means no comma in range
      oldLines: ["old"],
      newLines: ["new"],
    });
    const hunkLine = diffLines(diff).find(l => l.startsWith("@@"))!;
    // @@ -1 +1 @@ (no comma since count=1)
    expect(hunkLine).toBe("@@ -1 +1 @@");
  });
});

// ─── Multi-line Addition ─────────────────────────────────────────────────────

describe("buildUnifiedDiff — multi-line addition", () => {
  it("marks added lines with +", () => {
    const diff = buildUnifiedDiff({
      oldPath: "src/app.ts",
      newPath: "src/app.ts",
      oldLines: ["line1", "line3"],
      newLines: ["line1", "line2a", "line2b", "line3"],
    });
    const lines = diffLines(diff);
    expect(lines).toContain("+line2a");
    expect(lines).toContain("+line2b");
    expect(lines).toContain(" line1");
    expect(lines).toContain(" line3");
  });
});

// ─── Multi-line Deletion ─────────────────────────────────────────────────────

describe("buildUnifiedDiff — multi-line deletion", () => {
  it("marks deleted lines with -", () => {
    const diff = buildUnifiedDiff({
      oldPath: "src/app.ts",
      newPath: "src/app.ts",
      oldLines: ["line1", "del1", "del2", "line4"],
      newLines: ["line1", "line4"],
    });
    const lines = diffLines(diff);
    expect(lines).toContain("-del1");
    expect(lines).toContain("-del2");
    expect(lines).toContain(" line1");
    expect(lines).toContain(" line4");
  });
});

// ─── File Creation ────────────────────────────────────────────────────────────

describe("buildUnifiedDiff — file creation", () => {
  it("shows all lines as insertions with correct hunk header", () => {
    const diff = buildUnifiedDiff({
      oldPath: "src/new.ts",
      newPath: "src/new.ts",
      oldLines: [],
      newLines: ["line1", "line2", "line3"],
    });
    const lines = diffLines(diff);
    expect(lines[0]).toBe("--- /dev/null");
    expect(lines[1]).toBe("+++ b/src/new.ts");
    // @@ -0,0 +1,3 @@ (standard creation hunk)
    const hunkLine = lines.find(l => l.startsWith("@@"))!;
    expect(hunkLine).toBe("@@ -0,0 +1,3 @@");
    expect(lines).toContain("+line1");
    expect(lines).toContain("+line2");
    expect(lines).toContain("+line3");
  });
});

// ─── File Deletion ────────────────────────────────────────────────────────────

describe("buildUnifiedDiff — file deletion", () => {
  it("shows all lines as deletions with correct hunk header", () => {
    const diff = buildUnifiedDiff({
      oldPath: "src/old.ts",
      newPath: "src/old.ts",
      oldLines: ["line1", "line2"],
      newLines: [],
    });
    const lines = diffLines(diff);
    expect(lines[0]).toBe("--- a/src/old.ts");
    expect(lines[1]).toBe("+++ /dev/null");
    // @@ -1,2 +0,0 @@ (standard deletion hunk)
    const hunkLine = lines.find(l => l.startsWith("@@"))!;
    expect(hunkLine).toBe("@@ -1,2 +0,0 @@");
    expect(lines).toContain("-line1");
    expect(lines).toContain("-line2");
  });
});

// ─── Multiple Hunks ───────────────────────────────────────────────────────────

describe("buildUnifiedDiff — multiple hunks", () => {
  it("splits distant changes into separate @@ blocks", () => {
    // Changes at line 1 and line 10 with 8 unchanged lines between — with 3-line
    // context that’s 6 context lines max per boundary, but the gap (8 lines) is
    // larger than contextLines*2 (6), so they should be separate hunks.
    const oldLines = [
      "change1",   // 1 — changed
      "same2",     // 2
      "same3",     // 3
      "same4",     // 4
      "same5",     // 5
      "same6",     // 6
      "same7",     // 7
      "same8",     // 8
      "same9",     // 9
      "change10",  // 10 — changed
    ];
    const newLines = [
      "CHANGE1",   // 1
      "same2",
      "same3",
      "same4",
      "same5",
      "same6",
      "same7",
      "same8",
      "same9",
      "CHANGE10",  // 10
    ];
    const diff = buildUnifiedDiff({
      oldPath: "src/app.ts",
      newPath: "src/app.ts",
      oldLines,
      newLines,
    });
    const lines = diffLines(diff);
    const hunkLines = lines.filter(l => l.startsWith("@@"));
    expect(hunkLines).toHaveLength(2);
    // Both changes should appear
    expect(lines).toContain("-change1");
    expect(lines).toContain("+CHANGE1");
    expect(lines).toContain("-change10");
    expect(lines).toContain("+CHANGE10");
  });

  it("merges close changes into a single @@ block", () => {
    // Changes at line 1 and line 3, with only 1 equal line between.
    // They must merge (gap=1 <= contextLines*2=6).
    const oldLines = ["change1", "same", "change3"];
    const newLines = ["CHANGE1", "same", "CHANGE3"];
    const diff = buildUnifiedDiff({
      oldPath: "src/app.ts",
      newPath: "src/app.ts",
      oldLines,
      newLines,
    });
    const lines = diffLines(diff);
    const hunkLines = lines.filter(l => l.startsWith("@@"));
    expect(hunkLines).toHaveLength(1);
  });
});

// ─── Context Lines ────────────────────────────────────────────────────────────

describe("buildUnifiedDiff — context lines option", () => {
  it("respects custom contextLines=1", () => {
    const diff = buildUnifiedDiff({
      oldPath: "src/app.ts",
      newPath: "src/app.ts",
      oldLines: ["ctx1", "ctx2", "change", "ctx3", "ctx4"],
      newLines: ["ctx1", "ctx2", "CHANGE", "ctx3", "ctx4"],
      contextLines: 1,
    });
    const lines = diffLines(diff);
    // With contextLines=1, only 1 line before and after the change
    expect(lines).toContain(" ctx2");
    expect(lines).toContain("-change");
    expect(lines).toContain("+CHANGE");
    expect(lines).toContain(" ctx3");
    // ctx1 and ctx4 should NOT be present (beyond 1 context line)
    expect(lines).not.toContain(" ctx1");
    expect(lines).not.toContain(" ctx4");
  });
});