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
import { applyUnifiedDiff, parseUnifiedDiff, type UnifiedDiffHunk } from './unifiedDiff';

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

/**
 * Legacy：应用单个 search/replace diff
 */
export function applyDiffToContent(
    content: string,
    search: string,
    replace: string,
    startLine?: number
): { success: boolean; result: string; error?: string; matchCount: number; matchedLine?: number } {
    const normalizedContent = normalizeLineEndings(content);
    const normalizedSearch = normalizeLineEndings(search);
    const normalizedReplace = normalizeLineEndings(replace);

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
        return {
            success: false,
            result: normalizedContent,
            error: `Multiple matches found (${matches}). Please provide 'start_line' parameter to specify which match to use.`,
            matchCount: matches
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
- Provide ONLY unified diff hunks starting with @@ ... @@
- Do NOT include file headers (---/+++), diff --git, index, etc.

Parameters:
- path: Path to the file (relative to workspace root)
- patch: Unified diff hunks text (must include @@ headers and lines starting with ' ', '+', '-')

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
                        description: "Unified diff hunks only. Must start with @@ ... @@ and contain lines prefixed by ' ', '+', '-'. Do NOT include ---/+++ headers."
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
                            error: 'apply_diff is configured to use unified diff patch. Please provide { patch } containing unified diff hunks starting with @@ ... @@ (do not include ---/+++ headers).'
                        };
                    }

                    const parsed = parseUnifiedDiff(patch);
                    const { newContent, appliedHunks } = applyUnifiedDiff(originalContent, parsed);

                    const diffCount = parsed.hunks.length;

                    // 创建待审阅的 diff
                    const diffManager = getDiffManager();

                    const blocks: Array<{ index: number; startLine: number; endLine: number }> = appliedHunks.map(h => ({
                        index: h.index,
                        startLine: h.startLine,
                        endLine: h.endLine
                    }));

                    const rawHunks: UnifiedDiffHunk[] = parsed.hunks;

                    const pendingDiff = await diffManager.createPendingDiff(
                        filePath,
                        absolutePath,
                        originalContent,
                        newContent,
                        blocks,
                        rawHunks as any[],
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
                                appliedCount: diffCount,
                                failedCount: 0,
                                diffContentId
                            }
                        };
                    }

                    const message = wasAccepted
                        ? `Diff applied and saved to ${filePath}`
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
                            appliedCount: diffCount,
                            failedCount: 0,
                            userEditedContent,
                            diffContentId,
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
