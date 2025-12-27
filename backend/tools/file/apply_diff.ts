/**
 * Apply Diff 工具 - 精确搜索替换文件内容
 * 支持多工作区（Multi-root Workspaces）
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { Tool, ToolResult } from '../types';
import { getDiffManager } from './diffManager';
import { resolveUriWithInfo, getAllWorkspaces } from '../utils';
import { getDiffStorageManager } from '../../modules/conversation';

/**
 * 单个 diff 块
 */
interface DiffBlock {
    /** 要搜索的内容（必须 100% 精确匹配） */
    search: string;
    /** 替换后的内容 */
    replace: string;
    /**
     * 搜索起始行号（1-based，可选）
     *
     * 注意：在同一次 apply_diff 调用中包含多个 diff 块时，diff 是“按顺序”依次应用的。
     * 因此前一个 diff 可能会改变文件的行号。
     *
     * - diff[0].start_line：相对于原始文件内容（即应用任何 diff 之前）。
     * - diff[i].start_line (i>0)：相对于“已经应用了 diff[0..i-1] 后”的当前内容。
     *
     * 如果不确定或内容在文件中是唯一的，也可以省略 start_line，让工具全局精确匹配 search。
     */
    start_line?: number;
}

/**
 * 规范化换行符为 LF
 */
function normalizeLineEndings(text: string): string {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * 应用单个 diff
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

/**
 * 创建 apply_diff 工具
 */
export function createApplyDiffTool(): Tool {
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
    
    return {
        declaration: {
            name: 'apply_diff',
            category: 'file',
            description: `Apply precise search-and-replace diff(s) to a file. The search content must match EXACTLY (including whitespace and indentation).

Parameters:
- path: Path to the file (relative to workspace root)
- diffs: Array of diff objects to apply

Each diff object contains:
- search: The exact content to search for (must match 100%)
- replace: The content to replace with
- start_line: (RECOMMENDED, 1-based) Where to start searching in the CURRENT content when applying this diff.

Important:
- Diffs are applied strictly in order.
- When providing multiple diffs in one call, the file content changes after each successful diff.
  Therefore, for diff[i] (i>0), start_line MUST be calculated against the file AFTER applying diff[0..i-1], not the original file.
- If you are not sure, omit start_line and make 'search' unique by including enough surrounding context.
- The 'search' content must match EXACTLY (including whitespace and indentation)
- If any diff fails, the entire operation is rolled back

**IMPORTANT**: The \`diffs\` parameter MUST be an array, even for a single diff. Example: \`{"path": "file.txt", "diffs": [{"search": "...", "replace": "...", "start_line": 1}]}\`${descriptionSuffix}`,
            
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: pathDescription
                    },
                    diffs: {
                        type: 'array',
                        description: 'Array of diff objects to apply. MUST be an array even for a single diff.',
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
                                    description: 'Line number (1-based) to start searching in the current content while applying this diff (RECOMMENDED). For multiple diffs in one call, diff[i] is applied after diff[0..i-1], so its start_line is relative to the updated content.'
                                }
                            },
                            required: ['search', 'replace']
                        }
                    }
                },
                required: ['path', 'diffs']
            }
        },
        handler: async (args, context): Promise<ToolResult> => {
            const filePath = args.path as string;
            const diffs = args.diffs as DiffBlock[] | undefined;
            
            if (!filePath || typeof filePath !== 'string') {
                return { success: false, error: 'Path is required' };
            }
            
            if (!diffs || !Array.isArray(diffs) || diffs.length === 0) {
                return { success: false, error: 'Diffs array is required and must not be empty' };
            }
            
            const { uri, workspace } = resolveUriWithInfo(filePath);
            if (!uri) {
                return { success: false, error: 'No workspace folder open' };
            }
            
            const absolutePath = uri.fsPath;
            if (!fs.existsSync(absolutePath)) {
                return { success: false, error: `File not found: ${filePath}` };
            }
            
            try {
                const originalContent = fs.readFileSync(absolutePath, 'utf8');
                let currentContent = originalContent;
                
                // 记录每个 diff 的应用结果
                const diffResults: Array<{
                    index: number;
                    success: boolean;
                    error?: string;
                    matchedLine?: number;
                    lineCountDelta: number;
                }> = [];
                
                // 依次尝试应用每个 diff
                for (let i = 0; i < diffs.length; i++) {
                    const diff = diffs[i];
                    
                    if (!diff.search || diff.replace === undefined) {
                        diffResults.push({
                            index: i,
                            success: false,
                            error: `Diff at index ${i} is missing 'search' or 'replace' field`,
                            lineCountDelta: 0
                        });
                        continue;
                    }
                    
                    const result = applyDiffToContent(currentContent, diff.search, diff.replace, diff.start_line);
                    
                    const searchLines = diff.search.split('\n').length;
                    const replaceLines = diff.replace.split('\n').length;
                    
                    diffResults.push({
                        index: i,
                        success: result.success,
                        error: result.error,
                        matchedLine: result.matchedLine,
                        lineCountDelta: result.success ? (replaceLines - searchLines) : 0
                    });
                    
                    if (result.success) {
                        currentContent = result.result;
                    }
                }
                
                const appliedCount = diffResults.filter(r => r.success).length;
                const failedCount = diffResults.length - appliedCount;
                
                // 收集失败的 diff 信息供 AI 参考
                const failedDiffs = diffResults
                    .filter(r => !r.success)
                    .map(r => ({
                        index: r.index,
                        error: r.error
                    }));
                
                // 如果没有任何一个 diff 成功应用，则返回失败
                if (appliedCount === 0 && diffs.length > 0) {
                    const firstError = diffResults.find(r => !r.success)?.error || 'All diffs failed';
                    return {
                        success: false,
                        error: `Failed to apply any diffs: ${firstError}`,
                        data: {
                            file: filePath,
                            message: `Failed to apply any diffs to ${filePath}.`,
                            // 包含失败详情供 AI 修复
                            failedDiffs,
                            appliedCount: 0,
                            totalCount: diffs.length,
                            failedCount: diffs.length
                        }
                    };
                }
                
                // 至少有一个 diff 成功应用，创建待审阅的 diff
                const diffManager = getDiffManager();
                
                // 计算每个成功的 diff 块在最终 currentContent 中的范围
                const blocks: Array<{ index: number; startLine: number; endLine: number }> = [];
                
                for (let i = 0; i < diffs.length; i++) {
                    const res = diffResults[i];
                    if (res.success && res.matchedLine !== undefined) {
                        let finalMatchedLine = res.matchedLine;
                        
                        // 调整行号：受后面应用但位置在前的 diff 影响（虽然通常是顺序的，但为了健壮性考虑）
                        // 实际上，因为我们是顺序应用的，前面的 diff 已经改变了 currentContent。
                        // 所以 res.matchedLine 就是它在它被应用时的那个 content 里的行号。
                        // 如果后面的 diff 在它【之前】应用，它会移动。
                        // 但由于我们是【顺序】应用，所以前面的 diff 已经生效了。
                        // 现在的 res.matchedLine 是相对于已经应用了 0...i-1 个 diff 的 content。
                        // 如果后续 i+1...n 个 diff 应用在它【之前】，它的行号会变。
                        
                        // 我们需要计算最终行号。
                        // 我们可以通过在应用所有 diff 后再次搜索，或者在应用时记录。
                        // 简单的办法：假设 AI 是按顺序（从上到下）提供 diff 的。
                        // 这样 res.matchedLine 对于最终 content 也是大致正确的，除非后续 diff 插在前面。
                        
                        // 这里的逻辑简化处理：直接使用应用时的行号
                        const replaceLines = diffs[i].replace.split('\n').length;
                        blocks.push({
                            index: i,
                            startLine: finalMatchedLine,
                            endLine: finalMatchedLine + replaceLines - 1
                        });
                    }
                }
                
                const pendingDiff = await diffManager.createPendingDiff(
                    filePath,
                    absolutePath,
                    originalContent,
                    currentContent,
                    blocks,
                    diffs,
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

                // 检查用户是否编辑了内容
                const userEditedContent = finalDiff?.userEditedContent;
                // 尝试将大内容保存到 DiffStorageManager
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
                    // 用户主动终止（AbortSignal），视为取消
                    return {
                        success: false,
                        cancelled: true,
                        error: 'Diff was cancelled by user',
                        data: {
                            file: filePath,
                            message: `Diff for ${filePath} was cancelled by user.`,
                            status: 'rejected',
                            diffCount: diffs.length,
                            appliedCount: appliedCount,
                            failedCount: failedCount,
                            // 包含失败详情供 AI 修复
                            failedDiffs: failedDiffs.length > 0 ? failedDiffs : undefined,
                            // 仅供前端按需加载用，不发送给 AI
                            diffContentId
                        }
                    };
                }

                // 简化返回：AI 已经知道 diffs 内容，不需要重复返回
                let message = wasAccepted
                    ? `Diff applied and saved to ${filePath}`
                    : `Diff was rejected for ${filePath}`;

                if (wasAccepted && failedCount > 0) {
                    message = `Partially applied diffs to ${filePath}: ${appliedCount} succeeded, ${failedCount} failed. Saved successfully.`;
                }

                // 如果用户编辑了内容，在消息中告知 AI
                if (wasAccepted && userEditedContent) {
                    message += `\n\n[USER EDIT] The user modified the AI-suggested content before saving. User's final content:\n${userEditedContent}`;
                }

                return {
                    success: wasAccepted,
                    data: {
                        file: filePath,
                        message,
                        status: wasAccepted ? 'accepted' : 'rejected',
                        diffCount: diffs.length,
                        appliedCount: appliedCount,
                        failedCount: failedCount,
                        // 包含失败详情供 AI 修复
                        failedDiffs: failedDiffs.length > 0 ? failedDiffs : undefined,
                        // 用户编辑的内容（供前端展示）
                        userEditedContent: userEditedContent,
                        // 仅供前端按需加载用，不发送给 AI
                        diffContentId,
                        // Diff 会话 ID
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