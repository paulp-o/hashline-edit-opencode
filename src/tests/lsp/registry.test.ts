import { describe, it, expect } from "bun:test";
import { LSP_REGISTRY } from "../../lib/lsp/types";
import type { LspServerInfo } from "../../lib/lsp/types";

describe("LSP_REGISTRY", () => {
  const registryEntries = Object.entries(LSP_REGISTRY);

  // ── 11.1: Verify LSP_REGISTRY structure — all entries are valid LspServerInfo objects ──

  it("is a non-empty record of LspServerInfo objects", () => {
    expect(registryEntries.length).toBeGreaterThan(0);
  });

  it("every entry is a valid LspServerInfo with command and extensions", () => {
    for (const [language, info] of registryEntries) {
      expect(info).toBeDefined();
      expect(Array.isArray(info.command)).toBe(true);
      expect(Array.isArray(info.extensions)).toBe(true);
    }
  });

  // ── 11.2: Each entry has required fields (command array, extensions array) ──

  it("every entry has a non-empty command array", () => {
    for (const [language, info] of registryEntries) {
      expect(info.command.length).toBeGreaterThan(0);
      // Each element in the command should be a non-empty string
      for (const part of info.command) {
        expect(typeof part).toBe("string");
        expect(part.length).toBeGreaterThan(0);
      }
    }
  });

  it("every entry has a non-empty extensions array", () => {
    for (const [language, info] of registryEntries) {
      expect(info.extensions.length).toBeGreaterThan(0);
    }
  });

  // ── 11.3: No extension is duplicated across different language entries ──

  it("no file extension appears in more than one language entry", () => {
    const seen = new Map<string, string>(); // ext → language
    for (const [language, info] of registryEntries) {
      for (const ext of info.extensions) {
        const existing = seen.get(ext);
        if (existing) {
          // This will fail with a helpful message showing exactly which extensions conflict
          expect(`${ext} in "${language}"`).toBe(
            `unique (already in "${existing}")`,
          );
        }
        seen.set(ext, language);
      }
    }
  });

  // ── 11.4: All commands have at least one element ──

  it("all commands have at least one element (the executable)", () => {
    for (const [language, info] of registryEntries) {
      expect(info.command.length).toBeGreaterThanOrEqual(1);
    }
  });

  // ── Additional: Verify known languages are present ──

  it("contains entries for all expected languages", () => {
    const expectedLanguages = [
      "typescript",
      "python",
      "rust",
      "go",
      "c-cpp",
      "java",
      "ruby",
      "php",
      "csharp",
      "swift",
      "kotlin",
      "scala",
      "zig",
      "vue",
      "svelte",
      "lua",
    ];
    for (const lang of expectedLanguages) {
      expect(LSP_REGISTRY[lang]).toBeDefined();
    }
  });

  it("has at least 16 language entries", () => {
    expect(registryEntries.length).toBeGreaterThanOrEqual(16);
  });

  // ── Additional: Verify all extensions start with "." ──

  it("all extensions start with a dot", () => {
    for (const [language, info] of registryEntries) {
      for (const ext of info.extensions) {
        expect(ext.startsWith(".")).toBe(true);
      }
    }
  });

  it("all extensions are lowercase", () => {
    for (const [language, info] of registryEntries) {
      for (const ext of info.extensions) {
        expect(ext).toBe(ext.toLowerCase());
      }
    }
  });

  // ── Additional: Verify well-known server commands ──

  it("typescript uses typescript-language-server", () => {
    expect(LSP_REGISTRY["typescript"].command[0]).toBe(
      "typescript-language-server",
    );
  });

  it("python uses pyright-langserver", () => {
    expect(LSP_REGISTRY["python"].command[0]).toBe("pyright-langserver");
  });

  it("rust uses rust-analyzer", () => {
    expect(LSP_REGISTRY["rust"].command[0]).toBe("rust-analyzer");
  });

  it("go uses gopls", () => {
    expect(LSP_REGISTRY["go"].command[0]).toBe("gopls");
  });

  // ── Additional: Verify TypeScript handles common extensions ──

  it("typescript entry covers .ts, .tsx, .js, .jsx", () => {
    const tsExts = LSP_REGISTRY["typescript"].extensions;
    expect(tsExts).toContain(".ts");
    expect(tsExts).toContain(".tsx");
    expect(tsExts).toContain(".js");
    expect(tsExts).toContain(".jsx");
  });
});
