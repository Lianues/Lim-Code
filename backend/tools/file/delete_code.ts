/**
 * 删除代码工具
 *
 * 删除文件中指定行范围的代码
 * 支持批量操作多个文件
 * 支持多工作区（Multi-root Workspaces）
 */

import * as fs from 'fs';
import type { Tool, ToolResult, ToolContext } from '../types';
import { resolveUriWithInfo, getAllWorkspaces, normalizeLineEndingsToLF } from '../utils';
import { getDiffManager } from './diffManager';
import { getDiffStorageManager } from '../../modules/conversation';

/**
 * 单个删除条目
 */
interface DeleteCodeEntry {
    path: string;
    start_line: number;
    end_line: number;
}

/**
 * 单个删除结果
 */
interface DeleteResult {
    path: string;
    success: boolean;
    start_line?: number;
    end_line?: number;
    deletedLines?: number;
    status?: 'accepted' | 'rejected' | 'pending';
    error?: string;
    cancelled?: boolean;
    diffContentId?: string;
    pendingDiffId?: string;
}

/**
 * 删除指定行范围
 */
function deleteLineRange(lines: string[], startLine: number, endLine: number): string {
    const newLines = [
        ...lines.slice(0, startLine - 1),
        ...lines.slice(endLine)
    ];
    return newLines.join('\n');
}

/**
 * 执行单个文件的删除
 */
async function deleteSingleFile(
    entry: DeleteCodeEntry,
    toolId?: string,
    abortSignal?: AbortSignal
): Promise<DeleteResult> {
    const { path: filePath, start_line: startLine, end_line: endLine } = entry;

    // 参数校验
    if (!filePath || typeof filePath !== 'string') {
        return { path: filePath || '', success: false, error: 'path is required' };
    }
    if (typeof startLine !== 'number' || !Number.isInteger(startLine) || startLine < 1) {
        return { path: filePath, success: false, error: 'start_line must be a positive integer (1-based)' };
    }
    if (typeof endLine !== 'number' || !Number.isInteger(endLine) || endLine < 1) {
        return { path: filePath, success: false, error: 'end_line must be a positive integer (1-based)' };
    }
    if (startLine > endLine) {
        return { path: filePath, success: false, error: `start_line (${startLine}) must be <= end_line (${endLine})` };
    }

    const { uri } = resolveUriWithInfo(filePath);
    if (!uri) {
        return { path: filePath, success: false, error: 'No workspace folder open' };
    }

    const absolutePath = uri.fsPath;
    if (!fs.existsSync(absolutePath)) {
        return { path: filePath, success: false, error: `File not found: ${filePath}` };
    }

    try {
        const originalContent = normalizeLineEndingsToLF(
            fs.readFileSync(absolutePath, 'utf8')
        );
        const originalLines = originalContent.split('\n');
        const totalLines = originalLines.length;

        // 范围校验
        if (startLine > totalLines) {
            return {
                path: filePath,
                success: false,
                error: `start_line ${startLine} is out of range. File has ${totalLines} lines.`
            };
        }
        if (endLine > totalLines) {
            return {
                path: filePath,
                success: false,
                error: `end_line ${endLine} is out of range. File has ${totalLines} lines.`
            };
        }

        const newContent = deleteLineRange(originalLines, startLine, endLine);
        const deletedCount = endLine - startLine + 1;

        if (originalContent === newContent) {
            return { path: filePath, success: true, start_line: startLine, end_line: endLine, deletedLines: 0, status: 'accepted' };
        }

        // 删除操作的 blocks：在新内容中标记被删除区域的前后交界处
        const blocks = [{
            index: 0,
            startLine: Math.max(1, startLine - 1),
            endLine: Math.min(startLine, totalLines - deletedCount)
        }];

        // 创建 pending diff 等待用户确认
        const diffManager = getDiffManager();
        const pendingDiff = await diffManager.createPendingDiff(
            filePath,
            absolutePath,
            originalContent,
            newContent,
            blocks,
            undefined,
            toolId
        );

        // 等待用户处理
        const interruptReason = await waitForDiffResolution(
            diffManager, pendingDiff.id, abortSignal
        );

        const wasInterrupted = interruptReason !== 'none';
        const finalDiff = diffManager.getDiff(pendingDiff.id);
        const wasAccepted = !wasInterrupted && (!finalDiff || finalDiff.status === 'accepted');

        // 保存 diff 内容供前端按需加载
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
           path: filePath,
                success: false,
                cancelled: true,
                start_line: startLine,
                end_line: endLine,
                deletedLines: deletedCount,
                status: 'rejected',
                error: interruptReason === 'abort'
                    ? 'Delete was cancelled by user'
                    : 'Delete was interrupted by user',
                diffContentId
            };
        }

        return {
            path: filePath,
            success: wasAccepted,
            start_line: startLine,
            end_line: endLine,
            deletedLines: deletedCount,
            status: wasAccepted ? 'accepted' : 'rejected',
            error: wasAccepted ? undefined : 'Diff was rejected',
            diffContentId,
            pendingDiffId: pendingDiff.id
        };
    } catch (error) {
        return {
            path: filePath,
            success: false,
            error: `Failed to delete code: ${error instanceof Error ? error.message : String(error)}`
        };
    }
}

/**
 * 创建 delete_code 工具
 */
export function createDeleteCodeTool(): Tool {
    const workspaces = getAllWorkspaces();
    const isMultiRoot = workspaces.length > 1;

    const arrayFormatNote = '\n\n**IMPORTANT**: The `files` parameterMUST be an array, even for a single file. Example: `{"files": [{"path": "file.ts", "start_line": 10, "end_line": 20}]}`.';

    let description = 'Delete a range of lines (inclusive on both ends) from one or more files. A Diff preview will be shown for user confirmation.' + arrayFormatNote;
    let pathDescription = 'File path (relative to workspace root)';

    if (isMultiRoot) {
        description += `\n\nMulti-root workspace: Must use "workspace_name/path" format. Available workspaces: ${workspaces.map(w => w.name).join(', ')}`;
        pathDescription = 'File path, must use "workspace_name/path" format';
    }

    return {
        declaration: {
            name: 'delete_code',
            description,
            category: 'file',
            parameters: {
                type: 'object',
                properties: {
                    files: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                path: {
                                    type: 'string',
                                    description: pathDescription
                                },
                                start_line: {
                                    type: 'number',
                         description: 'Start line number (1-based, inclusive)'
                                },
                                end_line: {
                                    type: 'number',
                                    description: 'End line number (1-based, inclusive)'
                                }
                            },
                            required: ['path', 'start_line', 'end_line']
                        },
                        description: 'Array of delete operations. Each element specifies a file and line range to delete. MUST be an array even for a single file.'
                    }
                },
                required: ['files']
            }
        },
        handler: async (args, context?: ToolContext): Promise<ToolResult> => {
            const fileList = args.files as DeleteCodeEntry[] | undefined;

            if (!fileList || !Array.isArray(fileList) || fileList.length === 0) {
                return { success: false, error: 'files is required and must be a non-empty array' };
            }

            const results: DeleteResult[] = [];
            let successCount = 0;
            let failCount = 0;

            for (const entry of fileList) {
                const result = await deleteSingleFile(entry, context?.toolId, context?.abortSignal);
               results.push(result);
                if (result.success) {
                    successCount++;
                } else {
                    failCount++;
                }
            }

            const anyCancelled = results.some(r => r.cancelled);
            const allSuccess = failCount === 0 && !anyCancelled;

            return {
                success: allSuccess,
                cancelled: anyCancelled,
                data: {
                    results,
                    successCount,
                    failCount,
                    totalCount: fileList.length
                },
                error: anyCancelled
                    ? 'Delete was cancelled by user'
                    : (allSuccess ? undefined : `${failCount} file(s) failed to delete`)
            };
        }
    };
}

/**
 * 等待 DiffManager 中的 diff 被解决（接受/拒绝/中断）
 */
function waitForDiffResolution(
    diffManager: ReturnType<typeof getDiffManager>,
    diffId: string,
    abortSignal?: AbortSignal
): Promise<'none' | 'abort' | 'user'> {
    return new Promise<'none' | 'abort' | 'user'>((resolve) => {
        let resolved = false;

        const finish = (reason: 'none' | 'abort' | 'user') => {
            if (resolved) return;
     resolved = true;
            if (abortHandler && abortSignal) {
                try { abortSignal.removeEventListener('abort', abortHandler); } catch { /* ignore */ }
            }
            resolve(reason);
        };

        const abortHandler = () => {
            diffManager.rejectDiff(diffId).catch(() => {});
            finish('abort');
        };

        if (abortSignal) {
            if (abortSignal.aborted) { abortHandler(); return; }
            abortSignal.addEventListener('abort', abortHandler, { once: true } as any);
        }

        const checkStatus = () => {
            if (diffManager.isUserInterrupted()) {
                diffManager.rejectDiff(diffId).catch(() => {});
                finish('user');
                return;
            }
            const diff = diffManager.getDiff(diffId);
            if (!diff || diff.status !== 'pending') {
                finish('none');
            } else {
                setTimeout(checkStatus, 100);
            }
        };
        checkStatus();
    });
}

/**
 * 注册 delete_code 工具
 */
export function registerDeleteCode(): Tool {
    return createDeleteCodeTool();
}