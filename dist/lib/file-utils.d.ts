/**
 * file-utils.ts — Shared file utility functions used by MCP plugin and CLI tools.
 */
import type { EditOperation } from "./hashline-apply";
/** Known binary/image/PDF extensions to reject early. */
export declare const BINARY_EXTENSIONS: Set<string>;
/**
 * Check if a path has a known binary extension.
 */
export declare function hasBinaryExtension(filePath: string): boolean;
/**
 * Detect binary files by checking for null bytes in the first 8KB.
 * Returns true if the file appears to be binary.
 */
export declare function isBinaryFile(filePath: string): Promise<boolean>;
/**
 * Resolve a path relative to the context directory.
 * If the path is already absolute, it's returned as-is.
 */
export declare function resolvePath(filePath: string, contextDirectory: string): string;
export declare function getGitIgnoredSet(dirPath: string): Promise<Set<string>>;
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
export declare function buildDirectoryListing(dirPath: string, basePath: string, indent?: string, parentIgnored?: Set<string>): Promise<string>;
/**
 * Summarize edit operations for the response message.
 * Gives a concise description of what each edit did.
 */
export declare function summarizeEdits(edits: EditOperation[]): string;
//# sourceMappingURL=file-utils.d.ts.map