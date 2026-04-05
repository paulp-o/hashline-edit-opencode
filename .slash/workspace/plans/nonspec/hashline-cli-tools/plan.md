---
created: 2026-04-05T12:00:00Z
last_updated: 2026-04-05T12:00:00Z
type: nonspec
change_id: hashline-cli-tools
status: pending
trigger: "Add CLI tools (hread, hg, hedit) with 100% feature parity to existing MCP tools"
---

# Plan: Hashline CLI Tools — hread, hg, hedit

## Background & Research

### Current Architecture

The project is a Bun-based MCP plugin (`@paulp-o/hashline-edit-opencode`) that registers 3 tools: `hashline_read`, `hashline_edit`, `hashline_grep`. All tool logic lives in `src/index.ts` (1005 lines) with shared libraries in `src/lib/`.

**Key Dependency Chain:**
```
src/index.ts (MCP plugin entry — 3 tool handlers)
├── src/lib/hashline-core.ts (hash computation, formatHashLines)
├── src/lib/hashline-apply.ts (edit engine: applyHashlineEdits)
├── src/lib/hashline-errors.ts (HashlineMismatchError)
├── src/lib/hashline-strip.ts (stripNewLinePrefixes)
├── src/lib/hashline-prompt.ts (system prompt rendering)
└── src/lib/lsp/ (LSP diagnostics subsystem)
```

### Functions to Extract from src/index.ts

Currently **17 private items** in `src/index.ts` need extraction to shared modules so CLI tools can reuse them. They fall into 3 categories:

#### Category A: Grep/Search Functions → Extract to `src/lib/grep-search.ts`

- File: `src/index.ts` lines 291-560

```ts
// Types (lines 291-310)
interface GrepMatch {
  filePath: string;
  lineNumber: number;
  isMatch: boolean;  // true = match line, false = context line
  content: string;
}

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

// Detection helper (lines 316-318)
function looksLikeFilePath(s: string): boolean {
  return (s.includes("/") || s.includes("\\")) && !s.includes("*") && !s.includes("?");
}

// Parse ripgrep output (lines 328-360)
function parseRipgrepOutput(output: string): GrepMatch[] {
  const results: GrepMatch[] = [];
  const lines = output.split("\n");
  for (const line of lines) {
    if (!line || line === "--") continue;
    const matchResult = line.match(/^(.+?):(\d+):(.*)$/);
    if (matchResult) {
      results.push({ filePath: matchResult[1], lineNumber: parseInt(matchResult[2], 10), isMatch: true, content: matchResult[3] });
      continue;
    }
    const contextResult = line.match(/^(.+?)-(\d+)-(.*)$/);
    if (contextResult) {
      results.push({ filePath: contextResult[1], lineNumber: parseInt(contextResult[2], 10), isMatch: false, content: contextResult[3] });
    }
  }
  return results;
}

// Format results with hashline annotations (lines 365-401)
function formatGrepResults(matches: GrepMatch[]): string {
  if (matches.length === 0) return "";
  const fileGroups = new Map<string, GrepMatch[]>();
  for (const match of matches) {
    const group = fileGroups.get(match.filePath);
    if (group) { group.push(match); } else { fileGroups.set(match.filePath, [match]); }
  }
  const sections: string[] = [];
  for (const [filePath, fileMatches] of fileGroups) {
    const lines: string[] = [`## ${filePath}`];
    fileMatches.sort((a, b) => a.lineNumber - b.lineNumber);
    for (const m of fileMatches) {
      const hash = computeLineHash(m.content, m.lineNumber);
      const tag = `${m.lineNumber}#${hash}:${m.content}`;
      if (m.isMatch) { lines.push(`> ${tag}`); } else { lines.push(`  ${tag}`); }
    }
    sections.push(lines.join("\n"));
  }
  return sections.join("\n\n");
}

// Format files-only (lines 406-410)
function formatFilesOnlyResults(matches: GrepMatch[]): string {
  const seen = new Set<string>();
  for (const m of matches) seen.add(m.filePath);
  return [...seen].join("\n");
}

// Format count-only (lines 415-428)
function formatCountResults(matches: GrepMatch[]): string {
  const counts = new Map<string, number>();
  for (const m of matches) { if (m.isMatch) counts.set(m.filePath, (counts.get(m.filePath) ?? 0) + 1); }
  const lines: string[] = [];
  let total = 0;
  for (const [filePath, count] of counts) { lines.push(`${filePath}: ${count}`); total += count; }
  lines.push(`\nTotal: ${total} matches in ${counts.size} files`);
  return lines.join("\n");
}

// Walk directory (lines 435-450)
async function* walkDirectory(dir: string, includePattern?: RegExp): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) { yield* walkDirectory(fullPath, includePattern); }
    else { if (includePattern && !includePattern.test(entry.name)) continue; yield fullPath; }
  }
}

// Glob to regex (lines 455-461)
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

// FS-based fallback search (lines 466-527)
async function fsBasedSearch(opts: GrepOptions): Promise<GrepMatch[]> { /* full body above */ }

// Ripgrep runner (lines 533-560)
async function runRipgrep(opts: GrepOptions): Promise<string | null> { /* full body above */ }
```

#### Category B: File Utility Functions → Extract to `src/lib/file-utils.ts`

- File: `src/index.ts` lines 29-90, 209-287

```ts
// Binary extensions constant (lines 29-67)
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".svg",
  ".pdf", ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
  ".exe", ".dll", ".so", ".dylib", ".o", ".a", ".wasm", ".class", ".jar", ".pyc", ".pyo",
  ".mp3", ".mp4", ".wav", ".avi", ".mov", ".mkv",
  ".ttf", ".otf", ".woff", ".woff2", ".eot",
]);

// Binary detection by null bytes (lines 73-77)
async function isBinaryFile(filePath: string): Promise<boolean> {
  const file = Bun.file(filePath);
  const buf = new Uint8Array(await file.slice(0, 8192).arrayBuffer());
  return buf.includes(0);
}

// Path resolution (lines 83-85)
function resolvePath(filePath: string, contextDirectory: string): string {
  return isAbsolute(filePath) ? filePath : resolve(contextDirectory, filePath);
}

// Binary extension check (lines 284-287)
function hasBinaryExtension(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

// Git ignored set (lines 209-227)
async function getGitIgnoredSet(dirPath: string): Promise<Set<string>> {
  try {
    const proc = Bun.spawn(["git", "ls-files", "--others", "--ignored", "--exclude-standard", "-z", "."], { cwd: dirPath, stdout: "pipe", stderr: "pipe" });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    const ignored = new Set<string>();
    for (const p of output.split("\0")) { const trimmed = p.trim().replace(/\/$/, ""); if (trimmed) ignored.add(trimmed.split("/")[0]); }
    return ignored;
  } catch { return new Set(); }
}

// Directory listing (lines 229-279)
async function buildDirectoryListing(dirPath: string, basePath: string, indent: string = "", parentIgnored?: Set<string>): Promise<string> {
  // ... full recursive tree builder with gitignore support
}
```

#### Category C: Edit Summary Functions (used by hedit CLI output)

- File: `src/index.ts` lines 121-197

```ts
// Summarize edits for response (lines 121-154)
function summarizeEdits(edits: EditOperation[]): string {
  const lines: string[] = [];
  for (const edit of edits) {
    const pos = edit.pos ?? "(none)";
    if (edit.op === "replace") {
      const range = edit.end ? `${edit.pos}..${edit.end}` : pos;
      if (!edit.lines || (Array.isArray(edit.lines) && edit.lines.length === 0) || edit.lines === null) { lines.push(`  delete ${range}`); }
      else { const count = Array.isArray(edit.lines) ? edit.lines.length : 1; lines.push(`  replace ${range} → ${count} line(s)`); }
    } else if (edit.op === "append") {
      const count = Array.isArray(edit.lines) ? edit.lines.length : edit.lines ? 1 : 0;
      lines.push(`  append ${count} line(s) after ${pos}`);
    } else if (edit.op === "prepend") {
      const count = Array.isArray(edit.lines) ? edit.lines.length : edit.lines ? 1 : 0;
      lines.push(`  prepend ${count} line(s) before ${pos}`);
    }
  }
  return lines.join("\n");
}
```

### Build Configuration

- File: `package.json`

```json
{
  "name": "@paulp-o/hashline-edit-opencode",
  "version": "0.3.2",
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "build": "bun build src/index.ts --outdir dist --format esm --sourcemap=linked --target=bun",
    "build:types": "tsc --emitDeclarationOnly",
    "build:all": "rm -rf dist && bun run build && bun run build:types",
    "test": "bun test src/tests/",
    "typecheck": "tsc --noEmit"
  }
}
```

No `bin` field exists. No `src/cli/` directory exists.

### Existing Tests (102 cases across 8 files)

```
src/tests/hashline-core.test.ts     (13 tests)
src/tests/hashline-apply.test.ts    (17 tests)
src/tests/hashline-strip.test.ts    (4 tests)
src/tests/e2e.test.ts               (10 tests)
src/tests/lsp-diagnostics.test.ts   (14 tests)
src/tests/lsp/path-detection.test.ts (10 tests)
src/tests/lsp/project-scanning.test.ts (18 tests)
src/tests/lsp/registry.test.ts      (15+ tests)
```

### CLI Design Decisions

1. **No external dependencies**: Use manual `process.argv` parsing — Bun provides `process.argv` natively.
2. **Shebang**: Each CLI file starts with `#!/usr/bin/env bun`.
3. **Build**: Separate `bun build` command for CLI entrypoints targeting `dist/cli/`.
4. **Exit codes**: 0 = success, 1 = match failure (hg only, like grep), 2 = error.
5. **Color output**: Not in initial scope — plain text output matches MCP tool format exactly.
6. **Output format**: Identical to MCP tool output (hashline-annotated). This IS the feature parity requirement.

---

## Testing Plan (TDD — tests first)

### Extraction Tests (verify no regression)

- [ ] T1: Create `src/tests/grep-search.test.ts` — unit tests for extracted grep functions:
  - `parseRipgrepOutput()`: match lines, context lines, separator handling, empty input
  - `formatGrepResults()`: single file, multi-file grouping, empty matches
  - `formatFilesOnlyResults()`: deduplication, empty input
  - `formatCountResults()`: per-file counts, total aggregation
  - `globToRegex()`: `*.ts` pattern, `*.{ts,tsx}` pattern, exact name pattern
  - `looksLikeFilePath()`: `/path/to/file` true, `*.ts` false, `src/**/*.js` false
  - `walkDirectory()`: yield files, skip hidden/node_modules, include filter

- [ ] T2: Create `src/tests/file-utils.test.ts` — unit tests for extracted file utilities:
  - `hasBinaryExtension()`: `.png` true, `.ts` false, `.PDF` case test
  - `isBinaryFile()`: binary file detection, text file passes
  - `resolvePath()`: absolute passthrough, relative resolution
  - `buildDirectoryListing()`: tree output format, empty directory

- [ ] T3: Run `bun test src/tests/` — all 102 existing tests must still pass after extraction (NO REGRESSIONS)

### CLI Tests

- [ ] T4: Create `src/tests/cli/hread.test.ts` — `hread` CLI integration tests:
  - Read a file → output matches `hashline_read` format (LINE#HASH:content)
  - Read a directory → tree listing output
  - `--offset 5 --limit 10` pagination
  - Binary file → error message
  - Nonexistent file → error + exit code 2
  - `--help` → usage text + exit code 0

- [ ] T5: Create `src/tests/cli/hg.test.ts` — `hg` CLI integration tests:
  - Simple pattern search → hashline-annotated output
  - `-i` case-insensitive → matches regardless of case
  - `-l` files-only → file paths only
  - `-v` invert-match → non-matching lines
  - `-c` count-only → per-file counts
  - `-C 3` context lines → 3 lines of context
  - `-g "*.ts"` glob filter → only .ts files
  - Multiple paths → merged results
  - No matches → exit code 1
  - Invalid regex → error + exit code 2
  - `--help` → usage text + exit code 0

- [ ] T6: Create `src/tests/cli/hedit.test.ts` — `hedit` CLI integration tests:
  - `--replace <pos> --lines "new content"` → single-line replace
  - `--replace <pos> --end <end> --lines "a" "b"` → range replace
  - `--append <pos> --lines "new"` → append after anchor
  - `--append --lines "new"` → anchorless append (new file creation)
  - `--prepend <pos> --lines "new"` → prepend before anchor
  - `--delete` → file deletion
  - `--move <new-path>` → file rename
  - `--json '[{"op":"replace","pos":"5#NS","lines":["x"]}]'` → JSON edits
  - Hash mismatch → error + exit code 2
  - `--help` → usage text + exit code 0

---

## Implementation Plan

### Phase 1: Extract Shared Modules (prerequisite for CLI)

- [ ] I1: Create `src/lib/grep-search.ts` — extract from `src/index.ts`:
  - Move `GrepMatch` interface (export it)
  - Move `GrepOptions` interface (export it)
  - Move `looksLikeFilePath()` (export it)
  - Move `parseRipgrepOutput()` (export it)
  - Move `formatGrepResults()` (export it, add import for `computeLineHash`)
  - Move `formatFilesOnlyResults()` (export it)
  - Move `formatCountResults()` (export it)
  - Move `walkDirectory()` (export it)
  - Move `globToRegex()` (export it)
  - Move `fsBasedSearch()` (export it)
  - Move `runRipgrep()` (export it)
  - Add required imports: `computeLineHash` from hashline-core, `readdir`/`stat` from fs/promises, `resolve` from path

- [ ] I2: Create `src/lib/file-utils.ts` — extract from `src/index.ts`:
  - Move `BINARY_EXTENSIONS` constant (export it)
  - Move `isBinaryFile()` (export it)
  - Move `hasBinaryExtension()` (export it)
  - Move `resolvePath()` (export it)
  - Move `getGitIgnoredSet()` (export it)
  - Move `buildDirectoryListing()` (export it)
  - Add required imports: `readdir`/`stat` from fs/promises, `resolve`/`isAbsolute` from path

- [ ] I3: Update `src/index.ts` — replace moved code with imports:
  - Add `import { BINARY_EXTENSIONS, isBinaryFile, hasBinaryExtension, resolvePath, getGitIgnoredSet, buildDirectoryListing } from "./lib/file-utils"`
  - Add `import { GrepMatch, GrepOptions, looksLikeFilePath, parseRipgrepOutput, formatGrepResults, formatFilesOnlyResults, formatCountResults, runRipgrep, fsBasedSearch } from "./lib/grep-search"`
  - Remove the moved function bodies and types (lines 29-67, 73-85, 209-279, 284-287, 291-560)
  - Keep `summarizeEdits()`, `buildEditTitle()`, `getBaseDir()`, and all tool handler code
  - Keep LSP-related code intact

- [ ] I4: Verify extraction — `bun test src/tests/ && tsc --noEmit && bun run build` — all must pass

### Phase 2: Create CLI Entry Points

- [ ] I5: Create `src/cli/hread.ts`:
  - `#!/usr/bin/env bun` shebang
  - Parse args: positional `<file-or-dir>`, `--offset/-o`, `--limit/-l`, `--diagnostics/-d`, `--help/-h`
  - Import: `formatHashLines` from hashline-core, `buildDirectoryListing`, `isBinaryFile`, `hasBinaryExtension` from file-utils
  - Logic mirrors `hashline_read` execute handler (lines 597-676 of index.ts):
    1. Resolve path (cwd-relative)
    2. If directory → `buildDirectoryListing()` → stdout
    3. If binary extension → stderr error, exit 2
    4. If binary file → stderr error, exit 2
    5. Read file, slice by offset/limit
    6. Truncate long lines (>2000 chars)
    7. `formatHashLines()` → stdout
    8. Show range header if file exceeds limit
  - Exit codes: 0 success, 2 error

- [ ] I6: Create `src/cli/hg.ts`:
  - `#!/usr/bin/env bun` shebang
  - Parse args: positional `<pattern> [path...]`, `-i`, `-l`, `-v`, `-c`, `-C <n>`, `-g <glob>`, `--help/-h`
  - Import: all exported functions from grep-search, `resolvePath` from file-utils
  - Logic mirrors `hashline_grep` execute handler (lines 879-994 of index.ts):
    1. Parse pattern (first positional arg)
    2. Remaining positional args = search paths (multi-path support)
    3. If no paths, use cwd
    4. Normalize `\|` → `|` in pattern
    5. Validate mutually exclusive modes (filesOnly + countOnly)
    6. For each path: `runRipgrep()` → parse → format, or `fsBasedSearch()` fallback
    7. Make paths relative to cwd
    8. Output: `formatGrepResults()` / `formatFilesOnlyResults()` / `formatCountResults()`
  - Exit codes: 0 match found, 1 no match, 2 error (matches grep convention)

- [ ] I7: Create `src/cli/hedit.ts`:
  - `#!/usr/bin/env bun` shebang
  - Parse args: positional `<file>`, operation flags, `--json`, `--diagnostics/-d`, `--help/-h`
  - Import: `applyHashlineEdits`, `EditOperation` from hashline-apply, `HashlineMismatchError` from hashline-errors, `summarizeEdits` from a new shared location (or inline — it's small)
  - Operation parsing:
    - `--replace <pos> [--end <end>] --lines <line1> [line2...]`
    - `--append [<pos>] --lines <line1> [line2...]`
    - `--prepend [<pos>] --lines <line1> [line2...]`
    - `--delete` — delete the file
    - `--move <new-path>` — rename/move the file
    - `--json '<json-array>'` — parse JSON array of EditOperation objects
  - Logic mirrors `hashline_edit` execute handler (lines 719-838 of index.ts):
    1. If `--delete`: `unlink(resolvedPath)` → stdout "Deleted file: ..."
    2. If edits: `applyHashlineEdits(resolvedPath, edits)` → stdout summary
    3. If `--move`: `rename()` → stdout "Moved file: ..."
    4. On `HashlineMismatchError`: stderr, exit 2
    5. On other error: stderr, exit 2
  - Exit codes: 0 success, 2 error

- [ ] I8: Also extract `summarizeEdits()` to `src/lib/file-utils.ts` (or a new `src/lib/edit-utils.ts`) so hedit can import it — OR inline it in hedit.ts since it's only ~30 lines. Decision: extract to `src/lib/file-utils.ts` for single source of truth.

### Phase 3: Build Configuration

- [ ] I9: Update `package.json`:
  - Add `"bin"` field:
    ```json
    "bin": {
      "hread": "./dist/cli/hread.js",
      "hg": "./dist/cli/hg.js",
      "hedit": "./dist/cli/hedit.js"
    }
    ```
  - Add `"build:cli"` script: `"bun build src/cli/hread.ts src/cli/hg.ts src/cli/hedit.ts --outdir dist/cli --format esm --target=bun"`
  - Update `"build:all"` to include CLI: `"rm -rf dist && bun run build && bun run build:cli && bun run build:types"`
  - Add `"dist/cli"` to `"files"` array (so npm publish includes CLI)

- [ ] I10: Verify full build — `bun run build:all && bun run typecheck && bun test src/tests/` — all must pass

### Phase 4: Manual Smoke Testing

- [ ] I11: Smoke test `hread`:
  - `bun src/cli/hread.ts package.json` → hashline output
  - `bun src/cli/hread.ts src/` → directory tree
  - `bun src/cli/hread.ts --offset 5 --limit 10 src/index.ts` → pagination

- [ ] I12: Smoke test `hg`:
  - `bun src/cli/hg.ts "import" src/index.ts` → matches
  - `bun src/cli/hg.ts -i "IMPORT" src/index.ts` → case-insensitive
  - `bun src/cli/hg.ts -l "import" -g "*.ts" src/` → files only
  - `bun src/cli/hg.ts -c "import" src/lib/` → count mode
  - `bun src/cli/hg.ts -v "import" src/index.ts` → invert match
  - `bun src/cli/hg.ts "import" src/lib/ src/tests/` → multi-path

- [ ] I13: Smoke test `hedit`:
  - Create test file, read hashes, then:
  - `bun src/cli/hedit.ts /tmp/test.txt --replace "1#XX" --lines "new content"` → replace
  - `bun src/cli/hedit.ts /tmp/test.txt --append "1#XX" --lines "added line"` → append
  - `bun src/cli/hedit.ts /tmp/newfile.txt --append --lines "created"` → new file
  - `bun src/cli/hedit.ts /tmp/test.txt --json '[{"op":"replace","pos":"1#XX","lines":["json edit"]}]'` → JSON mode
  - `bun src/cli/hedit.ts /tmp/test.txt --delete` → deletion
  - `bun src/cli/hedit.ts /tmp/test.txt --move /tmp/test-moved.txt` → rename

---

## Parallelization Plan

### Batch 1: Extract Shared Modules (sequential — same file)
- [ ] Coder A: Tasks I1, I2, I3, I4 → files: `src/lib/grep-search.ts` (new), `src/lib/file-utils.ts` (new), `src/index.ts` (refactor imports)

### Batch 2: Create CLI Entry Points (parallel after Batch 1)
- [ ] Coder B: Task I5 (hread) → files: `src/cli/hread.ts` (new)
- [ ] Coder C: Task I6 (hg) → files: `src/cli/hg.ts` (new)
- [ ] Coder D: Task I7, I8 (hedit + summarizeEdits extraction) → files: `src/cli/hedit.ts` (new), `src/lib/file-utils.ts` (append summarizeEdits)

### Batch 3: Tests + Build Config (parallel after Batch 2)
- [ ] Coder E: Tasks T1, T2 → files: `src/tests/grep-search.test.ts` (new), `src/tests/file-utils.test.ts` (new)
- [ ] Coder F: Tasks T4, T5, T6 → files: `src/tests/cli/hread.test.ts` (new), `src/tests/cli/hg.test.ts` (new), `src/tests/cli/hedit.test.ts` (new)
- [ ] Coder G: Tasks I9, I10 → files: `package.json`

### Batch 4: Verification (after Batch 3)
- [ ] Coder H: Tasks T3, I11, I12, I13 → run all tests + smoke tests (no file writes)

### Dependencies
- Batch 2 depends on Batch 1: CLI files import from the new shared modules
- Batch 3 depends on Batch 2: CLI tests import from CLI entry points
- Batch 4 depends on Batch 3: Full integration verification
- Within Batch 2: Coder D touches `src/lib/file-utils.ts` (append summarizeEdits) — must not overlap with Coder A's Batch 1 work on same file

### Risk Areas
- **src/index.ts refactor (I3)** is highest risk — removing ~400 lines of functions and replacing with imports. One wrong import path breaks everything. Mitigated by running full test suite immediately after (I4).
- **Coder D appending to file-utils.ts** after Coder A creates it — sequence dependency. If parallelized, Coder D must read fresh file content.
- **CLI arg parsing edge cases**: Patterns starting with `-` (like `-v` as a regex pattern) may conflict with flags. Use `--` separator convention: `hg -- "-pattern" path`.
- **ripgrep availability**: CLI must handle systems without ripgrep (same fallback as MCP tool). Already handled by `fsBasedSearch` fallback.

---

## Done Criteria

- [ ] All 102 existing tests pass (no regressions from extraction)
- [ ] New extraction tests pass (grep-search.test.ts, file-utils.test.ts)
- [ ] New CLI tests pass (hread, hg, hedit)
- [ ] `tsc --noEmit` clean (no type errors)
- [ ] `bun run build:all` succeeds (includes CLI build)
- [ ] `hread` CLI has 100% feature parity with `hashline_read` MCP tool
- [ ] `hg` CLI has 100% feature parity with `hashline_grep` MCP tool (all flags: -i, -l, -v, -c, -C, -g, multi-path)
- [ ] `hedit` CLI has 100% feature parity with `hashline_edit` MCP tool (replace, append, prepend, delete, move, JSON mode)
- [ ] All 3 CLI tools have `--help` output
- [ ] All 3 CLI tools use correct exit codes
- [ ] `package.json` has `bin` entries for all 3 tools
- [ ] Smoke tests pass for all 3 tools
