## ADDED Requirements

### Requirement: Project language detection
The system SHALL scan the project directory at plugin initialization to detect file extensions present in the project.

The system SHALL:
- Scan source files in the project directory tree at initialization time
- Map detected file extensions to known programming languages using a built-in registry
- Complete scanning within a reasonable time without blocking plugin initialization
- Support detection for: TypeScript, Python, Rust, Go, C/C++, Java, Ruby, PHP, C#, Swift, Kotlin, Scala, Zig, Vue, Svelte, Lua, YAML, CSS/SCSS, HTML, JSON, TOML, Markdown

#### Scenario: Project with Python files only
- **WHEN** the plugin initializes in a project containing only `.py` files
- **THEN** the system SHALL detect Python as the only language present
- **AND** the system SHALL record that Python files are present in the project

#### Scenario: Project with multiple languages
- **WHEN** the plugin initializes in a project containing `.ts`, `.py`, and `.rs` files
- **THEN** the system SHALL detect TypeScript, Python, and Rust as present languages
- **AND** the system SHALL record all three languages for LSP server consideration

#### Scenario: Empty project
- **WHEN** the plugin initializes in a project with no source files
- **THEN** the system SHALL detect no languages
- **AND** no LSP servers SHALL be considered for startup

#### Scenario: Project with only binary files
- **WHEN** the plugin initializes in a project containing only binary files (images, executables)
- **THEN** the system SHALL detect no recognized languages
- **AND** no LSP servers SHALL be considered for startup

### Requirement: LSP server discovery
The system SHALL maintain a built-in registry of known LSP servers and check for their availability in the system PATH.

The system SHALL:
- Maintain a registry mapping languages to their corresponding LSP server executables
- Check if LSP server executables exist in the system PATH for each detected language
- Perform PATH checks in a non-blocking manner
- Include servers for: TypeScript (typescript-language-server), Python (pylsp, pyright, or python-lsp-server), Rust (rust-analyzer), Go (gopls), C/C++ (clangd), Java (jdtls or java-language-server), Ruby (solargraph), PHP (intelephense or phpactor), C# (omnisharp), Swift (sourcekit-lsp), Kotlin (kotlin-language-server), Zig (zls), Vue (vue-language-server), Svelte (svelte-language-server), Lua (lua-language-server), YAML (yaml-language-server), CSS/SCSS (vscode-css-language-server), HTML (vscode-html-language-server), JSON (vscode-json-language-server), TOML (taplo), Markdown (marksman or unified-language-server)

#### Scenario: LSP server executable is in PATH
- **WHEN** the plugin detects Python files and `pylsp` is found in PATH
- **THEN** the system SHALL mark Python LSP server as available
- **AND** the system SHALL prepare to auto-start the Python LSP server

#### Scenario: LSP server executable is not in PATH
- **WHEN** the plugin detects Rust files but `rust-analyzer` is not found in PATH
- **THEN** the system SHALL mark Rust LSP server as unavailable
- **AND** the system SHALL record the missing server for user notification

#### Scenario: Multiple LSP servers found for a language
- **WHEN** the plugin detects Python files and both `pylsp` and `pyright` are found in PATH
- **THEN** the system SHALL select the first available server from its priority list
- **AND** the system SHALL prepare to auto-start the selected server

#### Scenario: No LSP servers found for any detected language
- **WHEN** the plugin detects TypeScript files but `typescript-language-server` is not in PATH
- **AND** no other detected languages have available LSP servers
- **THEN** the system SHALL mark all servers as unavailable
- **AND** the system SHALL prepare a notification listing all missing servers

### Requirement: Automatic LSP server startup
The system SHALL automatically start LSP servers that are both needed (language detected in project) AND available (executable found in PATH).

The system SHALL:
- Automatically start eligible LSP servers during plugin initialization
- Start servers without requiring any user configuration
- Handle server startup failures gracefully without blocking plugin functionality
- Continue plugin operation even if some or all LSP servers fail to start

#### Scenario: Successful auto-start of all detected servers
- **WHEN** the plugin detects Python files and `pylsp` is available in PATH
- **AND** the plugin initializes the LSP subsystem
- **THEN** the system SHALL automatically start the Python LSP server
- **AND** the server SHALL be ready to provide diagnostics

#### Scenario: Partial availability - some servers available, some not
- **WHEN** the plugin detects TypeScript and Python files
- **AND** `typescript-language-server` is in PATH but `pylsp` is not
- **THEN** the system SHALL auto-start the TypeScript LSP server
- **AND** the system SHALL skip starting the Python LSP server
- **AND** the plugin SHALL continue functioning normally

#### Scenario: LSP server crashes on startup
- **WHEN** the plugin attempts to auto-start an LSP server
- **AND** the server process crashes immediately
- **THEN** the system SHALL catch the error gracefully
- **AND** the plugin SHALL continue functioning without that server's diagnostics

#### Scenario: All detected servers fail to start
- **WHEN** the plugin detects multiple languages with available LSP servers
- **AND** all server startup attempts fail
- **THEN** the system SHALL handle all failures gracefully
- **AND** the plugin SHALL continue functioning without LSP diagnostics

### Requirement: User notification for missing servers
The system SHALL include an informational message in hashline_edit responses when LSP servers for detected languages are not available.

The system SHALL:
- Check which languages are present in the project but lack available LSP servers
- Include an informational message on the first hashline_edit response when servers are missing
- List the missing languages and suggest which server to install for each
- Only show notifications when the EXPERIMENTAL_LSP_DIAGNOSTICS environment variable is enabled

#### Scenario: All LSP servers available
- **WHEN** the plugin detects TypeScript files
- **AND** `typescript-language-server` is found in PATH and starts successfully
- **AND** the user performs a hashline_edit operation
- **THEN** no missing server notification SHALL be included in the response

#### Scenario: Some LSP servers missing
- **WHEN** the plugin detects Python and Rust files
- **AND** `pylsp` is not in PATH but `rust-analyzer` is
- **AND** the user performs the first hashline_edit operation
- **THEN** an informational message SHALL be appended to the response
- **AND** the message SHALL indicate that Python LSP server is missing
- **AND** the message SHALL suggest installing `pylsp` for Python support

#### Scenario: All LSP servers missing
- **WHEN** the plugin detects Go and Ruby files
- **AND** neither `gopls` nor `solargraph` are in PATH
- **AND** the user performs the first hashline_edit operation
- **THEN** an informational message SHALL be appended to the response
- **AND** the message SHALL list both missing servers
- **AND** the message SHALL suggest installing `gopls` for Go and `solargraph` for Ruby
