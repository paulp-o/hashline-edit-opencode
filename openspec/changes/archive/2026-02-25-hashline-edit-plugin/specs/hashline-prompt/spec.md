## ADDED Requirements

### Requirement: Runtime Prompt Rendering
The system SHALL render the system prompt at runtime using a `renderHashlineEditPrompt()` function.

The function SHALL:
- Use `computeLineHash()` to generate accurate hash examples in the prompt
- Provide `hlinefull(lineNum, content)` helper that returns `LINE#HASH:content` format
- Provide `hlineref(lineNum, content)` helper that returns `"LINE#HASH"` format for anchors
- Ensure prompt examples contain hashes matching the actual algorithm output

#### Scenario: Rendered prompt contains valid hashes matching computeLineHash output
- **WHEN** `renderHashlineEditPrompt()` is called
- **THEN** all hash examples in the prompt SHALL use `computeLineHash()` output
- **AND** hashes SHALL match what `hashline_read` would produce for the same content

#### Scenario: hlinefull produces N#XX:content format
- **WHEN** `hlinefull(23, "  const timeout = 5000;")` is called
- **THEN** it SHALL return a string like `23#XY:  const timeout = 5000;`
- **AND** `#XY` SHALL be the computed hash of the normalized content

#### Scenario: hlineref produces N#XX format
- **WHEN** `hlineref(23, "  const timeout = 5000;")` is called  
- **THEN** it SHALL return a string like `"23#XY"`
- **AND** `#XY` SHALL match the hash in `hlinefull` for the same inputs

### Requirement: System Prompt Content
The system SHALL provide a system prompt that teaches the LLM the hashline format.

The prompt SHALL be based on oh-my-pi's `hashline.md` with minimal modifications:
- Structure: `<workflow>` → `<operations>` → `<rules>` → `<recovery>` → Examples (8) → `<critical>`
- Tool names changed from generic to plugin-specific:
  - `read` → `hashline_read`
  - `edit` → `hashline_edit`
  - `grep` → `hashline_grep`
- Added grep-to-edit shortcut as workflow item #2
- All other content preserved exactly

The prompt MUST explain:
- The `LINE#HASH:content` format
- All three edit operations (replace, append, prepend)
- The pos/end anchor format (`"N#ID"`)
- Lines parameter variants (array, string, null, [])
- Workflow instructions (4 steps with grep-to-edit shortcut)
- Recovery rules (tag mismatch retry, no-op handling)
- 8 practical examples rendered with runtime-computed hashes

#### Scenario: Prompt contains format explanation
- **WHEN** the system prompt is rendered
- **THEN** it SHALL explain that lines are formatted as `LINE#HASH:content`
- **AND** it SHALL explain that HASH is a 2-character content hash
- **AND** it SHALL explain that tags are stable for unchanged content

#### Scenario: Prompt contains operation descriptions
- **WHEN** the system prompt is rendered
- **THEN** it SHALL describe replace operation with single and range variants
- **AND** it SHALL describe append operation (after anchor line)
- **AND** it SHALL describe prepend operation (before anchor line)
- **AND** it SHALL describe file-level delete and move operations

#### Scenario: Prompt contains anchor format explanation
- **WHEN** the system prompt is rendered
- **THEN** it SHALL explain the `"N#ID"` format for referencing lines
- **AND** it SHALL explain that N is the line number and ID is the hash
- **AND** it SHALL provide examples using `hlineref()` output format

#### Scenario: Prompt contains lines parameter variants
- **WHEN** the system prompt is rendered
- **THEN** it SHALL explain that `lines` can be an array of strings
- **AND** it SHALL explain that `lines: []` or `lines: null` means delete
- **AND** it SHALL explain that `lines: [""]` clears a line
- **AND** it SHALL explain that string shorthand `"single"` means `["single"]`

#### Scenario: Prompt contains workflow instructions
- **WHEN** the system prompt is rendered
- **THEN** it SHALL instruct to call `hashline_read` or `hashline_grep` before editing
- **AND** it SHALL explain grep-to-edit shortcut (workflow step #2)
- **AND** it SHALL instruct to batch all edits to a file into one `hashline_edit` call
- **AND** it SHALL instruct to re-read before subsequent edits to the same file
- **AND** it SHALL note that edits apply bottom-up (preserving earlier tags)

#### Scenario: Prompt contains recovery rules
- **WHEN** the system prompt is rendered
- **THEN** it SHALL explain how to handle tag mismatch errors (re-read and retry)
- **AND** it SHALL explain no-op detection
- **AND** it SHALL explain that operations near changed content should be simplified

#### Scenario: Prompt contains 8 practical examples
- **WHEN** the system prompt is rendered
- **THEN** it SHALL include exactly 8 examples with runtime-computed hashes
- **AND** example 1 SHALL demonstrate single-line delete (lines: null)
- **AND** example 2 SHALL demonstrate range delete (lines: null with end)
- **AND** example 3 SHALL demonstrate clear line (lines: [""])
- **AND** example 4 SHALL demonstrate prepend operation
- **AND** example 5 SHALL demonstrate append operation  
- **AND** example 6 SHALL demonstrate block replace (replace with end)
- **AND** example 7 SHALL demonstrate file delete (delete: true)
- **AND** example 8 SHALL demonstrate file move (move: "new/path")
- **AND** all examples SHALL use `hlinefull()` and `hlineref()` helpers for hashes

### Requirement: Tool Descriptions
The system SHALL provide descriptive text for each tool's description field.

The descriptions MUST:
- hashline_read: explain hashline output format
- hashline_edit: explain edit operations and anchor format
- hashline_grep: explain hashline-annotated search results

#### Scenario: hashline_read description
- **WHEN** the hashline_read tool is registered
- **THEN** its description SHALL explain that output includes LINE#HASH prefixes
- **AND** it SHALL mention offset and limit parameters for large files

#### Scenario: hashline_edit description
- **WHEN** the hashline_edit tool is registered
- **THEN** its description SHALL explain the three edit operations
- **AND** it SHALL explain the anchor format ("N#ID")
- **AND** it SHALL mention hash verification

#### Scenario: hashline_grep description
- **WHEN** the hashline_grep tool is registered
- **THEN** its description SHALL explain that results include hashline tags
- **AND** it SHALL explain the context parameter for surrounding lines

### Requirement: System Prompt Injection
The system SHALL inject hashline instructions into the LLM system prompt.

The system SHALL:
- Call `renderHashlineEditPrompt()` at runtime to generate the prompt content
- Use plugin hook mechanism for injection (if available)
- Fall back to tool descriptions only if hook unavailable
- Use pure TypeScript string interpolation (no external template engine)

#### Scenario: Prompt rendered at runtime and injected via hook
- **WHEN** the plugin has access to agent initialization hook
- **THEN** `renderHashlineEditPrompt()` SHALL be called to generate the prompt
- **AND** the rendered prompt SHALL be injected into system prompt
- **AND** the prompt SHALL contain accurate hashes computed via `computeLineHash()`

#### Scenario: Prompt rendering uses no external template engine
- **WHEN** `renderHashlineEditPrompt()` is called
- **THEN** it SHALL use TypeScript template literals only
- **AND** it SHALL NOT depend on Handlebars or other external template engines
- **AND** helper functions `hlinefull()` and `hlineref()` SHALL be pure TypeScript

#### Scenario: Fallback to description only
- **WHEN** plugin hook is unavailable
- **THEN** tool descriptions SHALL include comprehensive hashline instructions
- **AND** the LLM SHALL still understand the hashline format
