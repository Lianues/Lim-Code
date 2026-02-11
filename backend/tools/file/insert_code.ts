/**
 * 插入代码工具
 *
 * 在文件的指定行前插入一段代码
 * 支持批量操作多个文件
 * 支持多工作区（Multi-root Workspaces）
 */

import * as fs from 'fs';
import type { Tool, ToolResult, ToolContext } from '../types';
import { resolveUriWithInfo, getAllWorkspaces, normalizeLineEndingsToLF } from '../utils';
import { getDiffManager } from './diffManager';
import { getDiffStorageManager } from '../../modules/conversation';

/**
 * 单个插入条目
 */
interface InsertCodeEntry {
    path: string;
    line: number;
    content: string;
}

/**
 * 单个插入结果
 */
interface InsertResult {
    path: string;
    success: boolean;
    line?: number;
    insertedLines?: number;
    status?: 'accepted' | 'rejected' | 'pending';
    error?: string;
    cancelled?: boolean;
    diffContentId?: string;
    pendingDiffId?: string;
}

/**
 * 在指定行前插入代码
 */
function insertAtLine(lines: string[], line: number, content: string): string {
    const insertLines = content.split('\n');
    const idx = line - 1; // 转为 0-based
    const newLines = [
        ...lines.slice(0, idx),
        ...insertLines,
        ...lines.slice(idx)
    ];
    return newLines.join('\n');
}

/**
 * 执行单个文件的插入
 */
async function insertSingleFile(
    entry: InsertCodeEntry,
    toolId?: string,
    abortSignal?: AbortSignal
): Promise<InsertResult> {
    const { path: filePath, line, content } = entry;

    // 参数校验
    if (!filePath || typeof filePath !== 'string') {
        return { path: filePath || '', success: false, error: 'path is required' };
    }
    if (typeof line !== 'number' || !Number.isInteger(line) || line < 1) {
        return { path: filePath, success: false, error: 'line must be a positive integer (1-based)' };
    }
    if (typeof content !== 'string') {
        return { path: filePath, success: false, error: 'content is required' };
    }

    const { uri } = resolveUriWithInfo(filePath);
    if (!uri) {
        return { path: filePath, success: false, error: 'No workspace folder open' };
    }

    const absolutePath = uri.fsPath;
    if (!fs.existsSync(absolutePath)) {
        return { path: filePath, success: false, error: `File not found: ${filePath}. Use write_file to create new files.` };
    }

    try {
        const originalContent = normalizeLineEndingsToLF(
            fs.readFileSync(absolutePath, 'utf8')
        );
        const originalLines = originalContent.split('\n');
        const totalLines = originalLines.length;

        // line 范围校验：1 ~ totalLines + 1
        if (line > totalLines + 1) {
            return {
                path: filePath,
                success: false,
                error: `Line ${line} is out of range. File has ${totalLines} lines. Use 1~${totalLines + 1}.`
            };
        }

        const newContent = insertAtLine(originalLines, line, content);

        if (originalContent === newContent) {
            return { path: filePath, success: true, line, insertedLines: 0, status: 'accepted' };
        }

        // 计算插入块的行范围（用于 CodeLens 高亮）
        const insertedLineCount = content.split('\n').length;
        const blocks = [{
            index: 0,
            startLine: line,
            endLine: line + insertedLineCount - 1
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
            line,
                insertedLines: insertedLineCount,
                status: 'rejected',
                error: interruptReason === 'abort'
                    ? 'Insert was cancelled by user'
                    : 'Insert was interrupted by user',
                diffContentId
            };
        }

        return {
            path: filePath,
            success: wasAccepted,
            line,
            insertedLines: insertedLineCount,
            status: wasAccepted ? 'accepted' : 'rejected',
            error: wasAccepted ? undefined : 'Diff was rejected',
            diffContentId,
            pendingDiffId: pendingDiff.id
        };
    } catch (error) {
        return {
            path: filePath,
            success: false,
            error: `Failed to insert code: ${error instanceof Error ? error.message : String(error)}`
        };
    }
}

/**
 * 创建 insert_code 工具
 */
export function createInsertCodeTool(): Tool {
    const workspaces = getAllWorkspaces();
    const isMultiRoot = workspaces.length > 1;

    const arrayFormatNote = '\n\n**IMPORTANT**: The `files` parameter MUST be an array, even for a single file. Example: `{"files": [{"path": "file.ts", "line": 5, "content": "..."}]}`.';

    let description = 'Insert code before a specified line in one or more files. Use `line = last_line + 1` to append at the end. A Diff preview will be shown for user confirmation.' + arrayFormatNote;
    let pathDescription = 'File path (relative to workspace root)';

    if (isMultiRoot) {
        description += `\n\nMulti-root workspace: Must use "workspace_name/path" format. Available workspaces: ${workspaces.map(w => w.name).join(', ')}`;
        pathDescription = 'File path, must use "workspace_name/path" format';
    }

    return {
        declaration: {
            name: 'insert_code',
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
                                line: {
                                    type: 'number',
                                    description: 'Line number (1-based) to insert before. Use last_line + 1 to append at end of file.'
               },
                                content: {
                                    type: 'string',
                                    description: 'The code content to insert'
                                }
                            },
                            required: ['path', 'line', 'content']
                        },
                        description: 'Array of insert operations. Each element specifies a file, line number, and content to insert. MUST be an array even for a single file.'
                    }
                },
                required: ['files']
            }
        },
        handler: async (args, context?: ToolContext): Promise<ToolResult> => {
            const fileList = args.files as InsertCodeEntry[] | undefined;

            if (!fileList || !Array.isArray(fileList) || fileList.length === 0) {
                return { success: false, error: 'files is required and must be a non-empty array' };
            }

            const results: InsertResult[] = [];
            let successCount = 0;
            let failCount = 0;

            for (const entry of fileList) {
                const result = await insertSingleFile(entry, context?.toolId, context?.abortSignal);
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
                    ? 'Insert was cancelled by user'
                    : (allSuccess ? undefined : `${failCount} file(s) failed to insert`)
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
 * 注册 insert_code 工具
 */
export function registerInsertCode(): Tool {
    return createInsertCodeTool();
}
