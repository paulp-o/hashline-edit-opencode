export interface MismatchInfo {
    line: number;
    expected: string;
    actual: string;
    content: string;
    /** True when `line` is not in the file (e.g. empty file but anchor line 1). */
    outOfRange?: boolean;
}
export declare class HashlineMismatchError extends Error {
    readonly mismatches: MismatchInfo[];
    constructor(mismatches: MismatchInfo[], fileLines: string[], formatLineFn: (lineNum: number, content: string) => string);
}
//# sourceMappingURL=hashline-errors.d.ts.map