/**
 * hashline-prompt.ts — System prompt rendering for HashLine Edit plugin.
 *
 * Generates the LLM system prompt with runtime-computed hashes so that
 * every example hash exactly matches the actual hashing algorithm output.
 *
 * Based on oh-my-pi's hashline.md with 6 modifications:
 *  1. `read` → `hashline_read` (first sentence)
 *  2. `read` → `hashline_read` or `hashline_grep` (workflow #1)
 *  3. Added: grep-to-edit shortcut as workflow item #2
 *  4. `edit` → `hashline_edit` (workflow items #3-4)
 *  5. `last read` → `last hashline_read or hashline_grep` (atomicity note)
 *  6. `re-read the file` → `re-read the file with hashline_read` (recovery)
 */

import { computeLineHash } from "./hashline-core";

// ─── Example File Content ────────────────────────────────────────────────────

const EXAMPLE = [
  "import { useState } from 'react';",       // line 1
  "",                                          // line 2
  "export function Counter() {",               // line 3
  "  const [count, setCount] = useState(0);",  // line 4
  "  const timeout = 5000;",                   // line 5
  "",                                          // line 6
  "  return (",                                // line 7
  "    <div>",                                 // line 8
  "      <p>Count: {count}</p>",               // line 9
  "      <button onClick={() => setCount(c => c + 1)}>", // line 10
  "        Increment",                         // line 11
  "      </button>",                           // line 12
  "    </div>",                                // line 13
  "  );",                                      // line 14
  "}",                                         // line 15
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Render "N#HASH:content" for example display in the prompt.
 *
 * @param n 1-indexed line number.
 * @param content Raw line content.
 */
export function hlinefull(n: number, content: string): string {
  const hash = computeLineHash(content, n);
  return `${n}#${hash}:${content}`;
}

/**
 * Render '"N#HASH"' for anchor references in the prompt.
 *
 * @param n 1-indexed line number.
 * @param content Raw line content.
 */
export function hlineref(n: number, content: string): string {
  const hash = computeLineHash(content, n);
  return `"${n}#${hash}"`;
}

// ─── Tool Descriptions ───────────────────────────────────────────────────────

export const TOOL_DESCRIPTIONS = {
  hashline_read:
    "Read a file or directory with hashline annotations. Each line is formatted as LINE#HASH:content where HASH is a 2-character content hash. Use offset/limit for large files. For directories, returns a tree listing with line counts. Set diagnostics=true to include LSP diagnostics (errors/warnings) for the file.",
  hashline_edit:
    "Edit a file using hashline references. Operations: replace (single/range), append (after line), prepend (before line). Use \"N#ID\" anchors from hashline_read/hashline_grep output. Supports file creation (anchorless append), delete, and move. All hashes verified before mutation.",
  hashline_grep:
    "Search files with hashline-annotated results. Returns matching lines with LINE#HASH:content format. Match lines prefixed with >. Context lines shown around matches. Results can be used directly for hashline_edit anchors.",
};

// ─── Main Prompt ─────────────────────────────────────────────────────────────

/**
 * Render the complete HashLine Edit system prompt.
 *
 * All hash examples are computed at runtime via computeLineHash(),
 * so they always match the actual algorithm output.
 */
export function renderHashlineEditPrompt(lspDiagnosticsEnabled = false): string {
  // Pre-compute example hashes referenced multiple times
  const e = EXAMPLE;

  // Build the complete hashline-annotated file view
  const exampleFileView = e
    .map((line, i) => hlinefull(i + 1, line))
    .join("\n");

  return `<hashline_edit>
You use \`hashline_read\` and \`hashline_grep\` to view files. Every line is tagged \`LINE#HASH:content\`, where HASH is a 2-char content hash. You reference lines by their tag to make precise edits with \`hashline_edit\`.

<workflow>
1. **Read first.** Always call \`hashline_read\` or \`hashline_grep\` to obtain LINE#HASH tags before editing.
2. **Grep-to-edit shortcut.** Results from \`hashline_grep\` include LINE#HASH tags that can be used directly as \`hashline_edit\` anchors — no intermediate \`hashline_read\` needed.
3. **Batch edits.** Collect all edits to a single file into one \`hashline_edit\` call.
4. **Re-read after edits.** Before making subsequent edits to the same file, call \`hashline_read\` to get fresh hashes.
</workflow>

<operations>
## Format

Each line from \`hashline_read\` looks like:
\`\`\`
${hlinefull(1, e[0])}
${hlinefull(2, e[1])}
${hlinefull(3, e[2])}
${hlinefull(4, e[3])}
${hlinefull(5, e[4])}
\`\`\`

The tag (e.g. ${hlineref(1, e[0])}) uniquely identifies a line by its content hash. Use it as an anchor.

## Anchor Format

Anchors use the format \`"N#ID"\` where N is the line number and ID is the 2-character hash.
Example: ${hlineref(5, e[4])} references line 5 with content \`${e[4]}\`.

## Edit Operations

Each edit in the \`edits\` array has:

- **op**: \`"replace"\` | \`"append"\` | \`"prepend"\`
- **pos**: \`"N#ID"\` — anchor line reference (required for replace/append/prepend)
- **end**: \`"N#ID"\` — end of range (optional, for multi-line replace)
- **lines**: new content — see below

**\`op: "replace"\`** — Replace a single line or range of lines.
  - Single line: \`{ op: "replace", pos: ${hlineref(5, e[4])}, lines: ["  const timeout = 3000;"] }\`
  - Range: \`{ op: "replace", pos: ${hlineref(4, e[3])}, end: ${hlineref(5, e[4])}, lines: [...] }\`

**\`op: "append"\`** — Insert lines after the anchor line.
  - \`{ op: "append", pos: ${hlineref(5, e[4])}, lines: ["  const delay = 1000;"] }\`
  - Without pos: appends at end of file (EOF), or **creates a new file** if the file doesn't exist.

**\`op: "prepend"\`** — Insert lines before the anchor line.
  - \`{ op: "prepend", pos: ${hlineref(3, e[2])}, lines: ["// Counter component"] }\`
  - Without pos: prepends at beginning of file (BOF).

## Lines Parameter

- **\`string[]\`**: Array of new lines — \`["line1", "line2"]\`
- **\`null\` or \`[]\`**: Delete the target line(s)
- **\`[""]\`**: Clear the line (make it empty, but keep the line)
- **\`"single"\`**: Shorthand for \`["single"]\`

## File Operations

- **Create new file**: Use anchorless append (no \`pos\`) on a non-existent path — the file will be created automatically.
- **Delete file**: \`{ path: "src/old.ts", delete: true }\`
- **Move/rename file**: \`{ path: "src/old.ts", move: "src/new.ts" }\`
</operations>

<rules>
- Hashes are **content-specific**: same content at the same line number always produces the same hash. They are stable as long as the line is unchanged.
- **Minimize edit scope** — only include lines that actually change.
- **Anchor on structural boundaries** — prefer function signatures, class declarations, import lines as anchors over generic code.
- **Edits apply bottom-up** — when multiple edits target the same file, they are sorted highest-line-first so earlier tags remain valid.
- **Use hashes from most recent \`hashline_read\` or \`hashline_grep\` only** — never reuse stale tags from earlier calls.
</rules>

<recovery>
- **Tag mismatch**: If you get a hash mismatch error, the file has changed since your last read. Re-read the file with \`hashline_read\`, obtain new hashes, and retry.
- **No-op**: If an edit produces no change, a warning is returned. Review your edit to ensure it's necessary.
- **Operations near changed content**: When edits are near recently-modified lines, simplify — use a broader replace range instead of multiple precise operations.
</recovery>

## Examples

Given this file (\`src/Counter.tsx\`):
\`\`\`
${exampleFileView}
\`\`\`

### 1. Single-line delete
Delete line 5 (\`${e[4]}\`):
\`\`\`json
{
  "path": "src/Counter.tsx",
  "edits": [{ "op": "replace", "pos": ${hlineref(5, e[4])}, "lines": null }]
}
\`\`\`

### 2. Range delete
Delete lines 8–12 (the \`<div>\` through \`</button>\`):
\`\`\`json
{
  "path": "src/Counter.tsx",
  "edits": [{ "op": "replace", "pos": ${hlineref(8, e[7])}, "end": ${hlineref(12, e[11])}, "lines": null }]
}
\`\`\`

### 3. Clear line
Clear line 2 (make it empty but keep it):
\`\`\`json
{
  "path": "src/Counter.tsx",
  "edits": [{ "op": "replace", "pos": ${hlineref(2, e[1])}, "lines": [""] }]
}
\`\`\`

### 4. Prepend
Insert a comment before line 3 (\`export function Counter()\`):
\`\`\`json
{
  "path": "src/Counter.tsx",
  "edits": [{ "op": "prepend", "pos": ${hlineref(3, e[2])}, "lines": ["/** A simple counter component. */"] }]
}
\`\`\`

### 5. Append
Insert a new line after line 5 (\`const timeout = 5000;\`):
\`\`\`json
{
  "path": "src/Counter.tsx",
  "edits": [{ "op": "append", "pos": ${hlineref(5, e[4])}, "lines": ["  const delay = 1000;"] }]
}
\`\`\`

### 6. Block replace
Replace lines 9–11 with new JSX:
\`\`\`json
{
  "path": "src/Counter.tsx",
  "edits": [{
    "op": "replace",
    "pos": ${hlineref(9, e[8])},
    "end": ${hlineref(11, e[10])},
    "lines": [
      "      <p>Current count: {count}</p>",
      "      <button onClick={() => setCount(c => c + 1)}>+1</button>",
      "      <button onClick={() => setCount(0)}>Reset</button>"
    ]
  }]
}
\`\`\`

### 7. File delete
Delete the entire file:
\`\`\`json
{
  "path": "src/Counter.tsx",
  "delete": true
}
\`\`\`

### 8. File move
Rename/move the file:
\`\`\`json
{
  "path": "src/Counter.tsx",
  "move": "src/components/Counter.tsx"
}
\`\`\`

<critical>
- **Always** call \`hashline_read\` or \`hashline_grep\` before editing a file — never guess hashes.
- **Batch** all edits to one file into a single \`hashline_edit\` call.
- **Re-read** with \`hashline_read\` before making subsequent edits to the same file.
</critical>
${lspDiagnosticsEnabled ? `

<lsp_diagnostics>
When \`hashline_edit\` modifies a file, LSP diagnostics (errors, warnings) are automatically collected and appended to the response. Review any reported errors and fix them in subsequent edits.
</lsp_diagnostics>` : ""}
</hashline_edit>`;
}
