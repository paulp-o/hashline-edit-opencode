#!/usr/bin/env bun
/**
 * hread — CLI wrapper for hashline_read.
 * Reads files and directories with hashline annotations.
 *
 * Usage: hread <file-or-dir> [--offset|-o <n>] [--limit|-l <n>] [--help|-h]
 */

import { stat } from "fs/promises";
import { formatHashLines } from "../lib/hashline-core";
import {
  buildDirectoryListing,
  isBinaryFile,
  hasBinaryExtension,
  resolvePath,
} from "../lib/file-utils";

// ─── Arg Parsing ─────────────────────────────────────────────────────────────

function printUsage(): void {
  process.stdout.write(
    [
      "Usage: hread <file-or-dir> [options]",
      "",
      "Read a file or directory with hashline annotations.",
      "",
      "Arguments:",
      "  <file-or-dir>          File or directory path to read",
      "",
      "Options:",
      "  --offset, -o <n>       Starting line number (1-indexed, default: 1)",
      "  --limit,  -l <n>       Max lines to return (default: 2000)",
      "  --help,   -h           Show this help message",
    ].join("\n") + "\n",
  );
}

interface Args {
  filePath: string | null;
  offset: number;
  limit: number;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { filePath: null, offset: 1, limit: 2000, help: false };
  const rest = argv.slice(2); // skip [bun, hread.ts]

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--offset" || arg === "-o") {
      const val = parseInt(rest[++i] ?? "", 10);
      if (isNaN(val) || val < 1) {
        process.stderr.write(`Error: --offset requires a positive integer\n`);
        process.exit(2);
      }
      args.offset = val;
    } else if (arg === "--limit" || arg === "-l") {
      const val = parseInt(rest[++i] ?? "", 10);
      if (isNaN(val) || val < 1) {
        process.stderr.write(`Error: --limit requires a positive integer\n`);
        process.exit(2);
      }
      args.limit = val;
    } else if (arg.startsWith("-")) {
      process.stderr.write(`Error: Unknown option: ${arg}\n`);
      process.exit(2);
    } else {
      if (args.filePath !== null) {
        process.stderr.write(`Error: Multiple file paths specified. Provide a single path.\n`);
        process.exit(2);
      }
      args.filePath = arg;
    }
  }

  return args;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.help || args.filePath === null) {
    printUsage();
    process.exit(0);
  }

  const resolvedPath = resolvePath(args.filePath, process.cwd());

  // Check if path exists
  let pathStat;
  try {
    pathStat = await stat(resolvedPath);
  } catch {
    process.stderr.write(`Error: File not found: ${args.filePath}\n`);
    process.exit(2);
  }

  // Directory listing mode
  if (pathStat.isDirectory()) {
    const listing = await buildDirectoryListing(resolvedPath, resolvedPath);
    process.stdout.write((listing || "(empty directory)") + "\n");
    process.exit(0);
  }

  // Check for known binary extensions
  if (hasBinaryExtension(resolvedPath)) {
    process.stderr.write(`Error: Binary file detected (${args.filePath}). Use a binary-aware tool for binary files, images, or PDFs.\n`);
    process.exit(2);
  }

  // Binary detection via null byte check
  try {
    if (await isBinaryFile(resolvedPath)) {
      process.stderr.write(`Error: Binary file detected (${args.filePath}). Use a binary-aware tool for binary files, images, or PDFs.\n`);
      process.exit(2);
    }
  } catch {
    process.stderr.write(`Error: Could not read file: ${args.filePath}\n`);
    process.exit(2);
  }

  // Read file content
  let content: string;
  try {
    content = await Bun.file(resolvedPath).text();
  } catch {
    process.stderr.write(`Error: Could not read file: ${args.filePath}\n`);
    process.exit(2);
  }

  const allLines = content.split("\n");
  const totalLines = allLines.length;

  // Clamp offset to valid range
  const startIdx = Math.max(0, args.offset - 1);
  const endIdx = Math.min(totalLines, startIdx + args.limit);

  // Slice the lines
  const sliced = allLines.slice(startIdx, endIdx);

  // Truncate long lines (match MCP tool behaviour: 2000 chars + '... [truncated]')
  const truncated = sliced.map((line) =>
    line.length > 2000 ? line.slice(0, 2000) + "... [truncated]" : line,
  );

  // Format with hashline annotations
  const formatted = formatHashLines(truncated.join("\n"), startIdx + 1);

  // Prepend range header when output is partial
  const showingStart = startIdx + 1;
  const showingEnd = startIdx + sliced.length;
  if (totalLines > args.limit || args.offset > 1) {
    process.stdout.write(`(showing lines ${showingStart}-${showingEnd} of ${totalLines} total)\n${formatted}\n`);
  } else {
    process.stdout.write(formatted + "\n");
  }
}

main();