## ADDED Requirements

### Requirement: Line Hash Computation
The system SHALL compute a 2-character hash for any given line using xxHash32.

The algorithm SHALL be:
- `DICT[Bun.hash.xxHash32(normalized_line, seed) & 0xFF]`
- NIBBLE_STR = "ZPMQVRWSNKTXJBYH"
- DICT = 256 entries, each from `NIBBLE_STR[high_nibble] + NIBBLE_STR[low_nibble]`
- Normalization SHALL strip all whitespace (`/\s+/g`) and strip trailing `\r`
- For lines with NO alphanumeric/letter chars (`/[\p{L}\p{N}]/u` fails), seed SHALL equal line index
- For lines WITH alphanumeric chars, seed SHALL be 0

#### Scenario: Normal line hash computation
- **WHEN** the system computes hash for "function hello() {"
- **THEN** the result SHALL be a 2-character string from the NIBBLE_STR alphabet

#### Scenario: Whitespace-only differences produce same hash
- **WHEN** the system computes hashes for "function hello() {", "  function hello() {  ", and "function  hello()  {"
- **THEN** all three lines SHALL produce the same hash

#### Scenario: Symbol-only lines at different indices produce different hashes
- **WHEN** the system computes hash for "}" at line 5 with seed=5
- **AND** the system computes hash for "}" at line 10 with seed=10
- **THEN** the two hashes SHALL be different

#### Scenario: CRLF handling
- **WHEN** the system computes hash for "function hello() {\r\n"
- **THEN** the trailing `\r` SHALL be stripped before hashing
- **AND** the result SHALL match hash of "function hello() {\n"

### Requirement: Line Formatting
The system SHALL format lines as `LINE#HASH:content`.

The system SHALL provide:
- `formatHashLines(text, startLine?)`: formats entire text block with hashline annotations
- `formatLineTag(lineNum, content)`: formats single line tag
- Line numbers SHALL be 1-indexed

#### Scenario: Single line formatting
- **WHEN** the system formats line 1 with content "function hello() {"
- **THEN** the result SHALL be "1#XY:function hello() {" where XY is the computed hash

#### Scenario: Multi-line formatting
- **WHEN** the system formats text "line1\nline2\nline3"
- **THEN** the result SHALL be "1#XX:line1\n2#YY:line2\n3#ZZ:line3" with each line numbered and hashed

#### Scenario: Custom start line offset
- **WHEN** the system formats text with startLine=10
- **THEN** the first line SHALL be numbered 10
- **AND** subsequent lines SHALL increment sequentially

#### Scenario: Empty line formatting
- **WHEN** the system formats an empty line
- **THEN** the line SHALL still include a hash
- **AND** the format SHALL be "N#XX:" where XX is the hash of empty string

### Requirement: Tag Parsing
The system SHALL parse `"N#ID"` references from LLM output.

The `parseTag(ref)` function SHALL:
- Extract `{line, hash}` from strings like `"23#XY"`
- Accept optional prefixes: `>`, `+`, `-`, whitespace
- Validate hash chars are from NIBBLE_STR alphabet
- Validate line >= 1
- Return null for invalid formats

#### Scenario: Valid tag parsing
- **WHEN** the system parses "23#XY"
- **THEN** the result SHALL be `{line: 23, hash: "XY"}`

#### Scenario: Tag with prefix parsing
- **WHEN** the system parses "> 23#XY"
- **THEN** the prefix SHALL be stripped
- **AND** the result SHALL be `{line: 23, hash: "XY"}`

#### Scenario: Invalid format rejection
- **WHEN** the system parses "23" (missing hash)
- **OR** the system parses "#XY" (missing line)
- **OR** the system parses "23#X" (single char hash)
- **THEN** the result SHALL be null

#### Scenario: Line 0 rejection
- **WHEN** the system parses "0#XY"
- **THEN** the result SHALL be null
- **AND** the error SHALL indicate invalid line number

#### Scenario: Invalid hash characters rejection
- **WHEN** the system parses "23#AB" where 'A' or 'B' are not in NIBBLE_STR
- **THEN** the result SHALL be null

### Requirement: Line Validation
The system SHALL validate hash references against current file content.

The `validateLineRef(ref, fileLines)` function SHALL:
- Compute current hash of the referenced line
- Compare with expected hash from the reference
- Return boolean indicating match

#### Scenario: Matching hash validation
- **WHEN** the system validates "5#XY" against fileLines where line 5's current hash is "XY"
- **THEN** the result SHALL be true

#### Scenario: Mismatched hash validation
- **WHEN** the system validates "5#XY" against fileLines where line 5's current hash is "AB"
- **THEN** the result SHALL be false
- **AND** the system SHALL report the mismatch

#### Scenario: Out of range line validation
- **WHEN** the system validates "100#XY" against fileLines with only 50 lines
- **THEN** the result SHALL be false
- **AND** the system SHALL report line out of range
