## Context

### Background

The HashLine Edit technique addresses a fundamental limitation in AI-assisted code editing: LLMs struggle with precise text reproduction when making edits. Traditional approaches (str_replace, diff-based patching) require the model to:
1. Reproduce exact content including whitespace
2. Handle large multi-file edits with positional ambiguity
3. Deal with hallucinated or slightly modified content

This leads to high failure rates, increased token usage, and frustrating retry loops.

### The HashLine Edit Solution

HashLine Edit tags each line with a 2-character content hash (e.g., `23#XY:function hello() {`). The LLM can then reference lines by their hash tag (`23#XY`) instead of reproducing content. This provides:
- **Unambiguous line identification** — hash tags are unique within a file
- **Whitespace tolerance** — the hash captures normalized content
- **Reduced token usage** — models don't need to echo large code blocks
- **Atomic validation** — all hashes verified before any mutation

### Current State

This project is a fresh OpenCode plugin implementation. No existing HashLine code exists in the codebase. We have:
- OpenCode project structure with `.opencode/` directory
- Access to Bun runtime (includes xxHash32)
- Reference implementation at `oh-my-pi` repository
- Design decisions already confirmed with the user

### Constraints

- **Runtime**: Bun only (relies on `Bun.hash.xxHash32`)
- **Plugin System**: Must use `@opencode-ai/plugin` SDK
- **Tool Override**: Cannot directly replace built-in tools; use distinct names + permission configuration
- **No opencode.jsonc modification**: Plugin must work without modifying user config

## Goals / Non-Goals

**Goals:**
- Implement robust HashLine hashing algorithm (xxHash32-based with custom nibble alphabet)
- Create three plugin tools: `hashline_read`, `hashline_edit`, `hashline_grep`
- Support all core edit operations: replace (single/range), append, prepend
- Provide atomic multi-edit application with validation-before-mutation
- Include intelligent LLM output handling (prefix stripping, error recovery)
- Add comprehensive error reporting with context for hash mismatches
- Support file deletion and move operations
- Enable grep→edit workflows without intermediate read calls
- Provide clear system prompt guidance for LLM usage
- Achieve >95% test coverage for core modules

**Non-Goals:**
- Replace OpenCode's built-in `write` tool (use built-in for file creation)
- Support non-Bun runtimes (Node.js, Deno)
- Real-time file watching or synchronization
- IDE/editor integrations (VSCode extension, etc.)
- Collaborative/multi-user editing features
- Version control integration (git operations)
- Binary file editing (explicitly blocked with error)
- Streaming/tool-call-chunking (OpenCode returns string results)

## Decisions

### 1. Plugin Architecture Over Standalone Tools

**Decision:** Implement as `.opencode/plugins/hashline-edit.ts` using the plugin SDK, not as standalone tools in `.opencode/tools/`.

**Rationale:**
- Plugin SDK provides hooks for system prompt injection
- Better integration with OpenCode's tool lifecycle
- Cleaner tool registration via `tool.schema`
- Can access plugin context and configuration

**Alternative Considered:**
- Standalone tools (`.opencode/tools/hashline-read.ts`, etc.) — Rejected because no system prompt hook access, each tool would need duplicate setup code

### 2. Distinct Tool Names (Not Built-in Override)

**Decision:** Name tools `hashline_read`, `hashline_edit`, `hashline_grep` instead of `read`, `edit`, `grep`.

**Rationale:**
- Avoids collision/confusion with built-in tools
- User configures permission deny for built-ins separately
- Clearer in logs and debugging which tool is called
- Follows OpenCode plugin naming conventions

**Alternative Considered:**
- Same names as built-ins — Rejected due to potential confusion and collision with permission system

### 3. xxHash32 with Custom Nibble Alphabet

**Decision:** Use `Bun.hash.xxHash32(line, seed)` with nibble alphabet `ZPMQVRWSNKTXJBYH` to produce 2-char tags.

**Rationale:**
- xxHash32 is extremely fast (~5GB/s) — no caching needed
- 256 possible tags (2 chars × 16 nibbles) provides sufficient entropy
- Custom alphabet avoids ambiguous characters (0/O, 1/l/I)
- Seed variation handles symbol-only lines

**Algorithm Details:**
```typescript
const NIBBLE_STR = "ZPMQVRWSNKTXJBYH";  // Custom alphabet
const DICT = Array.from({ length: 256 }, (_, i) => {
  const h = i >>> 4;
  const l = i & 0x0f;
  return `${NIBBLE_STR[h]}${NIBBLE_STR[l]}`;
});
// Hash = DICT[xxHash32(normalized_line, seed) & 0xFF]
```

**Normalization:**
- Strip all whitespace: `/\s+/g` → `''`
- Strip trailing `\r` (CRLF handling)
- Result is used as hash input

**Seed Variation:**
- For symbol-only lines (no `[\p{L}\p{N}]`), use line index as seed
- Prevents hash collisions on lines like `}`, `//`, `***`

**Alternative Considered:**
- SHA-256 or MD5 — Rejected (slower, unnecessary security for content addressing)
- MurmurHash3 — Rejected (xxHash32 is faster and built into Bun)
- Hash caching — Rejected (xxHash32 is fast enough, caching adds invalidation complexity)

### 4. Atomic Multi-Edit with Bottom-Up Application

**Decision:** Collect all edits, validate all hashes first, then apply edits sorted by position (highest line first).

**Rationale:**
- Prevents partial file corruption from failed mid-sequence edits
- Bottom-up order preserves line indices during application
- No need for complex index remapping during edits

**Process:**
1. Parse all edit operations from the `edits` array
2. Validate all `pos`/`end` references (hash + line number match)
3. If any validation fails, throw `HashlineMismatchError` with full context
4. Sort validated edits by line position (descending)
5. Apply each edit to file content
6. Write result atomically

**Alternative Considered:**
- Top-down with index remapping — Rejected (more complex, error-prone)
- Immediate application with rollback — Rejected (unnecessary complexity)

### 5. No-Op Detection and Duplicate Filtering

**Decision:** Detect and warn on edits that produce no change, filter duplicate identical edits.

**Rationale:**
- Prevents wasted LLM tokens on redundant operations
- Helps identify model confusion or looping
- Cleaner edit history

**Implementation:**
- Compare old content vs new content after edit application
- If identical, log warning and skip (or include in response)
- Use Set to deduplicate edits with same pos/end/lines

### 6. Prefix Stripping from LLM Output

**Decision:** Automatically strip accidental `LINE#HASH:` prefixes from `lines` parameter when >50% of lines have them.

**Rationale:**
- LLMs often echo hashline format when instructed to "provide new content"
- Manual stripping is error-prone and frustrating
- 50% threshold catches obvious accidents without affecting intentional content

**Example:**
```typescript
// LLM might return:
lines: ["23#XY:function hello() {", "24#YZ:  console.log('hi');"]

// After stripping (>50% have prefix):
lines: ["function hello() {", "  console.log('hi');"]
```

### 7. Error Reporting with Context Lines

**Decision:** On hash mismatch, show 2 context lines above/below the changed line, with `>>>` markers on mismatching lines.

**Rationale:**
- Helps LLM understand what changed and why hash failed
- Provides correct LINE#ID references for retry
- Similar to git diff format — familiar to developers

**Error Format:**
```
Hash mismatch at line 23 (expected 23#XY, got 23#AB):
  21#WX: function outer() {
  22#YZ:   const x = 1;
>>>23#AB:   const y = 2;  // <-- line changed
  24#CD:   return x + y;
  25#EF: }

To retry, use:
  pos: "23#AB"
```

### 8. Binary File Detection

**Decision:** Check for null bytes in first 8KB of file; if found, reject with error message.

**Rationale:**
- Simple, fast heuristic for binary detection
- Prevents hashline corruption of binary files
- Consistent with common CLI tools (git, ripgrep)

### 9. Directory Listing Enhancement

**Decision:** `hashline_read` on a directory returns tree listing with line counts per file.

**Rationale:**
- Helps LLM understand codebase structure
- Line counts indicate file size for read planning
- More useful than simple file list

**Format:**
```
src/
  components/
    Button.tsx ............... 45 lines
    Modal.tsx ................ 128 lines
  utils/
    helpers.ts ............... 23 lines
```

### 10. Grep with Hashline Context

**Decision:** `hashline_grep` returns matches with configurable context lines, all hashline-annotated.

**Rationale:**
- Enables grep→edit workflows without re-reading files
- Context helps LLM understand match surroundings
- Match lines marked with `>` prefix for visibility

**Format:**
```
> 23#XY:function hello() {
  24#YZ:  console.log('hi');
  25#AB:}
```

### 11. System Prompt Injection Strategy

**Decision:** Primary injection via plugin hook (if available), fallback to tool descriptions.

**Rationale:**
- Plugin hook provides clean separation of concerns
- Tool descriptions ensure guidance is always present
- Dual approach maximizes compatibility

**Prompt Content:**
- HashLine Edit workflow explanation
- Operation syntax (replace, append, prepend, delete, move)
- Rules (hashes are line-specific, bottom-up application)
- Recovery guidance (context lines, remapping)

### 12. Prompt Rendering — Runtime TS Template (Option C)

**Decision:** Use runtime rendering via TypeScript template literals with `computeLineHash()` calls.

**Rationale:**
- Zero external dependencies (no Handlebars)
- Hashes in prompt examples always match the actual algorithm output
- Prompt is a function, not a static string — adaptable to implementation changes
- Clean separation: content logic in template, hash computation in helpers

**Alternatives Considered:**
- **Option A (Handlebars full reproduction):** Rejected — adds external dependency
- **Option B (Pre-computed hardcoded hashes):** Rejected — breaks when hash algorithm changes, examples become stale

**Based on oh-my-pi's Original:**
- Source: `oh-my-pi/packages/coding-agent/src/prompts/hashline.md`
- Changes made (6 total):
  1. `read` → `hashline_read` (first sentence)
  2. `read` → `hashline_read` or `hashline_grep` (workflow #1)
  3. **Added:** grep-to-edit shortcut as workflow item #2
  4. `edit` → `hashline_edit` (workflow items #3-4)
  5. `last read` → `last hashline_read or hashline_grep` (atomicity note)
  6. `re-read the file` → `re-read the file with hashline_read` (recovery section)

**Implementation:**
```typescript
function hlinefull(n: number, content: string): string {
  const hash = computeLineHash(content, n);
  return `${n}#${hash}:${content}`;
}

function hlineref(n: number, content: string): string {
  const hash = computeLineHash(content, n);
  return `"${n}#${hash}"`;
}

export function renderHashlineEditPrompt(): string {
  return `## HashLine Edit Workflow
...
1. Call ${hlineref(23, "const timeout = 5000;")}
...
${hlinefull(23, "const timeout = 5000;")}
...`;
}
```

**Structure Preserved from Original:**
- `<workflow>` — 4 steps including grep-to-edit shortcut
- `<operations>` — op, pos, end, lines, delete, move descriptions
- `<rules>` — minimize scope, anchor on boundaries, etc.
- `<recovery>` — tag mismatch handling, no-op detection
- **8 Examples** — rendered with runtime-computed hashes via helpers
- `<critical>` — workflow notes and warnings

## Risks / Trade-offs

### [Risk] Bun.hash.xxHash32 API Compatibility
**Impact:** High — core dependency
**Likelihood:** Low — xxHash32 is stable in Bun
**Mitigation:** 
- Test xxHash32 immediately in development
- Document minimum Bun version
- Provide fallback if API changes (though unlikely)

### [Risk] System Prompt Hook Unavailability
**Impact:** Medium — reduces guidance quality
**Likelihood:** Low — OpenCode plugin SDK supports hooks
**Mitigation:**
- Include full guidance in tool descriptions as fallback
- Document alternative injection methods

### [Risk] Large File Performance (>100K lines)
**Impact:** Medium — slower reads, high memory usage
**Likelihood:** Medium — some files may be very large
**Mitigation:**
- offset/limit parameters for pagination
- Consider streaming for reads (if OpenCode supports)
- Document recommended file size limits

### [Risk] Hash Collisions on Symbol-Only Lines
**Impact:** Low — rare edge case
**Likelihood:** Low — seed variation handles most cases
**Mitigation:**
- Seed variation with line index for symbol-only lines
- Document collision handling (validation catches mismatches)

### [Risk] CRLF Line Ending Corruption
**Impact:** Medium — Windows compatibility
**Likelihood:** Medium — many repos use CRLF
**Mitigation:**
- Detect original line ending on read
- Preserve line endings in edit operations
- Normalize only for hashing, not storage

### [Risk] ripgrep Dependency Not Available
**Impact:** Low — affects hashline_grep only
**Likelihood:** Low — ripgrep is common
**Mitigation:**
- Implement fs-based fallback search
- Document ripgrep as optional dependency
- Graceful degradation (slower but functional)

### [Risk] LLM Misunderstands Hash Semantics
**Impact:** Medium — incorrect edits, hash mismatches
**Likelihood:** Medium — new pattern for models
**Mitigation:**
- Comprehensive system prompt with examples
- Clear error messages with retry guidance
- Include common mistakes in documentation

### [Trade-off] 2-Character Hash vs Longer
**Decision:** 2 characters (256 possibilities)
**Trade-off:** Shorter tags (good) vs higher collision chance (acceptable with seed variation)
**Rationale:** 2 chars is the oh-my-pi standard and provides sufficient entropy with proper seeding

### [Trade-off] No Built-in Write Tool Replacement
**Decision:** Use OpenCode's built-in write tool for file creation
**Trade-off:** Less unified API (minor) vs simpler implementation (major)
**Rationale:** File creation via write is rare; hashline focus is editing

## Migration Plan

**Installation:**
1. Copy plugin files to `.opencode/plugins/` and `.opencode/lib/`
2. Add permissions config to deny built-in read/edit (user handles this)
3. Restart OpenCode agent

**Rollback:**
1. Remove `.opencode/plugins/hashline-edit.ts`
2. Remove `.opencode/lib/hashline-*` files
3. Restore built-in tool permissions
4. Restart OpenCode agent

**No migration needed for:**
- Existing files (hashes computed on-the-fly)
- User configuration (no opencode.jsonc changes)

## Open Questions

1. **Plugin Hook Availability:** Need to verify exact hook names and capabilities in current OpenCode SDK version
2. **Tool Permission Override:** Confirm exact permission syntax for denying built-in tools
3. **Test Environment:** Set up Bun test runner in `.opencode/` directory
4. **Performance Baseline:** Establish benchmarks for large files (10K, 100K, 1M lines)

These will be resolved during implementation phase.
