#!/usr/bin/env bun
// @bun

// src/cli/hg.ts
import { relative, isAbsolute as isAbsolute2 } from "path";

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

// src/lib/grep-search.ts
import { resolve as resolve2 } from "path";
import { readdir as readdir2, stat } from "fs/promises";
function looksLikeFilePath(s) {
  return (s.includes("/") || s.includes("\\")) && !s.includes("*") && !s.includes("?");
}
function parseRipgrepOutput(output) {
  const results = [];
  const lines = output.split(`
`);
  for (const line of lines) {
    if (!line || line === "--")
      continue;
    const matchResult = line.match(/^(.+?):(\d+):(.*)$/);
    if (matchResult) {
      results.push({
        filePath: matchResult[1],
        lineNumber: parseInt(matchResult[2], 10),
        isMatch: true,
        content: matchResult[3]
      });
      continue;
    }
    const contextResult = line.match(/^(.+?)-(\d+)-(.*)$/);
    if (contextResult) {
      results.push({
        filePath: contextResult[1],
        lineNumber: parseInt(contextResult[2], 10),
        isMatch: false,
        content: contextResult[3]
      });
    }
  }
  return results;
}
function formatGrepResults(matches) {
  if (matches.length === 0)
    return "";
  const fileGroups = new Map;
  for (const match of matches) {
    const group = fileGroups.get(match.filePath);
    if (group) {
      group.push(match);
    } else {
      fileGroups.set(match.filePath, [match]);
    }
  }
  const sections = [];
  for (const [filePath, fileMatches] of fileGroups) {
    const lines = [`## ${filePath}`];
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
    sections.push(lines.join(`
`));
  }
  return sections.join(`

`);
}
function formatFilesOnlyResults(matches) {
  const seen = new Set;
  for (const m of matches)
    seen.add(m.filePath);
  return [...seen].join(`
`);
}
function formatCountResults(matches) {
  const counts = new Map;
  for (const m of matches) {
    if (m.isMatch)
      counts.set(m.filePath, (counts.get(m.filePath) ?? 0) + 1);
  }
  const lines = [];
  let total = 0;
  for (const [filePath, count] of counts) {
    lines.push(`${filePath}: ${count}`);
    total += count;
  }
  lines.push(`
Total: ${total} matches in ${counts.size} files`);
  return lines.join(`
`);
}
async function* walkDirectory(dir, includePattern) {
  const entries = await readdir2(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules")
      continue;
    const fullPath = resolve2(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkDirectory(fullPath, includePattern);
    } else {
      if (includePattern && !includePattern.test(entry.name))
        continue;
      yield fullPath;
    }
  }
}
function globToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}
async function fsBasedSearch(opts) {
  const { pattern, searchPath, contextLines, includeGlob, ignoreCase, invertMatch } = opts;
  const regexFlags = ignoreCase ? "i" : "";
  const regex = new RegExp(pattern, regexFlags);
  const includeRe = includeGlob ? globToRegex(includeGlob) : undefined;
  const allMatches = [];
  let filePaths;
  const pathStat = await stat(searchPath).catch(() => null);
  if (pathStat?.isFile()) {
    filePaths = async function* () {
      yield searchPath;
    }();
  } else {
    filePaths = walkDirectory(searchPath, includeRe);
  }
  for await (const filePath of filePaths) {
    if (hasBinaryExtension(filePath))
      continue;
    try {
      const content = await Bun.file(filePath).text();
      const lines = content.split(`
`);
      const matchIndices = [];
      for (let i = 0;i < lines.length; i++) {
        if (invertMatch ? !regex.test(lines[i]) : regex.test(lines[i])) {
          matchIndices.push(i);
        }
      }
      if (matchIndices.length === 0)
        continue;
      const includedLines = new Set;
      for (const idx of matchIndices) {
        for (let c = Math.max(0, idx - contextLines);c <= Math.min(lines.length - 1, idx + contextLines); c++) {
          includedLines.add(c);
        }
      }
      const sortedIndices = Array.from(includedLines).sort((a, b) => a - b);
      const matchSet = new Set(matchIndices);
      for (const idx of sortedIndices) {
        allMatches.push({
          filePath,
          lineNumber: idx + 1,
          isMatch: matchSet.has(idx),
          content: lines[idx]
        });
      }
    } catch {}
  }
  return allMatches;
}
async function runRipgrep(opts) {
  const { pattern, searchPath, contextLines, includeGlob, ignoreCase, filesOnly, invertMatch, countOnly } = opts;
  const argv = [
    "rg",
    "--line-number",
    "--with-filename",
    "--color=never",
    "--max-columns=0"
  ];
  if (!filesOnly && !countOnly)
    argv.push(`-C${contextLines}`);
  if (ignoreCase)
    argv.push("--ignore-case");
  if (filesOnly)
    argv.push("--files-with-matches");
  if (invertMatch)
    argv.push("--invert-match");
  if (countOnly)
    argv.push("--count");
  if (includeGlob)
    argv.push("--glob", includeGlob);
  argv.push("-e", pattern, "--", searchPath);
  try {
    const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    const exit = await proc.exited;
    if (exit === 2)
      return null;
    return stdout;
  } catch {
    return null;
  }
}

// src/cli/hg.ts
var USAGE = `
hg \u2014 hashline grep (search files with hashline-annotated output)

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
function parseArgs(argv) {
  const result = {
    pattern: null,
    paths: [],
    ignoreCase: false,
    filesOnly: false,
    invertMatch: false,
    countOnly: false,
    contextLines: 2,
    includeGlob: undefined,
    help: false,
    error: null
  };
  const args = argv.slice(2);
  let i = 0;
  let stopFlagParsing = false;
  const positionals = [];
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
  if (positionals.length > 0) {
    result.pattern = positionals[0];
    result.paths = positionals.slice(1);
  }
  return result;
}
async function main() {
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
  if (args.filesOnly && args.countOnly) {
    console.error("Error: --files-only and --count cannot both be set.");
    process.exit(2);
  }
  let resolvedIncludeGlob = args.includeGlob;
  if (args.includeGlob && looksLikeFilePath(args.includeGlob)) {
    args.paths.push(args.includeGlob);
    resolvedIncludeGlob = undefined;
  }
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
    countOnly: args.countOnly
  };
  const searchOnePath = async (rawP) => {
    const sp = rawP ? resolvePath(rawP, cwd) : cwd;
    const opts = { ...baseGrepOpts, searchPath: sp };
    const rgOut = await runRipgrep(opts);
    if (rgOut !== null) {
      if (rgOut.trim().length === 0)
        return [];
      if (opts.filesOnly) {
        return rgOut.split(`
`).filter(Boolean).map((p) => ({
          filePath: isAbsolute2(p) ? relative(cwd, p) : p,
          lineNumber: 0,
          isMatch: true,
          content: ""
        }));
      }
      if (opts.countOnly) {
        const result = [];
        for (const line of rgOut.split(`
`)) {
          const m = line.match(/^(.+?):(\d+)$/);
          if (m) {
            const fp = isAbsolute2(m[1]) ? relative(cwd, m[1]) : m[1];
            const n = parseInt(m[2], 10);
            for (let i = 0;i < n; i++) {
              result.push({ filePath: fp, lineNumber: i + 1, isMatch: true, content: "" });
            }
          }
        }
        return result;
      }
      const parsed = parseRipgrepOutput(rgOut);
      for (const m of parsed) {
        if (isAbsolute2(m.filePath))
          m.filePath = relative(cwd, m.filePath);
      }
      return parsed;
    }
    const fMatches = await fsBasedSearch(opts);
    for (const m of fMatches) {
      if (isAbsolute2(m.filePath))
        m.filePath = relative(cwd, m.filePath);
    }
    return fMatches;
  };
  const allMatches = [];
  let anyError = null;
  for (const rawP of rawPaths) {
    try {
      allMatches.push(...await searchOnePath(rawP));
    } catch (err) {
      anyError = err instanceof Error ? err.message : String(err);
    }
  }
  if (allMatches.length === 0) {
    if (anyError) {
      console.error(`Error during search: ${anyError}`);
      process.exit(2);
    }
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
