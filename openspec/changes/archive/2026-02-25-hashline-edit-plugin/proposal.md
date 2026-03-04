## Why

Current AI code editing tools (str_replace, apply_patch, diff-based approaches) require LLMs to reproduce exact text content when making edits. This leads to high failure rates due to whitespace sensitivity, formatting mismatches, and LLM hallucinations. HashLine Edit solves this by annotating each line with a 2-character content hash (e.g., `1#HH:function hello() {`), allowing LLMs to reference lines by hash tag instead of reproducing content. This dramatically improves edit success rates (reported 10x improvement for some models) while reducing token usage and eliminating ambiguity in multi-file edits.

## What Changes

This change introduces a new OpenCode plugin implementing the HashLine Edit technique:

- **Three new plugin tools** that override/replace built-in OpenCode tools:
  - `hashline_read`: Read files with LINE#HASH:content format, supports offset/limit for large files, smart directory listing with line counts
  - `hashline_edit`: Edit files using hashline references with operations: replace (single/range), append, prepend, delete file, move file. Includes hash verification, bottom-up application, duplicate detection, and prefix stripping
  - `hashline_grep`: Search files with hashline-annotated results and configurable context lines (default 2), enabling grep→edit workflows without additional read calls

- **No write tool**: File creation uses OpenCode's built-in write tool (not replaced)

- **System prompt injection**: Plugin hooks into agent initialization to provide HashLine Edit instructions to the LLM

- **Comprehensive test suite**: Unit tests for core functions, edit engine, and prefix stripping, plus E2E tests for complete workflows

## Capabilities

### New Capabilities
- `hashline-core`: Core hashing algorithm (xxHash32-based), line formatting (`LINE#HASH:content`), hash parsing and validation, seed-based variation support
- `hashline-edit`: Edit application engine implementing replace/append/prepend operations, bottom-up multi-edit application, duplicate edit detection, no-op filtering, prefix stripping for LLM output
- `hashline-tools`: Plugin tool definitions and schemas for hashline_read, hashline_edit, hashline_grep with proper parameter validation
- `hashline-prompt`: System prompt generation and injection via plugin hooks
- `hashline-tests`: Test suite covering unit tests (hash computation, edit engine, prefix stripping) and E2E scenarios

### Modified Capabilities
- None (this is a new plugin, no existing specs modified)

## Impact

**New files** (all under `.opencode/`):
- `.opencode/plugins/hashline-edit.ts` — Main plugin entry point with tool registrations
- `.opencode/lib/hashline-core.ts` — Hash computation and line formatting utilities
- `.opencode/lib/hashline-apply.ts` — Edit application engine
- `.opencode/lib/hashline-errors.ts` — Custom error types (HashlineMismatchError)
- `.opencode/lib/hashline-strip.ts` — LLM output prefix stripping
- `.opencode/lib/hashline-prompt.ts` — System prompt text and injection
- `.opencode/tests/hashline-core.test.ts` — Unit tests for core functions
- `.opencode/tests/hashline-apply.test.ts` — Unit tests for edit engine
- `.opencode/tests/hashline-strip.test.ts` — Unit tests for prefix stripping
- `.opencode/tests/e2e.test.ts` — End-to-end integration tests

**Dependencies**:
- Runtime: Bun.hash.xxHash32 (built into Bun, no additional package needed)
- Plugin SDK: @opencode-ai/plugin (already in .opencode/package.json)

**Configuration**:
- No modification to `opencode.jsonc` required
- Tools registered via plugin system with `tool.schema` definitions
- Built-in read/edit tools will be overridden by permission configuration (deny built-in, allow hashline versions)

**Testing**:
- All tests run with `bun test` in the .opencode directory
