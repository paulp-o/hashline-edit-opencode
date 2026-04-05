#!/usr/bin/env bun
// @bun

// src/lib/hashline-core.ts
var NIBBLE_STR = "ZPMQVRWSNKTXJBYH";
var VALID_HASH_CHARS = new Set(NIBBLE_STR);
var DICT = Array.from({ length: 256 }, (_, i) => {
  const h = i >>> 4;
  const l = i & 15;
  return `${NIBBLE_STR[h]}${NIBBLE_STR[l]}`;
});
function normalizeLine(line) {
  return line.replace(/\r$/, "").replace(/\s+/g, "");
}
function computeLineHash(content, lineIndex) {
  const normalized = normalizeLine(content);
  const isSymbolOnly = !/[\p{L}\p{N}]/u.test(normalized);
  const seed = isSymbolOnly ? lineIndex : 0;
  return DICT[Bun.hash.xxHash32(normalized, seed) & 255];
}
function formatLineTag(lineNum, content) {
  return `${lineNum}#${computeLineHash(content, lineNum)}`;
}
function formatHashLines(text, startLine = 1) {
  const lines = text.split(`
`);
  return lines.map((line, i) => {
    const lineNum = startLine + i;
    return `${lineNum}#${computeLineHash(line, lineNum)}:${line}`;
  }).join(`
`);
}
var TAG_RE = /^["']?\s*[>+\-\s]*(\d+)#([A-Z]{2})\s*["']?$/;
function parseTag(ref) {
  const m = TAG_RE.exec(ref.trim());
  if (!m)
    return null;
  const line = parseInt(m[1], 10);
  const hash = m[2];
  if (line < 1)
    return null;
  if (!VALID_HASH_CHARS.has(hash[0]) || !VALID_HASH_CHARS.has(hash[1]))
    return null;
  return { line, hash };
}

// src/lib/hashline-errors.ts
class HashlineMismatchError extends Error {
  mismatches;
  constructor(mismatches, fileLines, formatLineFn) {
    const blocks = mismatches.map((m) => {
      if (m.outOfRange) {
        const n = fileLines.length;
        return [
          `Anchor out of range: line ${m.line} does not exist (file has ${n} line(s)).`,
          `You used ${m.line}#${m.expected}, but there is no line ${m.line} to anchor to.`,
          "",
          "Call hashline_read on this file and use pos/end values from the current hashline output (LINE#HASH only \u2014 never copy placeholder text from an error message)."
        ].join(`
`);
      }
      const start = Math.max(1, m.line - 2);
      const end = Math.min(fileLines.length, m.line + 2);
      const contextLines = [];
      for (let i = start;i <= end; i++) {
        const lineContent = fileLines[i - 1];
        const tag = formatLineFn(i, lineContent);
        if (i === m.line) {
          contextLines.push(`>>>${tag}:${lineContent}`);
        } else {
          contextLines.push(`  ${tag}:${lineContent}`);
        }
      }
      const header = `Hash mismatch at line ${m.line} (expected ${m.line}#${m.expected}, got ${m.line}#${m.actual}):`;
      return [
        header,
        ...contextLines,
        "",
        "To retry, use:",
        `  pos: "${m.line}#${m.actual}"`
      ].join(`
`);
    });
    const message = blocks.join(`

`);
    super(message);
    this.name = "HashlineMismatchError";
    this.mismatches = mismatches;
  }
}

// src/lib/hashline-strip.ts
var HASHLINE_PREFIX_RE = /^\d+#[A-Z]{2}:/;
function stripNewLinePrefixes(lines) {
  if (lines.length === 0)
    return lines;
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  const nonEmptyCount = nonEmptyLines.length;
  if (nonEmptyCount === 0)
    return lines;
  const matchCount = nonEmptyLines.filter((line) => HASHLINE_PREFIX_RE.test(line)).length;
  if (matchCount / nonEmptyCount > 0.5) {
    return lines.map((line) => line.replace(HASHLINE_PREFIX_RE, ""));
  }
  return lines;
}

// src/lib/hashline-apply.ts
import { mkdir } from "fs/promises";
import { dirname } from "path";
function normalizeLines(lines) {
  if (lines == null)
    return [];
  if (typeof lines === "string")
    return [lines];
  return lines;
}
function collectEdits(edits) {
  const result = [];
  for (const edit of edits) {
    const normalized = {
      op: edit.op,
      lines: stripNewLinePrefixes(normalizeLines(edit.lines))
    };
    if (edit.pos != null) {
      const parsed = parseTag(edit.pos);
      if (!parsed) {
        throw new Error(`Invalid pos reference: "${edit.pos}"`);
      }
      normalized.posLine = parsed.line;
      normalized.posHash = parsed.hash;
    }
    if (edit.end != null) {
      const parsed = parseTag(edit.end);
      if (!parsed) {
        throw new Error(`Invalid end reference: "${edit.end}"`);
      }
      if (normalized.posLine == null) {
        throw new Error(`"end" anchor provided without "pos": end="${edit.end}"`);
      }
      normalized.endLine = parsed.line;
      normalized.endHash = parsed.hash;
    }
    if (edit.op === "replace" && normalized.posLine == null) {
      throw new Error(`"replace" operation requires a "pos" anchor`);
    }
    result.push(normalized);
  }
  return result;
}
function deduplicateEdits(edits) {
  const seen = new Map;
  for (const edit of edits) {
    const key = `${edit.op}|${edit.posLine ?? ""}#${edit.posHash ?? ""}|${edit.endLine ?? ""}#${edit.endHash ?? ""}|${JSON.stringify(edit.lines)}`;
    if (!seen.has(key)) {
      seen.set(key, edit);
    }
  }
  return Array.from(seen.values());
}
function validateAllHashes(edits, fileLines) {
  const mismatches = [];
  for (const edit of edits) {
    if (edit.posLine != null && edit.posHash != null) {
      if (edit.posLine < 1 || edit.posLine > fileLines.length) {
        mismatches.push({
          line: edit.posLine,
          expected: edit.posHash,
          actual: "",
          content: "",
          outOfRange: true
        });
      } else {
        const actual = computeLineHash(fileLines[edit.posLine - 1], edit.posLine);
        if (actual !== edit.posHash) {
          mismatches.push({
            line: edit.posLine,
            expected: edit.posHash,
            actual,
            content: fileLines[edit.posLine - 1]
          });
        }
      }
    }
    if (edit.endLine != null && edit.endHash != null) {
      if (edit.endLine < 1 || edit.endLine > fileLines.length) {
        mismatches.push({
          line: edit.endLine,
          expected: edit.endHash,
          actual: "",
          content: "",
          outOfRange: true
        });
      } else {
        const actual = computeLineHash(fileLines[edit.endLine - 1], edit.endLine);
        if (actual !== edit.endHash) {
          mismatches.push({
            line: edit.endLine,
            expected: edit.endHash,
            actual,
            content: fileLines[edit.endLine - 1]
          });
        }
      }
    }
  }
  if (mismatches.length > 0) {
    throw new HashlineMismatchError(mismatches, fileLines, formatLineTag);
  }
}
function sortEditsBottomUp(edits) {
  const OP_PRECEDENCE = {
    replace: 0,
    append: 1,
    prepend: 2
  };
  return [...edits].sort((a, b) => {
    const aLine = getEffectiveLine(a);
    const bLine = getEffectiveLine(b);
    if (aLine !== bLine)
      return bLine - aLine;
    return OP_PRECEDENCE[a.op] - OP_PRECEDENCE[b.op];
  });
}
function getEffectiveLine(edit) {
  if (edit.posLine != null)
    return edit.posLine;
  if (edit.op === "append")
    return Infinity;
  if (edit.op === "prepend")
    return 0;
  return 0;
}
function detectNoOp(edit, fileLines) {
  if (edit.op !== "replace")
    return null;
  if (edit.posLine == null)
    return null;
  if (edit.endLine != null) {
    const original = fileLines.slice(edit.posLine - 1, edit.endLine);
    if (original.length === edit.lines.length && original.every((line, i) => line === edit.lines[i])) {
      return `No-op: replace range ${edit.posLine}-${edit.endLine} produces identical content`;
    }
  } else {
    if (edit.lines.length === 1 && fileLines[edit.posLine - 1] === edit.lines[0]) {
      return `No-op: replace at line ${edit.posLine} produces identical content`;
    }
  }
  return null;
}
function applyReplace(edit, lines) {
  const result = [...lines];
  const pos = edit.posLine;
  if (edit.endLine != null) {
    const count = edit.endLine - pos + 1;
    result.splice(pos - 1, count, ...edit.lines);
  } else {
    result.splice(pos - 1, 1, ...edit.lines);
  }
  return result;
}
function applyAppend(edit, lines) {
  const result = [...lines];
  if (edit.posLine != null) {
    result.splice(edit.posLine, 0, ...edit.lines);
  } else {
    result.push(...edit.lines);
  }
  return result;
}
function applyPrepend(edit, lines) {
  const result = [...lines];
  if (edit.posLine != null) {
    result.splice(edit.posLine - 1, 0, ...edit.lines);
  } else {
    result.unshift(...edit.lines);
  }
  return result;
}
async function applyHashlineEdits(filePath, edits) {
  let fileContent;
  try {
    fileContent = await Bun.file(filePath).text();
  } catch {
    const hasOnlyAnchorlessAppends = edits.every((e) => e.op === "append" && e.pos == null);
    if (hasOnlyAnchorlessAppends) {
      fileContent = "";
    } else {
      throw new Error(`File not found: ${filePath}`);
    }
  }
  const fileLines = fileContent.length === 0 ? [] : fileContent.split(`
`);
  const originalLineCount = fileLines.length;
  const collected = collectEdits(edits);
  const deduplicated = deduplicateEdits(collected);
  validateAllHashes(deduplicated, fileLines);
  const sorted = sortEditsBottomUp(deduplicated);
  const warnings = [];
  for (const edit of sorted) {
    const warning = detectNoOp(edit, fileLines);
    if (warning) {
      warnings.push(warning);
    }
  }
  let working = [...fileLines];
  for (const edit of sorted) {
    switch (edit.op) {
      case "replace":
        working = applyReplace(edit, working);
        break;
      case "append":
        working = applyAppend(edit, working);
        break;
      case "prepend":
        working = applyPrepend(edit, working);
        break;
    }
  }
  const result = working.join(`
`);
  await mkdir(dirname(filePath), { recursive: true });
  await Bun.write(filePath, result);
  return {
    content: result,
    lineCountDelta: working.length - originalLineCount,
    warnings
  };
}

// src/lib/file-utils.ts
import { isAbsolute, resolve } from "path";
import { readdir } from "fs/promises";
var BINARY_EXTENSIONS = new Set([
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
  ".eot"
]);
function hasBinaryExtension(filePath) {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}
async function isBinaryFile(filePath) {
  const file = Bun.file(filePath);
  const buf = new Uint8Array(await file.slice(0, 8192).arrayBuffer());
  return buf.includes(0);
}
function resolvePath(filePath, contextDirectory) {
  return isAbsolute(filePath) ? filePath : resolve(contextDirectory, filePath);
}
async function getGitIgnoredSet(dirPath) {
  try {
    const proc = Bun.spawn(["git", "ls-files", "--others", "--ignored", "--exclude-standard", "-z", "."], { cwd: dirPath, stdout: "pipe", stderr: "pipe" });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    const ignored = new Set;
    for (const p of output.split("\x00")) {
      const trimmed = p.trim().replace(/\/$/, "");
      if (trimmed)
        ignored.add(trimmed.split("/")[0]);
    }
    return ignored;
  } catch {
    return new Set;
  }
}
async function buildDirectoryListing(dirPath, basePath, indent = "", parentIgnored) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory())
      return -1;
    if (!a.isDirectory() && b.isDirectory())
      return 1;
    return a.name.localeCompare(b.name);
  });
  const ignoredSet = parentIgnored ?? await getGitIgnoredSet(dirPath);
  const lines = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules")
      continue;
    if (ignoredSet.has(entry.name))
      continue;
    const fullPath = resolve(dirPath, entry.name);
    if (entry.isDirectory()) {
      lines.push(`${indent}${entry.name}/`);
      const childIgnored = await getGitIgnoredSet(fullPath);
      const subListing = await buildDirectoryListing(fullPath, basePath, indent + "  ", childIgnored);
      if (subListing)
        lines.push(subListing);
    } else {
      try {
        const content = await Bun.file(fullPath).text();
        const lineCount = content.split(`
`).length;
        lines.push(`${indent}${entry.name} (${lineCount} lines)`);
      } catch {
        lines.push(`${indent}${entry.name} (unreadable)`);
      }
    }
  }
  return lines.join(`
`);
}
function summarizeEdits(edits) {
  const lines = [];
  for (const edit of edits) {
    const pos = edit.pos ?? "(none)";
    if (edit.op === "replace") {
      const range = edit.end ? `${edit.pos}..${edit.end}` : pos;
      if (!edit.lines || Array.isArray(edit.lines) && edit.lines.length === 0 || edit.lines === null) {
        lines.push(`  delete ${range}`);
      } else {
        const count = Array.isArray(edit.lines) ? edit.lines.length : 1;
        lines.push(`  replace ${range} \u2192 ${count} line(s)`);
      }
    } else if (edit.op === "append") {
      const count = Array.isArray(edit.lines) ? edit.lines.length : edit.lines ? 1 : 0;
      lines.push(`  append ${count} line(s) after ${pos}`);
    } else if (edit.op === "prepend") {
      const count = Array.isArray(edit.lines) ? edit.lines.length : edit.lines ? 1 : 0;
      lines.push(`  prepend ${count} line(s) before ${pos}`);
    }
  }
  return lines.join(`
`);
}

// src/cli/hedit.ts
import { unlink, rename, mkdir as mkdir2 } from "fs/promises";
var USAGE = `hedit \u2014 hashline file editor

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
function parseArgs(argv) {
  const args = argv.slice(2);
  const result = {
    file: null,
    op: null,
    pos: undefined,
    end: undefined,
    lines: null,
    deleteLines: false,
    deleteFile: false,
    moveTo: null,
    jsonEdits: null,
    help: false
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
      if (i < args.length && !args[i].startsWith("--")) {
        result.pos = args[i];
        i++;
      }
      continue;
    }
    if (arg === "--append") {
      result.op = "append";
      i++;
      if (i < args.length && !args[i].startsWith("--")) {
        result.pos = args[i];
        i++;
      }
      continue;
    }
    if (arg === "--prepend") {
      result.op = "prepend";
      i++;
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
    if (!arg.startsWith("--") && result.file === null) {
      result.file = arg;
      i++;
      continue;
    }
    i++;
  }
  return result;
}
function buildEditsFromFlags(parsed) {
  if (!parsed.op)
    return [];
  const edit = {
    op: parsed.op,
    pos: parsed.pos,
    end: parsed.end,
    lines: parsed.deleteLines ? null : parsed.lines ?? []
  };
  return [edit];
}
async function main() {
  const parsed = parseArgs(process.argv);
  if (parsed.help || !parsed.file && !parsed.deleteFile) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  if (!parsed.file) {
    process.stderr.write(`Error: No file specified.
`);
    process.exit(2);
  }
  const resolvedPath = resolvePath(parsed.file, process.cwd());
  if (parsed.deleteFile) {
    try {
      await unlink(resolvedPath);
      process.stdout.write(`Deleted file: ${parsed.file}
`);
      process.exit(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: Could not delete file: ${parsed.file} \u2014 ${msg}
`);
      process.exit(2);
    }
  }
  let edits = [];
  if (parsed.jsonEdits !== null) {
    try {
      const rawEdits = JSON.parse(parsed.jsonEdits);
      if (!Array.isArray(rawEdits)) {
        process.stderr.write(`Error: --json value must be a JSON array of EditOperation objects.
`);
        process.exit(2);
      }
      edits = rawEdits;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: Failed to parse --json value: ${msg}
`);
      process.exit(2);
    }
  } else if (parsed.op) {
    edits = buildEditsFromFlags(parsed);
  }
  let lineCountDelta = 0;
  const warnings = [];
  if (edits.length > 0) {
    try {
      const result = await applyHashlineEdits(resolvedPath, edits);
      lineCountDelta = result.lineCountDelta;
      warnings.push(...result.warnings);
    } catch (err) {
      if (err instanceof HashlineMismatchError) {
        process.stderr.write(err.message + `
`);
        process.exit(2);
      }
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${msg}
`);
      process.exit(2);
    }
  }
  if (parsed.moveTo !== null) {
    const resolvedNewPath = resolvePath(parsed.moveTo, process.cwd());
    try {
      const targetDir = resolvedNewPath.slice(0, resolvedNewPath.lastIndexOf("/"));
      if (targetDir)
        await mkdir2(targetDir, { recursive: true });
      await rename(resolvedPath, resolvedNewPath);
      if (edits.length > 0) {
        const delta = lineCountDelta >= 0 ? `+${lineCountDelta}` : `${lineCountDelta}`;
        const opSummary = summarizeEdits(edits);
        let msg = `Applied edits to ${parsed.file} (${delta} lines), then moved to ${parsed.moveTo}`;
        if (opSummary)
          msg += `
${opSummary}`;
        if (warnings.length > 0)
          msg += `
Warnings:
${warnings.join(`
`)}`;
        process.stdout.write(msg + `
`);
      } else {
        process.stdout.write(`Moved file: ${parsed.file} \u2192 ${parsed.moveTo}
`);
      }
      process.exit(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: Could not move file from ${parsed.file} to ${parsed.moveTo} \u2014 ${msg}
`);
      process.exit(2);
    }
  }
  if (edits.length > 0) {
    const delta = lineCountDelta >= 0 ? `+${lineCountDelta}` : `${lineCountDelta}`;
    const opSummary = summarizeEdits(edits);
    let msg = `Applied edits to ${parsed.file} (${delta} lines)`;
    if (opSummary)
      msg += `
${opSummary}`;
    if (warnings.length > 0)
      msg += `
Warnings:
${warnings.join(`
`)}`;
    process.stdout.write(msg + `
`);
    process.exit(0);
  }
  process.stdout.write(USAGE);
  process.exit(0);
}
main();
