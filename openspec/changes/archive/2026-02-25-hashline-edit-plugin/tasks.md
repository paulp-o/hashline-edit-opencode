# Implementation Checklist: HashLine Edit Plugin

## 1. Setup & Dependencies

- [x] 1.1 Verify Bun runtime availability and xxHash32 API (`Bun.hash.xxHash32`)
- [x] 1.2 Create `.opencode/lib/` directory structure
- [x] 1.3 Create `.opencode/plugins/` directory if not exists
- [x] 1.4 Set up test runner configuration for Bun

## 2. Core Hashing Module (hashline-core.ts)

- [x] 2.1 Define `NIBBLE_STR` constant: `"ZPMQVRWSNKTXJBYH"`
- [x] 2.2 Build `DICT` lookup table with 256 entries (nibble pairs)
- [x] 2.3 Implement `normalizeLine(line)` to strip whitespace and trailing `\r`
- [x] 2.4 Implement `computeLineHash(content, lineIndex)` with seed variation logic
- [x] 2.5 Implement `formatLineTag(lineNum, content)` returning `"N#HASH"`
- [x] 2.6 Implement `formatHashLines(text, startLine?)` returning full hashline-annotated text
- [x] 2.7 Implement `parseTag(ref)` to extract `{line, hash}` from `"N#ID"` format
- [x] 2.8 Implement `validateLineRef(ref, fileLines)` to check hash matches

## 3. Error Handling Module (hashline-errors.ts)

- [x] 3.1 Create `HashlineMismatchError` class extending Error
- [x] 3.2 Add `mismatches` array property for multiple error tracking
- [x] 3.3 Implement context line generation (2 lines above/below with `>>>` markers)
- [x] 3.4 Implement expected vs actual hash display in error message
- [x] 3.5 Include retry guidance with correct tags in error output

## 4. Prefix Stripping Module (hashline-strip.ts)

- [x] 4.1 Implement `stripNewLinePrefixes(lines)` function
- [x] 4.2 Add detection logic for `LINE#HASH:` pattern (regex: `/^\d+#[A-Z]{2}:/`)
- [x] 4.3 Implement >50% threshold heuristic (only strip if majority match)
- [x] 4.4 Handle edge case: markdown list lines (`- item`) should NOT be stripped
- [x] 4.5 Return original lines if threshold not met

## 5. System Prompt Module (hashline-prompt.ts)

- [x] 5.1 Create `HASHLINE_SYSTEM_PROMPT` constant with complete instructions
- [x] 5.2 Document `LINE#HASH:content` format in prompt
- [x] 5.3 Explain replace/append/prepend operations with examples
- [x] 5.4 Document anchor format `"N#ID"` for pos/end parameters
- [x] 5.5 Explain lines parameter variants (array, string, null, [])
- [x] 5.6 Include workflow instructions (read before edit, minimize scope)
- [x] 5.7 Add recovery rules section (tag mismatch retry, no-op handling)
- [x] 5.8 Provide at least 3 practical examples (replace single, append, prepend)

## 6. Edit Application Engine (hashline-apply.ts)

- [x] 6.1 Define `EditOperation` TypeScript interface
- [x] 6.2 Implement `collectEdits(editsArray)` to parse and normalize operations
- [x] 6.3 Implement `validateAllHashes(edits, fileLines)` — validates before any mutation
- [x] 6.4 Implement `sortEditsBottomUp(edits)` — descending line order with precedence rules
- [x] 6.5 Implement `applyReplace(edit, lines)` for single and range replace
- [x] 6.6 Implement `applyAppend(edit, lines)` for after-line and EOF append
- [x] 6.7 Implement `applyPrepend(edit, lines)` for before-line and BOF prepend
- [x] 6.8 Implement `deduplicateEdits(edits)` using Set with serialized keys
- [x] 6.9 Implement `detectNoOp(edit, oldContent, newContent)` comparison
- [x] 6.10 Create `applyHashlineEdits(path, edits)` main orchestrator function

## 7. Plugin Entry Point — hashline_read Tool

- [x] 7.1 Implement `hashline_read` tool schema with `filePath`, `offset`, `limit` parameters
- [x] 7.2 Add binary file detection (check for null bytes in first 8KB)
- [x] 7.3 Implement file reading with Bun.file().text()
- [x] 7.4 Implement directory listing mode with tree format and line counts
- [x] 7.5 Implement offset/limit slicing for large files
- [x] 7.6 Implement line truncation for lines >2000 characters
- [x] 7.7 Return hashline-annotated output using `formatHashLines()`
- [x] 7.8 Handle file not found with helpful error message

## 8. Plugin Entry Point — hashline_edit Tool

- [x] 8.1 Implement `hashline_edit` tool schema with `path`, `edits`, `delete`, `move` parameters
- [x] 8.2 Implement file existence check and creation for append to new file
- [x] 8.3 Integrate `stripNewLinePrefixes()` for `lines` parameter preprocessing
- [x] 8.4 Call `applyHashlineEdits()` for edit application
- [x] 8.5 Implement file deletion when `delete: true`
- [x] 8.6 Implement file move when `move` parameter provided
- [x] 8.7 Handle move + edit combo (apply edits then move)
- [x] 8.8 Return success message with line count delta
- [x] 8.9 Catch `HashlineMismatchError` and return formatted error to LLM

## 9. Plugin Entry Point — hashline_grep Tool

- [x] 9.1 Implement `hashline_grep` tool schema with `pattern`, `path`, `include`, `context` parameters
- [x] 9.2 Implement ripgrep execution via `Bun.$` shell command
- [x] 9.3 Parse ripgrep output to extract file paths and line numbers
- [x] 9.4 Read matching files and format context lines with hashline annotations
- [x] 9.5 Mark match lines with `>` prefix for visibility
- [x] 9.6 Implement fs-based fallback search if ripgrep unavailable
- [x] 9.7 Handle "no matches found" case with clear message
- [x] 9.8 Return results grouped by file path

## 10. Plugin Registration & Hook

- [x] 10.1 Create main plugin export function at `.opencode/plugins/hashline-edit.ts`
- [x] 10.2 Import `@opencode-ai/plugin` SDK and use `tool.schema` for parameter definitions
- [x] 10.3 Register `hashline_read` tool with descriptive description
- [x] 10.4 Register `hashline_edit` tool with edit operation descriptions
- [x] 10.5 Register `hashline_grep` tool with search and context descriptions
- [x] 10.6 Attempt system prompt injection via plugin hook (if available)
- [x] 10.7 Implement fallback: comprehensive descriptions in tool definitions
- [x] 10.8 Verify all three tools are properly exported and loadable

## 11. Unit Tests — Core Module

- [x] 11.1 Test `computeLineHash`: normal text returns 2-char hash from NIBBLE_STR
- [x] 11.2 Test `computeLineHash`: whitespace variations produce same hash
- [x] 11.3 Test `computeLineHash`: symbol-only lines at different indices produce different hashes
- [x] 11.4 Test `computeLineHash`: CRLF handling strips trailing `\r`
- [x] 11.5 Test `computeLineHash`: empty string returns valid hash
- [x] 11.6 Test `formatHashLines`: single line formats as `"1#XY:content"`
- [x] 11.7 Test `formatHashLines`: multi-line produces sequential numbering
- [x] 11.8 Test `formatHashLines`: offset parameter shifts starting line number
- [x] 11.9 Test `parseTag`: extracts `{line, hash}` from `"23#XY"`
- [x] 11.10 Test `parseTag`: handles prefixed tags like `"> 23#XY"`
- [x] 11.11 Test `parseTag`: returns null for invalid formats
- [x] 11.12 Test `parseTag`: rejects line 0 and invalid hash characters
- [x] 11.13 Test `validateLineRef`: returns true for matching hash
- [x] 11.14 Test `validateLineRef`: returns false for mismatched hash
- [x] 11.15 Test `validateLineRef`: returns false for out of range line

## 12. Unit Tests — Edit Engine

- [x] 12.1 Test replace single line: target line replaced, count unchanged
- [x] 12.2 Test replace range: multiple lines replaced with new content
- [x] 12.3 Test replace delete (lines=[]): target line removed
- [x] 12.4 Test replace delete range: multiple lines removed
- [x] 12.5 Test replace clear (lines=[""]): line becomes empty
- [x] 12.6 Test append after line: lines inserted after position
- [x] 12.7 Test append at EOF: lines added to end of file
- [x] 12.8 Test append creates new file when path doesn't exist
- [x] 12.9 Test prepend before line: lines inserted before position
- [x] 12.10 Test prepend at BOF: lines added to beginning
- [x] 12.11 Test hash mismatch single: throws HashlineMismatchError
- [x] 12.12 Test hash mismatch multiple: all mismatches reported in error
- [x] 12.13 Test hash mismatch blocks all: no edits applied if any invalid
- [x] 12.14 Test bottom-up ordering: edits applied highest line first
- [x] 12.15 Test deduplication: identical edits reduced to one
- [x] 12.16 Test no-op detection: warning generated for identical content

## 13. Unit Tests — Strip Module

- [x] 13.1 Test stripping triggered when >50% lines have `LINE#HASH:` prefix
- [x] 13.2 Test stripping NOT triggered when <=50% lines match pattern
- [x] 13.3 Test markdown list lines (`- item`) are NOT stripped
- [x] 13.4 Test mixed content: only hashline-patterned lines affected

## 14. E2E Tests

- [x] 14.1 Test read file: verify hashline format output with correct hashes
- [x] 14.2 Test read with offset=10, limit=5: only lines 10-14 returned
- [x] 14.3 Test edit file: verify file modified correctly with new content
- [x] 14.4 Test edit and re-read: new hashes match recomputed values
- [x] 14.5 Test grep: results include hashline tags with `>` on match lines
- [x] 14.6 Test grep to edit workflow: edit succeeds using hashes from grep output
- [x] 14.7 Test hash mismatch error: message includes expected, actual, line number
- [x] 14.8 Test directory read: tree listing with line counts displayed
- [x] 14.9 Test binary file rejection: error suggests using built-in read
- [x] 14.10 Test file not found: helpful error message returned

## 15. Verification & Documentation

- [x] 15.1 Verify all imports resolve correctly (no missing dependencies)
- [x] 15.2 Verify TypeScript compiles without errors
- [x] 15.3 Run full test suite and verify >95% coverage for core modules
- [x] 15.4 Create usage example in comments or separate EXAMPLES.md
- [x] 15.5 Document permission configuration for denying built-in tools (user step)
- [x] 15.6 Verify plugin loads in OpenCode without errors
- [x] 15.7 Test end-to-end workflow: read → grep → edit cycle
- [x] 15.8 Verify error messages are helpful and include retry guidance
