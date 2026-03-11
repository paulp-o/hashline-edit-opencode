## MODIFIED Requirements

### Requirement: hashline_edit Tool
The system SHALL provide a tool to edit files using hashline references. When EXPERIMENTAL_LSP_DIAGNOSTICS environment variable is enabled, the system SHALL automatically collect and append LSP diagnostics to edit responses using auto-detected LSP servers.

Parameters:
- `path` (required string): file path
- `edits` (required array): edit operations
- `delete` (optional boolean): delete file if true
- `move` (optional string): new path to move file to

Edit op schema: `{op: "replace"|"append"|"prepend", pos?: string, end?: string, lines: string[]|string|null}`

LSP Diagnostics behavior:
- The system SHALL auto-detect LSP servers based on project file types and PATH availability
- The system SHALL NOT read LSP configuration from opencode.json or opencode.jsonc files
- The system SHALL collect diagnostics from all active LSP servers after file modifications
- The system SHALL format diagnostics into XML-wrapped format: `<diagnostics file="path">...</diagnostics>`
- The system SHALL include an informational message about missing LSP servers on the first edit response

#### Scenario: Successful edit with LSP diagnostics
- **WHEN** calling hashline_edit with valid path and edits
- **AND** EXPERIMENTAL_LSP_DIAGNOSTICS is enabled
- **AND** an LSP server is active for the file type
- **THEN** the file SHALL be modified according to edit operations
- **AND** success message SHALL include line count delta
- **AND** LSP diagnostics SHALL be appended to the response

#### Scenario: Successful edit without available LSP server
- **WHEN** calling hashline_edit with valid path and edits
- **AND** EXPERIMENTAL_LSP_DIAGNOSTICS is enabled
- **AND** no LSP server is available for the file type
- **THEN** the file SHALL be modified according to edit operations
- **AND** success message SHALL be returned without diagnostics
- **AND** on the first edit, an informational message about missing servers SHALL be appended

#### Scenario: Hash mismatch error
- **WHEN** calling hashline_edit with a mismatched hash reference
- **THEN** HashlineMismatchError SHALL be returned
- **AND** error details SHALL include expected vs actual hashes

#### Scenario: File creation via append
- **WHEN** calling hashline_edit with path to non-existent file and append operation
- **THEN** a new file SHALL be created with the appended content
- **AND** success SHALL be reported
- **AND** LSP diagnostics SHALL be collected if a server is available for the file type

#### Scenario: File deletion
- **WHEN** calling hashline_edit with delete=true
- **THEN** the file SHALL be deleted
- **AND** success SHALL be reported
- **AND** no LSP diagnostics SHALL be collected

#### Scenario: File move
- **WHEN** calling hashline_edit with move="new/path.ts"
- **THEN** the file SHALL be moved to new location
- **AND** success SHALL be reported
- **AND** LSP diagnostics SHALL be collected for the new file location if a server is available
