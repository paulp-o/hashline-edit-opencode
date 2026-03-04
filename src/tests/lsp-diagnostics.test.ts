import { describe, it, expect } from "bun:test";
import {
  formatDiagnosticLine,
  formatFileDiagnostics,
} from "../lib/lsp/lsp-diagnostics";
import type { FormattedDiagnostic } from "../lib/lsp/types";

describe("formatDiagnosticLine", () => {
  it("formats ERROR diagnostic without source", () => {
    const d: FormattedDiagnostic = {
      severity: "ERROR",
      line: 12,
      col: 5,
      message: "'foo' is not defined",
    };
    expect(formatDiagnosticLine(d)).toBe("ERROR [12:5] 'foo' is not defined");
  });

  it("formats WARN diagnostic with source", () => {
    const d: FormattedDiagnostic = {
      severity: "WARN",
      line: 30,
      col: 1,
      message: "Unused import",
      source: "ts",
    };
    expect(formatDiagnosticLine(d)).toBe("WARN [30:1] [ts] Unused import");
  });

  it("formats INFO diagnostic", () => {
    const d: FormattedDiagnostic = {
      severity: "INFO",
      line: 1,
      col: 1,
      message: "Consider using const",
    };
    expect(formatDiagnosticLine(d)).toBe("INFO [1:1] Consider using const");
  });

  it("formats HINT diagnostic with source", () => {
    const d: FormattedDiagnostic = {
      severity: "HINT",
      line: 5,
      col: 10,
      message: "Unnecessary type assertion",
      source: "eslint",
    };
    expect(formatDiagnosticLine(d)).toBe(
      "HINT [5:10] [eslint] Unnecessary type assertion",
    );
  });
});

describe("formatFileDiagnostics", () => {
  it("returns empty string for no diagnostics", () => {
    expect(formatFileDiagnostics("src/index.ts", [])).toBe("");
  });

  it("wraps single diagnostic in XML format", () => {
    const diags: FormattedDiagnostic[] = [
      { severity: "ERROR", line: 12, col: 5, message: "'foo' is not defined" },
    ];
    const result = formatFileDiagnostics("src/index.ts", diags);
    expect(result).toBe(
      `<diagnostics file="src/index.ts">\nERROR [12:5] 'foo' is not defined\n</diagnostics>`,
    );
  });

  it("sorts by severity (ERROR first, then WARN, then INFO)", () => {
    const diags: FormattedDiagnostic[] = [
      { severity: "INFO", line: 1, col: 1, message: "info msg" },
      { severity: "ERROR", line: 5, col: 1, message: "error msg" },
      { severity: "WARN", line: 3, col: 1, message: "warn msg" },
    ];
    const result = formatFileDiagnostics("test.ts", diags);
    const lines = result.split("\n");
    expect(lines[0]).toBe('<diagnostics file="test.ts">');
    expect(lines[1]).toStartWith("ERROR");
    expect(lines[2]).toStartWith("WARN");
    expect(lines[3]).toStartWith("INFO");
    expect(lines[4]).toBe("</diagnostics>");
  });

  it("sorts by line number within same severity", () => {
    const diags: FormattedDiagnostic[] = [
      { severity: "ERROR", line: 20, col: 1, message: "second error" },
      { severity: "ERROR", line: 5, col: 1, message: "first error" },
    ];
    const result = formatFileDiagnostics("test.ts", diags);
    const lines = result.split("\n");
    expect(lines[1]).toContain("[5:1]");
    expect(lines[2]).toContain("[20:1]");
  });

  it("truncates when exceeding maxCount", () => {
    const diags: FormattedDiagnostic[] = Array.from({ length: 25 }, (_, i) => ({
      severity: "ERROR" as const,
      line: i + 1,
      col: 1,
      message: `Error ${i + 1}`,
    }));
    const result = formatFileDiagnostics("test.ts", diags, 20);
    expect(result).toContain("... and 5 more diagnostics");
    // Count actual diagnostic lines (not header, footer, or truncation notice)
    const lines = result.split("\n");
    // First line = header, last line = footer, second-to-last = truncation msg
    // So diagnostic lines = total lines - 3
    expect(lines.length - 3).toBe(20);
  });

  it("respects custom maxCount", () => {
    const diags: FormattedDiagnostic[] = Array.from({ length: 10 }, (_, i) => ({
      severity: "WARN" as const,
      line: i + 1,
      col: 1,
      message: `Warning ${i + 1}`,
    }));
    const result = formatFileDiagnostics("test.ts", diags, 5);
    expect(result).toContain("... and 5 more diagnostics");
  });

  it("includes source in formatted output", () => {
    const diags: FormattedDiagnostic[] = [
      { severity: "ERROR", line: 1, col: 1, message: "Type error", source: "ts" },
    ];
    const result = formatFileDiagnostics("test.ts", diags);
    expect(result).toContain("[ts] Type error");
  });

  it("does not truncate when exactly at maxCount", () => {
    const diags: FormattedDiagnostic[] = Array.from({ length: 20 }, (_, i) => ({
      severity: "ERROR" as const,
      line: i + 1,
      col: 1,
      message: `Error ${i + 1}`,
    }));
    const result = formatFileDiagnostics("test.ts", diags, 20);
    expect(result).not.toContain("... and");
    const lines = result.split("\n");
    // header + 20 diagnostics + footer = 22 lines
    expect(lines.length).toBe(22);
  });

  it("uses default maxCount of MAX_DIAGNOSTICS_PER_FILE (20)", () => {
    const diags: FormattedDiagnostic[] = Array.from({ length: 22 }, (_, i) => ({
      severity: "WARN" as const,
      line: i + 1,
      col: 1,
      message: `Warning ${i + 1}`,
    }));
    // No maxCount argument — should use default of 20
    const result = formatFileDiagnostics("test.ts", diags);
    expect(result).toContain("... and 2 more diagnostics");
  });

  it("preserves HINT severity in output", () => {
    const diags: FormattedDiagnostic[] = [
      { severity: "HINT", line: 7, col: 3, message: "Simplify expression" },
      { severity: "ERROR", line: 2, col: 1, message: "Missing semicolon" },
    ];
    const result = formatFileDiagnostics("test.ts", diags);
    const lines = result.split("\n");
    // ERROR before HINT
    expect(lines[1]).toStartWith("ERROR");
    expect(lines[2]).toStartWith("HINT");
  });
});