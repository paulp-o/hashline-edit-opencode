<div align="center">

  <h1>⚡ HashLine Edit</h1>
  
  <p><strong>Precision file editing with content-hashed line anchors</strong></p>
  
  <p>
    <a href="#">
      <img src="https://img.shields.io/badge/version-0.1.0-blue?style=flat-square&labelColor=black" alt="Version">
    </a>
    <a href="#">
      <img src="https://img.shields.io/badge/tests-59%2F59%20passing-brightgreen?style=flat-square&labelColor=black" alt="Tests">
    </a>
    <a href="#">
      <img src="https://img.shields.io/badge/runtime-Bun-orange?style=flat-square&labelColor=black" alt="Runtime">
    </a>
    <a href="#">
      <img src="https://img.shields.io/badge/license-MIT-yellow?style=flat-square&labelColor=black" alt="License">
    </a>
  </p>
  
  <p>
    <em>An <a href="https://opencode.ai">OpenCode</a> plugin that makes AI file editing cryptographically verifiable</em>
  </p>

</div>

> **The Problem:** AI coding assistants are powerful—but they edit files blind. Line numbers shift. Files change between reads. The AI has no way to verify it's editing the *right* line.

> **The Solution:** HashLine Edit annotates every line with a **content-based hash**. The AI references lines by their hash, not just their number. Stale edits are caught *before* they're applied.

---

## 🎯 What Makes It Different

| Feature | Built-in Edit | HashLine Edit |
|:--------|:---:|:---:|
| **Content-verified anchors** | ❌ | ✅ |
| **Stale edit detection** | ❌ | ✅ |
| **Grep-to-edit shortcut** | ❌ | ✅ |
| **LSP diagnostics** | ✅ | ✅ *(experimental)* |
| **File creation, delete, move** | ✅ | ✅ |
| **Directory listing with line counts** | ❌ | ✅ |

---

## 🚀 Quick Start

### 1. Install the Plugin

In your OpenCode workspace:
```bash
cd .opencode
bun add hashline-edit-opencode
```

### 2. Configure in `opencode.json`

```json
{
  "plugins": {
    "hashline-edit": "./.opencode/node_modules/hashline-edit-opencode/dist/index.js"
  }
}
```

### 3. Start Using It

```
→ hashline_read src/index.ts

1#SW:import { useState } from 'react';
2#KM:
3#MM:export function Counter() {
4#PN:  const [count, setCount] = useState(0);
...
```

---

## 🔗 The HashLine Format

Every line becomes a **verifiable anchor** (`LINE#HASH:content`):

```
1#SW:import { useState } from 'react';
2#KM:
3#MM:export function Counter() {
4#PN:  const [count, setCount] = useState(0);
5#NS:  const timeout = 5000;
```

- **`1#SW`** — Line 1 with hash `SW`
- The hash is derived from **xxHash32** of the content + line number
- Symbol-only lines (like `}`, `//`) use line index as seed for differentiation

Edit by referencing the hash:
```json
{
  "path": "src/index.ts",
  "edits": [{
    "op": "replace",
    "pos": "5#NS",
    "lines": ["  const timeout = 3000;"]
  }]
}
```

**Hash mismatch?** The edit is rejected with a clear error. No silent corruption.

---

## 🔍 Three Powerful Tools

### `hashline_read` — See Everything

Read files with hashline annotations. Supports pagination for large files.

```
→ hashline_read src/lib/api.ts --offset 50 --limit 25

50#XY:export async function fetchUser(id: string) {
51#ZT:  const response = await fetch(`/api/users/${id}`);
...
```

Directories show a tree with line counts:
```
→ hashline_read src/lib

src/lib/
├── hashline-core.ts (267 lines)
├── hashline-edit.ts (412 lines)
└── lsp/
    ├── lsp-client.ts (330 lines)
    └── lsp-manager.ts (134 lines)
```

### `hashline_grep` — Search with Anchors

Search files and get results with LINE#HASH tags. Use them directly as edit anchors.

```
→ hashline_grep "useState" --include "*.tsx"

src/components/Counter.tsx:4#PN:>  const [count, setCount] = useState(0);
src/components/Form.tsx:7#BW:  const [value, setValue] = useState('');
```

**Grep-to-edit shortcut:** No intermediate `hashline_read` needed. Just grab `4#PN` and use it.

### `hashline_edit` — Verified Edits

Edit operations: `replace`, `append`, `prepend`. Plus file operations.

**Single-line replace:**
```json
{
  "path": "src/index.ts",
  "edits": [{
    "op": "replace",
    "pos": "5#NS",
    "lines": ["  const timeout = 3000;"]
  }]
}
```

**Range replace:**
```json
{
  "path": "src/index.ts",
  "edits": [{
    "op": "replace",
    "pos": "8#HY",
    "end": "12#JM",
    "lines": ["    <span>New content</span>"]
  }]
}
```

**File creation** (anchorless append):
```json
{
  "path": "src/new-file.ts",
  "edits": [{
    "op": "append",
    "lines": ["export const hello = 'world';"]
  }]
}
```

**File delete:**
```json
{
  "path": "src/old-file.ts",
  "delete": true
}
```

**File move:**
```json
{
  "path": "src/old-file.ts",
  "move": "src/new-location/file.ts"
}
```

---

## 🩺 LSP Diagnostics (Experimental)

Enable automatic diagnostics after every edit:
```bash
export EXPERIMENTAL_LSP_DIAGNOSTICS=true
```

Language servers are **not** started during OpenCode startup (only detected from your project and PATH); they connect **lazily** the first time diagnostics are needed, so the UI is not blocked on a hung or slow LSP `initialize`.

When enabled, `hashline_edit` automatically:
1. Spawns LSP servers configured in `opencode.json`
2. Sends the file to the LSP after each edit
3. Collects and formats diagnostics
4. Appends them directly to the response

**Example output:**
```
Applied edits to src/index.ts (+3 lines)
  replace 5#NS → 1 line(s)

<diagnostics file="src/index.ts">
ERROR [5:7] [typescript] Type 'string' is not assignable to type 'number'.
ERROR [6:17] [typescript] Argument of type 'number' is not assignable to parameter of type 'string'.
HINT [5:7] [typescript] 'value' is declared but its value is never read.
</diagnostics>
```

The AI sees errors immediately and can fix them in the next edit.

---

## ⚙️ Configuration

### `opencode.json` — LSP Servers

```json
{
  "lsp": {
    "typescript-language-server": {
      "command": ["typescript-language-server", "--stdio"],
      "extensions": [".ts", ".tsx", ".js", ".jsx"]
    },
    "pyright": {
      "command": ["pyright-langserver", "--stdio"],
      "extensions": [".py"]
    },
    "rust-analyzer": {
      "command": ["rust-analyzer"],
      "extensions": [".rs"]
    }
  }
}
```

### Environment Variables

| Variable | Description | Default |
|:---------|:------------|:-------:|
| `EXPERIMENTAL_LSP_DIAGNOSTICS` | Enable LSP diagnostics after edits | `false` |

---

## 🏗️ Architecture

> **How it works under the hood**

```
opencode.json (LSP config)
        │
        ▼
┌─────────────────────────────────────┐
│         HashLine Edit Plugin         │
│                                      │
│  hashline_read ──► LINE#HASH:content │
│  hashline_grep ──► Anchored search   │
│  hashline_edit ──► Verified edits    │
│       │                              │
│       ▼                              │
│  LSP Diagnostics (optional)          │
│  ┌──────────────────────┐            │
│  │ typescript-language-  │            │
│  │ server, pyright, etc. │            │
│  └──────────────────────┘            │
└─────────────────────────────────────┘
```

### The Hashing Algorithm

1. **xxHash32** of content + line number
2. 256-entry dictionary lookup → **2-character hash** per line
3. Symbol-only lines (`}`, `//`, ``) use line index as additional seed to differentiate identical-looking content at different positions

---

## 📋 System Prompt

The plugin injects a comprehensive system prompt that teaches the LLM:
- How to read hashline format
- How to construct edit operations with anchors
- Recovery procedures for hash mismatches
- 8 complete examples (single-line delete, range delete, clear, prepend, append, block replace, file delete, file move)

All example hashes are **computed at runtime** so they always match the actual algorithm.

---

## ❓ FAQ

<details>
<summary><strong>Why hashes instead of just line numbers?</strong></summary>

Line numbers are fragile. Insert a line above, and every reference below shifts. HashLine Edit verifies the *content* hasn't changed before applying any edit. Stale edits are caught immediately, not silently corrupted.
</details>

<details>
<summary><strong>What happens if a hash doesn't match?</strong></summary>

The edit is rejected with a clear error message: `Hash mismatch at line 5: expected "NS", got "AB"`. The LLM re-reads the file with fresh hashes and retries. No data is lost.
</details>

<details>
<summary><strong>Does this work with any language?</strong></summary>

Yes! The hashline format is language-agnostic. The LSP diagnostics feature works with any language server configured in `opencode.json` (TypeScript, Python, Rust, Go, etc.).
</details>

<details>
<summary><strong>Is there overhead for large files?</strong></summary>

Minimal. Hash computation uses xxHash32 (extremely fast). For large files, use `--offset` and `--limit` with `hashline_read` to paginate.
</details>

<details>
<summary><strong>Can I use this alongside OpenCode's built-in tools?</strong></summary>

No—this plugin *replaces* the built-in `read`, `edit`, and `grep` tools with hash-anchored versions. They're mutually exclusive by design.
</details>

---

## 📦 Installation (Development)

```bash
git clone https://github.com/your-username/hashline-edit-opencode.git
cd hashline-edit-opencode
bun install
bun run build
bun test
```

---

## 🧪 Testing

```bash
# Run all tests
bun test

# Type check
bun run typecheck

# Build
bun run build:all
```

**Test coverage:** 59 tests, 152 assertions, all passing.

---

## 🤝 Contributing

This is an early release. Issues and PRs welcome!

---

## 📄 License

MIT © [paulpark](https://github.com/paulpark)

---

<div align="center">

  <p><strong>Built with ⚡ for <a href="https://opencode.ai">OpenCode</a></strong></p>
  
  <p><em>Making AI file editing verifiable, one hash at a time.</em></p>

</div>