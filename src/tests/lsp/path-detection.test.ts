/**
 * Tests for PATH-based LSP server detection.
 *
 * Verifies that LspManager.autoConfigure() correctly:
 * - Scans project files for extensions
 * - Uses Bun.which() to check PATH for LSP executables
 * - Returns proper LspDetectionResult structure
 * - Handles multiple languages
 */

import { describe, it, expect, afterEach } from "bun:test";
import { LspManager } from "../../lib/lsp/lsp-manager";
import { LSP_REGISTRY } from "../../lib/lsp/types";
import type { LspDetectionResult } from "../../lib/lsp/types";
import { mkdtemp, rm, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// ─── Test Helpers ────────────────────────────────────────────────────────────

let tmpDirs: string[] = [];

async function createTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "path-detection-test-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await LspManager.reset();
  for (const dir of tmpDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tmpDirs = [];
});

// ─── 10.1: Bun.which() is used for server detection ─────────────────────────

describe("PATH detection — Bun.which usage", () => {
  it("10.1 attempts detection for typescript-language-server when .ts files exist", async () => {
    const dir = await createTmpDir();
    // Create a .ts file so the scanner finds TypeScript extensions
    await Bun.write(join(dir, "index.ts"), "export const x = 1;");

    const result = await LspManager.autoConfigure(dir);

    // typescript-language-server should appear in either detected or missing
    const allServers = [
      ...result.detected.map((d) => d.server),
      ...result.missing.map((m) => m.server),
    ];
    expect(allServers).toContain("typescript-language-server");
  });
});

// ─── 10.2: Server availability — known executable in PATH ────────────────────

describe("PATH detection — server availability", () => {
  it("10.2 Bun.which() finds executables that are actually in PATH", () => {
    // `node` or `bun` should be available in any test environment
    const bunPath = Bun.which("bun");
    expect(bunPath).not.toBeNull();
    expect(typeof bunPath).toBe("string");

    // Also verify `git` is typically available
    const gitPath = Bun.which("git");
    expect(gitPath).not.toBeNull();
  });
});

// ─── 10.3: Server unavailability — nonexistent executable ────────────────────

describe("PATH detection — server unavailability", () => {
  it("10.3 Bun.which() returns null for nonexistent executables", () => {
    const result = Bun.which("__absolutely_fake_lsp_server_that_does_not_exist_12345__");
    expect(result).toBeNull();
  });

  it("10.3b nonexistent LSP server ends up in missing list", async () => {
    const dir = await createTmpDir();
    // Create a .zig file — zls is unlikely to be installed in CI/test environments
    await Bun.write(join(dir, "main.zig"), "const std = @import(\"std\");");

    const result = await LspManager.autoConfigure(dir);

    // If zls is not installed, it should be in missing
    const zlsInPath = Bun.which("zls");
    if (zlsInPath === null) {
      const missingServers = result.missing.map((m) => m.server);
      expect(missingServers).toContain("zls");
    } else {
      // If zls IS installed, it should be in detected
      const detectedServers = result.detected.map((d) => d.server);
      expect(detectedServers).toContain("zls");
    }
  });
});

// ─── 10.4: Detection result structure ────────────────────────────────────────

describe("PATH detection — result structure", () => {
  it("10.4 autoConfigure returns proper LspDetectionResult shape", async () => {
    const dir = await createTmpDir();
    await Bun.write(join(dir, "app.ts"), "const a = 1;");

    const result = await LspManager.autoConfigure(dir);

    // Verify top-level structure
    expect(result).toHaveProperty("detected");
    expect(result).toHaveProperty("missing");
    expect(Array.isArray(result.detected)).toBe(true);
    expect(Array.isArray(result.missing)).toBe(true);

    // TypeScript should be in one of the lists
    const allEntries = [...result.detected, ...result.missing];
    expect(allEntries.length).toBeGreaterThan(0);

    // Verify detected entries have correct shape
    for (const entry of result.detected) {
      expect(entry).toHaveProperty("language");
      expect(entry).toHaveProperty("server");
      expect(entry).toHaveProperty("started");
      expect(typeof entry.language).toBe("string");
      expect(typeof entry.server).toBe("string");
      expect(typeof entry.started).toBe("boolean");
    }

    // Verify missing entries have correct shape
    for (const entry of result.missing) {
      expect(entry).toHaveProperty("language");
      expect(entry).toHaveProperty("server");
      expect(entry).toHaveProperty("installHint");
      expect(typeof entry.language).toBe("string");
      expect(typeof entry.server).toBe("string");
      expect(typeof entry.installHint).toBe("string");
      expect(entry.installHint.length).toBeGreaterThan(0);
    }
  });

  it("10.4b getDetectionResult returns same result after autoConfigure", async () => {
    const dir = await createTmpDir();
    await Bun.write(join(dir, "main.py"), "print('hello')");

    const result = await LspManager.autoConfigure(dir);
    const stored = LspManager.getDetectionResult();

    expect(stored).toBeDefined();
    expect(stored!.detected).toEqual(result.detected);
    expect(stored!.missing).toEqual(result.missing);
  });

  it("10.4c empty project produces empty detection result", async () => {
    const dir = await createTmpDir();
    // Empty directory — no source files

    const result = await LspManager.autoConfigure(dir);

    expect(result.detected).toEqual([]);
    expect(result.missing).toEqual([]);
  });
});

// ─── 10.5: Multiple language detection ───────────────────────────────────────

describe("PATH detection — multiple languages", () => {
  it("10.5 detects both TypeScript and Python in the same project", async () => {
    const dir = await createTmpDir();
    await mkdir(join(dir, "src"), { recursive: true });
    await Bun.write(join(dir, "src", "index.ts"), "export const x = 1;");
    await Bun.write(join(dir, "src", "main.py"), "print('hello')");

    const result = await LspManager.autoConfigure(dir);

    // Both languages should appear across detected + missing
    const allLanguages = [
      ...result.detected.map((d) => d.language),
      ...result.missing.map((m) => m.language),
    ];
    expect(allLanguages).toContain("typescript");
    expect(allLanguages).toContain("python");
  });

  it("10.5b detects three languages from different file types", async () => {
    const dir = await createTmpDir();
    await Bun.write(join(dir, "app.ts"), "const x = 1;");
    await Bun.write(join(dir, "lib.py"), "x = 1");
    await Bun.write(join(dir, "main.go"), "package main");

    const result = await LspManager.autoConfigure(dir);

    const allLanguages = [
      ...result.detected.map((d) => d.language),
      ...result.missing.map((m) => m.language),
    ];
    expect(allLanguages).toContain("typescript");
    expect(allLanguages).toContain("python");
    expect(allLanguages).toContain("go");
  });

  it("10.5c each detected language maps to correct server from registry", async () => {
    const dir = await createTmpDir();
    await Bun.write(join(dir, "index.ts"), "const x = 1;");
    await Bun.write(join(dir, "main.rs"), "fn main() {}");

    const result = await LspManager.autoConfigure(dir);

    // Verify detected/missing entries have correct servers from registry
    const allEntries = [...result.detected, ...result.missing];
    for (const entry of allEntries) {
      const registryEntry = LSP_REGISTRY[entry.language];
      expect(registryEntry).toBeDefined();
      expect(entry.server).toBe(registryEntry.command[0]);
    }
  });
});
