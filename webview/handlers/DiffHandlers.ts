/**
 * Diff 预览消息处理器
 */

import * as vscode from 'vscode';
import { t } from '../../backend/i18n';
import { getDiffManager } from '../../backend/tools/file/diffManager';
import type { HandlerContext, MessageHandler } from '../types';

/**
 * 打开 Diff 预览
 */
export const openDiffPreview: MessageHandler = async (data, requestId, ctx) => {
  try {
    await handleOpenDiffPreview(data, ctx);
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendError(requestId, 'OPEN_DIFF_PREVIEW_ERROR', error.message || t('webview.errors.openDiffPreviewFailed'));
  }
};

/**
 * 加载 Diff 内容
 */
export const loadDiffContent: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { diffContentId } = data;
    const content = await ctx.diffStorageManager.loadGlobalDiff(diffContentId);
    if (content) {
      ctx.sendResponse(requestId, {
        success: true,
        originalContent: content.originalContent,
        newContent: content.newContent,
        filePath: content.filePath
      });
    } else {
      ctx.sendResponse(requestId, {
        success: false,
        error: t('webview.errors.diffContentNotFound')
      });
    }
  } catch (error: any) {
    ctx.sendError(requestId, 'LOAD_DIFF_CONTENT_ERROR', error.message || t('webview.errors.loadDiffContentFailed'));
  }
};

/**
 * 接受 diff 修改（保存文件）
 */
export const acceptDiff: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { diffId, annotation } = data as { diffId: string; annotation?: string };
    const diffManager = getDiffManager();

    // 手动保存模式：isAutoSave=false，会保留用户编辑；closeTab=true 关闭标签页
    const success = await diffManager.acceptDiff(diffId, true, false);

    const fullAnnotation = (annotation || '').trim();
    ctx.sendResponse(requestId, {
      success,
      hasAnnotation: !!fullAnnotation,
      fullAnnotation
    });
  } catch (error: any) {
    ctx.sendError(requestId, 'DIFF_ACCEPT_ERROR', error.message || 'Failed to accept diff');
  }
};

/**
 * 拒绝 diff 修改（放弃更改）
 */
export const rejectDiff: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { diffId, annotation } = data as { diffId: string; annotation?: string };
    const diffManager = getDiffManager();

    const success = await diffManager.rejectDiff(diffId);

    const fullAnnotation = (annotation || '').trim();
    ctx.sendResponse(requestId, {
      success,
      hasAnnotation: !!fullAnnotation,
      fullAnnotation
    });
  } catch (error: any) {
    ctx.sendError(requestId, 'DIFF_REJECT_ERROR', error.message || 'Failed to reject diff');
  }
};

/**
 * 获取当前 pending 的 diff 列表
 */
export const getPendingDiffs: MessageHandler = async (_data, requestId, ctx) => {
  try {
    const diffManager = getDiffManager();
    const diffs = diffManager.getPendingDiffs().map(d => ({
      id: d.id,
      filePath: d.filePath
    }));

    ctx.sendResponse(requestId, { diffs });
  } catch (error: any) {
    ctx.sendError(requestId, 'DIFF_GET_PENDING_ERROR', error.message || 'Failed to get pending diffs');
  }
};

/**
 * 处理打开 Diff 预览的内部逻辑
 */
async function handleOpenDiffPreview(
  data: {
    toolId: string;
    toolName: string;
    filePaths: string[];
    args: Record<string, unknown>;
    result?: Record<string, unknown>;
  },
  ctx: HandlerContext
): Promise<void> {
  const { toolName, args, result } = data;
  
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    throw new Error(t('webview.errors.noWorkspaceOpen'));
  }
  
  if (toolName === 'apply_diff') {
    await handleApplyDiffPreview(args, result, ctx);
  } else if (toolName === 'search_in_files') {
    await handleSearchInFilesPreview(result, ctx);
  } else if (toolName === 'write_file') {
    await handleWriteFilePreview(args, result, ctx);
  } else {
    throw new Error(t('webview.errors.unsupportedToolType', { toolName }));
  }
}

/**
 * 处理 apply_diff 预览
 */
async function handleApplyDiffPreview(
  args: Record<string, unknown>,
  result: Record<string, unknown> | undefined,
  ctx: HandlerContext
): Promise<void> {
  const filePath = args.path as string;
  const diffs = args.diffs as Array<{ search: string; replace: string; start_line?: number }>;
  
  if (!filePath || !diffs || diffs.length === 0) {
    throw new Error(t('webview.errors.invalidDiffData'));
  }
  
  const resultData = result?.data as Record<string, unknown> | undefined;
  let fullOriginalContent = resultData?.originalContent as string | undefined;
  let fullNewContent = resultData?.newContent as string | undefined;
  
  const diffContentId = resultData?.diffContentId as string | undefined;
  if (diffContentId && (!fullOriginalContent || !fullNewContent)) {
    try {
      const loadedContent = await ctx.diffStorageManager.loadGlobalDiff(diffContentId);
      if (loadedContent) {
        fullOriginalContent = loadedContent.originalContent;
        fullNewContent = loadedContent.newContent;
      }
    } catch (e) {
      console.warn('Failed to load diff content:', e);
    }
  }
  
  let originalContent: string;
  let newContent: string;
  let diffTitle: string;
  
  if (fullOriginalContent && fullNewContent) {
    originalContent = fullOriginalContent;
    newContent = fullNewContent;
    diffTitle = t('webview.messages.fullFileDiffPreview', { filePath });
  } else {
    originalContent = diffs.map((d, i) => `// === Diff #${i + 1}${d.start_line ? ` (Line ${d.start_line})` : ''} ===\n${d.search}`).join('\n\n');
    newContent = diffs.map((d, i) => `// === Diff #${i + 1}${d.start_line ? ` (Line ${d.start_line})` : ''} ===\n${d.replace}`).join('\n\n');
    diffTitle = t('webview.messages.historyDiffPreview', { filePath });
  }
  
  await openDiffView(filePath, originalContent, newContent, diffTitle, ctx);
}

/**
 * 处理 search_in_files 替换预览
 */
async function handleSearchInFilesPreview(
  result: Record<string, unknown> | undefined,
  ctx: HandlerContext
): Promise<void> {
  const resultData = result?.data as Record<string, unknown> | undefined;
  const isReplaceMode = resultData?.isReplaceMode as boolean | undefined;
  
  if (!isReplaceMode) {
    throw new Error(t('webview.errors.searchNotReplaceMode'));
  }
  
  const replaceResults = resultData?.results as Array<{
    file: string;
    replacements: number;
    diffContentId?: string;
  }> | undefined;
  
  if (!replaceResults || replaceResults.length === 0) {
    throw new Error(t('webview.errors.noReplaceResults'));
  }
  
  for (const replaceResult of replaceResults) {
    if (!replaceResult.diffContentId) {
      continue;
    }
    
    try {
      const loadedContent = await ctx.diffStorageManager.loadGlobalDiff(replaceResult.diffContentId);
      if (loadedContent) {
        const diffTitle = t('webview.messages.searchReplaceDiffPreview', { filePath: replaceResult.file });
        await openDiffView(replaceResult.file, loadedContent.originalContent, loadedContent.newContent, diffTitle, ctx);
      }
    } catch (e) {
      console.warn('Failed to load diff content for search_in_files:', e);
    }
  }
}

/**
 * 处理 write_file 预览
 */
async function handleWriteFilePreview(
  args: Record<string, unknown>,
  result: Record<string, unknown> | undefined,
  ctx: HandlerContext
): Promise<void> {
  const files = args.files as Array<{ path: string; content: string }>;
  
  if (!files || files.length === 0) {
    throw new Error(t('webview.errors.noFileContent'));
  }
  
  const resultData = result?.data as Record<string, unknown> | undefined;
  const writeResults = resultData?.results as Array<{
    path: string;
    diffContentId?: string;
    action?: 'created' | 'modified' | 'unchanged';
  }> | undefined;
  
  const diffContentIdMap = new Map<string, string>();
  if (writeResults) {
    for (const r of writeResults) {
      if (r.diffContentId) {
        diffContentIdMap.set(r.path, r.diffContentId);
      }
    }
  }
  
  for (const file of files) {
    let originalContent = '';
    let newContent = file.content;
    let diffTitle: string;
    
    const diffContentId = diffContentIdMap.get(file.path);
    if (diffContentId) {
      try {
        const loadedContent = await ctx.diffStorageManager.loadGlobalDiff(diffContentId);
        if (loadedContent) {
          originalContent = loadedContent.originalContent;
          newContent = loadedContent.newContent;
          diffTitle = t('webview.messages.fullFileDiffPreview', { filePath: file.path });
        } else {
          diffTitle = t('webview.messages.newFileContentPreview', { filePath: file.path });
        }
      } catch (e) {
        console.warn('Failed to load diff content for write_file:', e);
        diffTitle = t('webview.messages.newFileContentPreview', { filePath: file.path });
      }
    } else {
      diffTitle = t('webview.messages.newFileContentPreview', { filePath: file.path });
    }
    
    await openDiffView(file.path, originalContent, newContent, diffTitle, ctx);
  }
}

/**
 * 打开 Diff 视图
 */
async function openDiffView(
  filePath: string,
  originalContent: string,
  newContent: string,
  diffTitle: string,
  ctx: HandlerContext
): Promise<void> {
  const originalUri = vscode.Uri.parse(`limcode-diff-preview:original/${encodeURIComponent(filePath)}`);
  const newUri = vscode.Uri.parse(`limcode-diff-preview:modified/${encodeURIComponent(filePath)}`);
  
  ctx.diffPreviewProvider.setContent(originalUri.toString(), originalContent);
  ctx.diffPreviewProvider.setContent(newUri.toString(), newContent);
  
  await vscode.commands.executeCommand('vscode.diff', originalUri, newUri, diffTitle, {
    preview: false
  });
}

/**
 * 注册 Diff 处理器
 */
export function registerDiffHandlers(registry: Map<string, MessageHandler>): void {
  registry.set('diff.openPreview', openDiffPreview);
  registry.set('diff.loadContent', loadDiffContent);

  // 旧版 diff 确认流程（ToolMessage.vue）所需的 handler
  registry.set('diff.accept', acceptDiff);
  registry.set('diff.reject', rejectDiff);
  registry.set('diff.getPending', getPendingDiffs);
}
