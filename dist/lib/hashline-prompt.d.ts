/**
 * hashline-prompt.ts — System prompt rendering for HashLine Edit plugin.
 *
 * Generates the LLM system prompt with runtime-computed hashes so that
 * every example hash exactly matches the actual hashing algorithm output.
 *
 * Based on oh-my-pi's hashline.md with 6 modifications:
 *  1. `read` → `hashline_read` (first sentence)
 *  2. `read` → `hashline_read` or `hashline_grep` (workflow #1)
 *  3. Added: grep-to-edit shortcut as workflow item #2
 *  4. `edit` → `hashline_edit` (workflow items #3-4)
 *  5. `last read` → `last hashline_read or hashline_grep` (atomicity note)
 *  6. `re-read the file` → `re-read the file with hashline_read` (recovery)
 */
/**
 * Render "N#HASH:content" for example display in the prompt.
 *
 * @param n 1-indexed line number.
 * @param content Raw line content.
 */
export declare function hlinefull(n: number, content: string): string;
/**
 * Render '"N#HASH"' for anchor references in the prompt.
 *
 * @param n 1-indexed line number.
 * @param content Raw line content.
 */
export declare function hlineref(n: number, content: string): string;
export declare const TOOL_DESCRIPTIONS: {
    hashline_read: string;
    hashline_edit: string;
    hashline_grep: string;
};
/**
 * Render the complete HashLine Edit system prompt.
 *
 * All hash examples are computed at runtime via computeLineHash(),
 * so they always match the actual algorithm output.
 */
export declare function renderHashlineEditPrompt(): string;
//# sourceMappingURL=hashline-prompt.d.ts.map