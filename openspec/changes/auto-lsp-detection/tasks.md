## 1. Remove opencode.json Configuration Reading

- [x] 1.1 Remove lines 436-449 from `src/index.ts` that read opencode.json using `JSON.parse()`
- [x] 1.2 Remove unused imports (`fs`, `join`) if no longer needed elsewhere in index.ts

## 2. Add LSP Registry Types

- [x] 2.1 Add `LspServerInfo` interface to `src/lib/lsp/types.ts` with `{ command: string[]; extensions: string[] }`
- [x] 2.2 Add `LspDetectionResult` interface to `src/lib/lsp/types.ts` with `{ detected: Array<...>; missing: Array<...>; }`
- [x] 2.3 Export new types from `src/lib/lsp/types.ts`

## 3. Create LSP Server Registry

- [x] 3.1 Add `LSP_REGISTRY: Record<string, LspServerInfo>` constant to `src/lib/lsp/types.ts`
- [x] 3.2 Add TypeScript entry: `{ command: ["typescript-language-server", "--stdio"], extensions: [".ts", ".tsx", ".mjs", ".cjs", ".js", ".jsx"] }`
- [x] 3.3 Add Python entry: `{ command: ["pyright-langserver", "--stdio"], extensions: [".py", ".pyi"] }`
- [x] 3.4 Add Rust entry: `{ command: ["rust-analyzer"], extensions: [".rs"] }`
- [x] 3.5 Add Go entry: `{ command: ["gopls"], extensions: [".go"] }`
- [x] 3.6 Add C/C++ entry: `{ command: ["clangd"], extensions: [".c", ".cpp", ".cc", ".cxx", ".h", ".hpp"] }`
- [x] 3.7 Add Java entry: `{ command: ["jdtls"], extensions: [".java"] }`
- [x] 3.8 Add Ruby entry: `{ command: ["solargraph", "stdio"], extensions: [".rb", ".erb"] }`
- [x] 3.9 Add PHP entry: `{ command: ["intelephense", "--stdio"], extensions: [".php"] }`
- [x] 3.10 Add C# entry: `{ command: ["omnisharp"], extensions: [".cs"] }`
- [x] 3.11 Add Swift entry: `{ command: ["sourcekit-lsp"], extensions: [".swift"] }`
- [x] 3.12 Add Kotlin entry: `{ command: ["kotlin-language-server"], extensions: [".kt", ".kts"] }`
- [x] 3.13 Add Scala entry: `{ command: ["metals"], extensions: [".scala", ".sbt"] }`
- [x] 3.14 Add Zig entry: `{ command: ["zls"], extensions: [".zig"] }`
- [x] 3.15 Add Vue entry: `{ command: ["vue-language-server", "--stdio"], extensions: [".vue"] }`
- [x] 3.16 Add Svelte entry: `{ command: ["svelte-language-server", "--stdio"], extensions: [".svelte"] }`
- [x] 3.17 Add Lua entry: `{ command: ["lua-language-server"], extensions: [".lua"] }`
- [x] 3.18 Add YAML entry: `{ command: ["yaml-language-server", "--stdio"], extensions: [".yml", ".yaml"] }`
- [x] 3.19 Add CSS/SCSS entry: `{ command: ["vscode-css-language-server", "--stdio"], extensions: [".css", ".scss", ".sass", ".less"] }`
- [x] 3.20 Add HTML entry: `{ command: ["vscode-html-language-server", "--stdio"], extensions: [".html", ".htm"] }`
- [x] 3.21 Add JSON entry: `{ command: ["vscode-json-language-server", "--stdio"], extensions: [".json", ".jsonc"] }`
- [x] 3.22 Add TOML entry: `{ command: ["taplo", "lsp", "stdio"], extensions: [".toml"] }`

## 4. Implement Project File Scanning

- [x] 4.1 Add `scanProjectFiles(projectRoot: string): Promise<Set<string>>` method to `LspManager` class in `src/lib/lsp/lsp-manager.ts`
- [x] 4.2 Implement git-based scanning: try `git ls-files` first via `Bun.spawn()`, parse output for file extensions
- [x] 4.3 Implement fallback shallow scan: read root directory + common subdirs (src/, lib/, packages/*/) using `Bun.file()` or `fs`
- [x] 4.4 Exclude common directories: node_modules, .git, dist, build, .next, out, coverage
- [x] 4.5 Extract unique file extensions from found files and return as Set

## 5. Implement PATH Detection

- [x] 5.1 Add `checkServerAvailability(languages: Set<string>): Promise<Array<{lang: string, available: boolean, path: string | null}>>` to `LspManager`
- [x] 5.2 Implement parallel PATH checks using `Bun.which()` for each detected language's server command
- [x] 5.3 Handle multiple server options per language (e.g., Python: try pylsp first, then pyright-langserver)
- [x] 5.4 Return detection results with language, server name, availability status, and executable path

## 6. Refactor LspManager Configuration

- [x] 6.1 Remove or deprecate `configure(config: LspConfig)` method from `LspManager`
- [x] 6.2 Add `autoConfigure(projectRoot: string): Promise<LspDetectionResult>` method to `LspManager`
- [x] 6.3 Call `scanProjectFiles()` inside `autoConfigure()` to detect languages
- [x] 6.4 Call `checkServerAvailability()` inside `autoConfigure()` for detected languages
- [x] 6.5 Auto-start available LSP servers inside `autoConfigure()` with timeout handling (30s)
- [x] 6.6 Store detection result internally in `LspManager` for later retrieval via `getDetectionResult()`
- [x] 6.7 Add `getDetectionResult(): LspDetectionResult | undefined` method to `LspManager`

## 7. Update Plugin Initialization Flow

- [x] 7.1 Replace config reading code in `src/index.ts` with call to `await lspManager.autoConfigure(process.cwd())`
- [x] 7.2 Store detection result in plugin state for use in hashline_edit tool
- [x] 7.3 Ensure initialization doesn't block on missing servers (graceful degradation)

## 8. Add User Notification for Missing Servers

- [x] 8.1 Add `hasNotifiedMissingServers` boolean flag to track if notification was already shown
- [x] 8.2 Modify `hashline_edit` tool handler in `src/index.ts` to check `lspManager.getDetectionResult()`
- [x] 8.3 Build notification message listing missing languages and suggested install commands
- [x] 8.4 Append notification message to first hashline_edit response only when servers are missing
- [x] 8.5 Ensure notification only shows when `EXPERIMENTAL_LSP_DIAGNOSTICS` environment variable is set

## 9. Add Tests for Auto-Detection Logic

- [x] 9.1 Create `src/tests/lsp/project-scanning.test.ts` with tests for file extension extraction
- [x] 9.2 Test git-based scanning when `.git` directory exists
- [x] 9.3 Test fallback shallow scanning when git is not available
- [x] 9.4 Test exclusion of node_modules, .git, and other ignored directories
- [x] 9.5 Test multi-language detection (TypeScript + Python + Rust in same project)
- [x] 9.6 Test empty project (no source files detected)

## 10. Add Tests for PATH Detection

- [x] 10.1 Create `src/tests/lsp/path-detection.test.ts` with mocked `Bun.which()`
- [x] 10.2 Test server availability when executable is in PATH
- [x] 10.3 Test server unavailability when executable is not in PATH
- [x] 10.4 Test priority selection when multiple servers available for same language
- [x] 10.5 Test parallel detection performance with many languages

## 11. Add Tests for Registry

- [x] 11.1 Create `src/tests/lsp/registry.test.ts` to verify LSP_REGISTRY structure
- [x] 11.2 Test that all registry entries have required fields (command, extensions)
- [x] 11.3 Test that no extension is duplicated across different languages
- [x] 11.4 Test that all commands have at least one element

## 12. Update Integration Tests

- [x] 12.1 Update `src/tests/lsp/lsp-diagnostics.test.ts` to use auto-detection instead of manual config
- [x] 12.2 Remove any tests that expect opencode.json configuration
- [x] 12.3 Add integration test for full auto-detection flow: scan → detect → start → diagnostics

## 13. Update Existing LSP Tests

- [x] 13.1 Search for any tests referencing `configure()` method and update to use `autoConfigure()`
- [x] 13.2 Search for any tests with mock opencode.json and remove those mocks
- [x] 13.3 Ensure all LSP-related tests pass after changes

## 14. Documentation and Final Verification

- [x] 14.1 Run full test suite: `bun test` or equivalent
- [x] 14.2 Verify no TypeScript compilation errors: `tsc --noEmit`
- [x] 14.3 Manual test: Initialize plugin in TypeScript project without opencode.json
- [x] 14.4 Manual test: Verify notification appears on first edit when servers are missing
- [x] 14.5 Manual test: Verify no notification when all servers are available
