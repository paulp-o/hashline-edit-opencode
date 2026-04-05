/**
 * file-utils.ts — Shared file utility functions used by MCP plugin and CLI tools.
 */

import { isAbsolute, resolve } from "path";
import { readdir } from "fs/promises";
import type { EditOperation } from "./hashline-apply";

// ─── Binary File Detection ────────────────────────────────────────────────────

/** Known binary/image/PDF extensions to reject early. */
export const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".webp",
  ".svg",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".7z",
  ".rar",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".o",
  ".a",
  ".wasm",
  ".class",
  ".jar",
  ".pyc",
  ".pyo",
  ".mp3",
  ".mp4",
  ".wav",
  ".avi",
  ".mov",
  ".mkv",
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
  ".eot",
]);

/**
 * Check if a path has a known binary extension.
 */
export function hasBinaryExtension(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Detect binary files by checking for null bytes in the first 8KB.
 * Returns true if the file appears to be binary.
 */
export async function isBinaryFile(filePath: string): Promise<boolean> {
  const file = Bun.file(filePath);
  const buf = new Uint8Array(await file.slice(0, 8192).arrayBuffer());
  return buf.includes(0);
}

// ─── Path Resolution ─────────────────────────────────────────────────────────

/**
 * Resolve a path relative to the context directory.
 * If the path is already absolute, it's returned as-is.
 */
export function resolvePath(filePath: string, contextDirectory: string): string {
  return isAbsolute(filePath) ? filePath : resolve(contextDirectory, filePath);
}

// ─── Directory Listing ────────────────────────────────────────────────────────

export async function getGitIgnoredSet(dirPath: string): Promise<Set<string>> {
  try {
    const proc = Bun.spawn(
      ["git", "ls-files", "--others", "--ignored", "--exclude-standard", "-z", "."],
      { cwd: dirPath, stdout: "pipe", stderr: "pipe" },
    );
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    const ignored = new Set<string>();
    for (const p of output.split("\0")) {
      const trimmed = p.trim().replace(/\/$/, "");
      if (trimmed) ignored.add(trimmed.split("/")[0]);
    }
    return ignored;
  } catch {
    return new Set();
  }
}

/**
 * Build a tree listing of a directory with line counts.
 *
 * Format:
 *   src/
 *     components/
 *       Button.tsx ............... 45 lines
 *     utils/
 *       helpers.ts ............... 23 lines
 */
export async function buildDirectoryListing(
  dirPath: string,
  basePath: string,
  indent: string = "",
  parentIgnored?: Set<string>,
): Promise<string> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  entries.sort((a, b) => {
    // Directories first, then alphabetical
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  // Get gitignored names for this directory level
  const ignoredSet = parentIgnored ?? (await getGitIgnoredSet(dirPath));

  const lines: string[] = [];

  for (const entry of entries) {
    // Skip hidden files and common non-code directories
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    // Skip gitignored entries
    if (ignoredSet.has(entry.name)) continue;

    const fullPath = resolve(dirPath, entry.name);

    if (entry.isDirectory()) {
      lines.push(`${indent}${entry.name}/`);
      // Build child ignored set from this subdirectory
      const childIgnored = await getGitIgnoredSet(fullPath);
      const subListing = await buildDirectoryListing(
        fullPath,
        basePath,
        indent + "  ",
        childIgnored,
      );
      if (subListing) lines.push(subListing);
    } else {
      try {
        const content = await Bun.file(fullPath).text();
        const lineCount = content.split("\n").length;
        lines.push(`${indent}${entry.name} (${lineCount} lines)`);
      } catch {
        lines.push(`${indent}${entry.name} (unreadable)`);
      }
    }
  }

  return lines.join("\n");
}

// ─── Edit Summary ─────────────────────────────────────────────────────────────

/**
 * Summarize edit operations for the response message.
 * Gives a concise description of what each edit did.
 */
export function summarizeEdits(edits: EditOperation[]): string {
  const lines: string[] = [];
  for (const edit of edits) {
    const pos = edit.pos ?? "(none)";
    if (edit.op === "replace") {
      const range = edit.end ? `${edit.pos}..${edit.end}` : pos;
      if (
        !edit.lines ||
        (Array.isArray(edit.lines) && edit.lines.length === 0) ||
        edit.lines === null
      ) {
        lines.push(`  delete ${range}`);
      } else {
        const count = Array.isArray(edit.lines) ? edit.lines.length : 1;
        lines.push(`  replace ${range} → ${count} line(s)`);
      }
    } else if (edit.op === "append") {
      const count = Array.isArray(edit.lines)
        ? edit.lines.length
        : edit.lines
          ? 1
          : 0;
      lines.push(`  append ${count} line(s) after ${pos}`);
    } else if (edit.op === "prepend") {
      const count = Array.isArray(edit.lines)
        ? edit.lines.length
        : edit.lines
          ? 1
          : 0;
      lines.push(`  prepend ${count} line(s) before ${pos}`);
    }
  }
  return lines.join("\n");
}