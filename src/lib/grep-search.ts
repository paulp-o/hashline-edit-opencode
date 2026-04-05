/**
 * grep-search.ts — Shared grep/search functions used by MCP plugin and CLI tools.
 */

import { computeLineHash } from "./hashline-core";
import { hasBinaryExtension } from "./file-utils";
import { resolve } from "path";
import { readdir, stat } from "fs/promises";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface GrepMatch {
  filePath: string;
  lineNumber: number;
  isMatch: boolean; // true = match line, false = context line
  content: string;
}

/**
 * Options object for both ripgrep and fs-based grep.
 */
export interface GrepOptions {
  pattern: string;
  searchPath: string;
  contextLines: number;
  includeGlob?: string;
  ignoreCase?: boolean;
  filesOnly?: boolean;
  invertMatch?: boolean;
  countOnly?: boolean;
}

// ─── Detection Helper ───────────────────────────────────────────────────────────

/**
 * Returns true when a string looks like a file path rather than a glob pattern.
 * Heuristic: contains a path separator and has no glob wildcard characters.
 */
export function looksLikeFilePath(s: string): boolean {
  return (s.includes("/") || s.includes("\\")) && !s.includes("*") && !s.includes("?");
}

// ─── Ripgrep Parsing ────────────────────────────────────────────────────────────

/**
 * Parse ripgrep output into structured matches.
 *
 * Line formats:
 *   match:   path:linenum:content
 *   context: path-linenum-content
 *   separator: --
 */
export function parseRipgrepOutput(output: string): GrepMatch[] {
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

// ─── Result Formatters ────────────────────────────────────────────────────────────

/**
 * Group grep matches by file and format with hashline annotations.
 */
export function formatGrepResults(matches: GrepMatch[]): string {
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
export function formatFilesOnlyResults(matches: GrepMatch[]): string {
  const seen = new Set<string>();
  for (const m of matches) seen.add(m.filePath);
  return [...seen].join("\n");
}

/**
 * Format per-file match counts (countOnly mode).
 */
export function formatCountResults(matches: GrepMatch[]): string {
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

// ─── Fallback FS-based Search ──────────────────────────────────────────────────────

/**
 * Walk a directory recursively, yielding file paths.
 */
export async function* walkDirectory(
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
export function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

/**
 * Fallback search using the filesystem (no ripgrep dependency).
 */
export async function fsBasedSearch(opts: GrepOptions): Promise<GrepMatch[]> {
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
export async function runRipgrep(opts: GrepOptions): Promise<string | null> {
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