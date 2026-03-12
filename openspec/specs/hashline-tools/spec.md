## ADDED Requirements

### Requirement: hashline_read Tool
The system SHALL provide a tool to read files with hashline annotations.

Parameters:
- `filePath` (required string): path to file or directory
- `offset` (optional number, 1-indexed): starting line number
- `limit` (optional number, default 2000): maximum lines to return
- `diagnostics` (optional boolean, default false): include LSP diagnostics in output

Output: each line formatted as `LINE#HASH:content`

#### Scenario: Read file with hashlines
- **WHEN** calling hashline_read with filePath="src/app.ts"
- **THEN** each line SHALL be formatted as `N#HASH:content`
- **AND** all lines SHALL include computed hashes

#### Scenario: Read with offset and limit
- **WHEN** calling hashline_read with offset=10, limit=5
- **THEN** only lines 10-14 SHALL be returned
- **AND** line numbers SHALL reflect actual file positions (10, 11, 12, 13, 14)

#### Scenario: Read directory
- **WHEN** calling hashline_read with filePath="src/"
- **THEN** a tree listing SHALL be returned
- **AND** each entry SHALL include file name and line count

#### Scenario: Read binary file
- **WHEN** calling hashline_read with a binary file (contains null bytes in first 8KB)
- **THEN** an error message SHALL be returned
- **AND** the error SHALL suggest using built-in read for binary files

#### Scenario: Read image/PDF
- **WHEN** calling hashline_read with an image or PDF file
- **THEN** an error message SHALL be returned
- **AND** the error SHALL suggest using built-in tools

#### Scenario: Truncate long lines
- **WHEN** calling hashline_read with a file containing lines >2000 characters
- **THEN** those lines SHALL be truncated to 2000 characters
- **AND** a truncation indicator SHALL be appended

#### Scenario: Read missing file
- **WHEN** calling hashline_read with a non-existent filePath
- **THEN** a helpful error message SHALL be returned
- **AND** the error SHALL indicate file not found

#### Scenario: Read with diagnostics
- **WHEN** calling hashline_read with filePath="src/app.ts", diagnostics=true
- **AND** LSP diagnostics feature is enabled
- **THEN** the hashline-annotated content SHALL be returned
- **AND** LSP diagnostics (errors/warnings) for the file SHALL be appended to the output
- **AND** diagnostics SHALL be formatted in XML format matching hashline_edit output

### Requirement: hashline_edit Tool
The system SHALL provide a tool to edit files using hashline references.

Parameters:
- `path` (required string): file path
- `edits` (required array): edit operations
- `delete` (optional boolean): delete file if true
- `move` (optional string): new path to move file to

Edit op schema: `{op: "replace"|"append"|"prepend", pos?: string, end?: string, lines: string[]|string|null}`

#### Scenario: Successful edit
- **WHEN** calling hashline_edit with valid path and edits
- **THEN** the file SHALL be modified according to edit operations
- **AND** success message SHALL include line count delta

#### Scenario: Hash mismatch error
- **WHEN** calling hashline_edit with a mismatched hash reference
- **THEN** HashlineMismatchError SHALL be returned
- **AND** error details SHALL include expected vs actual hashes

#### Scenario: File creation via append
- **WHEN** calling hashline_edit with path to non-existent file and append operation
- **THEN** a new file SHALL be created with the appended content
- **AND** success SHALL be reported

#### Scenario: File deletion
- **WHEN** calling hashline_edit with delete=true
- **THEN** the file SHALL be deleted
- **AND** success SHALL be reported

#### Scenario: File move
- **WHEN** calling hashline_edit with move="new/path.ts"
- **THEN** the file SHALL be moved to new location
- **AND** success SHALL be reported

### Requirement: hashline_grep Tool
The system SHALL provide a tool to search files with hashline-annotated results.

Parameters:
- `pattern` (required string): search pattern
- `path` (optional string): directory or file to search
- `include` (optional string): file pattern filter (e.g., "*.ts")
- `context` (optional number, default 2): lines of context around matches

Internal: execute ripgrep via `Bun.$` shell, then annotate results with hashlines

#### Scenario: Basic search
- **WHEN** calling hashline_grep with pattern="function"
- **THEN** matching lines SHALL be returned with hashline tags
- **AND** match lines SHALL have `>` prefix

#### Scenario: Search with include filter
- **WHEN** calling hashline_grep with pattern="class", include="*.ts"
- **THEN** only TypeScript files SHALL be searched
- **AND** results SHALL include hashline annotations

#### Scenario: Search with path
- **WHEN** calling hashline_grep with pattern="TODO", path="src/"
- **THEN** only files under src/ SHALL be searched
- **AND** results SHALL include hashline annotations

#### Scenario: Search with custom context
- **WHEN** calling hashline_grep with pattern="export", context=5
- **THEN** 5 lines of context SHALL be shown before and after each match
- **AND** all context lines SHALL include hashline tags

#### Scenario: No results
- **WHEN** calling hashline_grep with pattern that matches nothing
- **THEN** an empty result set SHALL be returned
- **AND** a "no matches found" message SHALL be included

#### Scenario: Ripgrep fallback
- **WHEN** ripgrep is unavailable
- **THEN** fs-based search SHALL be used as fallback
- **AND** results SHALL still include hashline annotations

### Requirement: Plugin Registration
The system SHALL register all tools via the OpenCode plugin system.

The system SHALL:
- Export a `Plugin` function from `.opencode/plugins/hashline-edit.ts`
- Use `tool()` from `@opencode-ai/plugin` for tool definitions
- Use `tool.schema.string()`, `tool.schema.number()`, etc. for parameter schemas

#### Scenario: Plugin loads successfully
- **WHEN** OpenCode loads the hashline-edit plugin
- **THEN** no errors SHALL be thrown
- **AND** the plugin SHALL be registered

#### Scenario: Tools are available to LLM
- **WHEN** the plugin is loaded
- **THEN** hashline_read SHALL be available as a tool
- **AND** hashline_edit SHALL be available as a tool
- **AND** hashline_grep SHALL be available as a tool
