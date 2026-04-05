#!/usr/bin/env bun
// @bun

// src/cli/hread.ts
import { stat } from "fs/promises";

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

// src/cli/hread.ts
function printUsage() {
  process.stdout.write([
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
    "  --help,   -h           Show this help message"
  ].join(`
`) + `
`);
}
function parseArgs(argv) {
  const args = { filePath: null, offset: 1, limit: 2000, help: false };
  const rest = argv.slice(2);
  for (let i = 0;i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--offset" || arg === "-o") {
      const val = parseInt(rest[++i] ?? "", 10);
      if (isNaN(val) || val < 1) {
        process.stderr.write(`Error: --offset requires a positive integer
`);
        process.exit(2);
      }
      args.offset = val;
    } else if (arg === "--limit" || arg === "-l") {
      const val = parseInt(rest[++i] ?? "", 10);
      if (isNaN(val) || val < 1) {
        process.stderr.write(`Error: --limit requires a positive integer
`);
        process.exit(2);
      }
      args.limit = val;
    } else if (arg.startsWith("-")) {
      process.stderr.write(`Error: Unknown option: ${arg}
`);
      process.exit(2);
    } else {
      if (args.filePath !== null) {
        process.stderr.write(`Error: Multiple file paths specified. Provide a single path.
`);
        process.exit(2);
      }
      args.filePath = arg;
    }
  }
  return args;
}
async function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.filePath === null) {
    printUsage();
    process.exit(0);
  }
  const resolvedPath = resolvePath(args.filePath, process.cwd());
  let pathStat;
  try {
    pathStat = await stat(resolvedPath);
  } catch {
    process.stderr.write(`Error: File not found: ${args.filePath}
`);
    process.exit(2);
  }
  if (pathStat.isDirectory()) {
    const listing = await buildDirectoryListing(resolvedPath, resolvedPath);
    process.stdout.write((listing || "(empty directory)") + `
`);
    process.exit(0);
  }
  if (hasBinaryExtension(resolvedPath)) {
    process.stderr.write(`Error: Binary file detected (${args.filePath}). Use a binary-aware tool for binary files, images, or PDFs.
`);
    process.exit(2);
  }
  try {
    if (await isBinaryFile(resolvedPath)) {
      process.stderr.write(`Error: Binary file detected (${args.filePath}). Use a binary-aware tool for binary files, images, or PDFs.
`);
      process.exit(2);
    }
  } catch {
    process.stderr.write(`Error: Could not read file: ${args.filePath}
`);
    process.exit(2);
  }
  let content;
  try {
    content = await Bun.file(resolvedPath).text();
  } catch {
    process.stderr.write(`Error: Could not read file: ${args.filePath}
`);
    process.exit(2);
  }
  const allLines = content.split(`
`);
  const totalLines = allLines.length;
  const startIdx = Math.max(0, args.offset - 1);
  const endIdx = Math.min(totalLines, startIdx + args.limit);
  const sliced = allLines.slice(startIdx, endIdx);
  const truncated = sliced.map((line) => line.length > 2000 ? line.slice(0, 2000) + "... [truncated]" : line);
  const formatted = formatHashLines(truncated.join(`
`), startIdx + 1);
  const showingStart = startIdx + 1;
  const showingEnd = startIdx + sliced.length;
  if (totalLines > args.limit || args.offset > 1) {
    process.stdout.write(`(showing lines ${showingStart}-${showingEnd} of ${totalLines} total)
${formatted}
`);
  } else {
    process.stdout.write(formatted + `
`);
  }
}
main();
