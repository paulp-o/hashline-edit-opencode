## ADDED Requirements

### Requirement: Core Unit Tests
The system SHALL test hash computation, formatting, parsing, and validation.

Test coverage SHALL include:
- `computeLineHash`: normal text, whitespace variations, symbol-only lines, CRLF, empty string
- `formatHashLines`: single line, multi-line, offset, empty text
- `parseTag`: valid tags, prefixed tags, invalid format, edge cases
- `validateLineRef`: matching, mismatched, out of range

#### Scenario: computeLineHash normal text
- **WHEN** testing computeLineHash with "function hello() {"
- **THEN** it SHALL return a 2-character hash
- **AND** the hash SHALL be from NIBBLE_STR alphabet

#### Scenario: computeLineHash whitespace variations
- **WHEN** testing computeLineHash with "hello", "  hello  ", "hello  "
- **THEN** all SHALL return the same hash

#### Scenario: computeLineHash symbol-only lines
- **WHEN** testing computeLineHash with "}" at line 5 and line 10
- **THEN** different line indices SHALL produce different hashes

#### Scenario: computeLineHash CRLF handling
- **WHEN** testing computeLineHash with "hello\r\n"
- **THEN** it SHALL strip the trailing \r
- **AND** it SHALL match hash of "hello"

#### Scenario: computeLineHash empty string
- **WHEN** testing computeLineHash with ""
- **THEN** it SHALL return a valid hash
- **AND** the hash SHALL be deterministic

#### Scenario: formatHashLines single line
- **WHEN** testing formatHashLines with "hello"
- **THEN** output SHALL be "1#XY:hello" where XY is the hash

#### Scenario: formatHashLines multi-line
- **WHEN** testing formatHashLines with "line1\nline2\nline3"
- **THEN** output SHALL have 3 lines with sequential numbers

#### Scenario: formatHashLines with offset
- **WHEN** testing formatHashLines with startLine=10
- **THEN** first line number SHALL be 10

#### Scenario: formatHashLines empty text
- **WHEN** testing formatHashLines with ""
- **THEN** output SHALL be empty string or single empty line with hash

#### Scenario: parseTag valid tags
- **WHEN** testing parseTag with "23#XY"
- **THEN** it SHALL return {line: 23, hash: "XY"}

#### Scenario: parseTag prefixed tags
- **WHEN** testing parseTag with "> 23#XY"
- **THEN** it SHALL return {line: 23, hash: "XY"}

#### Scenario: parseTag invalid format
- **WHEN** testing parseTag with "invalid"
- **THEN** it SHALL return null

#### Scenario: parseTag edge cases
- **WHEN** testing parseTag with "0#XY"
- **THEN** it SHALL return null (line 0 invalid)

#### Scenario: validateLineRef matching
- **WHEN** testing validateLineRef with correct hash
- **THEN** it SHALL return true

#### Scenario: validateLineRef mismatched
- **WHEN** testing validateLineRef with incorrect hash
- **THEN** it SHALL return false

#### Scenario: validateLineRef out of range
- **WHEN** testing validateLineRef with line number beyond file length
- **THEN** it SHALL return false

### Requirement: Edit Engine Unit Tests
The system SHALL test the edit application logic.

Test coverage SHALL include:
- Replace: single, range, delete, clear
- Append: after line, at EOF, anchorless
- Prepend: before line, at BOF, anchorless
- Hash mismatch: single, multiple, blocks all edits
- Bottom-up: multiple edits maintain correct indices
- Dedup: identical edits deduplicated
- No-op: same content warning

#### Scenario: Replace single line
- **WHEN** testing replace with single line operation
- **THEN** the target line SHALL be replaced

#### Scenario: Replace range
- **WHEN** testing replace with range operation
- **THEN** the range SHALL be replaced with new lines

#### Scenario: Replace delete line
- **WHEN** testing replace with lines=[]
- **THEN** the target line SHALL be deleted

#### Scenario: Replace clear line
- **WHEN** testing replace with lines=[""]
- **THEN** the target line SHALL become empty

#### Scenario: Append after line
- **WHEN** testing append with pos specified
- **THEN** lines SHALL be inserted after the position

#### Scenario: Append at EOF
- **WHEN** testing append without pos
- **THEN** lines SHALL be appended at end of file

#### Scenario: Append anchorless to create file
- **WHEN** testing append to non-existent file
- **THEN** a new file SHALL be created

#### Scenario: Prepend before line
- **WHEN** testing prepend with pos specified
- **THEN** lines SHALL be inserted before the position

#### Scenario: Prepend at BOF
- **WHEN** testing prepend without pos
- **THEN** lines SHALL be prepended at beginning of file

#### Scenario: Hash mismatch single
- **WHEN** testing with one mismatched hash
- **THEN** HashlineMismatchError SHALL be thrown

#### Scenario: Hash mismatch multiple
- **WHEN** testing with multiple mismatched hashes
- **THEN** all mismatches SHALL be reported in error

#### Scenario: Hash mismatch blocks all
- **WHEN** testing with valid and invalid edits mixed
- **THEN** no edits SHALL be applied

#### Scenario: Bottom-up ordering
- **WHEN** testing multiple edits at different lines
- **THEN** edits SHALL be applied from bottom to top
- **AND** line indices SHALL be preserved

#### Scenario: Edit deduplication
- **WHEN** testing identical duplicate edits
- **THEN** only one edit SHALL be applied

#### Scenario: No-op detection
- **WHEN** testing replace with identical content
- **THEN** a warning SHALL be generated

### Requirement: Strip Unit Tests
The system SHALL test prefix stripping.

The system SHALL test:
- Lines with `LINE#HASH:` prefixes stripped when >50% of non-empty lines match
- Lines without prefixes left unchanged
- Markdown list lines (`- item`) preserved

#### Scenario: Stripping triggered
- **WHEN** input has >50% lines with LINE#HASH: prefix
- **THEN** all such prefixes SHALL be stripped

#### Scenario: Stripping not triggered
- **WHEN** input has <=50% lines with LINE#HASH: prefix
- **THEN** no stripping SHALL occur

#### Scenario: Markdown list preservation
- **WHEN** input has `- item` style lines
- **THEN** they SHALL NOT be mistaken for hashline prefixes

#### Scenario: Mixed content handling
- **WHEN** input has mix of hashline and non-hashline lines
- **THEN** stripping SHALL only affect hashline-patterned lines

### Requirement: E2E Tests
The system SHALL test complete tool workflows.

Test coverage SHALL include:
- Read file → verify hashline format
- Read file with offset/limit → verify subset
- Edit file → verify file changed correctly
- Grep → verify hashline-annotated results
- Grep → Edit without read → verify success
- Hash mismatch → verify error message format

#### Scenario: Read and verify format
- **WHEN** reading a file with hashline_read
- **THEN** output SHALL contain properly formatted hashlines
- **AND** hashes SHALL match computed values

#### Scenario: Read with offset and limit
- **WHEN** reading with offset=10, limit=5
- **THEN** only lines 10-14 SHALL be returned
- **AND** line numbers SHALL be correct

#### Scenario: Edit and verify change
- **WHEN** editing a file with hashline_edit
- **THEN** file contents SHALL be modified correctly
- **AND** line hashes SHALL be updated

#### Scenario: Grep and verify annotations
- **WHEN** searching with hashline_grep
- **THEN** results SHALL include hashline tags
- **AND** match lines SHALL have > prefix

#### Scenario: Grep to edit workflow
- **WHEN** using grep results to edit without re-reading
- **THEN** the edit SHALL succeed using hashes from grep output

#### Scenario: Hash mismatch error format
- **WHEN** editing with mismatched hash
- **THEN** error message SHALL include expected hash
- **AND** error message SHALL include actual hash
- **AND** error message SHALL include line number
