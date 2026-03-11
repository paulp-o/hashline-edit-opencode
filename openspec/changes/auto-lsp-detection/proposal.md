## Why

The current LSP diagnostics feature requires users to manually configure `opencode.json` with LSP server commands. This is brittle and limits adoption — users need to know which LSP servers exist, their exact command names, and how to configure them. By switching to automatic detection, we can provide out-of-the-box LSP support for any project without manual configuration, making the feature truly zero-config.

## What Changes

- **Remove** opencode.json/jsonc configuration reading — the plugin will no longer read LSP configuration from external config files
- **Add** automatic LSP server detection based on project file extensions — scan the project at plugin init to identify which languages are present
- **Add** PATH-based LSP server discovery — for each detected language, check if the corresponding LSP server executable exists in PATH
- **Auto-start** available LSP servers — automatically launch detected servers without user intervention
- **Support 16+ languages** automatically — TypeScript, Python, Rust, Go, C/C++, Java, Ruby, PHP, C#, Swift, Kotlin, Scala, Zig, Vue, Svelte, Lua, YAML, CSS/SCSS, HTML, JSON, TOML, Markdown
- **User notification** — show an info message on first hashline_edit response if LSP servers are missing or fail to start
- Keep `EXPERIMENTAL_LSP_DIAGNOSTICS` environment variable as the feature gate
- **No user override** — fully automatic, no configuration needed or allowed

## Capabilities

### New Capabilities
- `auto-lsp-detection`: Automatic discovery and launch of LSP servers based on project file types

### Modified Capabilities
- `hashline-tools`: LSP configuration source changes — no longer reads from opencode.json, instead uses auto-detected servers

## Impact

- Plugin initialization behavior — scans project files and attempts LSP server discovery
- LSP diagnostics behavior — servers are auto-detected rather than configured
- User experience — zero-config LSP support, but users see info messages when servers are unavailable
- Error handling — graceful degradation when LSP servers are not installed
