/**
 * Apply Diff 工具 - 按用户设置选择两种格式应用文件变更：
 * - unified diff patch（---/+++/@ @/+/-）
 * - legacy search/replace/start_line diffs
 *
 * 支持多工作区（Multi-root Workspaces）
 */

import * as fs from 'fs';
import type { Tool, ToolDeclaration, ToolResult } from '../types';
import { getDiffManager } from './diffManager';
import { resolveUriWithInfo, getAllWorkspaces } from '../utils';
import { getDiffStorageManager } from '../../modules/conversation';
import { getGlobalSettingsManager } from '../../core/settingsContext';
import { applyUnifiedDiffBestEffort, parseUnifiedDiff, type UnifiedDiffHunk } from './unifiedDiff';

/**
 * Legacy：单个 search/replace diff（仍被 DiffManager 用于旧结构的块级 accept/reject 逻辑）
 */
export interface LegacyDiffBlock {
    /** 要搜索的内容（必须 100% 精确匹配） */
    search: string;
    /** 替换后的内容 */
    replace: string;
    /** 搜索起始行号（1-based，可选） */
    start_line?: number;
}

/**
 * 结构化 hunk：apply_diff 的推荐新输入格式。
 *
 * 为什么要新增：旧 patch 字符串要求模型同时处理 JSON 字符串转义和 unified diff 前缀，容易把 `"` 当成文件内容写入。
 * 怎么改：把每个连续修改片段拆成 oldContent/newContent 字段，字段值按 JSON 字符串规则进入工具后直接作为最终文本使用。
 * 目的：保留多 hunk 能力来处理行号偏移，同时让内容字段和 write_file.content 的语义保持一致。
 */
export interface StructuredDiffHunk {
    /** 要被替换的原始内容，必须和当前文件内容精确匹配 */
    oldContent: string;
    /** 替换后的目标内容，按最终文件内容填写 */
    newContent: string;
    /** 可选。仅当 oldContent 在文件中重复出现时用于定位，1-based，基于原文件行号。 */
    startLine?: number;
}

/**
 * 规范化换行符为 LF
 */
function normalizeLineEndings(text: string): string {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function findAllExactMatchLineNumbers(
    normalizedContent: string,
    normalizedSearch: string,
    options?: {
        /** 最多返回多少个候选（避免返回体过大） */
        limit?: number;
    }
): number[] {
    if (!normalizedSearch) return [];

    const limit = options?.limit ?? 20;

    const result: number[] = [];
    let fromIndex = 0;
    let scanIndex = 0;
    let currentLine = 1;

    while (result.length < limit) {
        const pos = normalizedContent.indexOf(normalizedSearch, fromIndex);
        if (pos === -1) {
            break;
        }

        // 从 scanIndex 扫描到 pos，累计行号（scanIndex 单调递增，整体 O(n)）
        for (; scanIndex < pos; scanIndex++) {
            if (normalizedContent.charCodeAt(scanIndex) === 10) {
                currentLine++;
            }
        }

        result.push(currentLine);

        // 继续往后找（按非重叠匹配推进，避免候选行噪声）
        fromIndex = pos + Math.max(1, normalizedSearch.length);
    }

    return result;
}

function findAllExactMatchIndexes(normalizedContent: string, normalizedSearch: string): number[] {
    // 为什么要单独返回索引：结构化 hunks 需要先判断 oldContent 是否唯一，唯一时必须忽略 startLine，避免 stale line number 让本来正确的内容替换失败。
    // 怎么改：使用非重叠 indexOf 扫描，和 legacy search/replace 的匹配语义保持一致。
    // 目的：让“内容唯一优先，重复时才看 startLine”的规则有稳定、可测试的实现边界。
    if (!normalizedSearch) return [];

    const result: number[] = [];
    let fromIndex = 0;

    while (fromIndex <= normalizedContent.length) {
        const pos = normalizedContent.indexOf(normalizedSearch, fromIndex);
        if (pos === -1) break;

        result.push(pos);
        fromIndex = pos + Math.max(1, normalizedSearch.length);
    }

    return result;
}

function getCharOffsetForLine(normalizedContent: string, line: number): number | undefined {
    // 为什么要从行号转换为字符偏移：重复 oldContent 时 startLine 只是定位提示，最终替换仍然是字符串精确替换。
    // 怎么改：按 LF 扫描到指定 1-based 行的开头，超出文件范围时返回 undefined。
    // 目的：兼容现有 legacy start_line“从某行开始搜索”的用户心智，同时避免在内容唯一时依赖行号。
    if (!Number.isFinite(line) || line < 1) return undefined;
    if (line === 1) return 0;

    let currentLine = 1;
    for (let i = 0; i < normalizedContent.length; i++) {
        if (normalizedContent.charCodeAt(i) === 10) {
            currentLine++;
            if (currentLine === line) {
                return i + 1;
            }
        }
    }

    return undefined;
}

function getLineNumberAtIndex(normalizedContent: string, index: number): number {
    // 为什么要反算行号：前端 diff 面板和块级接受/拒绝需要知道每个 hunk 实际应用在哪一行。
    // 怎么改：只统计 index 之前的 LF 数量，得到 1-based 行号。
    // 目的：返回真实匹配位置，而不是盲信模型给出的 startLine。
    let line = 1;
    for (let i = 0; i < index; i++) {
        if (normalizedContent.charCodeAt(i) === 10) {
            line++;
        }
    }
    return line;
}

function countTextLines(normalizedText: string): number {
    // 为什么要统一计算展示行数：diff block 的 endLine 需要描述替换内容在审阅面板里的可见范围。
    // 怎么改：按 normalize 后的 LF 分割计算展示意义上的行数，空字符串按 0 行处理；lineDelta 另用 countLineBreaks 计算真实行号偏移。
    // 目的：区分“展示范围”和“后续 startLine 偏移”，避免删除整行时把后续定位多减一行。
    if (!normalizedText) return 0;
    return normalizedText.split('\n').length;
}

function countLineBreaks(normalizedText: string): number {
    // 修改原因：startLine 的 lineDelta 表示后续原始行号被前序 hunk 推动了多少行，真实变化取决于 LF 数量差，而不是展示行数差。
    // 修改方式：单独统计文本中的 LF 字符数量，避免删除 `first\n` 到空字符串时把行号多减一。
    // 修改目的：让前序插入、删除和替换都能正确调整后续重复 oldContent 的 startLine 定位。
    let count = 0;
    for (let i = 0; i < normalizedText.length; i++) {
        if (normalizedText.charCodeAt(i) === 10) count++;
    }
    return count;
}

type StructuredMatchKind = 'exact' | 'indent_fallback';

interface StructuredLineSpan {
    content: string;
    newline: '' | '\n';
    startIndex: number;
    endIndex: number;
    lineNumber: number;
}

interface StructuredMatchCandidate {
    startIndex: number;
    endIndex: number;
    startLine: number;
    matchedOldContent: string;
}

interface ResolvedStructuredMatch {
    kind: StructuredMatchKind;
    startIndex: number;
    endIndex: number;
    startLine: number;
    matchCount: number;
    candidateLines?: number[];
    matchedOldContent: string;
    replacementContent: string;
}

function tokenizeNormalizedLinesWithSpans(normalizedText: string): StructuredLineSpan[] {
    // 修改原因：缩进容错必须在“完整连续行窗口”上匹配，不能退化成不安全的任意子串 fuzzy 匹配。
    // 修改方式：把已规范化为 LF 的文本切成带起止字符偏移、行号和末尾换行标记的逻辑行。
    // 修改目的：后续 fallback 能用真实字符范围 splice，同时保留 final newline 的精确语义。
    const lines: StructuredLineSpan[] = [];
    if (!normalizedText) return lines;

    let startIndex = 0;
    let lineNumber = 1;

    while (startIndex < normalizedText.length) {
        const newlineIndex = normalizedText.indexOf('\n', startIndex);
        if (newlineIndex === -1) {
            lines.push({
                content: normalizedText.slice(startIndex),
                newline: '',
                startIndex,
                endIndex: normalizedText.length,
                lineNumber
            });
            break;
        }

        lines.push({
            content: normalizedText.slice(startIndex, newlineIndex),
            newline: '\n',
            startIndex,
            endIndex: newlineIndex + 1,
            lineNumber
        });

        startIndex = newlineIndex + 1;
        lineNumber++;
    }

    return lines;
}

function getLeadingHorizontalWhitespace(line: string): string {
    // 修改原因：AI 最常见的 oldContent 失败来自每行行首缩进误差，而不是代码主体变化。
    // 修改方式：只识别空格和 tab 组成的行首横向缩进，不触碰行内空白或其它字符。
    // 修改目的：把容错边界限制在缩进层面，避免字符串内容、参数间空格等语义内容被误忽略。
    return line.match(/^[ \t]*/)?.[0] ?? '';
}

function stripLeadingHorizontalWhitespace(line: string): string {
    return line.slice(getLeadingHorizontalWhitespace(line).length);
}

function hasNonWhitespaceBody(lines: StructuredLineSpan[]): boolean {
    // 修改原因：只包含空行或缩进的 oldContent 在缩进容错下信息量为零，自动应用风险过高。
    // 修改方式：要求至少一行在去掉行首缩进后仍有非空主体。
    // 修改目的：阻止纯空白块通过 fallback 命中任意空白区域。
    return lines.some(line => stripLeadingHorizontalWhitespace(line.content).trim().length > 0);
}

function findIndentFallbackCandidates(
    normalizedContent: string,
    normalizedOldContent: string
): { candidates: StructuredMatchCandidate[]; disabledReason?: string } {
    // 修改原因：精确匹配失败时需要兜底 AI 写错缩进的 oldContent，但不能引入通用 fuzzy 匹配的误落点风险。
    // 修改方式：按连续完整行窗口扫描；比较时只忽略每行行首空格/tab，行内空白、空行数量和换行结尾保持严格。
    // 修改目的：让缩进错误可以自动恢复，同时保留候选唯一性/startLine 这条安全边界。
    const contentLines = tokenizeNormalizedLinesWithSpans(normalizedContent);
    const searchLines = tokenizeNormalizedLinesWithSpans(normalizedOldContent);

    if (searchLines.length === 0) {
        return { candidates: [], disabledReason: 'oldContent has no logical lines.' };
    }

    if (!hasNonWhitespaceBody(searchLines)) {
        return {
            candidates: [],
            disabledReason: 'oldContent contains only blank or indentation-only lines; provide non-whitespace context.'
        };
    }

    if (searchLines.length > contentLines.length) {
        return { candidates: [] };
    }

    const candidates: StructuredMatchCandidate[] = [];

    for (let startLineIndex = 0; startLineIndex <= contentLines.length - searchLines.length; startLineIndex++) {
        let ok = true;

        for (let offset = 0; offset < searchLines.length; offset++) {
            const searchLine = searchLines[offset];
            const contentLine = contentLines[startLineIndex + offset];

            if (stripLeadingHorizontalWhitespace(searchLine.content) !== stripLeadingHorizontalWhitespace(contentLine.content)) {
                ok = false;
                break;
            }

            if (searchLine.newline === '\n' && contentLine.newline !== '\n') {
                ok = false;
                break;
            }
        }

        if (!ok) continue;

        const firstLine = contentLines[startLineIndex];
        const lastSearchLine = searchLines[searchLines.length - 1];
        const lastContentLine = contentLines[startLineIndex + searchLines.length - 1];
        const endIndex = lastSearchLine.newline === '\n'
            ? lastContentLine.endIndex
            : lastContentLine.startIndex + lastContentLine.content.length;

        candidates.push({
            startIndex: firstLine.startIndex,
            endIndex,
            startLine: firstLine.lineNumber,
            matchedOldContent: normalizedContent.slice(firstLine.startIndex, endIndex)
        });
    }

    return { candidates };
}

function buildNewToOldLineAlignment(oldLines: StructuredLineSpan[], newLines: StructuredLineSpan[]): Array<number | undefined> {
    // 修改原因：fallback 命中后，newContent 的缩进也可能跟 oldContent 一样是模型误写的，不能按同一行号硬套真实缩进。
    // 修改方式：先用去行首缩进后的主体做 LCS 找稳定锚点，再在锚点之间按顺序配对 changed chunk。
    // 修改目的：插入、删除、替换混合出现时，缩进重映射仍能依赖相对可靠的行级对应关系。
    const oldBodies = oldLines.map(line => stripLeadingHorizontalWhitespace(line.content));
    const newBodies = newLines.map(line => stripLeadingHorizontalWhitespace(line.content));
    const dp: number[][] = Array.from({ length: oldBodies.length + 1 }, () => Array(newBodies.length + 1).fill(0));

    for (let i = oldBodies.length - 1; i >= 0; i--) {
        for (let j = newBodies.length - 1; j >= 0; j--) {
            dp[i][j] = oldBodies[i] === newBodies[j]
                ? dp[i + 1][j + 1] + 1
                : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }

    const anchors: Array<{ oldIndex: number; newIndex: number }> = [];
    let oldIndex = 0;
    let newIndex = 0;

    while (oldIndex < oldBodies.length && newIndex < newBodies.length) {
        if (oldBodies[oldIndex] === newBodies[newIndex]) {
            anchors.push({ oldIndex, newIndex });
            oldIndex++;
            newIndex++;
        } else if (dp[oldIndex + 1][newIndex] >= dp[oldIndex][newIndex + 1]) {
            oldIndex++;
        } else {
            newIndex++;
        }
    }

    const alignment: Array<number | undefined> = Array(newLines.length).fill(undefined);
    let previousOld = -1;
    let previousNew = -1;

    for (const anchor of [...anchors, { oldIndex: oldLines.length, newIndex: newLines.length }]) {
        const oldGapStart = previousOld + 1;
        const newGapStart = previousNew + 1;
        const oldGapLength = anchor.oldIndex - oldGapStart;
        const newGapLength = anchor.newIndex - newGapStart;
        const pairedGapLength = Math.min(oldGapLength, newGapLength);

        for (let i = 0; i < pairedGapLength; i++) {
            alignment[newGapStart + i] = oldGapStart + i;
        }

        if (anchor.newIndex < newLines.length) {
            alignment[anchor.newIndex] = anchor.oldIndex;
        }

        previousOld = anchor.oldIndex;
        previousNew = anchor.newIndex;
    }

    return alignment;
}

function findNearestAlignedOldIndex(alignment: Array<number | undefined>, newLineIndex: number): number | undefined {
    for (let i = newLineIndex - 1; i >= 0; i--) {
        if (alignment[i] !== undefined) return alignment[i];
    }

    for (let i = newLineIndex + 1; i < alignment.length; i++) {
        if (alignment[i] !== undefined) return alignment[i];
    }

    return undefined;
}

function findFirstNonEmptyLineIndex(lines: StructuredLineSpan[]): number | undefined {
    const index = lines.findIndex(line => stripLeadingHorizontalWhitespace(line.content).trim().length > 0);
    return index === -1 ? undefined : index;
}

function remapNewContentIndentation(
    normalizedOldContent: string,
    normalizedNewContent: string,
    matchedOldContent: string
): string {
    // 修改原因：缩进 fallback 找到真实块以后，如果直接写入模型的 newContent，会把同样错误的缩进带进目标文件。
    // 修改方式：基于 oldContent/newContent 的行级 alignment，把 newContent 每行的“相对模型缩进”平移到真实匹配块的缩进上。
    // 修改目的：既自动修正 AI 的整体缩进偏差，又保留新增嵌套行相对锚点更深一层的缩进。
    const oldLines = tokenizeNormalizedLinesWithSpans(normalizedOldContent);
    const newLines = tokenizeNormalizedLinesWithSpans(normalizedNewContent);
    const matchedLines = tokenizeNormalizedLinesWithSpans(matchedOldContent);

    if (newLines.length === 0) return '';

    const alignment = buildNewToOldLineAlignment(oldLines, newLines);
    const fallbackOldIndex = findFirstNonEmptyLineIndex(oldLines);

    return newLines.map((line, newLineIndex) => {
        if (stripLeadingHorizontalWhitespace(line.content).trim().length === 0) {
            return line.content + line.newline;
        }

        const oldLineIndex = alignment[newLineIndex]
            ?? findNearestAlignedOldIndex(alignment, newLineIndex)
            ?? fallbackOldIndex;

        if (oldLineIndex === undefined || !oldLines[oldLineIndex] || !matchedLines[oldLineIndex]) {
            return line.content + line.newline;
        }

        const modelAnchorIndent = getLeadingHorizontalWhitespace(oldLines[oldLineIndex].content);
        const realAnchorIndent = getLeadingHorizontalWhitespace(matchedLines[oldLineIndex].content);
        const modelLineIndent = getLeadingHorizontalWhitespace(line.content);

        if (!modelLineIndent.startsWith(modelAnchorIndent)) {
            // 修改原因：有些修改是有意 outdent，强行重映射会改变用户想要的结构。
            // 修改方式：当前行无法证明是相对锚点的缩进时保留原样，只修正可证明的整体缩进偏移。
            // 修改目的：让 fallback 保守地修正常见 AI 缩进偏差，而不是替用户猜测语义级缩进调整。
            return line.content + line.newline;
        }

        return realAnchorIndent + line.content.slice(modelAnchorIndent.length) + line.newline;
    }).join('');
}

function resolveStructuredHunkMatch(
    currentContent: string,
    oldContent: string,
    newContent: string,
    hunk: StructuredDiffHunk,
    lineDelta: number
): { success: true; match: ResolvedStructuredMatch } | {
    success: false;
    error: string;
    matchCount?: number;
    candidateLines?: number[];
} {
    // 修改原因：结构化 hunk 需要同时支持精确匹配和缩进容错 fallback，二者必须共享 startLine、lineDelta 和候选歧义规则。
    // 修改方式：先执行原有 exact indexOf 逻辑；仅当 exact 为 0 时，才进入完整行窗口的 indent fallback。
    // 修改目的：保持历史成功路径完全不变，同时把 AI 缩进误差收敛到一个可审计的匹配解析函数。
    const matches = findAllExactMatchIndexes(currentContent, oldContent);

    if (matches.length === 1) {
        const startIndex = matches[0];
        return {
            success: true,
            match: {
                kind: 'exact',
                startIndex,
                endIndex: startIndex + oldContent.length,
                startLine: getLineNumberAtIndex(currentContent, startIndex),
                matchCount: 1,
                matchedOldContent: oldContent,
                replacementContent: newContent
            }
        };
    }

    if (matches.length > 1) {
        const candidateLines = matches.map(index => getLineNumberAtIndex(currentContent, index));
        if (hunk.startLine === undefined) {
            return {
                success: false,
                error: `Multiple matches found (${matches.length}). Provide startLine to choose which oldContent occurrence to replace. Candidate match lines: ${candidateLines.join(', ')}.`,
                matchCount: matches.length,
                candidateLines
            };
        }

        const adjustedStartLine = hunk.startLine + lineDelta;
        const startOffset = getCharOffsetForLine(currentContent, adjustedStartLine);
        if (startOffset === undefined) {
            return {
                success: false,
                error: `startLine ${hunk.startLine} adjusted to ${adjustedStartLine}, which is outside the current file after previous hunks.`,
                matchCount: matches.length,
                candidateLines
            };
        }

        const startIndex = matches.find(index => index >= startOffset);
        if (startIndex === undefined) {
            return {
                success: false,
                error: `Multiple matches found (${matches.length}), but none occur at or after startLine ${hunk.startLine} after line-offset adjustment. Candidate match lines: ${candidateLines.join(', ')}.`,
                matchCount: matches.length,
                candidateLines
            };
        }

        return {
            success: true,
            match: {
                kind: 'exact',
                startIndex,
                endIndex: startIndex + oldContent.length,
                startLine: getLineNumberAtIndex(currentContent, startIndex),
                matchCount: matches.length,
                candidateLines,
                matchedOldContent: oldContent,
                replacementContent: newContent
            }
        };
    }

    const fallback = findIndentFallbackCandidates(currentContent, oldContent);
    if (fallback.disabledReason) {
        return {
            success: false,
            error: `No exact match found for oldContent. Indentation fallback was not attempted: ${fallback.disabledReason}`,
            matchCount: 0
        };
    }

    if (fallback.candidates.length === 0) {
        return {
            success: false,
            error: 'No exact match found for oldContent. Also tried indentation-tolerant line matching (leading spaces/tabs only), but no candidate block matched. Please verify the non-indentation content exactly.',
            matchCount: 0
        };
    }

    const candidateLines = fallback.candidates.map(candidate => candidate.startLine);
    let candidate: StructuredMatchCandidate | undefined;

    if (fallback.candidates.length === 1) {
        candidate = fallback.candidates[0];
    } else {
        if (hunk.startLine === undefined) {
            return {
                success: false,
                error: `No exact match found for oldContent. Indentation fallback found multiple candidates (${fallback.candidates.length}). Provide startLine to choose which occurrence to replace. Candidate match lines: ${candidateLines.join(', ')}.`,
                matchCount: fallback.candidates.length,
                candidateLines
            };
        }

        const adjustedStartLine = hunk.startLine + lineDelta;
        const startOffset = getCharOffsetForLine(currentContent, adjustedStartLine);
        if (startOffset === undefined) {
            return {
                success: false,
                error: `No exact match found for oldContent. Indentation fallback found candidates, but startLine ${hunk.startLine} adjusted to ${adjustedStartLine}, which is outside the current file after previous hunks.`,
                matchCount: fallback.candidates.length,
                candidateLines
            };
        }

        candidate = fallback.candidates.find(item => item.startIndex >= startOffset);
        if (!candidate) {
            return {
                success: false,
                error: `No exact match found for oldContent. Indentation fallback found multiple candidates (${fallback.candidates.length}), but none occur at or after startLine ${hunk.startLine} after line-offset adjustment. Candidate match lines: ${candidateLines.join(', ')}.`,
                matchCount: fallback.candidates.length,
                candidateLines
            };
        }
    }

    return {
        success: true,
        match: {
            kind: 'indent_fallback',
            startIndex: candidate.startIndex,
            endIndex: candidate.endIndex,
            startLine: candidate.startLine,
            matchCount: fallback.candidates.length,
            candidateLines: fallback.candidates.length > 1 ? candidateLines : undefined,
            matchedOldContent: candidate.matchedOldContent,
            replacementContent: remapNewContentIndentation(oldContent, newContent, candidate.matchedOldContent)
        }
    };
}


export function applyStructuredDiffHunksBestEffort(
    originalContent: string,
    hunks: StructuredDiffHunk[],
    options?: {
        /** 只应用这些 hunk index（0-based，按原 hunks 顺序） */
        applyIndices?: Set<number>;
    }
): {
    newContent: string;
    results: Array<{
        index: number;
        success: boolean;
        error?: string;
        startLine?: number;
        endLine?: number;
        matchCount?: number;
        candidateLines?: number[];
        matchKind?: StructuredMatchKind;
    }>;
    blocks: Array<{ index: number; startLine: number; endLine: number }>;
    appliedCount: number;
    failedCount: number;
} {
    // 为什么要把结构化 hunk 应用逻辑做成导出函数：工具入口和 DiffManager 块级接受/拒绝都需要同一套重放语义，不能各写一份。
    // 怎么改：逐 hunk 处理；先保持 exact 匹配原有语义，exact 为 0 时才启用行首缩进容错，并根据已应用 hunk 的行数变化维护偏移。
    // 目的：同时解决 JSON 转义误写、多个修改点行号漂移、AI 缩进误差、以及块级拒绝后重新计算内容的一致性问题。
    let currentContent = normalizeLineEndings(originalContent);
    let lineDelta = 0;

    const results: Array<{
        index: number;
        success: boolean;
        error?: string;
        startLine?: number;
        endLine?: number;
        matchCount?: number;
        candidateLines?: number[];
        matchKind?: StructuredMatchKind;
    }> = [];
    const blocks: Array<{ index: number; startLine: number; endLine: number }> = [];

    for (let i = 0; i < hunks.length; i++) {
        if (options?.applyIndices && !options.applyIndices.has(i)) {
            continue;
        }

        const hunk = hunks[i];
        if (!hunk || typeof hunk.oldContent !== 'string' || typeof hunk.newContent !== 'string') {
            results.push({
                index: i,
                success: false,
                error: `Structured hunk at index ${i} must contain string oldContent and newContent.`
            });
            continue;
        }

        const oldContent = normalizeLineEndings(hunk.oldContent);
        const newContent = normalizeLineEndings(hunk.newContent);

        if (!oldContent) {
            results.push({
                index: i,
                success: false,
                error: `Structured hunk at index ${i} has empty oldContent. Provide enough existing content to locate the change.`
            });
            continue;
        }

        const resolved = resolveStructuredHunkMatch(currentContent, oldContent, newContent, hunk, lineDelta);

        // 修改原因：当前 TypeScript 配置不会在 `!resolved.success` 下稳定收窄布尔字面量联合类型。
        // 修改方式：改用 `resolved.success === false`，让失败分支可以安全读取 error/matchCount/candidateLines。
        // 修改目的：保持匹配结果类型严格，同时避免为了通过编译而放宽成 any。
        if (resolved.success === false) {
            results.push({
                index: i,
                success: false,
                error: resolved.error,
                matchCount: resolved.matchCount,
                candidateLines: resolved.candidateLines
            });
            continue;
        }

        const { match } = resolved;
        const oldLineCount = countTextLines(match.matchedOldContent);
        const newLineCount = countTextLines(match.replacementContent);
        const endLine = match.startLine + Math.max(newLineCount, 1) - 1;

        // 修改原因：缩进 fallback 的真实替换范围可能不同于模型给出的 oldContent 字符串，不能再用 oldContent.length 拼接。
        // 修改方式：统一使用解析后的 startIndex/endIndex 和 replacementContent 执行 splice。
        // 修改目的：让 exact 与 indent_fallback 共享同一条安全替换路径，并保留 final newline 的真实范围。
        currentContent =
            currentContent.substring(0, match.startIndex) +
            match.replacementContent +
            currentContent.substring(match.endIndex);

        lineDelta += countLineBreaks(match.replacementContent) - countLineBreaks(match.matchedOldContent);
        results.push({
            index: i,
            success: true,
            startLine: match.startLine,
            endLine,
            matchCount: match.matchCount,
            candidateLines: match.candidateLines,
            matchKind: match.kind
        });
        blocks.push({ index: i, startLine: match.startLine, endLine });
    }

    const appliedCount = results.filter(x => x.success).length;
    const failedCount = results.length - appliedCount;

    return {
        newContent: currentContent,
        results,
        blocks,
        appliedCount,
        failedCount
    };
}

/**
 * 对常见“AI 包裹/噪声行”做轻量去除，提升 loose patch 解析兼容性。
 *
 * 说明：
 * - 这是 unifiedDiff.ts 中 sanitize 的轻量副本，避免引入跨模块依赖。
 * - 仅移除明显不属于 patch 的外层壳；不做语义修复。
 */
function sanitizeLooseUnifiedPatch(patch: string): string {
    const normalized = normalizeLineEndings(patch);
    const lines = normalized.split('\n');
    const out: string[] = [];

    for (const line of lines) {
        // Markdown code fences（``` / ```diff / ```patch）
        if (line.startsWith('```')) {
            continue;
        }

        // 常见 ApplyPatch 风格包裹（*** Begin Patch / *** Update File: / *** End Patch 等）
        if (line.startsWith('***')) {
            if (
                line === '***' ||
                line.startsWith('*** Begin Patch') ||
                line.startsWith('*** End Patch') ||
                line.startsWith('*** Update File:') ||
                line.startsWith('*** Add File:') ||
                line.startsWith('*** Delete File:') ||
                line.startsWith('*** End of File')
            ) {
                continue;
            }
        }

        out.push(line);
    }

    return out.join('\n');
}

/**
 * 将“裸 @@”的 unified diff hunks 解析为 legacy search/replace diffs。
 *
 * 兜底语义：
 * - 每个 hunk 头以 `@@` 开始（不要求带行号）
 * - hunk 内：
 *   - search = context(' ') + del('-')
 *   - replace = context(' ') + add('+')
 */
function parseLooseUnifiedPatchToLegacyDiffs(patch: string): LegacyDiffBlock[] {
    const normalized = sanitizeLooseUnifiedPatch(patch);
    const lines = normalized.split('\n');

    const diffs: LegacyDiffBlock[] = [];

    let inHunk = false;
    let searchLines: string[] = [];
    let replaceLines: string[] = [];

    const flush = () => {
        if (!inHunk) return;
        const search = searchLines.join('\n');
        const replace = replaceLines.join('\n');

        // 没有 search 无法定位（裸 @@ 没有行号），直接拒绝
        if (!search.trim()) {
            throw new Error('Loose @@ hunk has empty search block. Please provide context lines so it can be matched uniquely.');
        }

        diffs.push({ search, replace });
        searchLines = [];
        replaceLines = [];
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // 新 hunk
        if (line.startsWith('@@')) {
            flush();
            inHunk = true;
            continue;
        }

        if (!inHunk) {
            // 跳过 file header / diff header 等
            continue;
        }

        // 结束条件：遇到文件头/新的 diff 块
        if (line.startsWith('diff --git ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
            // flush 当前 hunk，然后回到非 hunk 状态
            flush();
            inHunk = false;
            continue;
        }

        // 统一 diff 里常见的特殊行："\\ No newline at end of file"
        if (line.startsWith('\\')) {
            continue;
        }

        // 忽略纯空行（一般是 patch 末尾 split 出来的噪声）
        if (line === '') {
            continue;
        }

        const prefix = line[0];
        const content = line.length > 0 ? line.slice(1) : '';

        if (prefix === ' ') {
            searchLines.push(content);
            replaceLines.push(content);
        } else if (prefix === '-') {
            searchLines.push(content);
        } else if (prefix === '+') {
            replaceLines.push(content);
        } else {
            // 兜底：AI 可能会漏掉前缀，将其视为 context 行
            searchLines.push(line);
            replaceLines.push(line);
        }
    }

    flush();

    if (diffs.length === 0) {
        throw new Error('No hunks (@@) found in patch.');
    }

    return diffs;
}

function convertUnifiedHunksToLegacyDiffs(hunks: UnifiedDiffHunk[]): LegacyDiffBlock[] {
    return hunks.map(h => {
        // 为 unified fallback 提供行号锚点，避免全局 search 在重复上下文中出现“多处匹配”歧义。
        // 这里使用 oldStart（1-based）作为起点提示：
        // - 与 hunk 在原文件中的定位语义一致
        // - 即使 search 很短（如仅 "}"），也能优先命中预期区域的首个匹配
        const startLineHint = Number.isFinite(h.oldStart) ? Math.max(1, h.oldStart) : undefined;

        const searchLines: string[] = [];
        const replaceLines: string[] = [];

        for (const l of h.lines) {
            if (l.type === 'context') {
                searchLines.push(l.content);
                replaceLines.push(l.content);
                continue;
            }

            if (l.type === 'del') {
                searchLines.push(l.content);
                continue;
            }

            // add
            replaceLines.push(l.content);
        }

        return {
            search: searchLines.join('\n'),
            replace: replaceLines.join('\n'),
            start_line: startLineHint
        };
    });
}

/**
 * Legacy：应用单个 search/replace diff
 */
export function applyDiffToContent(
    content: string,
    search: string,
    replace: string,
    startLine?: number
): {
    success: boolean;
    result: string;
    error?: string;
    matchCount: number;
    matchedLine?: number;
    /** 当匹配不唯一时，返回候选行号（1-based，最多返回部分） */
    candidateLines?: number[];
} {
    const normalizedContent = normalizeLineEndings(content);
    const normalizedSearch = normalizeLineEndings(search);
    const normalizedReplace = normalizeLineEndings(replace);

    if (!normalizedSearch) {
        return {
            success: false,
            result: normalizedContent,
            error: 'Search content is empty. Please provide enough context so the change can be located.',
            matchCount: 0
        };
    }

    // 如果提供了起始行号，从该行开始搜索
    if (startLine !== undefined && startLine > 0) {
        const lines = normalizedContent.split('\n');
        const startIndex = startLine - 1;

        if (startIndex >= lines.length) {
            return {
                success: false,
                result: normalizedContent,
                error: `Start line ${startLine} is out of range. File has ${lines.length} lines.`,
                matchCount: 0
            };
        }

        // 计算从起始行开始的字符位置
        let charOffset = 0;
        for (let i = 0; i < startIndex; i++) {
            charOffset += lines[i].length + 1;
        }

        // 从起始位置开始查找
        const contentFromStart = normalizedContent.substring(charOffset);
        const matchIndex = contentFromStart.indexOf(normalizedSearch);

        if (matchIndex === -1) {
            return {
                success: false,
                result: normalizedContent,
                error: `No exact match found starting from line ${startLine}.`,
                matchCount: 0
            };
        }

        // 计算实际匹配的行号
        const textBeforeMatch = normalizedContent.substring(0, charOffset + matchIndex);
        const actualMatchedLine = textBeforeMatch.split('\n').length;

        // 执行替换
        const result =
            normalizedContent.substring(0, charOffset + matchIndex) +
            normalizedReplace +
            normalizedContent.substring(charOffset + matchIndex + normalizedSearch.length);

        return {
            success: true,
            result,
            matchCount: 1,
            matchedLine: actualMatchedLine
        };
    }

    // 没有提供起始行号，计算匹配次数
    const matches = normalizedContent.split(normalizedSearch).length - 1;

    if (matches === 0) {
        return {
            success: false,
            result: normalizedContent,
            error: 'No exact match found. Please verify the content matches exactly.',
            matchCount: 0
        };
    }

    if (matches > 1) {
        const candidateLines = findAllExactMatchLineNumbers(normalizedContent, normalizedSearch, { limit: 20 });
        return {
            success: false,
            result: normalizedContent,
            error:
                `Multiple matches found (${matches}). Please provide 'start_line' parameter to specify which match to use.` +
                (candidateLines.length > 0 ? ` Candidate match lines: ${candidateLines.join(', ')}.` : ''),
            matchCount: matches,
            candidateLines
        };
    }

    // 计算实际匹配的行号
    const matchIndex = normalizedContent.indexOf(normalizedSearch);
    const textBeforeMatch = normalizedContent.substring(0, matchIndex);
    const actualMatchedLine = textBeforeMatch.split('\n').length;

    // 精确替换
    const result = normalizedContent.replace(normalizedSearch, normalizedReplace);

    return {
        success: true,
        result,
        matchCount: 1,
        matchedLine: actualMatchedLine
    };
}

function applyLegacyDiffsBestEffort(
    originalContent: string,
    diffs: LegacyDiffBlock[],
    options?: {
        /** 在错误信息中附加说明（用于统一 diff 的 loose fallback 场景） */
        errorSuffix?: string;
    }
): {
    newContent: string;
    results: Array<{
        index: number;
        success: boolean;
        error?: string;
        startLine?: number;
        endLine?: number;
        matchCount?: number;
        candidateLines?: number[];
    }>;
    blocks: Array<{ index: number; startLine: number; endLine: number }>;
    appliedCount: number;
    failedCount: number;
} {
    let currentContent = originalContent;

    const results: Array<{
        index: number;
        success: boolean;
        error?: string;
        startLine?: number;
        endLine?: number;
        matchCount?: number;
        candidateLines?: number[];
    }> = [];
    const blocks: Array<{ index: number; startLine: number; endLine: number }> = [];

    for (let i = 0; i < diffs.length; i++) {
        const diff = diffs[i];
        if (typeof diff.search !== 'string' || diff.replace === undefined) {
            results.push({
                index: i,
                success: false,
                error: `Diff at index ${i} is missing 'search' or 'replace' field${options?.errorSuffix ? ` ${options.errorSuffix}` : ''}`
            });
            continue;
        }

        const r = applyDiffToContent(currentContent, diff.search, diff.replace, diff.start_line);
        let error = r.error;
        if (!r.success && error && options?.errorSuffix) {
            error = `${error} ${options.errorSuffix}`;
        }

        const replaceLines = normalizeLineEndings(diff.replace).split('\n').length;
        const startLine = r.matchedLine;
        const endLine = startLine !== undefined ? startLine + replaceLines - 1 : undefined;

        results.push({
            index: i,
            success: r.success,
            error,
            startLine,
            endLine,
            matchCount: r.matchCount,
            candidateLines: r.candidateLines
        });

        if (r.success) {
            currentContent = r.result;
            if (startLine !== undefined && endLine !== undefined) {
                blocks.push({ index: i, startLine, endLine });
            }
        }
    }

    const appliedCount = results.filter(x => x.success).length;
    const failedCount = results.length - appliedCount;

    return {
        newContent: currentContent,
        results,
        blocks,
        appliedCount,
        failedCount
    };
}

function getApplyDiffFormat(): 'unified' | 'search_replace' {
    const settingsManager = getGlobalSettingsManager();
    const raw = settingsManager?.getApplyDiffConfig()?.format;
    return raw === 'search_replace' ? 'search_replace' : 'unified';
}

/**
 * 创建 apply_diff 工具
 */
export function createApplyDiffTool(): Tool {
    const buildDeclaration = (): ToolDeclaration => {
        // 获取工作区信息
        const workspaces = getAllWorkspaces();
        const isMultiRoot = workspaces.length > 1;

        // 根据工作区数量生成描述
        let pathDescription = '文件路径，相对于当前工作区根目录。例如：src/example.ts。';
        let descriptionSuffix = '';

        if (isMultiRoot) {
            pathDescription = `文件路径，必须使用 "workspace_name/path" 格式。可用工作区：${workspaces.map(w => w.name).join(', ')}`;
            descriptionSuffix = `\n\n多根工作区：必须使用 "workspace_name/path" 格式。可用工作区：${workspaces.map(w => w.name).join(', ')}`;
        }

        const format = getApplyDiffFormat();

        if (format === 'search_replace') {
            // 修改原因：旧版 search/replace 声明只强调“单次调用单文件”，容易让模型误以为每改一个文件后必须停止等待。
            // 修改方式：在工具 description 中加入批量修改规则，明确“一个工具调用单文件”和“一轮回复多个工具调用”并不冲突。
            // 修改目的：鼓励模型在多文件修改计划已经明确且互不依赖时，同一轮连续输出多个 apply_diff 调用，减少无意义的工具迭代。
            return {
                name: 'apply_diff',
                category: 'file',
                strict: true,  // API 端强制 schema 校验
                description: `对单个文件应用旧版 search/replace 差异，并打开待确认 diff 预览。

参数：
- path：目标文件路径。
- diffs：要应用的旧版差异数组。

每个 diff 对象包含：
- search：要查找的原始内容，必须和文件内容完全一致。
- replace：替换后的目标内容。
- start_line：可选，1-based 起始行号，用于重复内容定位。

规则：
- search 必须精确匹配，包括空格、缩进和换行。
- diffs 会按数组顺序应用。
- 某个 diff 失败时，该 diff 不会生效。

批量修改规则：
- 本工具一次调用仍然只修改一个文件；如果计划要修改多个互不依赖的文件，应该在同一轮回复中连续输出多个 apply_diff 调用。
- 不要在完成第一个文件的 apply_diff 后停止等待结果，除非后续修改依赖该工具结果或需要先确认上一处修改是否成功。
- 对已经明确、互不依赖的多文件修改，应一次性输出所有 apply_diff 调用，以减少无意义的工具迭代。
- 错误示例：修改 A 文件后停止，等下一轮再修改 B 文件。
- 正确示例：同一轮依次输出 apply_diff(A)、apply_diff(B)、apply_diff(C)。

${descriptionSuffix}`,

                parameters: {
                    type: 'object',
                    properties: {
                        path: {
                            type: 'string',
                            description: pathDescription
                        },
                        diffs: {
                            type: 'array',
                            description: '旧版 diff 对象数组。即使只有一个 diff，也必须使用数组。',
                            items: {
                                type: 'object',
                                properties: {
                                    search: {
                                        type: 'string',
                                        description: '要查找的原始内容，必须精确匹配。'
                                    },
                                    replace: {
                                        type: 'string',
                                        description: '替换后的目标内容。'
                                    },
                                    start_line: {
                                        type: 'number',
                                        description: '可选，1-based 起始行号，用于重复内容定位。'
                                    }
                                },
                                required: ['search', 'replace']
                            }
                        }
                    },
                    required: ['path', 'diffs']
                }
            };
        }

        // 为什么要把默认声明改为结构化 hunks：旧 patch 字符串让模型混淆 JSON 转义和 unified diff 文本，双引号、反斜杠等内容容易写错。
        // 怎么改：主推 hunks[{oldContent,newContent,startLine?}]，同时保留 patch 字符串作为历史兼容字段。
        // 目的：让 newContent 像 write_file.content 一样表示最终内容，并保留一次调用处理多个连续片段的能力。
        // 修改原因：模型会把“apply_diff 一次调用只处理一个文件”误读成“一轮只能调用一次 apply_diff”。
        // 修改方式：在默认结构化 hunk 声明中补充批量修改规则，明确多文件计划应在同一轮连续输出多个 apply_diff 调用。
        // 修改目的：让工具说明本身承担行为引导，减少用户反复用自然语言纠正模型每次只改一个文件的问题。
        return {
            name: 'apply_diff',
            category: 'file',
            strict: true,  // API 端强制 schema 校验
            description: `对单个文件应用一个或多个结构化内容替换，并打开待确认 diff 预览。

推荐输入格式：
- path：目标文件路径。
- hunks：结构化修改数组。每个 hunk 表示一个连续片段替换。
- hunks[].oldContent：文件中要被替换的原始内容，必须和文件内容完全一致。
- hunks[].newContent：替换后的目标内容。按 JSON 字符串规则填写；工具收到后会作为最终文件内容使用，不要加 + 前缀，也不要为了 diff 再额外转义双引号。
- hunks[].startLine：可选，1-based，基于修改前原文件的行号。只有 oldContent 在当前文件中重复出现时才会用于定位；oldContent 唯一匹配时会忽略 startLine，避免陈旧行号导致失败。

规则：
- 一次调用只修改一个文件；多个不连续片段放在 hunks 数组中。
- hunks 应按原文件中的出现顺序排列，这样前面修改造成的行号偏移可以被工具正确维护。
- 不能让两个 hunk 修改同一段或互相覆盖的文本；如果要改同一个区块，应该合并成一个 hunk。
- oldContent 必须能匹配；如果 oldContent 重复出现，请提供 startLine 或增加上下文让它唯一。
- patch 字段仅作为兼容旧 unified diff hunk 字符串的 fallback；新调用优先使用 hunks。

批量修改规则：
- 本工具一次调用仍然只修改一个文件；如果计划要修改多个互不依赖的文件，应该在同一轮回复中连续输出多个 apply_diff 调用。
- 不要在完成第一个文件的 apply_diff 后停止等待结果，除非后续修改依赖该工具结果或需要先确认上一处修改是否成功。
- 对已经明确、互不依赖的多文件修改，应一次性输出所有 apply_diff 调用，以减少无意义的工具迭代。
- 错误示例：修改 A 文件后停止，等下一轮再修改 B 文件。
- 正确示例：同一轮依次输出 apply_diff(A)、apply_diff(B)、apply_diff(C)。

示例：
{
  "path": "src/example.ts",
  "hunks": [
    {
      "oldContent": "content: old;",
      "newContent": "content: \"\";",
      "startLine": 12
    }
  ]
}
${descriptionSuffix}`,

            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: pathDescription
                    },
                    hunks: {
                        type: 'array',
                        description: '推荐格式。结构化 hunk 数组；每个 hunk 使用 oldContent/newContent 表示一次连续内容替换。',
                        items: {
                            type: 'object',
                            properties: {
                                oldContent: {
                                    type: 'string',
                                    description: '文件中要被替换的原始内容，必须精确匹配。'
                                },
                                newContent: {
                                    type: 'string',
                                    description: '替换后的目标内容。按 JSON 字符串规则填写；工具收到后作为最终文件内容使用。'
                                },
                                startLine: {
                                    type: 'number',
                                    description: '可选，1-based，基于修改前原文件的行号。仅当 oldContent 重复出现时用于定位。'
                                }
                            },
                            required: ['oldContent', 'newContent']
                        }
                    },
                    patch: {
                        type: 'string',
                        description: "兼容字段。旧 unified diff hunks 文本；新调用请优先使用 hunks。"
                    }
                },
                required: ['path']
            }
        };
    };

    return {
        // declaration 做成 getter：根据用户设置动态返回不同描述/Schema
        get declaration() {
            return buildDeclaration();
        },

        handler: async (args, context): Promise<ToolResult> => {
            const filePath = args.path as string;
            const patch = args.patch as string | undefined;
            const structuredHunks = args.hunks as StructuredDiffHunk[] | undefined;
            const diffs = args.diffs as LegacyDiffBlock[] | undefined;

            if (!filePath || typeof filePath !== 'string') {
                return { success: false, error: 'Path is required' };
            }

            const { uri } = resolveUriWithInfo(filePath);
            if (!uri) {
                return { success: false, error: 'No workspace folder open' };
            }

            const absolutePath = uri.fsPath;
            if (!fs.existsSync(absolutePath)) {
                return { success: false, error: `File not found: ${filePath}` };
            }

            const format = getApplyDiffFormat();

            try {
                const originalContent = fs.readFileSync(absolutePath, 'utf8');

                // ========== 统一 diff 模式 ==========
                if (format === 'unified') {
                    if ((!structuredHunks || !Array.isArray(structuredHunks) || structuredHunks.length === 0) && (!patch || typeof patch !== 'string')) {
                        return {
                            success: false,
                            error: 'apply_diff 当前推荐使用结构化 hunks。请提供 { path, hunks: [{ oldContent, newContent, startLine? }] }；旧 patch 字符串仅作为兼容 fallback。'
                        };
                    }

                    let diffCount = 0;
                    let appliedCount = 0;
                    let failedCount = 0;
                    let results: Array<{ index: number; success: boolean; error?: string; startLine?: number; endLine?: number }> = [];
                    let blocks: Array<{ index: number; startLine: number; endLine: number }> = [];
                    let newContent = originalContent;
                    let rawDiffs: any[] = [];
                    let fallbackMode: 'none' | 'structured_hunks' | 'loose_hunk_search_replace' | 'unified_hunks_search_replace' = 'none';

                    // 为什么优先处理 hunks：新格式把 newContent 当最终内容字段，避免旧 patch 字符串里的反斜杠/双引号被模型误写。
                    // 怎么改：当 hunks 存在时不再解析 patch；按结构化规则应用，并把原始 hunks 存入 DiffManager 以支持块级接受/拒绝重放。
                    // 目的：兼容历史 patch 的同时，让新的 AI 调用路径默认走更稳定的结构化参数。
                    if (structuredHunks && Array.isArray(structuredHunks) && structuredHunks.length > 0) {
                        const applied = applyStructuredDiffHunksBestEffort(originalContent, structuredHunks);

                        diffCount = structuredHunks.length;
                        appliedCount = applied.appliedCount;
                        failedCount = applied.failedCount;
                        results = applied.results;
                        blocks = applied.blocks;
                        newContent = applied.newContent;
                        rawDiffs = structuredHunks as any[];
                        fallbackMode = 'structured_hunks';
                    } else {
                        try {
                            if (!patch || typeof patch !== 'string') {
                                throw new Error('Missing patch fallback input.');
                            }
                        const parsed = parseUnifiedDiff(patch);
                        const applied = applyUnifiedDiffBestEffort(originalContent, parsed);

                        diffCount = parsed.hunks.length;
                        appliedCount = applied.results.filter(r => r.ok).length;
                        failedCount = diffCount - appliedCount;

                        results = applied.results.map(r => ({
                            index: r.index,
                            success: r.ok,
                            error: r.error,
                            startLine: r.startLine,
                            endLine: r.endLine
                        }));

                        blocks = applied.appliedHunks.map(h => ({
                            index: h.index,
                            startLine: h.startLine,
                            endLine: h.endLine
                        }));

                        newContent = applied.newContent;
                        rawDiffs = parsed.hunks as UnifiedDiffHunk[] as any[];

                        // 若有 hunk 因行号/上下文不匹配等原因失败，尝试兜底：将 hunks 退化为全局精确 search/replace。
                        // 说明：
                        // - 仅在兜底能“额外应用更多块”时采用，避免降低标准 unified diff 的成功率。
                        // - 兜底不会在多处匹配时强行选择（会失败并返回 candidateLines）。
                        if (appliedCount < diffCount) {
                            const legacyDiffs = convertUnifiedHunksToLegacyDiffs(parsed.hunks);
                            const legacyApplied = applyLegacyDiffsBestEffort(originalContent, legacyDiffs, {
                                errorSuffix:
                                    '(unified fallback: applied via global exact search/replace; if ambiguous, add more context or provide start_line)'
                            });

                            if (legacyApplied.appliedCount > appliedCount) {
                                diffCount = legacyDiffs.length;
                                appliedCount = legacyApplied.appliedCount;
                                failedCount = legacyApplied.failedCount;
                                results = legacyApplied.results as any;
                                blocks = legacyApplied.blocks;
                                newContent = legacyApplied.newContent;
                                rawDiffs = legacyDiffs as any[];
                                fallbackMode = 'unified_hunks_search_replace';
                            }
                        }
                        } catch (e) {
                            const msg = e instanceof Error ? e.message : String(e);

                            // “裸 @@”兜底：将 patch 退化为 legacy search/replace diffs（全局精确匹配）
                            if (msg.startsWith('Invalid hunk header')) {
                                const legacyDiffs = parseLooseUnifiedPatchToLegacyDiffs(patch || '');
                                const looseApplied = applyLegacyDiffsBestEffort(originalContent, legacyDiffs, {
                                    errorSuffix:
                                        '(loose @@ fallback: ensure the search block is unique, or use a full @@ -a,b +c,d @@ header)'
                                });

                                diffCount = legacyDiffs.length;
                                appliedCount = looseApplied.appliedCount;
                                failedCount = looseApplied.failedCount;
                                results = looseApplied.results;
                                blocks = looseApplied.blocks;
                                newContent = looseApplied.newContent;
                                rawDiffs = legacyDiffs as any[];
                                fallbackMode = 'loose_hunk_search_replace';
                            } else {
                                throw e;
                            }
                        }
                    }

                    // 一个都没应用上：直接失败返回（不创建 pending diff）
                    if (appliedCount === 0) {
                        const firstError = results.find(r => !r.success)?.error || 'All hunks failed';
                        return {
                            success: false,
                            error: `Failed to apply any hunks: ${firstError}`,
                            data: {
                                file: filePath,
                                message: `Failed to apply any hunks to ${filePath}.`,
                                status: 'rejected',
                                diffCount,
                                totalCount: diffCount,
                                appliedCount: 0,
                                failedCount: diffCount,
                                results,
                                fallbackMode
                            }
                        };
                    }

                    // 创建待审阅的 diff
                    const diffManager = getDiffManager();

                    const pendingDiff = await diffManager.createPendingDiff(
                        filePath,
                        absolutePath,
                        originalContent,
                        newContent,
                        blocks,
                        rawDiffs,
                        context?.toolId
                    );

                    // 等待 diff 被处理（保存、拒绝、abort 或用户新请求中断）。
                    // 为什么改用 DiffManager 统一等待：apply_diff 之前只监听状态变化，用户中断会清掉自动保存定时器但不一定产生新状态事件，导致偶发卡住。
                    // 怎么改：统一等待方法同时监听状态事件、轮询中断标记，并处理 AbortSignal。
                    // 目的：让结构化 hunks 与旧 patch 路径共享可靠的 diff 生命周期收敛逻辑。
                    const interruptReason = await diffManager.waitForDiffResolution(pendingDiff.id, context?.abortSignal);
                    const wasInterrupted = interruptReason !== 'none';

                    // 获取最终状态
                    const finalDiff = diffManager.getDiff(pendingDiff.id);
                    const wasAccepted = !wasInterrupted && (!finalDiff || finalDiff.status === 'accepted');

                    // 用户可能在保存前编辑了内容（手动保存/手动接受时）
                    const userEditedContent = finalDiff?.userEditedContent;

                    // 尝试将大内容保存到 DiffStorageManager
                    const diffStorageManager = getDiffStorageManager();
                    let diffContentId: string | undefined;

                    if (diffStorageManager) {
                        try {
                            const diffRef = await diffStorageManager.saveGlobalDiff({
                                originalContent,
                                newContent,
                                filePath
                            });
                            diffContentId = diffRef.diffId;
                        } catch (e) {
                            console.warn('Failed to save diff content to storage:', e);
                        }
                    }

                    if (wasInterrupted) {
                        return {
                            success: false,
                            cancelled: true,
                            error: 'Diff was cancelled by user',
                            data: {
                                file: filePath,
                                message: `Diff for ${filePath} was cancelled by user.`,
                                status: 'rejected',
                                diffCount,
                                totalCount: diffCount,
                                appliedCount,
                                failedCount,
                                results,
                                diffContentId,
                                diffGuardWarning: pendingDiff.diffGuardWarning,
                                diffGuardDeletePercent: pendingDiff.diffGuardDeletePercent,
                                fallbackMode
                            }
                        };
                    }

                    const autoSaveError = finalDiff?.autoSaveError;
                    const message = wasAccepted
                        ? failedCount > 0
                            ? `Partially applied hunks to ${filePath}: ${appliedCount} succeeded, ${failedCount} failed. Saved successfully.`
                            : `Diff applied and saved to ${filePath}`
                        : autoSaveError
                          ? `Auto-save failed for ${filePath}: ${autoSaveError}`
                          : finalDiff?.status === 'rejected'
                          ? `Diff was explicitly rejected by the user for ${filePath}. No changes were saved.`
                          : `Diff was not accepted for ${filePath}. No changes were saved.`;

                    return {
                        success: wasAccepted,
                        error: wasAccepted ? undefined : autoSaveError,
                        data: {
                            file: filePath,
                            message,
                            status: wasAccepted ? 'accepted' : 'rejected',
                            diffCount,
                            totalCount: diffCount,
                            appliedCount,
                            failedCount,
                            results,
                            userEditedContent,
                            diffContentId,
                            fallbackMode,
                            diffGuardWarning: pendingDiff.diffGuardWarning,
                            diffGuardDeletePercent: pendingDiff.diffGuardDeletePercent,
                            autoSaveError,
                            pendingDiffId: pendingDiff.id
                        }
                    };
                }

                // ========== 旧 search/replace 模式 ==========
                if (!diffs || !Array.isArray(diffs) || diffs.length === 0) {
                    return {
                        success: false,
                        error: 'apply_diff is configured to use legacy diffs. Please provide { diffs: [{search, replace, start_line?}, ...] }.'
                    };
                }

                let currentContent = originalContent;

                const diffResults: Array<{
                    index: number;
                    success: boolean;
                    error?: string;
                    matchedLine?: number;
                }> = [];

                for (let i = 0; i < diffs.length; i++) {
                    const diff = diffs[i];

                    if (!diff.search || diff.replace === undefined) {
                        diffResults.push({
                            index: i,
                            success: false,
                            error: `Diff at index ${i} is missing 'search' or 'replace' field`
                        });
                        continue;
                    }

                    const result = applyDiffToContent(currentContent, diff.search, diff.replace, diff.start_line);
                    diffResults.push({
                        index: i,
                        success: result.success,
                        error: result.error,
                        matchedLine: result.matchedLine
                    });

                    if (result.success) {
                        currentContent = result.result;
                    }
                }

                const appliedCount = diffResults.filter(r => r.success).length;
                const failedCount = diffResults.length - appliedCount;

                // 如果没有任何一个 diff 成功应用，则返回失败
                if (appliedCount === 0 && diffs.length > 0) {
                    const firstError = diffResults.find(r => !r.success)?.error || 'All diffs failed';
                    return {
                        success: false,
                        error: `Failed to apply any diffs: ${firstError}`,
                        data: {
                            file: filePath,
                            message: `Failed to apply any diffs to ${filePath}.`,
                            results: diffResults,
                            appliedCount: 0,
                            totalCount: diffs.length,
                            failedCount: diffs.length
                        }
                    };
                }

                const diffManager = getDiffManager();

                const blocks: Array<{ index: number; startLine: number; endLine: number }> = [];
                for (let i = 0; i < diffs.length; i++) {
                    const res = diffResults[i];
                    if (res.success && res.matchedLine !== undefined) {
                        const replaceLines = diffs[i].replace.split('\n').length;
                        blocks.push({
                            index: i,
                            startLine: res.matchedLine,
                            endLine: res.matchedLine + replaceLines - 1
                        });
                    }
                }

                const pendingDiff = await diffManager.createPendingDiff(
                    filePath,
                    absolutePath,
                    originalContent,
                    currentContent,
                    blocks,
                    diffs as any[],
                    context?.toolId
                );

                // 等待 diff 被处理（保存、拒绝、abort 或用户新请求中断）。
                // 为什么旧 search/replace 路径也要改：它和结构化 hunks 一样会创建 pending diff，不能保留另一套可能遗漏中断的等待逻辑。
                // 怎么改：复用 DiffManager.waitForDiffResolution，统一事件监听、轮询兜底和 abort 清理。
                // 目的：让 apply_diff 的所有输入格式在自动保存和取消场景下表现一致。
                const interruptReason = await diffManager.waitForDiffResolution(pendingDiff.id, context?.abortSignal);
                const wasInterrupted = interruptReason !== 'none';

                const finalDiff = diffManager.getDiff(pendingDiff.id);
                const wasAccepted = !wasInterrupted && (!finalDiff || finalDiff.status === 'accepted');
                const userEditedContent = finalDiff?.userEditedContent;

                const diffStorageManager = getDiffStorageManager();
                let diffContentId: string | undefined;

                if (diffStorageManager) {
                    try {
                        const diffRef = await diffStorageManager.saveGlobalDiff({
                            originalContent,
                            newContent: currentContent,
                            filePath
                        });
                        diffContentId = diffRef.diffId;
                    } catch (e) {
                        console.warn('Failed to save diff content to storage:', e);
                    }
                }

                if (wasInterrupted) {
                    return {
                        success: false,
                        cancelled: true,
                        error: 'Diff was cancelled by user',
                        data: {
                            file: filePath,
                            message: `Diff for ${filePath} was cancelled by user.`,
                            status: 'rejected',
                            diffCount: diffs.length,
                            appliedCount,
                            failedCount,
                            results: diffResults,
                            diffContentId,
                            diffGuardWarning: pendingDiff.diffGuardWarning,
                            diffGuardDeletePercent: pendingDiff.diffGuardDeletePercent
                        }
                    };
                }

                const autoSaveError = finalDiff?.autoSaveError;
                let message: string;
                if (wasAccepted) {
                    message = `Diff applied and saved to ${filePath}`;
                    if (failedCount > 0) {
                        message = `Partially applied diffs to ${filePath}: ${appliedCount} succeeded, ${failedCount} failed. Saved successfully.`;
                    }
                } else {
                    message = autoSaveError
                        ? `Auto-save failed for ${filePath}: ${autoSaveError}`
                        : finalDiff?.status === 'rejected'
                        ? `Diff was explicitly rejected by the user for ${filePath}. No changes were saved.`
                        : `Diff was not accepted for ${filePath}. No changes were saved.`;
                }

                return {
                    success: wasAccepted,
                    error: wasAccepted ? undefined : autoSaveError,
                    data: {
                        file: filePath,
                        message,
                        status: wasAccepted ? 'accepted' : 'rejected',
                        diffCount: diffs.length,
                        appliedCount,
                        failedCount,
                        results: diffResults,
                        userEditedContent,
                        diffContentId,
                        diffGuardWarning: pendingDiff.diffGuardWarning,
                        diffGuardDeletePercent: pendingDiff.diffGuardDeletePercent,
                        autoSaveError,
                        pendingDiffId: pendingDiff.id
                    }
                };
            } catch (error) {
                return {
                    success: false,
                    error: `Failed to apply diff: ${error instanceof Error ? error.message : String(error)}`
                };
            }
        }
    };
}

/**
 * 注册 apply_diff 工具
 */
export function registerApplyDiff(): Tool {
    return createApplyDiffTool();
}
