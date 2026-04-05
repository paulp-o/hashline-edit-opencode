/**
 * grep-search.ts — Shared grep/search functions used by MCP plugin and CLI tools.
 */
export interface GrepMatch {
    filePath: string;
    lineNumber: number;
    isMatch: boolean;
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
/**
 * Returns true when a string looks like a file path rather than a glob pattern.
 * Heuristic: contains a path separator and has no glob wildcard characters.
 */
export declare function looksLikeFilePath(s: string): boolean;
/**
 * Parse ripgrep output into structured matches.
 *
 * Line formats:
 *   match:   path:linenum:content
 *   context: path-linenum-content
 *   separator: --
 */
export declare function parseRipgrepOutput(output: string): GrepMatch[];
/**
 * Group grep matches by file and format with hashline annotations.
 */
export declare function formatGrepResults(matches: GrepMatch[]): string;
/**
 * Format results as a deduplicated list of file paths (filesOnly mode).
 */
export declare function formatFilesOnlyResults(matches: GrepMatch[]): string;
/**
 * Format per-file match counts (countOnly mode).
 */
export declare function formatCountResults(matches: GrepMatch[]): string;
/**
 * Walk a directory recursively, yielding file paths.
 */
export declare function walkDirectory(dir: string, includePattern?: RegExp): AsyncGenerator<string>;
/**
 * Convert a glob-like include pattern (e.g. "*.ts") to a RegExp.
 */
export declare function globToRegex(pattern: string): RegExp;
/**
 * Fallback search using the filesystem (no ripgrep dependency).
 */
export declare function fsBasedSearch(opts: GrepOptions): Promise<GrepMatch[]>;
/**
 * Run ripgrep with argv-safe `-e PATTERN -- PATH` (handles spaces, long patterns, leading `-`).
 * Returns stdout text, or null if rg is missing or exits with error (caller may fall back to fs search).
 */
export declare function runRipgrep(opts: GrepOptions): Promise<string | null>;
//# sourceMappingURL=grep-search.d.ts.map