export interface MismatchInfo {
  line: number;         // 1-indexed line number
  expected: string;     // 2-char hash the LLM provided
  actual: string;       // 2-char hash computed from current file content
  content: string;      // The current content of the mismatched line
}

export class HashlineMismatchError extends Error {
  readonly mismatches: MismatchInfo[];

  constructor(
    mismatches: MismatchInfo[],
    fileLines: string[],
    formatLineFn: (lineNum: number, content: string) => string,
  ) {
    const blocks = mismatches.map((m) => {
      const start = Math.max(1, m.line - 2);
      const end = Math.min(fileLines.length, m.line + 2);

      const contextLines: string[] = [];
      for (let i = start; i <= end; i++) {
        const lineContent = fileLines[i - 1]; // fileLines is 0-indexed
        const tag = formatLineFn(i, lineContent);
        if (i === m.line) {
          contextLines.push(`>>>${tag}:${lineContent}`);
        } else {
          contextLines.push(`  ${tag}:${lineContent}`);
        }
      }

      const header = `Hash mismatch at line ${m.line} (expected ${m.line}#${m.expected}, got ${m.line}#${m.actual}):`;

      return [
        header,
        ...contextLines,
        "",
        "To retry, use:",
        `  pos: "${m.line}#${m.actual}"`,
      ].join("\n");
    });

    const message = blocks.join("\n\n");

    super(message);
    this.name = "HashlineMismatchError";
    this.mismatches = mismatches;
  }
}
