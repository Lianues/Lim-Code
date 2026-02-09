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
        let pathDescription = 'Path to the file (relative to workspace root)';
        let descriptionSuffix = '';

        if (isMultiRoot) {
            pathDescription = `Path to the file, must use "workspace_name/path" format. Available workspaces: ${workspaces.map(w => w.name).join(', ')}`;
            descriptionSuffix = `\n\nMulti-root workspace: Must use "workspace_name/path" format. Available workspaces: ${workspaces.map(w => w.name).join(', ')}`;
        }

        const format = getApplyDiffFormat();

        if (format === 'search_replace') {
            return {
                name: 'apply_diff',
                category: 'file',
                description: `Apply legacy search/replace diffs to a file and open a pending diff for user confirmation.

Parameters:
- path: Path to the file (relative to workspace root)
- diffs: Array of diff objects to apply

Each diff object contains:
- search: The exact content to search for (must match 100%)
- replace: The content to replace with
- start_line: (optional, 1-based) Where to start searching

Important:
- Search content must match EXACTLY (including whitespace and indentation)
- Diffs are applied strictly in order
- If a diff fails, it will not be applied

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
                            description: 'Array of legacy diff objects to apply. MUST be an array even for a single diff.',
                            items: {
                                type: 'object',
                                properties: {
                                    search: {
                                        type: 'string',
                                        description: 'The exact content to search for'
                                    },
                                    replace: {
                                        type: 'string',
                                        description: 'The content to replace with'
                                    },
                                    start_line: {
                                        type: 'number',
                                        description: 'Line number (1-based) to start searching (optional).'
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

        // 默认：unified diff patch
        // 由于 apply_diff 已通过 path 指定单文件，这里将 patch 定义简化为“只提供 hunks”
        return {
            name: 'apply_diff',
            category: 'file',
            description: `Apply a unified diff patch (single-file) to a file and open a pending diff for user confirmation.

Input format (simplified):
- Provide ONLY unified diff hunks.
- Each hunk MUST start with a full header line:
  @@ -oldStart,oldCount +newStart,newCount @@
  (oldCount/newCount are optional, but oldStart/newStart are required)
- Do NOT include file headers (---/+++), diff --git, index, etc.
- Fallback compatibility: Bare "@@" lines (without line numbers) are allowed and will be applied using a global exact search/replace based on the hunk content.
  This may fail if the search block is not unique; prefer full headers when possible.

Parameters:
- path: Path to the file (relative to workspace root)
- patch: Unified diff hunks text (must include valid @@ headers and lines starting with ' ', '+', '-')

Requirements:
- patch must be a single-file patch (this tool call targets exactly one file via path)
- /dev/null create/delete patches are not supported (use write_file/delete_file instead)
- patch must contain enough context lines so it can be applied exactly

Example:
@@ -1,3 +1,3 @@
 const x = 1;
-const y = 2;
+const y = 3;
 console.log(x, y);
${descriptionSuffix}`,

            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: pathDescription
                    },
                    patch: {
                        type: 'string',
                        description: "Unified diff hunks only. Each hunk header should be like '@@ -oldStart,oldCount +newStart,newCount @@'. Lines should be prefixed by ' ', '+', '-'. Do NOT include ---/+++ headers. Bare '@@' is accepted as a fallback and will be applied using global exact search/replace based on hunk content."
                    }
                },
                required: ['path', 'patch']
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
                    if (!patch || typeof patch !== 'string') {
                        return {
                            success: false,
                            error: 'apply_diff is configured to use unified diff patch. Please provide { patch } containing hunks with valid headers like @@ -oldStart,oldCount +newStart,newCount @@ (do not include ---/+++ headers).'
                        };
                    }

                    let diffCount = 0;
                    let appliedCount = 0;
                    let failedCount = 0;
                    let results: Array<{ index: number; success: boolean; error?: string; startLine?: number; endLine?: number }> = [];
                    let blocks: Array<{ index: number; startLine: number; endLine: number }> = [];
                    let newContent = originalContent;
                    let rawDiffs: any[] = [];
                    let fallbackMode: 'none' | 'loose_hunk_search_replace' | 'unified_hunks_search_replace' = 'none';

                    try {
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
                            const legacyDiffs = parseLooseUnifiedPatchToLegacyDiffs(patch);
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

                    // 等待 diff 被处理（保存或拒绝）或用户中断
                    const wasInterrupted = await new Promise<boolean>((resolve) => {
                        let resolved = false;
                        let abortHandler: (() => void) | undefined;
                        let statusListener: ((pending: any[], allProcessed: boolean) => void) | undefined;

                        const finish = (interrupted: boolean) => {
                            if (resolved) return;
                            resolved = true;

                            if (statusListener) {
                                diffManager.removeStatusListener(statusListener);
                            }
                            if (abortHandler && context?.abortSignal) {
                                try {
                                    context.abortSignal.removeEventListener('abort', abortHandler);
                                } catch {
                                    // ignore
                                }
                            }
                            resolve(interrupted);
                        };

                        abortHandler = () => {
                            diffManager.rejectDiff(pendingDiff.id).catch(() => {});
                            finish(true);
                        };

                        // 监听信号取消
                        if (context?.abortSignal) {
                            if (context.abortSignal.aborted) {
                                abortHandler();
                                return;
                            }
                            context.abortSignal.addEventListener('abort', abortHandler, { once: true } as any);
                        }

                        // 监听 diffManager 的状态变化
                        statusListener = (_pending: any[], _allProcessed: boolean) => {
                            const d = diffManager.getDiff(pendingDiff.id);
                            if (!d || d.status !== 'pending') {
                                finish(false);
                            }
                        };
                        diffManager.addStatusListener(statusListener);
                    });

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
                                fallbackMode
                            }
                        };
                    }

                    const message = wasAccepted
                        ? failedCount > 0
                            ? `Partially applied hunks to ${filePath}: ${appliedCount} succeeded, ${failedCount} failed. Saved successfully.`
                            : `Diff applied and saved to ${filePath}`
                        : finalDiff?.status === 'rejected'
                          ? `Diff was explicitly rejected by the user for ${filePath}. No changes were saved.`
                          : `Diff was not accepted for ${filePath}. No changes were saved.`;

                    return {
                        success: wasAccepted,
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

                const wasInterrupted = await new Promise<boolean>((resolve) => {
                    let resolved = false;
                    let abortHandler: (() => void) | undefined;
                    let statusListener: ((pending: any[], allProcessed: boolean) => void) | undefined;

                    const finish = (interrupted: boolean) => {
                        if (resolved) return;
                        resolved = true;

                        if (statusListener) {
                            diffManager.removeStatusListener(statusListener);
                        }
                        if (abortHandler && context?.abortSignal) {
                            try {
                                context.abortSignal.removeEventListener('abort', abortHandler);
                            } catch {
                                // ignore
                            }
                        }
                        resolve(interrupted);
                    };

                    abortHandler = () => {
                        diffManager.rejectDiff(pendingDiff.id).catch(() => {});
                        finish(true);
                    };

                    if (context?.abortSignal) {
                        if (context.abortSignal.aborted) {
                            abortHandler();
                            return;
                        }
                        context.abortSignal.addEventListener('abort', abortHandler, { once: true } as any);
                    }

                    statusListener = (_pending: any[], _allProcessed: boolean) => {
                        const d = diffManager.getDiff(pendingDiff.id);
                        if (!d || d.status !== 'pending') {
                            finish(false);
                        }
                    };
                    diffManager.addStatusListener(statusListener);
                });

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
                            diffContentId
                        }
                    };
                }

                let message: string;
                if (wasAccepted) {
                    message = `Diff applied and saved to ${filePath}`;
                    if (failedCount > 0) {
                        message = `Partially applied diffs to ${filePath}: ${appliedCount} succeeded, ${failedCount} failed. Saved successfully.`;
                    }
                } else {
                    message = finalDiff?.status === 'rejected'
                        ? `Diff was explicitly rejected by the user for ${filePath}. No changes were saved.`
                        : `Diff was not accepted for ${filePath}. No changes were saved.`;
                }

                return {
                    success: wasAccepted,
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
