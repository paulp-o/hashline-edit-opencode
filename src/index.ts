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

/** Check if experimental LSP diagnostics feature is enabled via env var. */
const LSP_DIAGNOSTICS_ENABLED =
  process.env.EXPERIMENTAL_LSP_DIAGNOSTICS === "true";


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
async function buildDirectoryListing(
  dirPath: string,
  basePath: string,
  indent: string = "",
): Promise<string> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  entries.sort((a, b) => {
    // Directories first, then alphabetical
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  const lines: string[] = [];

  for (const entry of entries) {
    // Skip hidden files and common non-code directories
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

    const fullPath = resolve(dirPath, entry.name);

    if (entry.isDirectory()) {
      lines.push(`${indent}${entry.name}/`);
      const subListing = await buildDirectoryListing(
        fullPath,
        basePath,
        indent + "  ",
      );
      if (subListing) lines.push(subListing);
    } else {
      try {
        const content = await Bun.file(fullPath).text();
        const lineCount = content.split("\n").length;
        const dots = ".".repeat(
          Math.max(3, 40 - indent.length - entry.name.length),
        );
        lines.push(`${indent}${entry.name} ${dots} ${lineCount} lines`);
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
async function fsBasedSearch(
  pattern: string,
  searchPath: string,
  include?: string,
  contextLines: number = 2,
): Promise<GrepMatch[]> {
  const regex = new RegExp(pattern);
  const includeRe = include ? globToRegex(include) : undefined;
  const allMatches: GrepMatch[] = [];

  for await (const filePath of walkDirectory(searchPath, includeRe)) {
    if (hasBinaryExtension(filePath)) continue;

    try {
      const content = await Bun.file(filePath).text();
      const lines = content.split("\n");

      const matchIndices: number[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
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

// ─── Plugin ──────────────────────────────────────────────────────────────────

const plugin: Plugin = async (ctx) => {
  const { $ } = ctx;

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

          // Add header if file exceeds limit
          const showingStart = startIdx + 1;
          const showingEnd = startIdx + sliced.length;
          if (totalLines > limit || offset > 1) {
            return `(showing lines ${showingStart}-${showingEnd} of ${totalLines} total)\n${formatted}`;
          }

          return formatted;
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
        },
        async execute(args, context) {
          const searchPath = args.path
            ? resolvePath(args.path, getBaseDir(context))
            : getBaseDir(context);
          const contextLines = args.context ?? 2;

          // Try ripgrep first
          try {
            const rgArgs: string[] = [
              "--line-number",
              "--with-filename",
              `-C${contextLines}`,
              "--color=never",
            ];
            if (args.include) {
              rgArgs.push("--glob", args.include);
            }

            const result = await $`rg ${rgArgs} ${args.pattern} ${searchPath}`
              .nothrow()
              .quiet()
              .text();

            // Exit code 1 = no matches (normal), exit code 2+ = error
            if (result.trim().length === 0) {
              return `No matches found for pattern: ${args.pattern}`;
            }

            // Parse and format ripgrep output
            const matches = parseRipgrepOutput(result);
            if (matches.length === 0) {
              return `No matches found for pattern: ${args.pattern}`;
            }

            // Make file paths relative to search path for cleaner display
            for (const m of matches) {
              if (isAbsolute(m.filePath)) {
                m.filePath = relative(getBaseDir(context), m.filePath);
              }
            }

            return formatGrepResults(matches);
          } catch {
            // Ripgrep not available — fall back to fs-based search
          }

          // Fallback: fs-based search
          try {
            const matches = await fsBasedSearch(
              args.pattern,
              searchPath,
              args.include,
              contextLines,
            );

            if (matches.length === 0) {
              return `No matches found for pattern: ${args.pattern}`;
            }

            // Make file paths relative
            for (const m of matches) {
              if (isAbsolute(m.filePath)) {
                m.filePath = relative(getBaseDir(context), m.filePath);
              }
            }

            return formatGrepResults(matches);
          } catch (err) {
            if (err instanceof Error) {
              return `Error during search: ${err.message}`;
            }
            return `Error during search for pattern: ${args.pattern}`;
          }
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
