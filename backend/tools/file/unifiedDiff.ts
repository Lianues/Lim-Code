/**
 * Unified diff（统一 diff / unified diff format）解析与应用
 *
 * 目标：
 * - 支持解析形如：
 *   --- a/file
 *   +++ b/file
 *   @@ -oldStart,oldCount +newStart,newCount @@
 *   [ ' ' | '+' | '-' ] lines...
 * - 严格按上下文匹配应用到原文件内容，生成 newContent
 *
 * 说明：
 * - 这里只处理“单文件 patch”。若检测到 multi-file patch 或 /dev/null，将抛错。
 * - 换行统一按 LF 处理。
 */

export type UnifiedDiffLineType = 'context' | 'add' | 'del';

export interface UnifiedDiffLine {
    type: UnifiedDiffLineType;
    content: string;
    /** 原始行（包含前缀符号），用于调试/错误提示 */
    raw: string;
}

export interface UnifiedDiffHunk {
    /** 原文件起始行（1-based） */
    oldStart: number;
    /** 原文件行数 */
    oldLines: number;
    /** 新文件起始行（1-based） */
    newStart: number;
    /** 新文件行数 */
    newLines: number;
    /** hunk header 原文 */
    header: string;
    lines: UnifiedDiffLine[];
}

export interface ParsedUnifiedDiff {
    oldFile?: string;
    newFile?: string;
    hunks: UnifiedDiffHunk[];
}

export interface AppliedHunkRange {
    index: number;
    /** 在“应用后的内容”中的起始行号（1-based） */
    startLine: number;
    /** 在“应用后的内容”中的结束行号（1-based） */
    endLine: number;
}

export interface ApplyUnifiedDiffResult {
    newContent: string;
    appliedHunks: AppliedHunkRange[];
}

function normalizeLineEndings(text: string): string {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function splitLinesPreserveTrailing(text: string): { lines: string[]; endsWithNewline: boolean } {
    const normalized = normalizeLineEndings(text);
    const endsWithNewline = normalized.endsWith('\n');
    const lines = normalized.split('\n');
    if (endsWithNewline) {
        // split 会产生最后一个空字符串，去掉以避免行号偏差
        lines.pop();
    }
    return { lines, endsWithNewline };
}

function joinLinesPreserveTrailing(lines: string[], endsWithNewline: boolean): string {
    const body = lines.join('\n');
    return endsWithNewline ? body + '\n' : body;
}

function parseFileHeaderPath(line: string, prefix: '---' | '+++'): string {
    // 形如："--- a/foo" / "+++ b/foo" / "--- /dev/null"
    // 也可能带时间戳："--- a/foo\t2020-..."
    const rest = line.slice(prefix.length).trim();
    // 去掉时间戳部分（tab 分隔）
    const p = rest.split('\t')[0]?.trim() || '';
    return p;
}

/**
 * 解析 unified diff patch（单文件）
 */
export function parseUnifiedDiff(patch: string): ParsedUnifiedDiff {
    const normalized = normalizeLineEndings(patch);
    const lines = normalized.split('\n');

    let oldFile: string | undefined;
    let newFile: string | undefined;
    const hunks: UnifiedDiffHunk[] = [];

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];

        if (line.startsWith('diff --git ')) {
            // 只允许出现一次文件块；若已经解析到 hunks/headers，再次出现则视为 multi-file
            if (hunks.length > 0 || oldFile || newFile) {
                throw new Error('Multi-file patch is not supported. Please split into one apply_diff call per file.');
            }
            i++;
            continue;
        }

        if (line.startsWith('--- ')) {
            if (oldFile && (hunks.length > 0 || newFile)) {
                // 第二个 --- 说明可能是 multi-file
                throw new Error('Multi-file patch is not supported. Please split into one apply_diff call per file.');
            }
            oldFile = parseFileHeaderPath(line, '---');
            i++;
            continue;
        }

        if (line.startsWith('+++ ')) {
            if (newFile && hunks.length > 0) {
                throw new Error('Multi-file patch is not supported. Please split into one apply_diff call per file.');
            }
            newFile = parseFileHeaderPath(line, '+++');
            i++;
            continue;
        }

        if (line.startsWith('@@')) {
            const header = line;
            const m = header.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
            if (!m) {
                throw new Error(
                    `Invalid hunk header: ${header}. ` +
                    `Expected format: @@ -oldStart,oldCount +newStart,newCount @@ ` +
                    `(oldCount/newCount optional, but start line numbers are required).`
                );
            }

            const oldStart = parseInt(m[1], 10);
            const oldCount = m[2] ? parseInt(m[2], 10) : 1;
            const newStart = parseInt(m[3], 10);
            const newCount = m[4] ? parseInt(m[4], 10) : 1;

            const hunkLines: UnifiedDiffLine[] = [];
            i++;
            while (i < lines.length) {
                const l = lines[i];

                if (l.startsWith('@@') || l.startsWith('--- ') || l.startsWith('diff --git ') || l.startsWith('+++ ')) {
                    break;
                }

                // patch 末尾通常会有一个空行（最后一个换行导致 split 出来），直接忽略
                if (l === '') {
                    i++;
                    continue;
                }

                // 特殊行："\\ No newline at end of file"
                if (l.startsWith('\\')) {
                    i++;
                    continue;
                }

                const prefix = l[0];
                const content = l.length > 0 ? l.slice(1) : '';

                if (prefix === ' ') {
                    hunkLines.push({ type: 'context', content, raw: l });
                } else if (prefix === '+') {
                    hunkLines.push({ type: 'add', content, raw: l });
                } else if (prefix === '-') {
                    hunkLines.push({ type: 'del', content, raw: l });
                } else {
                    // 非法前缀
                    throw new Error(`Invalid hunk line prefix '${prefix}' in line: ${l}`);
                }
                i++;
            }

            hunks.push({
                oldStart,
                oldLines: oldCount,
                newStart,
                newLines: newCount,
                header,
                lines: hunkLines
            });
            continue;
        }

        i++;
    }

    if (oldFile === '/dev/null' || newFile === '/dev/null') {
        throw new Error('Patches creating/deleting files via /dev/null are not supported. Use write_file/delete_file instead.');
    }

    if (hunks.length === 0) {
        throw new Error('No hunks (@@ ... @@) found in patch. Please provide a valid unified diff.');
    }

    return { oldFile, newFile, hunks };
}

function computeHunkNewLen(hunk: UnifiedDiffHunk): number {
    // newLen = context + add
    return hunk.lines.reduce((acc, l) => acc + (l.type === 'del' ? 0 : 1), 0);
}

/**
 * 对原内容应用 hunks（可选只应用部分索引）
 *
 * - 默认按 hunk.oldStart 及已应用 hunk 的 delta 来定位
 * - 严格匹配 context/del 行
 */
export function applyUnifiedDiffHunks(
    originalContent: string,
    hunks: UnifiedDiffHunk[],
    options?: {
        /** 只应用这些 hunk index（0-based，按原 hunks 顺序） */
        applyIndices?: Set<number>;
    }
): ApplyUnifiedDiffResult {
    const { lines, endsWithNewline } = splitLinesPreserveTrailing(originalContent);

    let delta = 0;
    const appliedHunks: AppliedHunkRange[] = [];

    for (let hunkIndex = 0; hunkIndex < hunks.length; hunkIndex++) {
        if (options?.applyIndices && !options.applyIndices.has(hunkIndex)) {
            continue;
        }

        const hunk = hunks[hunkIndex];
        if (hunk.oldStart < 0) {
            throw new Error(`Invalid hunk oldStart: ${hunk.oldStart}`);
        }

        // 统一 diff 的行号是 1-based；oldStart=0 只在特殊情况下出现，这里按插入到文件头处理
        const baseOldStart = Math.max(1, hunk.oldStart);
        const startIndex = baseOldStart - 1 + delta;

        if (startIndex < 0 || startIndex > lines.length) {
            throw new Error(`Hunk start is out of range. ${hunk.header}`);
        }

        let idx = startIndex;
        let removed = 0;
        let added = 0;

        for (const line of hunk.lines) {
            if (line.type === 'context') {
                const actual = lines[idx];
                if (actual !== line.content) {
                    throw new Error(
                        `Hunk context mismatch at ${hunk.header}.\nExpected: ${JSON.stringify(line.content)}\nActual:   ${JSON.stringify(actual)}`
                    );
                }
                idx++;
                continue;
            }

            if (line.type === 'del') {
                const actual = lines[idx];
                if (actual !== line.content) {
                    throw new Error(
                        `Hunk delete mismatch at ${hunk.header}.\nExpected: ${JSON.stringify(line.content)}\nActual:   ${JSON.stringify(actual)}`
                    );
                }
                lines.splice(idx, 1);
                removed++;
                continue;
            }

            // add
            lines.splice(idx, 0, line.content);
            idx++;
            added++;
        }

        const newLen = computeHunkNewLen(hunk);
        const startLine = startIndex + 1;
        const endLine = startLine + Math.max(newLen, 1) - 1;
        appliedHunks.push({ index: hunkIndex, startLine, endLine });

        delta += added - removed;
    }

    return {
        newContent: joinLinesPreserveTrailing(lines, endsWithNewline),
        appliedHunks
    };
}

/**
 * 应用完整 patch（单文件）
 */
export function applyUnifiedDiff(originalContent: string, parsed: ParsedUnifiedDiff): ApplyUnifiedDiffResult {
    return applyUnifiedDiffHunks(originalContent, parsed.hunks);
}
