#!/usr/bin/env bun
/**
 * hedit — CLI wrapper for hashline_edit with 100% feature parity.
 *
 * Usage:
 *   hedit <file> --replace <pos> [--end <end>] --lines <line1> [line2...]
 *   hedit <file> --append [<pos>] --lines <line1> [line2...]
 *   hedit <file> --prepend [<pos>] --lines <line1> [line2...]
 *   hedit <file> --delete
 *   hedit <file> --move <new-path>
 *   hedit <file> --json '<json-array>'
 *   hedit --help
 */

import { applyHashlineEdits } from "../lib/hashline-apply";
import type { EditOperation } from "../lib/hashline-apply";
import { HashlineMismatchError } from "../lib/hashline-errors";
import { summarizeEdits, resolvePath } from "../lib/file-utils";
import { unlink, rename, mkdir } from "fs/promises";

// ─── Help ─────────────────────────────────────────────────────────────────────

const USAGE = `hedit — hashline file editor

Usage:
  hedit <file> --replace <pos> [--end <end>] --lines <line1> [line2...]
  hedit <file> --append [<pos>] --lines <line1> [line2...]
  hedit <file> --prepend [<pos>] --lines <line1> [line2...]
  hedit <file> --delete
  hedit <file> --move <new-path>
  hedit <file> --json '<json-array>'
  hedit -h, --help

Operations:
  --replace <pos>              Replace the line at anchor pos
  --replace <pos> --end <end>  Replace a range of lines from pos to end
  --append [<pos>]             Append lines after anchor pos (or EOF if no pos)
  --prepend [<pos>]            Prepend lines before anchor pos (or BOF if no pos)
  --delete                     Delete the file
  --move <new-path>            Move/rename the file
  --json '<json>'              Pass edits as a JSON array of EditOperation objects

Flags:
  --lines <l1> [l2...]         Lines to write (collect until next flag)
  --delete-lines               With --replace: delete the matched line(s)
  --end <end>                  End anchor for range replace
  -h, --help                   Show this help

Anchors:
  Anchors use the format N#ID where N is the line number and ID is the 2-char
  content hash from hashline_read output (e.g. 5#NS, 12#XR).

Exit codes:
  0  Success
  2  Error (hash mismatch, file not found, invalid args)
`;

// ─── Arg Parsing ─────────────────────────────────────────────────────────────

interface ParsedArgs {
  file: string | null;
  op: "replace" | "append" | "prepend" | null;
  pos: string | undefined;
  end: string | undefined;
  lines: string[] | null;
  deleteLines: boolean;
  deleteFile: boolean;
  moveTo: string | null;
  jsonEdits: string | null;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = {
    file: null,
    op: null,
    pos: undefined,
    end: undefined,
    lines: null,
    deleteLines: false,
    deleteFile: false,
    moveTo: null,
    jsonEdits: null,
    help: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "-h" || arg === "--help") {
      result.help = true;
      break;
    }

    if (arg === "--replace") {
      result.op = "replace";
      i++;
      // Next non-flag arg is pos
      if (i < args.length && !args[i].startsWith("--")) {
        result.pos = args[i];
        i++;
      }
      continue;
    }

    if (arg === "--append") {
      result.op = "append";
      i++;
      // Next non-flag arg is optional pos
      if (i < args.length && !args[i].startsWith("--")) {
        result.pos = args[i];
        i++;
      }
      continue;
    }

    if (arg === "--prepend") {
      result.op = "prepend";
      i++;
      // Next non-flag arg is optional pos
      if (i < args.length && !args[i].startsWith("--")) {
        result.pos = args[i];
        i++;
      }
      continue;
    }

    if (arg === "--end") {
      i++;
      if (i < args.length) {
        result.end = args[i];
        i++;
      }
      continue;
    }

    if (arg === "--lines") {
      i++;
      result.lines = [];
      // Collect all subsequent args until the next flag (--xxx)
      while (i < args.length && !args[i].startsWith("--")) {
        result.lines.push(args[i]);
        i++;
      }
      continue;
    }

    if (arg === "--delete-lines") {
      result.deleteLines = true;
      i++;
      continue;
    }

    if (arg === "--delete") {
      result.deleteFile = true;
      i++;
      continue;
    }

    if (arg === "--move") {
      i++;
      if (i < args.length) {
        result.moveTo = args[i];
        i++;
      }
      continue;
    }

    if (arg === "--json") {
      i++;
      if (i < args.length) {
        result.jsonEdits = args[i];
        i++;
      }
      continue;
    }

    // Positional: first non-flag arg is the file
    if (!arg.startsWith("--") && result.file === null) {
      result.file = arg;
      i++;
      continue;
    }

    // Unknown flag — skip
    i++;
  }

  return result;
}

// ─── Build EditOperations ─────────────────────────────────────────────────────

function buildEditsFromFlags(parsed: ParsedArgs): EditOperation[] {
  if (!parsed.op) return [];

  const edit: EditOperation = {
    op: parsed.op,
    pos: parsed.pos,
    end: parsed.end,
    lines: parsed.deleteLines ? null : (parsed.lines ?? []),
  };

  return [edit];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  if (parsed.help || (!parsed.file && !parsed.deleteFile)) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  if (!parsed.file) {
    process.stderr.write("Error: No file specified.\n");
    process.exit(2);
  }

  const resolvedPath = resolvePath(parsed.file, process.cwd());

  // ── File deletion ──────────────────────────────────────────────────────────
  if (parsed.deleteFile) {
    try {
      await unlink(resolvedPath);
      process.stdout.write(`Deleted file: ${parsed.file}\n`);
      process.exit(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: Could not delete file: ${parsed.file} — ${msg}\n`);
      process.exit(2);
    }
  }

  // ── Collect edits ──────────────────────────────────────────────────────────
  let edits: EditOperation[] = [];

  if (parsed.jsonEdits !== null) {
    try {
      const rawEdits = JSON.parse(parsed.jsonEdits);
      if (!Array.isArray(rawEdits)) {
        process.stderr.write("Error: --json value must be a JSON array of EditOperation objects.\n");
        process.exit(2);
      }
      edits = rawEdits as EditOperation[];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: Failed to parse --json value: ${msg}\n`);
      process.exit(2);
    }
  } else if (parsed.op) {
    edits = buildEditsFromFlags(parsed);
  }

  // ── Apply edits ────────────────────────────────────────────────────────────
  let lineCountDelta = 0;
  const warnings: string[] = [];

  if (edits.length > 0) {
    try {
      const result = await applyHashlineEdits(resolvedPath, edits);
      lineCountDelta = result.lineCountDelta;
      warnings.push(...result.warnings);
    } catch (err) {
      if (err instanceof HashlineMismatchError) {
        process.stderr.write(err.message + "\n");
        process.exit(2);
      }
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${msg}\n`);
      process.exit(2);
    }
  }

  // ── File move/rename ───────────────────────────────────────────────────────
  if (parsed.moveTo !== null) {
    const resolvedNewPath = resolvePath(parsed.moveTo, process.cwd());
    try {
      const targetDir = resolvedNewPath.slice(0, resolvedNewPath.lastIndexOf("/"));
      if (targetDir) await mkdir(targetDir, { recursive: true });
      await rename(resolvedPath, resolvedNewPath);

      if (edits.length > 0) {
        const delta = lineCountDelta >= 0 ? `+${lineCountDelta}` : `${lineCountDelta}`;
        const opSummary = summarizeEdits(edits);
        let msg = `Applied edits to ${parsed.file} (${delta} lines), then moved to ${parsed.moveTo}`;
        if (opSummary) msg += `\n${opSummary}`;
        if (warnings.length > 0) msg += `\nWarnings:\n${warnings.join("\n")}`;
        process.stdout.write(msg + "\n");
      } else {
        process.stdout.write(`Moved file: ${parsed.file} → ${parsed.moveTo}\n`);
      }
      process.exit(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: Could not move file from ${parsed.file} to ${parsed.moveTo} — ${msg}\n`);
      process.exit(2);
    }
  }

  // ── Standard edit response ─────────────────────────────────────────────────
  if (edits.length > 0) {
    const delta = lineCountDelta >= 0 ? `+${lineCountDelta}` : `${lineCountDelta}`;
    const opSummary = summarizeEdits(edits);
    let msg = `Applied edits to ${parsed.file} (${delta} lines)`;
    if (opSummary) msg += `\n${opSummary}`;
    if (warnings.length > 0) msg += `\nWarnings:\n${warnings.join("\n")}`;
    process.stdout.write(msg + "\n");
    process.exit(0);
  }

  // No operation specified — show help
  process.stdout.write(USAGE);
  process.exit(0);
}

main();
