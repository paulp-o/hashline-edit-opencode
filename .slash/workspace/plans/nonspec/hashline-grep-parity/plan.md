---
created: 2026-04-05T12:00:00Z
last_updated: 2026-04-05T12:00:00Z
type: nonspec
change_id: hashline-grep-parity
status: pending
trigger: "Fix bugs and implement feature parity improvements from hashline-tools-feature-parity-report.md — 1 critical bug, 1 doc fix, 5 feature gaps"
---

# Plan: Hashline Grep Bug Fixes & Feature Parity

## Background & Research

### Source Files

All grep logic lives in a single file: `src/index.ts`. Documentation/descriptions in `src/lib/hashline-prompt.ts`.

### GrepMatch Interface (src/index.ts lines 291-296)
```ts
interface GrepMatch {
  filePath: string;
  lineNumber: number;
  isMatch: boolean; // true = match line, false = context line
  content: string;
}
```

### Tool Schema Registration (src/index.ts lines 787-868)
```ts
      // ─── hashline_grep ───────────────────────────────────────────────
      hashline_grep: tool({
        description: TOOL_DESCRIPTIONS.hashline_grep,
        args: {
          pattern: tool.schema.string().describe("Search pattern (regex)"),
          path: tool.schema
            .string()
            .optional()
            .describe("Directory or file to search (default: project root)"),
          include: tool.schema
            .string()
            .optional()
            .describe('File pattern filter (e.g. "*.ts")'),
          context: tool.schema
            .number()
            .optional()
            .describe("Number of context lines around matches (default 2)"),
        },
        async execute(args, context) {
          const searchPath = args.path
            ? resolvePath(args.path, getBaseDir(context))
            : getBaseDir(context);
          const contextLines = args.context ?? 2;

          // Normalize BRE-style \| → | for grep compatibility
          const normalizedPattern = args.pattern.replace(/\\\|/g, "|");

          // Try ripgrep first (argv-safe pattern; no column limit on matches)
          const rgOut = await runRipgrep(
            normalizedPattern,
            searchPath,
            contextLines,
            args.include,
          );
          if (rgOut !== null) {
            if (rgOut.trim().length === 0) {
              return `No matches found for pattern: ${args.pattern}`;
            }

            const matches = parseRipgrepOutput(rgOut);
            if (matches.length === 0) {
              return `No matches found for pattern: ${args.pattern}`;
            }

            for (const m of matches) {
              if (isAbsolute(m.filePath)) {
                m.filePath = relative(getBaseDir(context), m.filePath);
              }
            }

            return formatGrepResults(matches);
          }

          // Fallback: fs-based search
          try {
            const matches = await fsBasedSearch(
              normalizedPattern,
              searchPath,
              args.include,
              contextLines,
            );

            if (matches.length === 0) {
              return `No matches found for pattern: ${args.pattern}`;
            }

            // Make file paths relative
            for (const m of matches) {
              if (isAbsolute(m.filePath)) {
                m.filePath = relative(getBaseDir(context), m.filePath);
              }
            }

            return formatGrepResults(matches);
          } catch (err) {
            if (err instanceof Error) {
              return `Error during search: ${err.message}`;
            }
            return `Error during search for pattern: ${args.pattern}`;
          }
        },
      }),
```

### runRipgrep() (src/index.ts lines 478-506)
```ts
async function runRipgrep(
  pattern: string,
  searchPath: string,
  contextLines: number,
  includeGlob: string | undefined,
): Promise<string | null> {
  const argv = [
    "rg",
    "--line-number",
    "--with-filename",
    `-C${contextLines}`,
    "--color=never",
    "--max-columns=0",
  ];
  if (includeGlob) {
    argv.push("--glob", includeGlob);
  }
  argv.push("-e", pattern, "--", searchPath);

  try {
    const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    const exit = await proc.exited;
    if (exit === 2) return null;
    return stdout;
  } catch {
    return null;
  }
}
```

### fsBasedSearch() (src/index.ts lines 417-472)
```ts
async function fsBasedSearch(
  pattern: string,
  searchPath: string,
  include?: string,
  contextLines: number = 2,
): Promise<GrepMatch[]> {
  const regex = new RegExp(pattern);
  const includeRe = include ? globToRegex(include) : undefined;
  const allMatches: GrepMatch[] = [];

  for await (const filePath of walkDirectory(searchPath, includeRe)) {
    if (hasBinaryExtension(filePath)) continue;

    try {
      const content = await Bun.file(filePath).text();
      const lines = content.split("\n");

      const matchIndices: number[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          matchIndices.push(i);
        }
      }

      if (matchIndices.length === 0) continue;

      // Collect lines with context
      const includedLines = new Set<number>();
      for (const idx of matchIndices) {
        for (
          let c = Math.max(0, idx - contextLines);
          c <= Math.min(lines.length - 1, idx + contextLines);
          c++
        ) {
          includedLines.add(c);
        }
      }

      const sortedIndices = Array.from(includedLines).sort((a, b) => a - b);
      const matchSet = new Set(matchIndices);

      for (const idx of sortedIndices) {
        allMatches.push({
          filePath: filePath,
          lineNumber: idx + 1,
          isMatch: matchSet.has(idx),
          content: lines[idx],
        });
      }
    } catch {
      // Skip unreadable files
    }
  }

  return allMatches;
}
```

### walkDirectory() (src/index.ts lines 386-401)
```ts
async function* walkDirectory(
  dir: string,
  includePattern?: RegExp,
): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkDirectory(fullPath, includePattern);
    } else {
      if (includePattern && !includePattern.test(entry.name)) continue;
      yield fullPath;
    }
  }
}
```

### globToRegex() (src/index.ts lines 406-412)
```ts
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}
```

### parseRipgrepOutput() (src/index.ts lines 306-338)
```ts
function parseRipgrepOutput(output: string): GrepMatch[] {
  const results: GrepMatch[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    if (!line || line === "--") continue;

    // Match line: path:linenum:content
    const matchResult = line.match(/^(.+?):(\d+):(.*)$/);
    if (matchResult) {
      results.push({
        filePath: matchResult[1],
        lineNumber: parseInt(matchResult[2], 10),
        isMatch: true,
        content: matchResult[3],
      });
      continue;
    }

    // Context line: path-linenum-content
    const contextResult = line.match(/^(.+?)-(\d+)-(.*)$/);
    if (contextResult) {
      results.push({
        filePath: contextResult[1],
        lineNumber: parseInt(contextResult[2], 10),
        isMatch: false,
        content: contextResult[3],
      });
    }
  }

  return results;
}
```

### formatGrepResults() (src/index.ts lines 343-379)
```ts
function formatGrepResults(matches: GrepMatch[]): string {
  if (matches.length === 0) return "";

  // Group by file
  const fileGroups = new Map<string, GrepMatch[]>();
  for (const match of matches) {
    const group = fileGroups.get(match.filePath);
    if (group) {
      group.push(match);
    } else {
      fileGroups.set(match.filePath, [match]);
    }
  }

  const sections: string[] = [];

  for (const [filePath, fileMatches] of fileGroups) {
    const lines: string[] = [`## ${filePath}`];

    // Sort by line number
    fileMatches.sort((a, b) => a.lineNumber - b.lineNumber);

    for (const m of fileMatches) {
      const hash = computeLineHash(m.content, m.lineNumber);
      const tag = `${m.lineNumber}#${hash}:${m.content}`;
      if (m.isMatch) {
        lines.push(`> ${tag}`);
      } else {
        lines.push(`  ${tag}`);
      }
    }

    sections.push(lines.join("\n"));
  }

  return sections.join("\n\n");
}
```

### Tool Descriptions (src/lib/hashline-prompt.ts lines 64-71)
```ts
export const TOOL_DESCRIPTIONS = {
  hashline_read:
    "Read a file or directory with hashline annotations. Each line is formatted as LINE#HASH:content where HASH is a 2-character content hash. Use offset/limit for large files. For directories, returns a tree listing with line counts. Set diagnostics=true to include LSP diagnostics (errors/warnings) for the file.",
  hashline_edit:
    "Edit a file using hashline references. Operations: replace (single/range), append (after line), prepend (before line). Use \"N#ID\" anchors from hashline_read/hashline_grep output. Supports file creation (anchorless append), delete, and move. All hashes verified before mutation.",
  hashline_grep:
    "Search files with hashline-annotated results. Returns matching lines with LINE#HASH:content format. Match lines prefixed with >. Context lines shown around matches. Results can be used directly for hashline_edit anchors.",
};
```

### Anchorless Append Doc (src/lib/hashline-prompt.ts lines 132-134)
```ts
**`op: "append"`** — Insert lines after the anchor line.
  - `{ op: "append", pos: ${hlineref(5, e[4])}, lines: ["  const delay = 1000;"] }`
  - Without pos: appends at end of file (EOF), or **creates a new file** if the file doesn't exist.
```

### File Operations Doc (src/lib/hashline-prompt.ts lines 147-151)
```ts
## File Operations

- **Create new file**: Use anchorless append (no `pos`) on a non-existent path — the file will be created automatically.
- **Delete file**: `{ path: "src/old.ts", delete: true }`
- **Move/rename file**: `{ path: "src/old.ts", move: "src/new.ts" }`
```

### Test Infrastructure
- **Runner:** `bun test src/tests/`
- **Typecheck:** `tsc --noEmit`
- **Test files:** `src/tests/e2e.test.ts` (429 lines), `src/tests/hashline-core.test.ts`, `src/tests/hashline-apply.test.ts`, `src/tests/hashline-strip.test.ts`, `src/tests/lsp-diagnostics.test.ts`, plus LSP test subdirectory
- **Grep-related tests:** e2e.test.ts scenarios 14.5 (grep formatting) and 14.6 (grep→edit workflow)

### Key Patterns
- `runRipgrep()` returns `string | null` — null means ripgrep unavailable, fallback to FS
- `fsBasedSearch()` uses `walkDirectory()` generator + `globToRegex()` for include filtering
- `walkDirectory()` tests `includePattern` against `entry.name` only (basename), NOT full path
- Both search paths feed into `formatGrepResults()` for uniform output
- The handler in `execute()` does path resolution, pattern normalization, then tries rg → fallback

### Key Constraint: walkDirectory includePattern Bug
The `walkDirectory()` function at line 397 tests `includePattern.test(entry.name)` — this tests **only the filename basename**, not the full path. When `include` is a full file path like `"apps/web/src/lib/sandbox/patch-engine.ts"`, `globToRegex()` converts it to a regex that requires matching the entire string, but it's tested against just the filename. This is the root cause of BUG 1.

---

## Testing Plan (TDD — tests first)

### Test File: `src/tests/hashline-grep-features.test.ts` (NEW)

- [ ] **T1** Create new test file `src/tests/hashline-grep-features.test.ts` with imports from `bun:test` and necessary helpers from `../index.ts` or internal modules. Since the grep functions (`fsBasedSearch`, `runRipgrep`, `formatGrepResults`, `parseRipgrepOutput`, `globToRegex`, `walkDirectory`) are module-private, tests should either: (a) export them in a test-friendly way, or (b) test through the tool handler. **Decision: test through exported tool handler via the MCP tool interface, or refactor to export the helper functions for unit testing.** Prefer approach (b) — export helper functions for direct unit testing, and add integration tests through the tool handler.

- [ ] **T2** Write unit tests for BUG 1 — `include` parameter with full file path:
  - Test: `include="path/to/file.ts"` without `path` should detect the file path and search it (not return 0 results)
  - Test: `include="path/to/file.ts"` with a pattern known to exist returns matches
  - Test: `include="*.ts"` (glob) still works as before
  - Test: `include="src/**/*.ts"` (glob with directory) still works as before

- [ ] **T3** Write unit tests for FEATURE 3 — `ignoreCase`:
  - Test: `ignoreCase=false` (default) — `pattern="import"` matches "import" but not "IMPORT" or "Import"
  - Test: `ignoreCase=true` — `pattern="import"` matches "import", "Import", "IMPORT"
  - Test: `ignoreCase=true` works with regex patterns like `"foo|bar"` (matches "FOO", "Bar", etc.)

- [ ] **T4** Write unit tests for FEATURE 5 — `filesOnly`:
  - Test: `filesOnly=true` returns only file paths, no line content
  - Test: `filesOnly=false` (default) returns full annotated output as before
  - Test: `filesOnly=true` with multiple files returns deduplicated file list

- [ ] **T5** Write unit tests for FEATURE 6 — `invertMatch`:
  - Test: `invertMatch=true` returns lines that do NOT match the pattern
  - Test: `invertMatch=false` (default) returns lines that match (existing behavior)
  - Test: `invertMatch=true` with context lines — context should still be shown around non-matching lines

- [ ] **T6** Write unit tests for FEATURE 7 — `countOnly`:
  - Test: `countOnly=true` returns counts per file and total, no line content
  - Test: `countOnly=false` (default) returns full annotated output as before
  - Test: `countOnly=true` — output format includes `{file: count}` style info

- [ ] **T7** Write unit tests for FEATURE 8 — multi-path `path` parameter:
  - Test: `path=["dir1/", "dir2/"]` (array) returns merged results from both paths
  - Test: `path="dir1/"` (string) still works as before (backward compatible)
  - Test: `path=["file1.ts", "file2.ts"]` (array of files) works

- [ ] **T8** Write unit tests for `fsBasedSearch()` directly to verify ignoreCase, invertMatch, countOnly, filesOnly work in the FS fallback path (not just ripgrep)

### Existing Tests: `src/tests/e2e.test.ts`

- [ ] **T9** Verify existing tests still pass after all changes — run `bun test src/tests/` as regression check

---

## Implementation Plan

### BUG 1: Fix `include` parameter silently failing with file paths

- [ ] **I1** In the `execute()` handler (src/index.ts ~line 805), add detection logic BEFORE calling `runRipgrep()` or `fsBasedSearch()`:
  - Check if `args.include` looks like a file path (contains `/` or `\` AND does NOT contain glob characters `*` or `?`)
  - If it looks like a file path:
    - If `args.path` is NOT set: treat `include` as `path` (set `searchPath = resolvePath(args.include, baseDir)` and clear the include)
    - If `args.path` IS set: return a clear error message explaining that `include` is for glob patterns, use `path` for file paths
  - Helper function: `function looksLikeFilePath(s: string): boolean` — returns true if the string contains `/` and no `*` or `?` characters

- [ ] **I2** Update `runRipgrep()` signature and implementation — no changes needed for BUG 1 (detection happens in handler)

- [ ] **I3** Update `fsBasedSearch()` — ensure when `searchPath` is a file (not directory), it searches just that file directly instead of walking. Add a `stat()` check: if `searchPath` is a file, read and search it directly.

### BUG 2: Document anchorless append gotcha

- [ ] **I4** In `src/lib/hashline-prompt.ts`, update the `hashline_edit` tool description string (line 68) to include a warning about anchorless append on existing files:
  - Add: `"WARNING: Anchorless append (no pos) on EXISTING files adds to end — it does NOT replace content. Use replace with anchors for idempotent rewrites."`

- [ ] **I5** In `src/lib/hashline-prompt.ts`, add a cautionary note in the File Operations section (around line 149) after "Create new file":
  - Add: `"- **Caution**: Anchorless append on an existing file appends to the end. For idempotent overwrites, read the file first and use replace."`

### FEATURE 3: Add `ignoreCase` parameter

- [ ] **I6** Add `ignoreCase` to the tool schema (src/index.ts ~line 803, after `context`):
  ```ts
  ignoreCase: tool.schema.boolean().optional().describe("Case-insensitive matching (default: false)"),
  ```

- [ ] **I7** Update `runRipgrep()` function signature to accept `ignoreCase: boolean`:
  - Add `ignoreCase` parameter
  - When true, add `"--ignore-case"` (or `-i`) to the argv array before the pattern

- [ ] **I8** Update `fsBasedSearch()` function signature to accept `ignoreCase: boolean`:
  - Add `ignoreCase` parameter
  - When true, create regex with `"i"` flag: `new RegExp(pattern, "i")`

- [ ] **I9** Thread `args.ignoreCase` through from the handler to both `runRipgrep()` and `fsBasedSearch()` calls

- [ ] **I10** Update `TOOL_DESCRIPTIONS.hashline_grep` in `src/lib/hashline-prompt.ts` to mention the `ignoreCase` parameter

### FEATURE 5: Add `filesOnly` parameter

- [ ] **I11** Add `filesOnly` to the tool schema:
  ```ts
  filesOnly: tool.schema.boolean().optional().describe("Return only file paths with matches, no line content (default: false)"),
  ```

- [ ] **I12** Update `runRipgrep()` — when `filesOnly` is true:
  - Add `"--files-with-matches"` (or `-l`) to argv
  - Remove context lines arg (`-C{n}`) since it's irrelevant
  - Parse output differently: each line is just a file path

- [ ] **I13** Create `formatFilesOnlyResults()` function:
  - Takes `GrepMatch[]` or `string[]` (file paths)
  - Returns deduplicated file list, one per line

- [ ] **I14** Update `fsBasedSearch()` or handler — when `filesOnly` is true:
  - Collect unique file paths from matches
  - Return early after first match per file (optimization)

- [ ] **I15** Thread `args.filesOnly` through the handler, format output appropriately:
  - For ripgrep path: parse `--files-with-matches` output (one path per line)
  - For FS path: extract unique file paths from GrepMatch[]
  - Return formatted file list instead of annotated lines

### FEATURE 6: Add `invertMatch` parameter

- [ ] **I16** Add `invertMatch` to the tool schema:
  ```ts
  invertMatch: tool.schema.boolean().optional().describe("Return non-matching lines (invert match, default: false)"),
  ```

- [ ] **I17** Update `runRipgrep()` — when `invertMatch` is true:
  - Add `"--invert-match"` (or `-v`) to argv

- [ ] **I18** Update `fsBasedSearch()` — when `invertMatch` is true:
  - Invert the regex test: `if (!regex.test(lines[i]))` instead of `if (regex.test(lines[i]))`
  - Context lines logic: show context around non-matching lines (matching lines become context)

- [ ] **I19** Thread `args.invertMatch` through from handler to both search functions

### FEATURE 7: Add `countOnly` parameter

- [ ] **I20** Add `countOnly` to the tool schema:
  ```ts
  countOnly: tool.schema.boolean().optional().describe("Return only match counts per file (default: false)"),
  ```

- [ ] **I21** Update `runRipgrep()` — when `countOnly` is true:
  - Add `"--count"` (or `-c`) to argv
  - Remove context lines arg
  - Parse output as `file:count` pairs

- [ ] **I22** Create `formatCountResults()` function:
  - Takes parsed count data `Map<string, number>` or `GrepMatch[]`
  - Returns formatted output like:
    ```
    src/file1.ts: 12
    src/file2.ts: 5
    Total: 17 matches in 2 files
    ```

- [ ] **I23** Update `fsBasedSearch()` or handler — when `countOnly` is true:
  - Count matches per file without collecting all line content (optimization)
  - Return count data

- [ ] **I24** Thread `args.countOnly` through the handler, format output appropriately

### FEATURE 8: Support multi-path `path` parameter

- [ ] **I25** Update the tool schema `path` to accept `string | string[]`:
  ```ts
  path: tool.schema.union([
    tool.schema.string(),
    tool.schema.array(tool.schema.string()),
  ]).optional().describe("Directory or file(s) to search (default: project root). Can be a single path or array of paths."),
  ```
  **Note:** Check if the schema library supports `union` or `oneOf`. If not, accept as string and parse JSON arrays, or use a different approach.

- [ ] **I26** Update the handler `execute()` to handle array paths:
  - If `args.path` is an array: loop over each path, run search for each, merge results
  - If `args.path` is a string: existing behavior (single path)
  - Deduplicate if paths overlap

- [ ] **I27** Update `TOOL_DESCRIPTIONS.hashline_grep` to mention multi-path support

### Cross-cutting: Update function signatures

- [ ] **I28** Refactor `runRipgrep()` to accept an options object instead of positional params (cleaner with 6+ params):
  ```ts
  interface GrepOptions {
    pattern: string;
    searchPath: string;
    contextLines: number;
    includeGlob?: string;
    ignoreCase?: boolean;
    filesOnly?: boolean;
    invertMatch?: boolean;
    countOnly?: boolean;
  }
  async function runRipgrep(opts: GrepOptions): Promise<string | null>
  ```

- [ ] **I29** Refactor `fsBasedSearch()` to accept a similar options object:
  ```ts
  async function fsBasedSearch(opts: GrepOptions): Promise<GrepMatch[]>
  ```

- [ ] **I30** Export internal helper functions (for direct unit testing) via a test-only barrel or conditional export pattern. Alternatively, mark them with `export` directly since this is an MCP tool package (no public API concern).

### Validation & Verification

- [ ] **V1** Run `bun test src/tests/` — all existing tests pass
- [ ] **V2** Run `tsc --noEmit` — no type errors
- [ ] **V3** Run `bun run build` — build succeeds
- [ ] **V4** Manual smoke test: try the reported failing case from BUG 1 (`include` with full file path)

---

## Parallelization Plan

### Batch 1 (parallel — foundation + tests)

- [ ] **Coder A: Refactor function signatures + BUG 1 fix** → files: `src/index.ts`
  - Tasks: I28, I29, I1, I2, I3 (refactor runRipgrep/fsBasedSearch to options objects, add file-path detection for include parameter, handle file-as-searchPath in fsBasedSearch)

- [ ] **Coder B: Write all new tests** → files: `src/tests/hashline-grep-features.test.ts` (NEW)
  - Tasks: T1, T2, T3, T4, T5, T6, T7, T8
  - Note: Tests can be written against the expected API even before implementation exists — they will fail initially (TDD red phase)

- [ ] **Coder C: Documentation fixes** → files: `src/lib/hashline-prompt.ts`
  - Tasks: I4, I5, I10, I27 (BUG 2 doc fix, update tool descriptions for new params)

### Batch 2 (parallel — feature implementation, after Batch 1)

- [ ] **Coder D: Implement ignoreCase + invertMatch** → files: `src/index.ts`
  - Tasks: I6, I7, I8, I9, I16, I17, I18, I19
  - These modify the schema + both search functions + handler threading

- [ ] **Coder E: Implement filesOnly + countOnly** → files: `src/index.ts`
  - Tasks: I11, I12, I13, I14, I15, I20, I21, I22, I23, I24
  - These add new formatting functions + modify schema + search functions

**⚠️ Conflict note:** Coder D and E both modify `src/index.ts`. They MUST be serialized OR carefully assigned non-overlapping line ranges:
  - Coder D: modifies schema lines (add ignoreCase, invertMatch), runRipgrep options handling, fsBasedSearch regex flags
  - Coder E: modifies schema lines (add filesOnly, countOnly), adds new format functions, modifies search function early-exit logic
  - **Recommendation:** Run D and E sequentially (D first, then E) to avoid merge conflicts in the same file. Alternatively, run as a single coder.

### Batch 3 (after Batch 2 — multi-path + final integration)

- [ ] **Coder F: Implement multi-path support + export helpers + final integration** → files: `src/index.ts`
  - Tasks: I25, I26, I30
  - This modifies the schema and handler dispatch loop

### Batch 4 (after all implementation — verification)

- [ ] **Coder G: Run all verification** → files: none (read-only)
  - Tasks: T9, V1, V2, V3, V4
  - Run tests, typecheck, build, smoke test

### Dependencies
- Batch 1 has no internal dependencies (A, B, C work on separate files)
- Batch 2 depends on Batch 1 (Coder A's refactored signatures are needed)
- Batch 2 D and E conflict on src/index.ts — serialize them
- Batch 3 depends on Batch 2 (all features in place before multi-path)
- Batch 4 depends on everything (verification is last)

### Risk Areas
- **src/index.ts contention:** All feature implementations modify this single file. Batches 2 and 3 should be sequential for the same file.
- **Schema library compatibility:** The `union` type for multi-path (I25) may not be supported by the tool schema library. May need to use `string` and parse arrays manually, or use `any()` with runtime validation.
- **ripgrep argument interaction:** When combining flags like `--ignore-case`, `--invert-match`, `--count`, `--files-with-matches`, some combinations may conflict (e.g., `--count` + `--files-with-matches`). Add validation to reject incompatible combos.
- **parseRipgrepOutput changes:** `--count` and `--files-with-matches` produce different output formats. Need separate parsers or mode-aware parsing.

---

## Done Criteria

- [ ] BUG 1 fixed: `hashline_grep(pattern="x", include="path/to/file.ts")` returns matches (not silent failure)
- [ ] BUG 2 documented: hashline_edit tool description warns about anchorless append on existing files
- [ ] FEATURE 3: `ignoreCase=true` performs case-insensitive search in both ripgrep and FS fallback
- [ ] FEATURE 5: `filesOnly=true` returns only file paths, no line content
- [ ] FEATURE 6: `invertMatch=true` returns non-matching lines
- [ ] FEATURE 7: `countOnly=true` returns match counts per file
- [ ] FEATURE 8: `path` accepts `string[]` for multi-path search
- [ ] All new tests pass (`bun test src/tests/`)
- [ ] All existing tests still pass (regression)
- [ ] TypeScript compiles cleanly (`tsc --noEmit`)
- [ ] Build succeeds (`bun run build`)
- [ ] Tool descriptions updated in `src/lib/hashline-prompt.ts` for all new parameters
