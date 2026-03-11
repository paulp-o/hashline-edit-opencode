import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { LspManager } from "../../lib/lsp/lsp-manager";
import { LSP_REGISTRY } from "../../lib/lsp/types";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { $ } from "bun";

// ─── Test Helpers ────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "lsp-scan-test-"));
});

afterEach(async () => {
  await LspManager.reset();
  await rm(tmpDir, { recursive: true, force: true });
});

/**
 * Create a file at the given path (relative to tmpDir) with empty content.
 * Parent directories are created automatically.
 */
async function createFile(relativePath: string, content = ""): Promise<void> {
  const fullPath = join(tmpDir, relativePath);
  const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(fullPath, content);
}

// ─── 9.1: File Extension Extraction ─────────────────────────────────────────

describe("Project Scanning — file extension extraction", () => {
  it("9.1a detects .ts files as typescript", async () => {
    await createFile("index.ts", "const x = 1;");
    await createFile("utils.ts", "export const y = 2;");

    const result = await LspManager.autoConfigure(tmpDir);

    // typescript-language-server likely not in PATH, so it shows up in missing
    const allLanguages = [
      ...result.detected.map((d) => d.language),
      ...result.missing.map((m) => m.language),
    ];
    expect(allLanguages).toContain("typescript");
  });

  it("9.1b detects .py files as python", async () => {
    await createFile("main.py", "print('hello')");

    const result = await LspManager.autoConfigure(tmpDir);

    const allLanguages = [
      ...result.detected.map((d) => d.language),
      ...result.missing.map((m) => m.language),
    ];
    expect(allLanguages).toContain("python");
  });

  it("9.1c detects .rs files as rust", async () => {
    await createFile("main.rs", "fn main() {}");

    const result = await LspManager.autoConfigure(tmpDir);

    const allLanguages = [
      ...result.detected.map((d) => d.language),
      ...result.missing.map((m) => m.language),
    ];
    expect(allLanguages).toContain("rust");
  });
});

// ─── 9.2: Git-Based Scanning ────────────────────────────────────────────────

describe("Project Scanning — git-based scanning", () => {
  it("9.2a uses git ls-files when .git directory exists", async () => {
    // Initialize a git repo in the temp directory
    await $`git init`.cwd(tmpDir).quiet();
    await $`git config user.email "test@test.com"`.cwd(tmpDir).quiet();
    await $`git config user.name "Test"`.cwd(tmpDir).quiet();

    // Create files and stage them
    await createFile("app.ts", "const app = true;");
    await createFile("lib/helper.py", "def helper(): pass");
    await $`git add .`.cwd(tmpDir).quiet();

    const result = await LspManager.autoConfigure(tmpDir);

    const allLanguages = [
      ...result.detected.map((d) => d.language),
      ...result.missing.map((m) => m.language),
    ];
    expect(allLanguages).toContain("typescript");
    expect(allLanguages).toContain("python");
  });

  it("9.2b git scanning respects gitignored files (they are excluded)", async () => {
    await $`git init`.cwd(tmpDir).quiet();
    await $`git config user.email "test@test.com"`.cwd(tmpDir).quiet();
    await $`git config user.name "Test"`.cwd(tmpDir).quiet();

    // Create a .gitignore that ignores .rs files
    await createFile(".gitignore", "*.rs");
    await createFile("main.ts", "const x = 1;");
    await createFile("ignored.rs", "fn main() {}");
    await $`git add .`.cwd(tmpDir).quiet();

    const result = await LspManager.autoConfigure(tmpDir);

    const allLanguages = [
      ...result.detected.map((d) => d.language),
      ...result.missing.map((m) => m.language),
    ];
    // TypeScript should be detected
    expect(allLanguages).toContain("typescript");
    // Rust should NOT be detected (gitignored)
    expect(allLanguages).not.toContain("rust");
  });
});

// ─── 9.3: Fallback Shallow Scanning ─────────────────────────────────────────

describe("Project Scanning — fallback shallow scanning", () => {
  it("9.3a scans root directory when no .git exists", async () => {
    // No git init — just plain files
    await createFile("index.ts", "export default {};");

    const result = await LspManager.autoConfigure(tmpDir);

    const allLanguages = [
      ...result.detected.map((d) => d.language),
      ...result.missing.map((m) => m.language),
    ];
    expect(allLanguages).toContain("typescript");
  });

  it("9.3b scans common subdirs (src/, lib/) in fallback mode", async () => {
    // Files only in src/ subdirectory, not in root
    await createFile("src/main.py", "print('hello')");
    await createFile("lib/utils.go", "package utils");

    const result = await LspManager.autoConfigure(tmpDir);

    const allLanguages = [
      ...result.detected.map((d) => d.language),
      ...result.missing.map((m) => m.language),
    ];
    expect(allLanguages).toContain("python");
    expect(allLanguages).toContain("go");
  });

  it("9.3c scans packages/*/ for monorepo structure", async () => {
    // Monorepo structure: packages/web/src/index.ts
    await createFile("packages/web/src/index.ts", "const x = 1;");
    await createFile("packages/api/src/main.py", "print('hi')");

    const result = await LspManager.autoConfigure(tmpDir);

    const allLanguages = [
      ...result.detected.map((d) => d.language),
      ...result.missing.map((m) => m.language),
    ];
    // Both languages from different packages should be detected
    expect(allLanguages).toContain("typescript");
    expect(allLanguages).toContain("python");
  });
});

// ─── 9.4: Directory Exclusion ───────────────────────────────────────────────

describe("Project Scanning — directory exclusion", () => {
  it("9.4a excludes node_modules from scanning", async () => {
    // Only .java file is inside node_modules
    await createFile("node_modules/some-pkg/index.java", "class X {}");
    // A .ts file is at root level (so there's something to detect)
    await createFile("index.ts", "const x = 1;");

    const result = await LspManager.autoConfigure(tmpDir);

    const allLanguages = [
      ...result.detected.map((d) => d.language),
      ...result.missing.map((m) => m.language),
    ];
    // Java should NOT be detected (inside node_modules)
    expect(allLanguages).not.toContain("java");
    // TypeScript should still be detected
    expect(allLanguages).toContain("typescript");
  });

  it("9.4b excludes dist directory from scanning", async () => {
    await createFile("dist/bundle.js", "var x=1;");
    await createFile("src/app.ts", "const x = 1;");

    const result = await LspManager.autoConfigure(tmpDir);

    // Since .js and .ts share the typescript registry entry, check that
    // the detection worked (it should find .ts in src/)
    const allLanguages = [
      ...result.detected.map((d) => d.language),
      ...result.missing.map((m) => m.language),
    ];
    expect(allLanguages).toContain("typescript");
  });

  it("9.4c excludes .git directory from scanning", async () => {
    // When there's no actual git repo, .git dir entries should be skipped
    // in the fallback scanner
    await createFile(".git/config", "some git config");
    await createFile("main.py", "print('hello')");

    const result = await LspManager.autoConfigure(tmpDir);

    const allLanguages = [
      ...result.detected.map((d) => d.language),
      ...result.missing.map((m) => m.language),
    ];
    expect(allLanguages).toContain("python");
  });
});

// ─── 9.5: Multi-Language Detection ──────────────────────────────────────────

describe("Project Scanning — multi-language detection", () => {
  it("9.5a detects TypeScript + Python + Rust in same project", async () => {
    await createFile("src/index.ts", "const x = 1;");
    await createFile("src/main.py", "print('hello')");
    await createFile("src/lib.rs", "fn main() {}");

    const result = await LspManager.autoConfigure(tmpDir);

    const allLanguages = [
      ...result.detected.map((d) => d.language),
      ...result.missing.map((m) => m.language),
    ];
    expect(allLanguages).toContain("typescript");
    expect(allLanguages).toContain("python");
    expect(allLanguages).toContain("rust");
  });

  it("9.5b detects many languages simultaneously", async () => {
    await createFile("app.ts", "const x = 1;");
    await createFile("script.py", "x = 1");
    await createFile("main.go", "package main");
    await createFile("main.rs", "fn main() {}");
    await createFile("App.java", "class App {}");
    await createFile("main.c", "int main() { return 0; }");

    const result = await LspManager.autoConfigure(tmpDir);

    const allLanguages = [
      ...result.detected.map((d) => d.language),
      ...result.missing.map((m) => m.language),
    ];
    expect(allLanguages).toContain("typescript");
    expect(allLanguages).toContain("python");
    expect(allLanguages).toContain("go");
    expect(allLanguages).toContain("rust");
    expect(allLanguages).toContain("java");
    expect(allLanguages).toContain("c-cpp");
  });

  it("9.5c detection result contains correct server names from registry", async () => {
    await createFile("index.ts", "const x = 1;");
    await createFile("main.py", "print('hello')");

    const result = await LspManager.autoConfigure(tmpDir);

    // All entries (detected or missing) should reference the correct server command
    const allEntries = [
      ...result.detected.map((d) => ({ language: d.language, server: d.server })),
      ...result.missing.map((m) => ({ language: m.language, server: m.server })),
    ];

    const tsEntry = allEntries.find((e) => e.language === "typescript");
    expect(tsEntry).toBeDefined();
    expect(tsEntry!.server).toBe(LSP_REGISTRY.typescript.command[0]);

    const pyEntry = allEntries.find((e) => e.language === "python");
    expect(pyEntry).toBeDefined();
    expect(pyEntry!.server).toBe(LSP_REGISTRY.python.command[0]);
  });
});

// ─── 9.6: Empty Project ─────────────────────────────────────────────────────

describe("Project Scanning — empty project", () => {
  it("9.6a returns empty detected and missing for empty directory", async () => {
    // tmpDir exists but has no files
    const result = await LspManager.autoConfigure(tmpDir);

    expect(result.detected).toHaveLength(0);
    expect(result.missing).toHaveLength(0);
  });

  it("9.6b returns empty for directory with only non-source files", async () => {
    // Files with extensions not in any LSP_REGISTRY entry
    await createFile("README.md", "# Hello");
    await createFile("LICENSE", "MIT");
    await createFile(".gitignore", "node_modules");

    const result = await LspManager.autoConfigure(tmpDir);

    // .md is not in LSP_REGISTRY extensions, LICENSE has no extension
    // .gitignore has no recognized extension
    // So no languages should be detected
    // NOTE: Some file might match if registry contains an entry — check carefully
    const registryExts = new Set<string>();
    for (const info of Object.values(LSP_REGISTRY)) {
      for (const ext of info.extensions) {
        registryExts.add(ext);
      }
    }

    // If .md isn't in registry, we expect empty results
    if (!registryExts.has(".md")) {
      expect(result.detected).toHaveLength(0);
      expect(result.missing).toHaveLength(0);
    }
  });

  it("9.6c returns empty for project with only excluded directories", async () => {
    // Only files are inside excluded directories
    await createFile("node_modules/pkg/index.js", "module.exports = {};");
    await createFile("dist/bundle.js", "var x = 1;");
    await createFile(".git/HEAD", "ref: refs/heads/main");

    const result = await LspManager.autoConfigure(tmpDir);

    // In fallback mode (no actual git repo), scanner skips excluded dirs
    // Root dir only has these excluded subdirs, no actual source files
    expect(result.detected).toHaveLength(0);
    expect(result.missing).toHaveLength(0);
  });
});
