# Hashline Tools: Bug Report & Feature Parity Specification

**Document Date:** April 5, 2026  
**Tool Version:** Current MCP implementation  
**Status:** 🔴 Critical issues identified

---

## Executive Summary

Battle testing of `hashline_grep`, `hashline_edit`, and `hashline_read` tools has uncovered **1 critical bug** (silently failing `include` parameter), **1 known gotcha** (accidental duplication), and **5 feature gaps** when compared to standard GNU grep functionality.

**Good news:** The tools are fundamentally sound and work well for their core use cases. The issues are edge cases and missing convenience features, not fundamental design problems.

**Recommendation:** Fix the critical `include` parameter bug immediately. Implement case-insensitive search as a P1 feature. The remaining gaps can be addressed iteratively.

---

## Tool: hashline_grep

### BUG 1 (CRITICAL): `include` Parameter Silently Fails Without `path` Parameter

**Severity:** 🔴 CRITICAL  
**Type:** Silent failure / parameter interaction bug  
**Impact:** Agents cannot search specific files by path; they fall back to bash grep

#### Problem Description

When the `include` parameter is used alone (without `path`) with a full file path string, the function silently returns 0 results, even if the pattern definitely exists in that file.

Agents interpret this as "pattern not found" and retry with bash grep, defeating the purpose of the hashline tools. The error is silent—no error message or warning indicates what went wrong.

#### Repro Steps

**❌ FAILS:**

```bash
# Search for "import" in a specific file using include parameter
hashline_grep(
  pattern="import",
  include="apps/web/src/lib/sandbox/patch-engine.ts"
)
# Expected: 9 matches
# Actual: 0 results (silent failure)
```

**✅ WORKS:**

```bash
# Same search using path parameter
hashline_grep(
  pattern="import",
  path="apps/web/src/lib/sandbox/patch-engine.ts"
)
# Result: 9 matches ✅
```

**✅ WORKS:**

```bash
# Using include as glob filter with path as directory
hashline_grep(
  pattern="import",
  include="*.ts",
  path="apps/web/src/lib/sandbox"
)
# Result: Multiple matches from all .ts files in directory ✅
```

#### Root Cause Analysis

The `include` parameter is documented and intended as a **glob filter** (e.g., `"*.ts"`, `"src/**/*.js"`), not a file path. When a full file path is passed (e.g., `"apps/web/src/lib/sandbox/patch-engine.ts"`), the glob matching fails silently instead of either:

1. Treating it as a literal file path, or
2. Returning an error explaining the parameter usage

#### Expected Behavior

**Option A (Recommended):** `include` should accept both glob patterns AND full file paths:

```bash
hashline_grep(pattern="import", include="src/**/*.ts")  # glob ✅
hashline_grep(pattern="import", include="apps/web/src/lib/sandbox/patch-engine.ts")  # full path ✅
```

**Option B (Fallback):** Return a clear error message:

```
Error: `include` parameter expects a glob pattern (e.g., "*.ts", "src/**/*.js"),
not a file path. Use the `path` parameter to specify file paths.
```

#### Current Behavior

```bash
hashline_grep(pattern="import", include="apps/web/src/lib/sandbox/patch-engine.ts")
# Returns: {results: [], matched_lines: 0}
# No error, no warning — silent failure
```

#### Additional Context

The parameter names are confusing:

- `include` sounds like "include this file" (a file parameter)
- `path` sounds like "search in this directory" (a directory parameter)

But the actual behavior is:

- `path` = search in this file OR directory (flexible)
- `include` = apply this glob filter (only glob patterns, NOT file paths)

**Workaround for agents:** Always use `path` parameter for file-specific searches. Use `include` only as a glob filter.

---

### FINDING 2: Regex Alternation (`|`) Works Correctly ✅

**Severity:** 🟢 No action needed  
**Type:** Clarification (not a bug)

#### Finding

Despite initial concerns, regex alternation with the `|` operator works correctly. All three syntax variations produce identical results:

```bash
hashline_grep(pattern="import|export", path="apps/web/src/lib/sandbox/patch-engine.ts")
# Result: All lines matching "import" OR "export" ✅

hashline_grep(pattern="(import|export)", path="...")
# Result: Same as above ✅

hashline_grep(pattern="import\\|export", path="...")
# Result: Same as above (backslash escaping is accepted but not required) ✅
```

All three syntaxes are functionally equivalent. The tool uses standard regex engine, so alternation works as expected.

#### Documentation Update

This is a **non-issue**. Document that:

- Alternation with `|` is fully supported
- Both with and without parentheses work
- Backslash escaping is accepted but optional

---

### FINDING 3: Case-Insensitive Search Missing

**Severity:** 🟡 P1 Feature Gap  
**Type:** Missing feature (equivalent to `grep -i`)  
**Impact:** Cannot perform case-insensitive pattern matching

#### Problem Description

There is no parameter or option to perform case-insensitive searches. The tool is always case-sensitive.

#### Current Behavior

```bash
hashline_grep(pattern="import", path="...") → matches "import" ✅
hashline_grep(pattern="IMPORT", path="...") → 0 results (no "IMPORT" keyword in code)
```

Standard grep provides this with the `-i` flag:

```bash
grep -i "import" file.ts  # matches "import", "Import", "IMPORT"
```

#### Expected Behavior

Add an optional `ignoreCase` boolean parameter (or similar):

```bash
hashline_grep(
  pattern="import",
  path="apps/web/src/lib/sandbox/patch-engine.ts",
  ignoreCase=true
)
# Result: Matches "import", "Import", "IMPORT", etc. ✅
```

#### Use Cases

- Finding variable/function names with inconsistent capitalization
- Searching for keywords in comments that may be capitalized inconsistently
- Case-insensitive debugging (searching for a feature name regardless of casing)

#### Recommendation

**Priority: P1** — Add `ignoreCase: boolean` parameter (default: false). This is a high-value feature gap.

---

### FINDING 4: `include` Glob Filter Works Correctly ✅

**Severity:** 🟢 No action needed  
**Type:** Clarification (working as intended)

#### Finding

When used correctly, the `include` parameter works as a glob filter for project-wide searches:

```bash
# Search all TypeScript files in the project
hashline_grep(pattern="import", include="*.ts")
# Result: All lines matching "import" in all .ts files ✅

# Same pattern, but scoped to a directory
hashline_grep(pattern="import", include="*.ts", path="apps/web/src/lib/sandbox")
# Result: All lines matching "import" in .ts files under that directory ✅
```

The `include` parameter works as a glob filter. The issue is only when agents try to use it as a file path parameter (BUG 1, above).

---

### FEATURE GAP 5: No Files-Only Mode (equivalent to `grep -l`)

**Severity:** 🟡 P2 Feature Gap  
**Type:** Missing convenience feature  
**Impact:** Broad searches produce massive output; hard to get just file list

#### Problem Description

When performing broad searches (e.g., `include="*.ts"` with no path), the results include all matching lines with context. There's no way to get just the list of files that contain matches, like `grep -l`.

#### Current Behavior

```bash
hashline_grep(pattern="async function", include="*.ts")
# Result: Every line containing "async function" across entire codebase
# Output: Potentially thousands of lines from hundreds of files
```

Standard grep provides this with the `-l` flag:

```bash
grep -l "async function" **/*.ts  # List only file paths, no line content
```

#### Expected Behavior

Add an optional `filesOnly` boolean parameter:

```bash
hashline_grep(
  pattern="async function",
  include="*.ts",
  filesOnly=true
)
# Result: ["apps/web/src/api/route.ts", "apps/web/src/lib/utils.ts", ...]
# Just file paths, no line content
```

#### Use Cases

- Finding all files that use a specific pattern (e.g., which files use `dangerouslySetInnerHTML`?)
- Auditing code (e.g., which files still have TODO comments?)
- Scoping changes (e.g., which files import a deprecated module?)

#### Recommendation

**Priority: P2** — Add `filesOnly: boolean` parameter (default: false). Useful for scoping and auditing tasks.

---

### FEATURE GAP 6: No Inverse Match Mode (equivalent to `grep -v`)

**Severity:** 🟡 P3 Feature Gap  
**Type:** Missing convenience feature  
**Impact:** Cannot exclude patterns; must resort to post-processing

#### Problem Description

There is no way to find lines that DO NOT match a pattern. Standard grep provides this with `-v` (invert-match).

#### Current Behavior

```bash
# Can find all lines with a pattern
hashline_grep(pattern="TODO", path="src/components/")
# Result: All TODO comments

# Cannot find all lines WITHOUT a pattern
hashline_grep(pattern="^TODO", invertMatch=true, path="src/components/")
# Parameter: invertMatch doesn't exist ❌
```

Standard grep:

```bash
grep -v "console.log" src/**/*.ts  # Find all lines NOT containing "console.log"
```

#### Expected Behavior

Add an optional `invertMatch` boolean parameter:

```bash
hashline_grep(
  pattern="console.log",
  invertMatch=true,
  path="src/components/"
)
# Result: All lines in src/components/ that DO NOT contain "console.log" ✅
```

#### Use Cases

- Finding code without debug statements (opposite of audit)
- Exclusion patterns for configuration
- Finding "clean" files without deprecated patterns

#### Recommendation

**Priority: P3** — Add `invertMatch: boolean` parameter (default: false). Nice-to-have for filtering and cleanup tasks.

---

### FEATURE GAP 7: No Count-Only Mode (equivalent to `grep -c`)

**Severity:** 🟡 P4 Feature Gap  
**Type:** Missing convenience feature  
**Impact:** Cannot get match count without retrieving all lines

#### Problem Description

There is no way to get just the count of matching lines without retrieving all the line content. Standard grep provides this with `-c` (count).

#### Current Behavior

```bash
# To count matches, agents must request all lines and count them
hashline_grep(pattern="export function", path="src/components/")
# Result: [line1, line2, line3, ...] (all content returned)
# Agents must: len(results) to get count ✅ (works, but inefficient)
```

Standard grep:

```bash
grep -c "export function" src/components/*.ts  # Returns just the count: 42
```

#### Expected Behavior

Add an optional `countOnly` boolean parameter:

```bash
hashline_grep(
  pattern="export function",
  include="*.ts",
  path="src/components/",
  countOnly=true
)
# Result: {total_matches: 42, files_matching: 8}
# Much more efficient than requesting all lines ✅
```

#### Use Cases

- Counting exported components in a directory
- Metrics and reporting (how many TODO comments?)
- Performance analysis (how many async functions vs sync?)

#### Recommendation

**Priority: P4** — Add `countOnly: boolean` parameter (default: false). Convenience feature for metrics and audits.

---

### FEATURE GAP 8: Single Path Only (No Multi-Path Support)

**Severity:** 🟡 P5 Feature Gap  
**Type:** Missing convenience feature  
**Impact:** Cannot search multiple paths in one call; must batch calls

#### Problem Description

The `path` parameter accepts only a single file or directory. Standard grep accepts multiple paths in one invocation.

#### Current Behavior

```bash
# Can search one path at a time
hashline_grep(pattern="import React", path="apps/web/src/components/")
hashline_grep(pattern="import React", path="apps/workspace/src/components/")
# Must make separate calls for each path
```

Standard grep:

```bash
grep "import React" apps/web/src/components/*.ts apps/workspace/src/components/*.ts
# Single call, multiple paths
```

#### Expected Behavior

Allow `path` to accept an array:

```bash
hashline_grep(
  pattern="import React",
  path=["apps/web/src/components/", "apps/workspace/src/components/"]
)
# Result: Combined matches from both paths in single call ✅
```

#### Use Cases

- Searching across multiple app directories
- Auditing a feature across different packages
- Finding common patterns across split codebases

#### Recommendation

**Priority: P5** — Add support for `path: string | string[]` (default: single string still works). Low priority; agents can batch calls if needed.

---

## Tool: hashline_edit

### FINDING 9: New File Creation Works Correctly ✅

**Severity:** 🟢 No action needed  
**Type:** Confirmation (working as intended)

#### Finding

The tool correctly creates new files, including nested directories (auto `mkdir -p`), using anchorless append:

```bash
# Create simple file
hashline_edit(
  path="/tmp/hashline-test-newfile.txt",
  edits=[{op: "append", lines: ["line one"]}]
)
# Result: File created with content "line one" ✅

# Create nested file (auto mkdir -p)
hashline_edit(
  path="/tmp/hashline-test-nested/deep/dir/file.txt",
  edits=[{op: "append", lines: ["nested"]}]
)
# Result: All intermediate directories created, file written ✅
```

This contradicts some sub-agent reports of creation failures. **The tool works.** Agents may be using it incorrectly (e.g., checking for file existence before creation).

#### Recommendation

Document that `hashline_edit` with anchorless append automatically creates files and directories. No fix needed.

---

### BUG 2 (GOTCHA): Anchorless Append on Existing File Duplicates Content

**Severity:** 🟠 Medium (gotcha, not a core bug)  
**Type:** Documented behavior (expected), but footgun for agents  
**Impact:** Agents may accidentally duplicate content if they call edit twice

#### Problem Description

When using anchorless append (no `pos` parameter) on a file that already exists, the new lines are **appended** to the existing content, not replacing it. This is technically correct append behavior, but it's a footgun.

Agents that don't track state might call the same edit twice and end up duplicating content.

#### Current Behavior

```bash
# First call: creates file with two lines
hashline_edit(
  path="/tmp/test.txt",
  edits=[{op: "append", lines: ["line one", "line two"]}]
)
# File contents: "line one\nline two"

# Second call: same content (agent retry or duplicate call)
hashline_edit(
  path="/tmp/test.txt",
  edits=[{op: "append", lines: ["line one", "line two"]}]
)
# File contents: "line one\nline two\nline one\nline two" (DUPLICATED!) ❌
```

#### Root Cause

This is **technically correct behavior** — append means "add to end". But agents calling this function may:

1. Not realize the file already exists
2. Retry a failed operation (idempotency assumption)
3. Get wrong results on second invocation

#### Expected Behavior (Documentation)

This is **not a bug** — it's a **documented edge case**. The fix is **documentation and agent awareness**:

1. **Document clearly:** Anchorless append is idempotent only for NEW files. On existing files, it adds to the end.
2. **Agent pattern:** If agents need to write/overwrite content, they should:
   - Check file existence first
   - Use `replace` with anchors for existing files
   - Or use anchorless append ONLY for new files (check `hashline_read` first)

#### Recommendation

**Priority: P0 for Documentation** — Update tool documentation with examples:

```bash
# ✅ Safe: Create new file
hashline_edit(path="/tmp/newfile.txt", edits=[{op: "append", lines: ["content"]}])

# ✅ Safe: Append to existing file (intentional add)
hashline_edit(path="/tmp/existing.txt", edits=[{op: "append", pos: "5#NS", lines: ["new line"]}])

# ⚠️  Gotcha: Anchorless append on existing file
# Only do this if you intend to append to the end!
hashline_edit(path="/tmp/existing.txt", edits=[{op: "append", lines: ["new line"]}])
# This adds to end, it doesn't replace!

# ✅ Safe: Replace content (for idempotent rewrites)
hashline_edit(path="/tmp/existing.txt", edits=[{op: "replace", pos: "1#XX", end: "5#YY", lines: ["new content"]}])
```

---

## Tool: hashline_read

### FINDING 10: No Issues Found ✅

**Severity:** 🟢 No action needed  
**Type:** Verification complete

#### Finding

The `hashline_read` tool works correctly across all tested scenarios:

✅ **Offset and limit parameters:** Work as expected for paginating through large files  
✅ **Directory tree listing:** Correctly lists entries with `/` suffix for directories  
✅ **Line number and hash stability:** Line hashes are content-specific and stable for edits  
✅ **Hashline anchors:** Hashes generated by `hashline_read` work correctly with `hashline_edit`

#### No Changes Needed

This tool requires no fixes or feature additions. It's production-ready.

---

## Summary: Prioritized Action Items

| Priority  | Issue                                                    | Tool          | Type          | Effort | Impact                               |
| --------- | -------------------------------------------------------- | ------------- | ------------- | ------ | ------------------------------------ |
| **P0 🔴** | BUG 1: `include` parameter without `path` silently fails | hashline_grep | Bug           | Medium | 🔴 CRITICAL — blocks agent workflows |
| **P0 📚** | BUG 2: Document anchorless append gotcha                 | hashline_edit | Documentation | Low    | 🟠 High — prevents user confusion    |
| **P1 🟡** | FEATURE 3: Add case-insensitive search (`ignoreCase`)    | hashline_grep | Feature       | Low    | 🟢 High value, easy to implement     |
| **P2 🟡** | FEATURE 5: Add files-only mode (`filesOnly`)             | hashline_grep | Feature       | Medium | 🟡 Medium — useful for auditing      |
| **P3 🟡** | FEATURE 6: Add inverse match (`invertMatch`)             | hashline_grep | Feature       | Medium | 🟡 Low-Medium — niche use case       |
| **P4 🟡** | FEATURE 7: Add count-only mode (`countOnly`)             | hashline_grep | Feature       | Low    | 🟡 Low — convenience feature         |
| **P5 🟡** | FEATURE 8: Support multiple paths                        | hashline_grep | Feature       | Medium | 🟡 Very Low — agents can batch       |

---

## What Works Well (No Changes Needed)

The following features and behaviors are solid and require **zero changes:**

| Feature                                         | Tool          | Status   | Notes                                    |
| ----------------------------------------------- | ------------- | -------- | ---------------------------------------- |
| **Regex alternation** (`\|`, `\|`, with parens) | hashline_grep | ✅ Works | All syntax variations work identically   |
| **Context lines** parameter                     | hashline_grep | ✅ Works | Correctly displays surrounding lines     |
| **New file creation**                           | hashline_edit | ✅ Works | Auto mkdir -p, idempotent for new files  |
| **Directory auto-creation**                     | hashline_edit | ✅ Works | Nested paths created automatically       |
| **Offset and limit**                            | hashline_read | ✅ Works | Pagination works correctly               |
| **Hash stability**                              | hashline_read | ✅ Works | Hashes remain stable for edits           |
| **Directory tree listing**                      | hashline_read | ✅ Works | Correct format with `/` for dirs         |
| **Glob filtering with `path`**                  | hashline_grep | ✅ Works | `include="*.ts" path="dir/"` works great |

---

## Recommended Implementation Roadmap

### Phase 1 (Immediate)

1. **Fix BUG 1:** Make `include` parameter accept full file paths OR glob patterns
2. **Fix BUG 2 Documentation:** Add examples showing the anchorless append gotcha
3. **Add P1 Feature (ignoreCase):** Quick win — 1-2 hours of implementation

### Phase 2 (Sprint)

4. **Add P2 Feature (filesOnly):** Useful for auditing; plan 4-6 hours
5. **Add P3 Feature (invertMatch):** Good coverage of grep parity; plan 4-6 hours

### Phase 3 (Future)

6. **Add P4 Feature (countOnly):** Optimization feature
7. **Add P5 Feature (multi-path):** Polish feature for convenience

---

## Appendix: Detailed Repro Test Cases

### Test: hashline_grep with include parameter variations

```bash
# Setup: File exists at apps/web/src/lib/sandbox/patch-engine.ts with "import" keyword

Test 1: include with full path (FAILS)
  Input:  hashline_grep(pattern="import", include="apps/web/src/lib/sandbox/patch-engine.ts")
  Expected: 9 results
  Actual: 0 results ❌
  Status: BUG - silent failure

Test 2: path with full file path (WORKS)
  Input:  hashline_grep(pattern="import", path="apps/web/src/lib/sandbox/patch-engine.ts")
  Expected: 9 results
  Actual: 9 results ✅
  Status: OK

Test 3: include with glob + path with directory (WORKS)
  Input:  hashline_grep(pattern="import", include="*.ts", path="apps/web/src/lib/sandbox")
  Expected: Multiple matches from .ts files
  Actual: Multiple matches ✅
  Status: OK

Test 4: include with glob, no path (WORKS)
  Input:  hashline_grep(pattern="import", include="*.ts")
  Expected: Matches from all .ts files in project
  Actual: Matches from all .ts files ✅
  Status: OK

Test 5: Case sensitivity (EXPECTED LIMITATION)
  Input:  hashline_grep(pattern="import", path="...")
  Expected: Matches "import" ✅
  Actual: Matches "import" ✅
  Status: OK

  Input:  hashline_grep(pattern="IMPORT", path="...")
  Expected: No matches (no uppercase IMPORT in codebase)
  Actual: 0 matches ✅
  Status: OK (but no ignoreCase option available)
```

### Test: hashline_edit file creation

```bash
Test 1: Create new file with anchorless append
  Input:  hashline_edit(path="/tmp/newfile.txt", edits=[{op:"append", lines:["content"]}])
  Expected: File created with content
  Actual: File created ✅
  Status: OK

Test 2: Create nested file (auto mkdir)
  Input:  hashline_edit(path="/tmp/deep/nested/file.txt", edits=[{op:"append", lines:["content"]}])
  Expected: All directories created + file written
  Actual: All directories created + file written ✅
  Status: OK

Test 3: Anchorless append on existing file (GOTCHA)
  Input:  hashline_edit(path="/tmp/test.txt", edits=[{op:"append", lines:["line1", "line2"]}])
           (called twice with same content)
  Expected: File has ["line1", "line2"] after first call, same after second call
  Actual: File has content duplicated after second call ❌
  Status: GOTCHA - append is not idempotent on existing files
```

### Test: hashline_read functionality

```bash
Test 1: Read with offset and limit
  Input:  hashline_read(filePath="src/file.ts", offset=10, limit=20)
  Expected: Lines 10-29 returned with hashes
  Actual: Lines 10-29 returned with hashes ✅
  Status: OK

Test 2: Read directory
  Input:  hashline_read(filePath="src/")
  Expected: Tree listing with `/` for directories
  Actual: Tree listing with `/` for directories ✅
  Status: OK

Test 3: Hash stability
  Input:  hashline_read(filePath="src/file.ts") → get hashes
           (file unchanged)
           hashline_read(filePath="src/file.ts") → get hashes again
  Expected: Same hashes
  Actual: Same hashes ✅
  Status: OK

Test 4: Hash in edit operation
  Input:  hashline_read(filePath="src/file.ts") → get hash "5#NS"
           hashline_edit(filePath="src/file.ts", edits=[{op:"replace", pos:"5#NS", lines:["new"]}])
  Expected: Edit succeeds using hash from read
  Actual: Edit succeeds ✅
  Status: OK
```

---

## Sign-Off

This specification documents the current state of the hashline tools as of April 5, 2026. All findings are based on actual testing and repro steps.

**Spec Author:** System Test  
**Test Date:** April 5, 2026  
**Status:** Ready for implementation planning

---

_For implementation questions or clarifications, reference the Repro Steps and Expected Behavior sections for each issue._
