# AGENTS.md

Instructions for AI coding agents working with this codebase.

<!-- opensrc:start -->

## Source Code Reference

Source code for dependencies is available in `opensrc/` for deeper understanding of implementation details.

See `opensrc/sources.json` for the list of available packages and their versions.

Use this source code when you need to understand how a package works internally, not just its types/interface.

### Fetching Additional Source Code

To fetch source code for a package or repository you need to understand, run:

```bash
npx opensrc <package>           # npm package (e.g., npx opensrc zod)
npx opensrc pypi:<package>      # Python package (e.g., npx opensrc pypi:requests)
npx opensrc crates:<package>    # Rust crate (e.g., npx opensrc crates:serde)
npx opensrc <owner>/<repo>      # GitHub repo (e.g., npx opensrc vercel/ai)
```

<!-- opensrc:end -->

<hashline_read>
You use `hashline_read` to view files. Every line is tagged `LINE#HASH:content`, where HASH is a 2-char content hash. You reference lines by their tag to make precise edits with `hashline_edit`.

> Parameters
- `filePath` (required string): path to file or directory
- `offset` (optional number, 1-indexed): starting line number
- `limit` (optional number, default 2000): maximum lines to return
- `diagnostics` (optional boolean, default false): include LSP diagnostics in output

> Diagnostics
When `diagnostics=true` and LSP diagnostics feature is enabled, LSP diagnostics (errors/warnings) are appended to the output after the normal hashline-annotated content.
</hashline_read>

<hashline_edit>
You use `hashline_read` and `hashline_grep` to view files. Every line is tagged `LINE#HASH:content`, where HASH is a 2-char content hash. You reference lines by their tag to make precise edits with `hashline_edit`.

> Parameters
- `path` (required string): file path
- `edits` (required array): edit operations — see operations below
- `delete` (optional boolean): delete file if true
- `move` (optional string): new path to move file to
- `dryRun` (optional boolean, default false): When true, computes edits in-memory and returns a unified diff preview without writing any changes to disk. Hash validation still runs. Useful for previewing destructive edits before applying them.

> Operations
## Format

Each line from `hashline_read` looks like:
```
1#SW:import { useState } from 'react';
2#KM:
3#MM:export function Counter() {
4#PN:  const [count, setCount] = useState(0);
5#NS:  const timeout = 5000;
```

The tag (e.g. "1#SW") uniquely identifies a line by its content hash. Use it as an anchor.

## Anchor Format

Anchors use the format `"N#ID"` where N is the line number and ID is the 2-character hash.
Example: "5#NS" references line 5 with content `  const timeout = 5000;`.

## Edit Operations

Each edit in the `edits` array has:

- **op**: `"replace"` | `"append"` | `"prepend"`
- **pos**: `"N#ID"` — anchor line reference (required for replace/append/prepend)
- **end**: `"N#ID"` — end of range (optional, for multi-line replace)
- **lines**: new content — see below

**`op: "replace"`** — Replace a single line or range of lines.
  - Single line: `{ op: "replace", pos: "5#NS", lines: ["  const timeout = 3000;"] }`
  - Range: `{ op: "replace", pos: "4#PN", end: "5#NS", lines: [...] }`

**`op: "append"`** — Insert lines after the anchor line.
  - `{ op: "append", pos: "5#NS", lines: ["  const delay = 1000;"] }`
  - Without pos: appends at end of file (EOF), or **creates a new file** if the file doesn't exist.

**`op: "prepend"`** — Insert lines before the anchor line.
  - `{ op: "prepend", pos: "3#MM", lines: ["// Counter component"] }`
  - Without pos: prepends at beginning of file (BOF).

## Lines Parameter

- **`string[]`**: Array of new lines — `["line1", "line2"]`
- **`null` or `[]`**: Delete the target line(s)
- **`[ "" ]`**: Clear the line (make it empty, but keep the line)
- **`"single"`**: Shorthand for `["single"]`

## File Operations

- **Create new file**: Use anchorless append (no `pos`) on a non-existent path — the file will be created automatically.
- **Delete file**: `{ path: "src/old.ts", delete: true }`
- **Move/rename file**: `{ path: "src/old.ts", move: "src/new.ts" }`

<rules>
- Hashes are **content-specific**: same content at the same line number always produces the same hash. They are stable as long as the line is unchanged.
- **Minimize edit scope** — only include lines that actually change.
- **Anchor on structural boundaries** — prefer function signatures, class declarations, import lines as anchors over generic code.
- **Edits apply bottom-up** — when multiple edits target the same file, they are sorted highest-line-first so earlier tags remain valid.
- **Use hashes from most recent `hashline_read` or `hashline_grep` only** — never reuse stale tags from earlier calls.
</rules>

<recovery>
- **Tag mismatch**: If you get a hash mismatch error, the file has changed since your last read. Re-read the file with `hashline_read`, obtain new hashes, and retry.
- **No-op**: If an edit produces no change, a warning is returned. Review your edit to ensure it's necessary.
- **Operations near changed content**: When edits are near recently-modified lines, simplify — use a broader replace range instead of multiple precise operations.
</recovery>

## Examples

Given this file (`src/Counter.tsx`):
```
1#SW:import { useState } from 'react';
2#KM:
3#MM:export function Counter() {
4#PN:  const [count, setCount] = useState(0);
5#NS:  const timeout = 5000;
6#SY:
7#SZ:  return (
8#HY:    <div>
9#TQ:      <p>Count: {count}</p>
10#PB:      <button onClick={() => setCount(c => c + 1)}>
11#JZ:        Increment
12#JM:      </button>
13#YH:    </div>
14#TP:  );
15#SR:}
```

### 1. Single-line delete
Delete line 5 (`  const timeout = 5000;`):
```json
{
  "path": "src/Counter.tsx",
  "edits": [{ "op": "replace", "pos": "5#NS", "lines": null }]
}
```

### 2. Range delete
Delete lines 8–12 (the `<div>` through `</button>`):
```json
{
  "path": "src/Counter.tsx",
  "edits": [{ "op": "replace", "pos": "8#HY", "end": "12#JM", "lines": null }]
}
```

### 3. Clear line
Clear line 2 (make it empty but keep it):
```json
{
  "path": "src/Counter.tsx",
  "edits": [{ "op": "replace", "pos": "2#KM", "lines": [""] }]
}
```

### 4. Prepend
Insert a comment before line 3 (`export function Counter()`):
```json
{
  "path": "src/Counter.tsx",
  "edits": [{ "op": "prepend", "pos": "3#MM", "lines": ["/** A simple counter component. */"] }]
}
```

### 5. Append
Insert a new line after line 5 (`const timeout = 5000;`):
```json
{
  "path": "src/Counter.tsx",
  "edits": [{ "op": "append", "pos": "5#NS", "lines": ["  const delay = 1000;"] }]
}
```

### 6. Block replace
Replace lines 9–11 with new JSX:
```json
{
  "path": "src/Counter.tsx",
  "edits": [{
    "op": "replace",
    "pos": "9#TQ",
    "end": "11#JZ",
    "lines": [
      "      <p>Current count: {count}</p>",
      "      <button onClick={() => setCount(c => c + 1)}>+1</button>",
      "      <button onClick={() => setCount(0)}>Reset</button>"
    ]
  }]
}
```

### 7. File delete
Delete the entire file:
```json
{
  "path": "src/Counter.tsx",
  "delete": true
}
```

### 8. File move
Rename/move the file:
```json
{
  "path": "src/Counter.tsx",
  "move": "src/components/Counter.tsx"
}
```

<critical>
- **Always** call `hashline_read` or `hashline_grep` before editing a file — never guess hashes.
- **Batch** all edits to one file into a single `hashline_edit` call.
- **Re-read** with `hashline_read` before making subsequent edits to the same file.
</critical>

<lsp_diagnostics>
When `hashline_edit` modifies a file, LSP diagnostics (errors, warnings) are automatically collected and appended to the response. Review any reported errors and fix them in subsequent edits.
</lsp_diagnostics>
</hashline_edit>
