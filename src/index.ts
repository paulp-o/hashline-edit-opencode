/**
 * hashline-edit.ts — Main plugin entry point for HashLine Edit.
 *
 * Registers three tools (hashline_read, hashline_edit, hashline_grep) and
 * injects the hashline system prompt via the experimental chat system hook.
 *
 * Plugin SDK: @opencode-ai/plugin@1.2.11
 * Runtime: Bun only (relies on Bun.file, Bun.hash)
 */

import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { formatHashLines, computeLineHash } from "./lib/hashline-core";
import { applyHashlineEdits, type EditOperation } from "./lib/hashline-apply";
import { stripNewLinePrefixes } from "./lib/hashline-strip";
import {
  renderHashlineEditPrompt,
  TOOL_DESCRIPTIONS,
} from "./lib/hashline-prompt";
import { HashlineMismatchError } from "./lib/hashline-errors";
import { resolve, isAbsolute, relative } from "path";
import { readdir, stat, unlink, rename, mkdir } from "fs/promises";
import { collectAndFormatDiagnostics } from "./lib/lsp/lsp-diagnostics";
import { LspManager } from "./lib/lsp/lsp-manager";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Known binary/image/PDF extensions to reject early. */
const BINARY_EXTENSIONS = new Set([
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
 * Detect binary files by checking for null bytes in the first 8KB.
 * Returns true if the file appears to be binary.
 */
async function isBinaryFile(filePath: string): Promise<boolean> {
  const file = Bun.file(filePath);
  const buf = new Uint8Array(await file.slice(0, 8192).arrayBuffer());
  return buf.includes(0);
}

/**
 * Resolve a path relative to the context directory.
 * If the path is already absolute, it's returned as-is.
 */
function resolvePath(filePath: string, contextDirectory: string): string {
  return isAbsolute(filePath) ? filePath : resolve(contextDirectory, filePath);
}

/** Get the effective base directory from plugin context. */
function getBaseDir(context: { directory: string; worktree: string }): string {
  return context.directory || context.worktree;
}

// ─── LSP Diagnostics ──────────────────────────────────────────────────────

/**
 * LSP diagnostics after edits (default: on).
 * Set `EXPERIMENTAL_LSP_DIAGNOSTICS=false` (or `0` / `off` / `no`) to disable.
 */
const LSP_DIAGNOSTICS_ENABLED = (() => {
  const v = process.env.EXPERIMENTAL_LSP_DIAGNOSTICS;
  if (v === undefined || v === "") return true;
  const lower = v.trim().toLowerCase();
  if (
    lower === "false" ||
    lower === "0" ||
    lower === "off" ||
    lower === "no"
  ) {
    return false;
  }
  return true;
})();


/** Track whether we have already notified about missing LSP servers. */
let hasNotifiedMissingServers = false;

/**
 * Summarize edit operations for the response message.
 * Gives a concise description of what each edit did.
 */
function summarizeEdits(edits: EditOperation[]): string {
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

/**
 * Build a descriptive title for the hashline_edit tool call.
 * Shows path + concise summary of operations for the OpenCode UI.
 */
function buildEditTitle(args: {
  path: string;
  edits?: unknown[];
  delete?: boolean;
  move?: string;
}): string {
  const parts: string[] = [args.path];

  if (args.delete) {
    parts.push("DELETE");
  } else if (args.edits && args.edits.length > 0) {
    const edits = args.edits as EditOperation[];
    const ops: string[] = [];
    for (const e of edits) {
      if (
        e.op === "replace" &&
        (!e.lines ||
          (Array.isArray(e.lines) && e.lines.length === 0) ||
          e.lines === null)
      ) {
        ops.push(e.end ? `del ${e.pos}..${e.end}` : `del ${e.pos}`);
      } else if (e.op === "replace") {
        ops.push(e.end ? `repl ${e.pos}..${e.end}` : `repl ${e.pos}`);
      } else if (e.op === "append") {
        ops.push(e.pos ? `app ${e.pos}` : "app EOF");
      } else if (e.op === "prepend") {
        ops.push(e.pos ? `prep ${e.pos}` : "prep BOF");
      }
    }
    parts.push(ops.join(", "));
  }

  if (args.move) {
    parts.push(`→ ${args.move}`);
  }

  return parts.join(" — ");
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
async function getGitIgnoredSet(dirPath: string): Promise<Set<string>> {
  try {
    // List all files under dirPath, then batch-check via git check-ignore
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

async function buildDirectoryListing(
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

/**
 * Check if a path has a known binary extension.
 */
function hasBinaryExtension(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

// ─── Ripgrep Parsing ─────────────────────────────────────────────────────────

interface GrepMatch {
  filePath: string;
  lineNumber: number;
  isMatch: boolean; // true = match line, false = context line
  content: string;
}

/**
 * Options object for both ripgrep and fs-based grep.
 */
interface GrepOptions {
  pattern: string;
  searchPath: string;
  contextLines: number;
  includeGlob?: string;
  ignoreCase?: boolean;
  filesOnly?: boolean;
  invertMatch?: boolean;
  countOnly?: boolean;
}

/**
 * Returns true when a string looks like a file path rather than a glob pattern.
 * Heuristic: contains a path separator and has no glob wildcard characters.
 */
function looksLikeFilePath(s: string): boolean {
  return (s.includes("/") || s.includes("\\")) && !s.includes("*") && !s.includes("?");
}

/**
 * Parse ripgrep output into structured matches.
 *
 * Line formats:
 *   match:   path:linenum:content
 *   context: path-linenum-content
 *   separator: --
 */
function parseRipgrepOutput(output: string): GrepMatch[] {
  const results: GrepMatch[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    if (!line || line === "--") continue;

    // Match line: path:linenum:content
    const matchResult = line.match(/^(.+?):(\d+):(.*)$/);
    if (matchResult) {
      results.push({
        filePath: matchResult[1],
        lineNumber: parseInt(matchResult[2], 10),
        isMatch: true,
        content: matchResult[3],
      });
      continue;
    }

    // Context line: path-linenum-content
    const contextResult = line.match(/^(.+?)-(\d+)-(.*)$/);
    if (contextResult) {
      results.push({
        filePath: contextResult[1],
        lineNumber: parseInt(contextResult[2], 10),
        isMatch: false,
        content: contextResult[3],
      });
    }
  }

  return results;
}

/**
 * Group grep matches by file and format with hashline annotations.
 */
function formatGrepResults(matches: GrepMatch[]): string {
  if (matches.length === 0) return "";

  // Group by file
  const fileGroups = new Map<string, GrepMatch[]>();
  for (const match of matches) {
    const group = fileGroups.get(match.filePath);
    if (group) {
      group.push(match);
    } else {
      fileGroups.set(match.filePath, [match]);
    }
  }

  const sections: string[] = [];

  for (const [filePath, fileMatches] of fileGroups) {
    const lines: string[] = [`## ${filePath}`];

    // Sort by line number
    fileMatches.sort((a, b) => a.lineNumber - b.lineNumber);

    for (const m of fileMatches) {
      const hash = computeLineHash(m.content, m.lineNumber);
      const tag = `${m.lineNumber}#${hash}:${m.content}`;
      if (m.isMatch) {
        lines.push(`> ${tag}`);
      } else {
        lines.push(`  ${tag}`);
      }
    }

    sections.push(lines.join("\n"));
  }

  return sections.join("\n\n");
}

/**
 * Format results as a deduplicated list of file paths (filesOnly mode).
 */
function formatFilesOnlyResults(matches: GrepMatch[]): string {
  const seen = new Set<string>();
  for (const m of matches) seen.add(m.filePath);
  return [...seen].join("\n");
}

/**
 * Format per-file match counts (countOnly mode).
 */
function formatCountResults(matches: GrepMatch[]): string {
  const counts = new Map<string, number>();
  for (const m of matches) {
    if (m.isMatch) counts.set(m.filePath, (counts.get(m.filePath) ?? 0) + 1);
  }
  const lines: string[] = [];
  let total = 0;
  for (const [filePath, count] of counts) {
    lines.push(`${filePath}: ${count}`);
    total += count;
  }
  lines.push(`\nTotal: ${total} matches in ${counts.size} files`);
  return lines.join("\n");
}

// ─── Fallback FS-based Search ────────────────────────────────────────────────

/**
 * Walk a directory recursively, yielding file paths.
 */
async function* walkDirectory(
  dir: string,
  includePattern?: RegExp,
): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkDirectory(fullPath, includePattern);
    } else {
      if (includePattern && !includePattern.test(entry.name)) continue;
      yield fullPath;
    }
  }
}

/**
 * Convert a glob-like include pattern (e.g. "*.ts") to a RegExp.
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

/**
 * Fallback search using the filesystem (no ripgrep dependency).
 */
async function fsBasedSearch(opts: GrepOptions): Promise<GrepMatch[]> {
  const { pattern, searchPath, contextLines, includeGlob, ignoreCase, invertMatch } = opts;
  const regexFlags = ignoreCase ? "i" : "";
  const regex = new RegExp(pattern, regexFlags);
  const includeRe = includeGlob ? globToRegex(includeGlob) : undefined;
  const allMatches: GrepMatch[] = [];

  // If searchPath is a file, search it directly without directory walk
  let filePaths: AsyncIterable<string>;
  const pathStat = await stat(searchPath).catch(() => null);
  if (pathStat?.isFile()) {
    filePaths = (async function* () { yield searchPath; })();
  } else {
    filePaths = walkDirectory(searchPath, includeRe);
  }

  for await (const filePath of filePaths) {
    if (hasBinaryExtension(filePath)) continue;

    try {
      const content = await Bun.file(filePath).text();
      const lines = content.split("\n");

      const matchIndices: number[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (invertMatch ? !regex.test(lines[i]) : regex.test(lines[i])) {
          matchIndices.push(i);
        }
      }

      if (matchIndices.length === 0) continue;

      // Collect lines with context
      const includedLines = new Set<number>();
      for (const idx of matchIndices) {
        for (
          let c = Math.max(0, idx - contextLines);
          c <= Math.min(lines.length - 1, idx + contextLines);
          c++
        ) {
          includedLines.add(c);
        }
      }

      const sortedIndices = Array.from(includedLines).sort((a, b) => a - b);
      const matchSet = new Set(matchIndices);

      for (const idx of sortedIndices) {
        allMatches.push({
          filePath: filePath,
          lineNumber: idx + 1,
          isMatch: matchSet.has(idx),
          content: lines[idx],
        });
      }
    } catch {
      // Skip unreadable files
    }
  }

  return allMatches;
}

/**
 * Run ripgrep with argv-safe `-e PATTERN -- PATH` (handles spaces, long patterns, leading `-`).
 * Returns stdout text, or null if rg is missing or exits with error (caller may fall back to fs search).
 */
async function runRipgrep(opts: GrepOptions): Promise<string | null> {
  const { pattern, searchPath, contextLines, includeGlob, ignoreCase, filesOnly, invertMatch, countOnly } = opts;
  const argv = [
    "rg",
    "--line-number",
    "--with-filename",
    "--color=never",
    "--max-columns=0",
  ];
  // Context lines are irrelevant for filesOnly and countOnly modes
  if (!filesOnly && !countOnly) argv.push(`-C${contextLines}`);
  if (ignoreCase) argv.push("--ignore-case");
  if (filesOnly) argv.push("--files-with-matches");
  if (invertMatch) argv.push("--invert-match");
  if (countOnly) argv.push("--count");
  if (includeGlob) argv.push("--glob", includeGlob);
  argv.push("-e", pattern, "--", searchPath);

  try {
    const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    const exit = await proc.exited;
    if (exit === 2) return null;
    return stdout;
  } catch {
    return null;
  }
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

const plugin: Plugin = async (ctx) => {
  // ─── LSP Configuration ──────────────────────────────────────────────
  if (LSP_DIAGNOSTICS_ENABLED) {
    const baseDir = ctx.directory || ctx.worktree;
    try {
      await LspManager.autoConfigure(baseDir);
    } catch {
      // Auto-detection failed — skip LSP diagnostics
    }
  }

  return {
    tool: {
      // ─── hashline_read ───────────────────────────────────────────────
      hashline_read: tool({
        description: TOOL_DESCRIPTIONS.hashline_read,
        args: {
          filePath: tool.schema
            .string()
            .describe("Path to a file or directory to read"),
          offset: tool.schema
            .number()
            .optional()
            .describe("Starting line number (1-indexed, default 1)"),
          limit: tool.schema
            .number()
            .optional()
            .describe("Maximum number of lines to return (default 2000)"),
          diagnostics: tool.schema
            .boolean()
            .optional()
            .describe("If true, append LSP diagnostics for the file (default: false)"),
        },
        async execute(args, context) {
          const resolvedPath = resolvePath(args.filePath, getBaseDir(context));

          // Check if path exists
          let pathStat;
          try {
            pathStat = await stat(resolvedPath);
          } catch {
            return `Error: File not found: ${args.filePath}`;
          }

          // Directory listing mode
          if (pathStat.isDirectory()) {
            const listing = await buildDirectoryListing(
              resolvedPath,
              resolvedPath,
            );
            return listing || "(empty directory)";
          }

          // Check for known binary extensions
          if (hasBinaryExtension(resolvedPath)) {
            return `Error: Binary file detected (${args.filePath}). Use the built-in read tool for binary files, images, or PDFs.`;
          }

          // Binary detection via null byte check
          try {
            if (await isBinaryFile(resolvedPath)) {
              return `Error: Binary file detected (${args.filePath}). Use the built-in read tool for binary files, images, or PDFs.`;
            }
          } catch {
            return `Error: Could not read file: ${args.filePath}`;
          }

          // Read file content
          let content: string;
          try {
            content = await Bun.file(resolvedPath).text();
          } catch {
            return `Error: Could not read file: ${args.filePath}`;
          }

          const allLines = content.split("\n");
          const totalLines = allLines.length;

          const offset = args.offset ?? 1;
          const limit = args.limit ?? 2000;

          // Clamp offset to valid range
          const startIdx = Math.max(0, offset - 1);
          const endIdx = Math.min(totalLines, startIdx + limit);

          // Slice the lines
          const sliced = allLines.slice(startIdx, endIdx);

          // Truncate long lines
          const truncated = sliced.map((line) =>
            line.length > 2000 ? line.slice(0, 2000) + "... [truncated]" : line,
          );

          // Format with hashline annotations
          const formatted = formatHashLines(truncated.join("\n"), startIdx + 1);

          // Collect LSP diagnostics if requested
          let diagnosticsOutput = "";
          if (args.diagnostics && LSP_DIAGNOSTICS_ENABLED) {
            try {
              diagnosticsOutput = await collectAndFormatDiagnostics(resolvedPath, getBaseDir(context));
            } catch { /* LSP failure must never block read */ }
          }

          // Add header if file exceeds limit
          const showingStart = startIdx + 1;
          const showingEnd = startIdx + sliced.length;
          if (totalLines > limit || offset > 1) {
            return `(showing lines ${showingStart}-${showingEnd} of ${totalLines} total)\n${formatted}${diagnosticsOutput}`;
          }

          return formatted + diagnosticsOutput;
        },
      }),

      // ─── hashline_edit ───────────────────────────────────────────────
      hashline_edit: tool({
        description: TOOL_DESCRIPTIONS.hashline_edit,
        args: {
          path: tool.schema.string().describe("File path to edit"),
          edits: tool.schema
            .array(
              tool.schema.object({
                op: tool.schema
                  .enum(["replace", "append", "prepend"])
                  .describe("Edit operation type"),
                pos: tool.schema
                  .string()
                  .optional()
                  .describe('Anchor line reference ("N#ID")'),
                end: tool.schema
                  .string()
                  .optional()
                  .describe('End of range reference ("N#ID")'),
                lines: tool.schema
                  .union([
                    tool.schema.array(tool.schema.string()),
                    tool.schema.string(),
                    tool.schema.null(),
                  ])
                  .optional()
                  .describe("New content lines"),
              }),
            )
            .optional()
            .describe("Array of edit operations"),
          delete: tool.schema
            .boolean()
            .optional()
            .describe("If true, delete the file"),
          move: tool.schema
            .string()
            .optional()
            .describe("New path to move/rename the file to"),
        },
        async execute(args, context) {
          // Set descriptive title for OpenCode UI
          const editTitle = buildEditTitle(args);
          context.metadata({ title: editTitle });

          const resolvedPath = resolvePath(args.path, getBaseDir(context));

          // File deletion
          if (args.delete) {
            try {
              await unlink(resolvedPath);
              return `Deleted file: ${args.path}`;
            } catch {
              return `Error: Could not delete file: ${args.path}`;
            }
          }

          let lineCountDelta = 0;
          const warnings: string[] = [];

          // Apply edits if provided
          if (args.edits && args.edits.length > 0) {
            try {
              const result = await applyHashlineEdits(
                resolvedPath,
                args.edits as EditOperation[],
              );
              lineCountDelta = result.lineCountDelta;
              warnings.push(...result.warnings);
            } catch (err) {
              if (err instanceof HashlineMismatchError) {
                return err.message;
              }
              if (err instanceof Error) {
                return `Error: ${err.message}`;
              }
              return `Error: Unknown error during edit`;
            }
          }

          // File move/rename (after edits, if any)
          if (args.move) {
            const resolvedNewPath = resolvePath(args.move, getBaseDir(context));
            try {
              // Ensure target directory exists
              const targetDir = resolvedNewPath.slice(
                0,
                resolvedNewPath.lastIndexOf("/"),
              );
              await mkdir(targetDir, { recursive: true });
              await rename(resolvedPath, resolvedNewPath);

              if (args.edits && args.edits.length > 0) {
                const delta =
                  lineCountDelta >= 0
                    ? `+${lineCountDelta}`
                    : `${lineCountDelta}`;
                const msg = `Applied edits to ${args.path} (${delta} lines), then moved to ${args.move}`;
                // Collect LSP diagnostics if enabled
                let diagnostics = "";
                if (LSP_DIAGNOSTICS_ENABLED) {
                  try {
                    diagnostics = await collectAndFormatDiagnostics(resolvedNewPath, getBaseDir(context));
                  } catch { /* LSP failure must never block edit */ }
                }
                // Notify about missing LSP servers on first edit
                if (LSP_DIAGNOSTICS_ENABLED && !hasNotifiedMissingServers) {
                  hasNotifiedMissingServers = true;
                  const detection = LspManager.getDetectionResult();
                  if (detection && detection.missing.length > 0) {
                    const missingList = detection.missing
                      .map(m => `${m.language} (${m.server} not found — ${m.installHint})`)
                      .join(", ");
                    diagnostics += `\n\nLSP diagnostics unavailable for: ${missingList}`;
                  }
                }
                if (warnings.length > 0) {
                  return `${msg}\nWarnings:\n${warnings.join("\n")}${diagnostics}`;
                }
                return msg + diagnostics;
              }
              return `Moved file: ${args.path} → ${args.move}`;
            } catch {
              return `Error: Could not move file from ${args.path} to ${args.move}`;
            }
          }

          // Standard edit response
          if (args.edits && args.edits.length > 0) {
            const delta =
              lineCountDelta >= 0 ? `+${lineCountDelta}` : `${lineCountDelta}`;
            // Summarize what was done
            const opSummary = summarizeEdits(args.edits as EditOperation[]);
            const msg = `Applied edits to ${args.path} (${delta} lines)\n${opSummary}`;
            // Collect LSP diagnostics if enabled
            let diagnostics = "";
            if (LSP_DIAGNOSTICS_ENABLED) {
              try {
                diagnostics = await collectAndFormatDiagnostics(resolvedPath, getBaseDir(context));
              } catch { /* LSP failure must never block edit */ }
            }
            // Notify about missing LSP servers on first edit
            if (LSP_DIAGNOSTICS_ENABLED && !hasNotifiedMissingServers) {
              hasNotifiedMissingServers = true;
              const detection = LspManager.getDetectionResult();
              if (detection && detection.missing.length > 0) {
                const missingList = detection.missing
                  .map(m => `${m.language} (${m.server} not found — ${m.installHint})`)
                  .join(", ");
                diagnostics += `\n\nLSP diagnostics unavailable for: ${missingList}`;
              }
            }
            if (warnings.length > 0) {
              return `${msg}\nWarnings:\n${warnings.join("\n")}${diagnostics}`;
            }
            return msg + diagnostics;
          }

          return `No operations specified for ${args.path}`;
        },
      }),

      // ─── hashline_grep ───────────────────────────────────────────────
      hashline_grep: tool({
        description: TOOL_DESCRIPTIONS.hashline_grep,
        args: {
          pattern: tool.schema.string().describe("Search pattern (regex)"),
          path: tool.schema
            .string()
            .optional()
            .describe("Directory or file to search (default: project root)"),
          include: tool.schema
            .string()
            .optional()
            .describe('File pattern filter (e.g. "*.ts")'),
          context: tool.schema
            .number()
            .optional()
            .describe("Number of context lines around matches (default 2)"),
          ignoreCase: tool.schema
            .boolean()
            .optional()
            .describe("Case-insensitive matching (default: false)"),
          filesOnly: tool.schema
            .boolean()
            .optional()
            .describe("Return only file paths with matches, no line content (default: false)"),
          invertMatch: tool.schema
            .boolean()
            .optional()
            .describe("Return non-matching lines, like grep -v (default: false)"),
          countOnly: tool.schema
            .boolean()
            .optional()
            .describe("Return only match counts per file, like grep -c (default: false)"),
          paths: tool.schema
            .array(tool.schema.string())
            .optional()
            .describe("Array of paths to search (alternative to path for multi-path searches)"),
        },
        async execute(args, context) {
          const baseDir = getBaseDir(context);

          // BUG 1 fix: detect when `include` is used as a file path instead of a glob
          let resolvedPath = args.path;
          let resolvedInclude = args.include;
          if (args.include && looksLikeFilePath(args.include)) {
            if (args.path) {
              return (
                `Error: The \`include\` parameter expects a glob pattern (e.g. "*.ts"), not a file path. ` +
                `Use the \`path\` parameter to specify a file path. Both \`include\` and \`path\` were provided.`
              );
            }
            // Treat the include value as the search path
            resolvedPath = args.include;
            resolvedInclude = undefined;
          }

          const contextLines = args.context ?? 2;

          // Normalize BRE-style \| → | for grep compatibility
          const normalizedPattern = args.pattern.replace(/\\\|/g, "|");

          // Validate mutually exclusive modes
          if (args.filesOnly && args.countOnly) {
            return "Error: `filesOnly` and `countOnly` cannot both be true.";
          }

          const baseGrepOpts = {
            pattern: normalizedPattern,
            contextLines,
            includeGlob: resolvedInclude,
            ignoreCase: args.ignoreCase ?? false,
            filesOnly: args.filesOnly ?? false,
            invertMatch: args.invertMatch ?? false,
            countOnly: args.countOnly ?? false,
          };

          // Determine search paths (multi-path support via `paths` array)
          const rawPaths: string[] = [];
          if (args.paths && args.paths.length > 0) {
            rawPaths.push(...args.paths);
          } else {
            rawPaths.push(resolvedPath ?? "");
          }

          // Run one search per path, merging results
          const searchOnePath = async (rawP: string): Promise<GrepMatch[]> => {
            const sp = rawP ? resolvePath(rawP, baseDir) : baseDir;
            const opts: GrepOptions = { ...baseGrepOpts, searchPath: sp };

            const rgOut = await runRipgrep(opts);
            if (rgOut !== null) {
              if (rgOut.trim().length === 0) return [];

              if (opts.filesOnly) {
                // --files-with-matches output: one file path per line
                return rgOut.split("\n").filter(Boolean).map((p) => ({
                  filePath: isAbsolute(p) ? relative(baseDir, p) : p,
                  lineNumber: 0,
                  isMatch: true,
                  content: "",
                }));
              }

              if (opts.countOnly) {
                // --count output: path:count per line
                const result: GrepMatch[] = [];
                for (const line of rgOut.split("\n")) {
                  const m = line.match(/^(.+?):(\d+)$/);
                  if (m) {
                    const fp = isAbsolute(m[1]) ? relative(baseDir, m[1]) : m[1];
                    const n = parseInt(m[2], 10);
                    for (let i = 0; i < n; i++) {
                      result.push({ filePath: fp, lineNumber: i + 1, isMatch: true, content: "" });
                    }
                  }
                }
                return result;
              }

              const parsed = parseRipgrepOutput(rgOut);
              for (const m of parsed) {
                if (isAbsolute(m.filePath)) m.filePath = relative(baseDir, m.filePath);
              }
              return parsed;
            }

            // Fallback: fs-based search
            const fMatches = await fsBasedSearch(opts);
            for (const m of fMatches) {
              if (isAbsolute(m.filePath)) m.filePath = relative(baseDir, m.filePath);
            }
            return fMatches;
          };

          // Collect matches across all paths
          const allMatches: GrepMatch[] = [];
          let anyError: string | null = null;
          for (const rawP of rawPaths) {
            try {
              allMatches.push(...(await searchOnePath(rawP)));
            } catch (err) {
              anyError = err instanceof Error ? err.message : String(err);
            }
          }

          if (allMatches.length === 0) {
            if (anyError) return `Error during search: ${anyError}`;
            return `No matches found for pattern: ${args.pattern}`;
          }

          if (args.filesOnly) return formatFilesOnlyResults(allMatches);
          if (args.countOnly) return formatCountResults(allMatches);
          return formatGrepResults(allMatches);
        },
      }),
    },

    // ─── System Prompt Injection ───────────────────────────────────────
    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(renderHashlineEditPrompt(LSP_DIAGNOSTICS_ENABLED));
    },
  };
};

export default plugin;
