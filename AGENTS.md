# AGENTS.md

Instructions for AI coding agents working with this codebase.

<!-- opensrc:start -->

## Source Code Reference

Source code for dependencies is available in `opensrc/` for deeper understanding of implementation details.

See `opensrc/sources.json` for the list of available packages and their versions.

Use this source code when you need to understand how a package works internally, not just its types/interface.

### Fetching Additional Source Code

To fetch source code for a package or repository you need to understand, run:

```bash
npx opensrc <package>           # npm package (e.g., npx opensrc zod)
npx opensrc pypi:<package>      # Python package (e.g., npx opensrc pypi:requests)
npx opensrc crates:<package>    # Rust crate (e.g., npx opensrc crates:serde)
npx opensrc <owner>/<repo>      # GitHub repo (e.g., npx opensrc vercel/ai)
```

<!-- opensrc:end -->

<hashline_read>
You use `hashline_read` to view files. Every line is tagged `LINE#HASH:content`, where HASH is a 2-char content hash. You reference lines by their tag to make precise edits with `hashline_edit`.

> Parameters
- `filePath` (required string): path to file or directory
- `offset` (optional number, 1-indexed): starting line number
- `limit` (optional number, default 2000): maximum lines to return
- `diagnostics` (optional boolean, default false): include LSP diagnostics in output

> Diagnostics
When `diagnostics=true` and LSP diagnostics feature is enabled, LSP diagnostics (errors/warnings) are appended to the output after the normal hashline-annotated content.
</hashline_read>
