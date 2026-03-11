## Context

### Current State

The LSP diagnostics feature currently requires manual configuration via `opencode.json`:

- `src/index.ts` (lines 436-449): Reads `opencode.json` using `JSON.parse()` — no JSONC support
- `LspManager` receives configuration via `configure()` method with hardcoded TypeScript-only setup
- Users must know LSP server names, command-line arguments, and configure them correctly
- This creates friction and limits adoption

### Target State

Switch to **fully automatic LSP detection** based on project file types:
- Scan project files at plugin initialization
- Map file extensions to known LSP servers via built-in registry
- Check PATH for available LSP server executables
- Auto-start available servers without any user configuration
- Support 16+ programming languages out of the box

### Constraints

- Must work without any configuration files (opencode.json/jsonc reading removed entirely)
- Must gracefully handle missing LSP servers (not all users will have them installed)
- Must maintain existing `EXPERIMENTAL_LSP_DIAGNOSTICS` environment variable gate
- Plugin initialization should not be significantly delayed by file scanning

## Goals / Non-Goals

**Goals:**
- Enable zero-config LSP diagnostics for any project with supported languages
- Support 16+ languages: TypeScript, Python, Rust, Go, C/C++, Java, Ruby, PHP, C#, Swift, Kotlin, Zig, Vue, Svelte, Lua, YAML, CSS/SCSS, and more
- Automatically detect which languages are present in the project
- Check PATH for LSP server availability without blocking startup
- Auto-start available LSP servers in parallel
- Inform users when LSP servers are detected but not installed (with installation guidance)
- Remove all opencode.json/jsonc configuration reading code

**Non-Goals:**
- Recursive scanning of entire project directory (would be too slow)
- User-defined LSP server overrides (fully automatic only)
- Installing LSP servers automatically (user must have them in PATH)
- Supporting every possible LSP server variant (focused on most common ones)
- Language-specific LSP configuration (e.g., custom initialization options)

## Decisions

### 1. Project Scanning Strategy: Shallow Scan + Git Integration

**Decision:** Use a combination of shallow directory scanning and `git ls-files` (when available) to detect project file types.

**Rationale:**
- Recursive scanning of entire projects is slow and unnecessary
- Most projects have source files in predictable locations (root, src/, lib/, etc.)
- Git repositories provide fast file listing via `git ls-files`
- Shallow scan of common directories (root, src/, packages/*/) covers 90%+ of cases

**Alternatives Considered:**
- **Recursive glob of all files**: Rejected — too slow on large codebases (node_modules, etc.)
- **Lazy detection on first file access**: Rejected — would delay first diagnostic, poor UX
- **File watcher-based detection**: Rejected — adds complexity, benefits minimal

**Implementation:**
```typescript
// Priority order:
// 1. git ls-files (fastest, most accurate)
// 2. Shallow scan of root directory + common subdirs (src/, lib/, etc.)
// 3. Extract unique extensions from found files
```

### 2. Built-in LSP Server Registry

**Decision:** Maintain a hardcoded registry mapping languages to their standard LSP servers.

**Rationale:**
- LSP server names and arguments are de facto standardized
- No need for user configuration — these are the "official" servers
- Can be extended over time as new languages/servers become popular
- Simple, predictable, testable

**Registry Structure:**
```typescript
interface LspServerInfo {
  command: string[];      // e.g., ["typescript-language-server", "--stdio"]
  extensions: string[];   // e.g., [".ts", ".tsx", ".js", ".jsx"]
}

const LSP_REGISTRY: Record<string, LspServerInfo> = {
  typescript: { 
    command: ["typescript-language-server", "--stdio"], 
    extensions: [".ts", ".tsx", ".mjs", ".cjs", ".js", ".jsx"] 
  },
  python: { 
    command: ["pyright-langserver", "--stdio"], 
    extensions: [".py", ".pyi"] 
  },
  rust: { 
    command: ["rust-analyzer"], 
    extensions: [".rs"] 
  },
  go: { 
    command: ["gopls"], 
    extensions: [".go"] 
  },
  // ... 13+ more languages
}
```

**Alternatives Considered:**
- **External registry file**: Rejected — adds deployment complexity, no benefit
- **User-extensible registry**: Rejected — conflicts with zero-config goal
- **npm package for registry**: Rejected — unnecessary dependency

### 3. PATH Detection with Bun.which()

**Decision:** Use `Bun.which()` for fast, native PATH lookups.

**Rationale:**
- `Bun.which()` is the idiomatic way to find executables in Bun runtime
- Cross-platform (works on macOS, Linux, Windows)
- Non-blocking — returns `null` immediately if not found
- Can run checks in parallel for all detected languages

**Implementation Pattern:**
```typescript
const detections = await Promise.all(
  detectedLanguages.map(async (lang) => {
    const command = LSP_REGISTRY[lang].command[0];
    const path = await Bun.which(command);
    return { lang, available: path !== null, path };
  })
);
```

**Alternatives Considered:**
- **`which` npm package**: Rejected — unnecessary dependency, Bun has native support
- **Shelling out to `which`/`where`**: Rejected — slower, platform-specific
- **Checking common installation paths**: Rejected — fragile, doesn't respect PATH

### 4. LspManager Configuration Refactor

**Decision:** Replace `configure(config: LspConfig)` with `autoConfigure(projectRoot: string)`.

**Rationale:**
- Removes dependency on external configuration
- Encapsulates detection logic within LspManager
- Single entry point for initialization
- Easier to test (mock file system, mock Bun.which)

**New Interface:**
```typescript
class LspManager {
  async autoConfigure(projectRoot: string): Promise<LspDetectionResult> {
    // 1. Scan project files
    // 2. Map to languages
    // 3. Check PATH
    // 4. Start available servers
    // 5. Return detection summary
  }
  
  getDetectionResult(): LspDetectionResult | undefined;
}

interface LspDetectionResult {
  detected: Array<{ language: string; server: string; started: boolean }>;
  missing: Array<{ language: string; server: string; installHint: string }>;
}
```

**Alternatives Considered:**
- **Keep configure() with auto-generated config**: Rejected — unnecessary indirection
- **Separate AutoDetector class**: Rejected — adds complexity, LspManager is natural owner

### 5. User Notification Strategy

**Decision:** Show missing LSP servers once, on first hashline_edit response.

**Rationale:**
- Plugin init is too early — user hasn't seen any output yet
- First edit is when diagnostics would appear, so context is clear
- One-time notification avoids spam
- Info level (not warning) — missing LSP servers are expected, not errors

**Message Format:**
```
LSP diagnostics unavailable for: Python (pyright-langserver not found), Java (jdtls not found). 
Install these for enhanced diagnostics. See: https://hashline.dev/docs/lsp
```

**Alternatives Considered:**
- **Show at plugin init**: Rejected — clutters startup, user not ready for it
- **Show on every edit**: Rejected — too noisy
- **Show as warning**: Rejected — not an error, user may not want these servers

### 6. Complete Removal of opencode.json Reading

**Decision:** Delete lines 436-449 in src/index.ts entirely; do not attempt to read any opencode configuration.

**Rationale:**
- User explicitly requested this — the plugin should be self-contained
- Avoids confusion between old config method and new auto-detection
- Simplifies codebase (less code to maintain)
- Aligns with "it should just work" philosophy

**Code to Remove:**
```typescript
// REMOVE:
const configPath = join(process.cwd(), 'opencode.json');
const raw = await fs.readFile(configPath, 'utf-8');
const config = JSON.parse(raw);
if (config.lsp) {
  await lspManager.configure(config.lsp);
}
```

**Replace With:**
```typescript
// Auto-detect and start LSP servers
await lspManager.autoConfigure(process.cwd());
```

**Alternatives Considered:**
- **Keep as fallback**: Rejected — user wants it removed entirely
- **Keep for backward compat with deprecation warning**: Rejected — adds complexity, not requested

## Risks / Trade-offs

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **False positive detections** — scanning detects languages not actively used (e.g., `.d.ts` files in node_modules) | Medium | Medium | Exclude common directories (node_modules, .git, dist, build); use git ls-files when available |
| **Missing LSP servers slow down first edit** — if many servers are missing, PATH checks add latency | Low | Low | Parallelize PATH checks; Bun.which is fast (<10ms per check) |
| **LSP server crashes or hangs** — auto-started server may fail to initialize | Medium | Low | Add timeout (30s) to LSP server startup; catch errors, mark as failed, don't retry |
| **Project with many languages** — scanning and checking 10+ languages | Low | Low | PATH checks are parallel and fast; registry limits us to supported languages only |
| **Non-standard LSP servers** — user has installed a different server (e.g., pylsp instead of pyright) | Medium | Medium | Document supported servers; user can install the expected one; future: consider popular alternatives |
| **Breaking change for existing users** — users who configured opencode.json will lose LSP | High | Low | This is intentional per user request; feature is marked EXPERIMENTAL, so breaking changes are acceptable |
| **Windows compatibility** — Bun.which and server names may differ | Medium | Medium | Test on Windows; most servers use same name, but document any differences |

## Migration Plan

### Phase 1: Implementation (this change)
1. Implement file scanning in `LspManager.autoConfigure()`
2. Create `LSP_REGISTRY` with 16+ language mappings
3. Add PATH detection using `Bun.which()`
4. Modify startup flow in `src/index.ts`
5. Add user notification for missing servers
6. Remove opencode.json reading code
7. Add tests for detection logic

### Phase 2: Validation
1. Test on projects with each supported language
2. Test with missing servers (graceful degradation)
3. Test on Windows (if available)
4. Test on large repositories (performance)

### Phase 3: Rollback (if needed)
If critical issues arise:
1. Revert commit to restore opencode.json reading
2. Disable auto-detection via feature flag
3. Restore previous behavior

## Open Questions

1. **Scala support** — The Scala LSP ecosystem has multiple options (Metals is most common). Which should we prioritize?
   - *Tentative*: Metals as primary, document alternative

2. **HTML/XML support** — vscode-html-language-server is available but less commonly installed. Include in registry?
   - *Tentative*: Include, low cost if not installed

3. **TOML support** — taplo is the main TSP LSP. Worth including?
   - *Tentative*: Include for Cargo.toml, pyproject.toml users

4. **Markdown support** — marksman and remark-language-server exist. Useful for this use case?
   - *Tentative*: Defer — less relevant for code diagnostics

5. **Should we cache detection results?** — If a project adds a new language, we'd need to restart to detect it.
   - *Tentative*: No caching for now — detection is fast, and language changes are rare
