## ADDED Requirements

### Requirement: Replace Operation
The system SHALL support replacing single lines or ranges.

Single line replace: `{op: "replace", pos: "N#ID", lines: ["new content"]}`
Range replace: `{op: "replace", pos: "N#ID", end: "M#ID", lines: ["..."]}`
Delete line: `{op: "replace", pos: "N#ID", lines: null}` or `lines: []`
Clear line: `{op: "replace", pos: "N#ID", lines: [""]}` (preserve line, clear content)

#### Scenario: Single line replace
- **WHEN** applying edit `{op: "replace", pos: "5#XY", lines: ["new content"]`}
- **THEN** line 5 SHALL be replaced with "new content"
- **AND** the file line count SHALL remain unchanged

#### Scenario: Range replace
- **WHEN** applying edit `{op: "replace", pos: "5#XY", end: "7#AB", lines: ["line A", "line B"]}`
- **THEN** lines 5 through 7 SHALL be replaced with 2 new lines
- **AND** the file line count SHALL decrease by 1

#### Scenario: Delete single line
- **WHEN** applying edit `{op: "replace", pos: "5#XY", lines: []}`
- **THEN** line 5 SHALL be removed
- **AND** the file line count SHALL decrease by 1

#### Scenario: Delete range
- **WHEN** applying edit `{op: "replace", pos: "5#XY", end: "8#CD", lines: []}`
- **THEN** lines 5 through 8 SHALL be removed
- **AND** the file line count SHALL decrease by 4

#### Scenario: Clear line content
- **WHEN** applying edit `{op: "replace", pos: "5#XY", lines: [""]}`
- **THEN** line 5 SHALL become an empty line
- **AND** the file line count SHALL remain unchanged

### Requirement: Append Operation
The system SHALL support inserting lines after a position.

Operation: `{op: "append", pos: "N#ID", lines: ["new line"]}`
Anchorless append (no pos): append at end of file

#### Scenario: Append after line
- **WHEN** applying edit `{op: "append", pos: "5#XY", lines: ["new line"]}`
- **THEN** "new line" SHALL be inserted after line 5
- **AND** the file line count SHALL increase by 1

#### Scenario: Append at EOF
- **WHEN** applying edit `{op: "append", lines: ["new line"]}` without pos
- **THEN** "new line" SHALL be appended at end of file
- **AND** the file line count SHALL increase by 1

#### Scenario: Append to create new file
- **WHEN** applying edit `{op: "append", lines: ["first line"]}` to non-existent file
- **THEN** a new file SHALL be created with "first line"

### Requirement: Prepend Operation
The system SHALL support inserting lines before a position.

Operation: `{op: "prepend", pos: "N#ID", lines: ["new line"]}`
Anchorless prepend (no pos): prepend at beginning of file

#### Scenario: Prepend before line
- **WHEN** applying edit `{op: "prepend", pos: "5#XY", lines: ["new line"]}`
- **THEN** "new line" SHALL be inserted before line 5
- **AND** the file line count SHALL increase by 1

#### Scenario: Prepend at BOF
- **WHEN** applying edit `{op: "prepend", lines: ["new line"]}` without pos
- **THEN** "new line" SHALL be inserted at beginning of file
- **AND** the file line count SHALL increase by 1

### Requirement: Hash Verification
The system SHALL validate ALL hash references BEFORE any mutation.

The system SHALL:
- Collect all mismatches first
- Throw HashlineMismatchError if any mismatch found
- NOT apply partial edits — all-or-nothing semantics

#### Scenario: All hashes valid
- **WHEN** applying multiple edits with all hash references matching
- **THEN** all edits SHALL be applied successfully

#### Scenario: One mismatch blocks all edits
- **WHEN** applying edits where one hash reference mismatches
- **THEN** HashlineMismatchError SHALL be thrown
- **AND** NO edits SHALL be applied

#### Scenario: Multiple mismatches reported
- **WHEN** applying edits where three hash references mismatch
- **THEN** HashlineMismatchError SHALL include all three mismatches
- **AND** the error message SHALL list each mismatch with expected and actual hashes

### Requirement: Bottom-Up Application
The system SHALL apply edits from bottom to top.

The system SHALL:
- Sort by line number descending (highest first)
- Within same line: replace < append < prepend precedence
- Preserve line indices for earlier splices

#### Scenario: Two non-overlapping edits
- **WHEN** applying edit at line 5 and edit at line 10
- **THEN** the line 10 edit SHALL be applied first
- **AND** the line 5 edit SHALL be applied second

#### Scenario: Edits near same area
- **WHEN** applying replace at line 5 and append at line 5
- **THEN** the replace SHALL be applied before the append
- **AND** both edits SHALL affect correct lines

### Requirement: Edit Deduplication
The system SHALL deduplicate identical edit operations.

The system SHALL consider edits identical when:
- Same op type
- Same pos anchor
- Same end anchor (if range)
- Same lines content

#### Scenario: Duplicate edits reduced to one
- **WHEN** receiving two identical replace edits for the same position
- **THEN** only one edit SHALL be applied
- **AND** the file SHALL reflect a single modification

### Requirement: No-Op Detection
The system SHALL warn when an edit produces identical content.

The system SHALL:
- Compare replacement content with original
- Return warning instead of error for same content
- Still report success but include warning message

#### Scenario: Replace with same content
- **WHEN** applying edit where new content equals old content
- **THEN** the edit SHALL succeed with warning
- **AND** the warning SHALL indicate no-op detected

### Requirement: File Operations
The system SHALL support file delete and move.

Delete: `{path, edits: [], delete: true}`
Move: `{path, move: "new-path", edits: [...]}`
Move + edit: apply edits then rename

#### Scenario: Delete file
- **WHEN** applying edit with `delete: true`
- **THEN** the file SHALL be deleted
- **AND** success SHALL be reported

#### Scenario: Move file
- **WHEN** applying edit with `move: "new/path.ts"`
- **THEN** the file SHALL be renamed to new location
- **AND** success SHALL be reported

#### Scenario: Move with edits
- **WHEN** applying edit with both `move` and `edits`
- **THEN** edits SHALL be applied first
- **AND** the modified file SHALL be moved to new location
