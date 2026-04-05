#!/usr/bin/env bun
/**
 * hg — Human-facing CLI for hashline_grep.
 *
 * Usage: hg <pattern> [path...] [options]
 *
 * Mirrors the hashline_grep MCP tool with 100% feature parity.
 */

import { relative, isAbsolute } from "path";
import {
  runRipgrep,
  fsBasedSearch,
  parseRipgrepOutput,
  formatGrepResults,
  formatFilesOnlyResults,
  formatCountResults,
  looksLikeFilePath,
  type GrepOptions,
  type GrepMatch,
} from "../lib/grep-search";
import { resolvePath } from "../lib/file-utils";

// ─── Usage ─────────────────────────────────────────────────────────────────

const USAGE = `
hg — hashline grep (search files with hashline-annotated output)

Usage:
  hg <pattern> [path...]  [options]
  hg --help

Arguments:
  pattern               Search pattern (regex)
  path...               One or more files or directories to search (default: cwd)

Options:
  -i, --ignore-case     Case-insensitive matching (like grep -i)
  -l, --files-only      Show only filenames with matches (like grep -l)
  -v, --invert-match    Invert match: show non-matching lines (like grep -v)
  -c, --count           Show match counts per file (like grep -c)
  -C, --context <n>     Context lines around matches (default: 2)
  -g, --glob <pattern>  File filter glob (e.g. "*.ts")
  -h, --help            Show this help message

  Use -- to stop flag parsing (useful for patterns starting with -).

Exit codes:
  0   Matches found
  1   No matches
  2   Error
`.trim();

// ─── Arg Parsing ───────────────────────────────────────────────────────────

interface ParsedArgs {
  pattern: string | null;
  paths: string[];
  ignoreCase: boolean;
  filesOnly: boolean;
  invertMatch: boolean;
  countOnly: boolean;
  contextLines: number;
  includeGlob: string | undefined;
  help: boolean;
  error: string | null;
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    pattern: null,
    paths: [],
    ignoreCase: false,
    filesOnly: false,
    invertMatch: false,
    countOnly: false,
    contextLines: 2,
    includeGlob: undefined,
    help: false,
    error: null,
  };

  const args = argv.slice(2); // strip [bun, script]
  let i = 0;
  let stopFlagParsing = false;
  const positionals: string[] = [];

  while (i < args.length) {
    const arg = args[i];

    if (stopFlagParsing) {
      positionals.push(arg);
      i++;
      continue;
    }

    if (arg === "--") {
      stopFlagParsing = true;
      i++;
      continue;
    }

    if (arg === "-h" || arg === "--help") {
      result.help = true;
      i++;
      continue;
    }

    if (arg === "-i" || arg === "--ignore-case") {
      result.ignoreCase = true;
      i++;
      continue;
    }

    if (arg === "-l" || arg === "--files-only") {
      result.filesOnly = true;
      i++;
      continue;
    }

    if (arg === "-v" || arg === "--invert-match") {
      result.invertMatch = true;
      i++;
      continue;
    }

    if (arg === "-c" || arg === "--count") {
      result.countOnly = true;
      i++;
      continue;
    }

    if (arg === "-C" || arg === "--context") {
      const next = args[i + 1];
      if (next === undefined || next.startsWith("-")) {
        result.error = `Option ${arg} requires a numeric argument`;
        return result;
      }
      const n = parseInt(next, 10);
      if (isNaN(n) || n < 0) {
        result.error = `Option ${arg} requires a non-negative integer`;
        return result;
      }
      result.contextLines = n;
      i += 2;
      continue;
    }

    // -C5 / --context=5 short form
    const contextShort = arg.match(/^-C(\d+)$/);
    if (contextShort) {
      result.contextLines = parseInt(contextShort[1], 10);
      i++;
      continue;
    }
    const contextLong = arg.match(/^--context=(\d+)$/);
    if (contextLong) {
      result.contextLines = parseInt(contextLong[1], 10);
      i++;
      continue;
    }

    if (arg === "-g" || arg === "--glob") {
      const next = args[i + 1];
      if (next === undefined) {
        result.error = `Option ${arg} requires a glob pattern argument`;
        return result;
      }
      result.includeGlob = next;
      i += 2;
      continue;
    }

    // --glob=*.ts form
    const globLong = arg.match(/^--glob=(.+)$/);
    if (globLong) {
      result.includeGlob = globLong[1];
      i++;
      continue;
    }

    if (arg.startsWith("-")) {
      result.error = `Unknown option: ${arg}`;
      return result;
    }

    positionals.push(arg);
    i++;
  }

  // First positional = pattern, rest = paths
  if (positionals.length > 0) {
    result.pattern = positionals[0];
    result.paths = positionals.slice(1);
  }

  return result;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.help) {
    console.log(USAGE);
    process.exit(0);
  }

  if (args.error) {
    console.error(`Error: ${args.error}`);
    console.error(`Run 'hg --help' for usage.`);
    process.exit(2);
  }

  if (!args.pattern) {
    console.log(USAGE);
    process.exit(0);
  }

  // Validate mutually exclusive modes
  if (args.filesOnly && args.countOnly) {
    console.error("Error: --files-only and --count cannot both be set.");
    process.exit(2);
  }

  // BUG 1 fix: detect when -g/--glob is used as a file path instead of a glob
  let resolvedIncludeGlob = args.includeGlob;
  if (args.includeGlob && looksLikeFilePath(args.includeGlob)) {
    // Treat the glob value as a search path
    args.paths.push(args.includeGlob);
    resolvedIncludeGlob = undefined;
  }

  // Normalize BRE-style \| → | for grep compatibility
  const normalizedPattern = args.pattern.replace(/\\\|/g, "|");

  const cwd = process.cwd();
  const rawPaths = args.paths.length > 0 ? args.paths : [""];

  const baseGrepOpts = {
    pattern: normalizedPattern,
    contextLines: args.contextLines,
    includeGlob: resolvedIncludeGlob,
    ignoreCase: args.ignoreCase,
    filesOnly: args.filesOnly,
    invertMatch: args.invertMatch,
    countOnly: args.countOnly,
  };

  const searchOnePath = async (rawP: string): Promise<GrepMatch[]> => {
    const sp = rawP ? resolvePath(rawP, cwd) : cwd;
    const opts: GrepOptions = { ...baseGrepOpts, searchPath: sp };

    const rgOut = await runRipgrep(opts);
    if (rgOut !== null) {
      if (rgOut.trim().length === 0) return [];

      if (opts.filesOnly) {
        return rgOut.split("\n").filter(Boolean).map((p) => ({
          filePath: isAbsolute(p) ? relative(cwd, p) : p,
          lineNumber: 0,
          isMatch: true,
          content: "",
        }));
      }

      if (opts.countOnly) {
        const result: GrepMatch[] = [];
        for (const line of rgOut.split("\n")) {
          const m = line.match(/^(.+?):(\d+)$/);
          if (m) {
            const fp = isAbsolute(m[1]) ? relative(cwd, m[1]) : m[1];
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
        if (isAbsolute(m.filePath)) m.filePath = relative(cwd, m.filePath);
      }
      return parsed;
    }

    // Fallback: fs-based search
    const fMatches = await fsBasedSearch(opts);
    for (const m of fMatches) {
      if (isAbsolute(m.filePath)) m.filePath = relative(cwd, m.filePath);
    }
    return fMatches;
  };

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
    if (anyError) {
      console.error(`Error during search: ${anyError}`);
      process.exit(2);
    }
    // No matches — exit 1 (like grep)
    process.exit(1);
  }

  if (args.filesOnly) {
    console.log(formatFilesOnlyResults(allMatches));
  } else if (args.countOnly) {
    console.log(formatCountResults(allMatches));
  } else {
    console.log(formatGrepResults(allMatches));
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});