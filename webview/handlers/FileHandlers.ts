/**
 * 固定文件和工作区文件消息处理器
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { t } from '../../backend/i18n';
import type { HandlerContext, MessageHandler } from '../types';
import { resolveUriWithInfo } from '../../backend/tools/utils';
import { validateFileInWorkspace, checkFileExists, getRelativePathFromAbsolute } from '../utils/WorkspaceUtils';
import { extractPlanTodoListFromContent } from '../../backend/tools/plan/todoListSection';
import type { PinnedFileItem } from '../../backend/modules/settings/types';

// ========== 工作区信息 ==========

export const getWorkspaceUri: MessageHandler = async (data, requestId, ctx) => {
  const uri = ctx.getCurrentWorkspaceUri();
  ctx.sendResponse(requestId, uri);
};

export const getRelativePath: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { absolutePath } = data;
    const relativePath = getRelativePathFromAbsolute(absolutePath);
    
    // 检查是否是目录
    let isDirectory = false;
    try {
      let filePath = absolutePath;
      if (absolutePath.startsWith('file://')) {
        const uri = vscode.Uri.parse(absolutePath);
        filePath = uri.fsPath;
      }
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
      isDirectory = stat.type === vscode.FileType.Directory;
    } catch {
      // 无法获取文件信息，默认为文件
    }
    
    ctx.sendResponse(requestId, { relativePath, isDirectory });
  } catch (error: any) {
    ctx.sendError(requestId, 'GET_RELATIVE_PATH_ERROR', error.message || t('webview.errors.getRelativePathFailed'));
  }
};

// ========== 固定文件管理 ==========

const CONVERSATION_PINNED_FILES_KEY = 'inputPinnedFiles';

function normalizePinnedFiles(raw: unknown): PinnedFileItem[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((item): item is PinnedFileItem => {
      return !!item
        && typeof (item as any).id === 'string'
        && typeof (item as any).path === 'string'
        && typeof (item as any).workspaceUri === 'string'
        && typeof (item as any).enabled === 'boolean'
        && typeof (item as any).addedAt === 'number';
    })
    .map(item => ({ ...item }));
}

function filterPinnedFilesByWorkspace(files: PinnedFileItem[], workspaceUri: string | null): PinnedFileItem[] {
  if (!workspaceUri) return files;
  return files.filter(f => f.workspaceUri === workspaceUri);
}

async function getConversationPinnedFilesRaw(
  ctx: HandlerContext,
  conversationId: string
): Promise<PinnedFileItem[] | null> {
  try {
    const raw = await ctx.conversationManager.getCustomMetadata(conversationId, CONVERSATION_PINNED_FILES_KEY);
    if (raw === undefined) return null;
    return normalizePinnedFiles(raw);
  } catch {
    return null;
  }
}

async function saveConversationPinnedFiles(
  ctx: HandlerContext,
  conversationId: string,
  files: PinnedFileItem[]
): Promise<void> {
  await ctx.conversationManager.setCustomMetadata(conversationId, CONVERSATION_PINNED_FILES_KEY, files);
}

export const getPinnedFilesConfig: MessageHandler = async (data, requestId, ctx) => {
  try {
    const workspaceUri = ctx.getCurrentWorkspaceUri();
    if (!workspaceUri) {
      ctx.sendResponse(requestId, { files: [], sectionTitle: 'PINNED FILES CONTENT' });
      return;
    }

    const conversationId = typeof data?.conversationId === 'string' ? data.conversationId.trim() : '';
    
    const allConfig = ctx.settingsManager.getPinnedFilesConfig();
    const conversationFiles = conversationId ? await getConversationPinnedFilesRaw(ctx, conversationId) : null;
    const sourceFiles = conversationFiles ?? allConfig.files;
    const workspaceFiles = filterPinnedFilesByWorkspace(sourceFiles, workspaceUri);
    
    ctx.sendResponse(requestId, {
      ...allConfig,
      files: workspaceFiles
    });
  } catch (error: any) {
    ctx.sendError(requestId, 'GET_PINNED_FILES_CONFIG_ERROR', error.message || t('webview.errors.getPinnedFilesConfigFailed'));
  }
};

export const checkPinnedFilesExistence: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { files } = data;
    const workspaceUri = ctx.getCurrentWorkspaceUri();
    
    if (!workspaceUri || !files) {
      ctx.sendResponse(requestId, { files: [] });
      return;
    }
    
    const filesWithExistence = await Promise.all(
      files.map(async (file: { id: string; path: string }) => {
        const exists = await checkFileExists(file.path, workspaceUri);
        return { id: file.id, exists };
      })
    );
    
    ctx.sendResponse(requestId, { files: filesWithExistence });
  } catch (error: any) {
    ctx.sendError(requestId, 'CHECK_PINNED_FILES_EXISTENCE_ERROR', error.message || t('webview.errors.checkPinnedFilesExistenceFailed'));
  }
};

/**
 * 批量检查工作区文件是否存在
 * 接收一组路径，返回每个路径的存在性结果
 */
export const checkWorkspaceFilesExist: MessageHandler = async (data, requestId, ctx) => {
  try {
    const paths: string[] = data?.paths;
    if (!Array.isArray(paths) || paths.length === 0) {
      ctx.sendResponse(requestId, { results: {} });
      return;
    }

    const workspaceUri = ctx.getCurrentWorkspaceUri();
    if (!workspaceUri) {
      // 无工作区，全部视为不存在
      const results: Record<string, boolean> = {};
      for (const p of paths) results[p] = false;
      ctx.sendResponse(requestId, { results });
      return;
    }

    const results: Record<string, boolean> = {};
    await Promise.all(paths.map(async (p: string) => {
      results[p] = await checkFileExists(p, workspaceUri);
    }));

    ctx.sendResponse(requestId, { results });
  } catch (error: any) {
    ctx.sendError(requestId, 'CHECK_WORKSPACE_FILES_EXIST_ERROR', error.message || 'Failed to check files existence');
  }
};

export const updatePinnedFilesConfig: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { config } = data;
    await ctx.settingsManager.updatePinnedFilesConfig(config);
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendError(requestId, 'UPDATE_PINNED_FILES_CONFIG_ERROR', error.message || t('webview.errors.updatePinnedFilesConfigFailed'));
  }
};

export const addPinnedFile: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { path: filePath, workspaceUri: providedWorkspaceUri, conversationId } = data;
    const normalizedConversationId = typeof conversationId === 'string' ? conversationId.trim() : '';
    const currentWorkspaceUri = ctx.getCurrentWorkspaceUri();
    
    if (!currentWorkspaceUri) {
      ctx.sendError(requestId, 'ADD_PINNED_FILE_ERROR', t('webview.errors.noWorkspaceOpen'));
      return;
    }
    
    const targetWorkspaceUri = providedWorkspaceUri || currentWorkspaceUri;
    const validation = await validateFileInWorkspace(filePath, targetWorkspaceUri);
    
    if (!validation.valid) {
      ctx.sendResponse(requestId, {
        success: false,
        error: validation.error,
        errorCode: validation.errorCode
      });
      return;
    }
    
    const actualWorkspaceUri = validation.workspaceUri || targetWorkspaceUri;

    if (normalizedConversationId) {
      const files = (await getConversationPinnedFilesRaw(ctx, normalizedConversationId))
        ?? [...ctx.settingsManager.getPinnedFiles()];

      if (files.some(f => f.path === validation.relativePath && f.workspaceUri === actualWorkspaceUri)) {
        ctx.sendResponse(requestId, {
          success: false,
          error: 'File already pinned',
          errorCode: 'FILE_ALREADY_PINNED'
        });
        return;
      }

      const file: PinnedFileItem = {
        id: `pinned_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        path: validation.relativePath!,
        workspaceUri: actualWorkspaceUri,
        enabled: true,
        addedAt: Date.now()
      };
      await saveConversationPinnedFiles(ctx, normalizedConversationId, [...files, file]);
      ctx.sendResponse(requestId, { success: true, file });
      return;
    }

    const file = await ctx.settingsManager.addPinnedFile(validation.relativePath!, actualWorkspaceUri);
    ctx.sendResponse(requestId, { success: true, file });
  } catch (error: any) {
    ctx.sendError(requestId, 'ADD_PINNED_FILE_ERROR', error.message || t('webview.errors.addPinnedFileFailed'));
  }
};

export const removePinnedFile: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { id, conversationId } = data;
    const normalizedConversationId = typeof conversationId === 'string' ? conversationId.trim() : '';

    if (normalizedConversationId) {
      const files = (await getConversationPinnedFilesRaw(ctx, normalizedConversationId))
        ?? [...ctx.settingsManager.getPinnedFiles()];
      const updated = files.filter(f => f.id !== id);
      await saveConversationPinnedFiles(ctx, normalizedConversationId, updated);
      ctx.sendResponse(requestId, { success: true });
      return;
    }

    await ctx.settingsManager.removePinnedFile(id);
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendError(requestId, 'REMOVE_PINNED_FILE_ERROR', error.message || t('webview.errors.removePinnedFileFailed'));
  }
};

export const setPinnedFileEnabled: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { id, enabled, conversationId } = data;
    const normalizedConversationId = typeof conversationId === 'string' ? conversationId.trim() : '';

    if (normalizedConversationId) {
      const files = (await getConversationPinnedFilesRaw(ctx, normalizedConversationId))
        ?? [...ctx.settingsManager.getPinnedFiles()];

      const updated = files.map(f => (
        f.id === id
          ? { ...f, enabled: !!enabled }
          : f
      ));

      // 若目标 id 不存在，保持兼容：不抛错，直接返回成功
      await saveConversationPinnedFiles(ctx, normalizedConversationId, updated);
      ctx.sendResponse(requestId, { success: true });
      return;
    }

    await ctx.settingsManager.setPinnedFileEnabled(id, enabled);
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendError(requestId, 'SET_PINNED_FILE_ENABLED_ERROR', error.message || t('webview.errors.setPinnedFileEnabledFailed'));
  }
};

export const validatePinnedFile: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { path: filePath, workspaceUri: providedWorkspaceUri } = data;
    const currentWorkspaceUri = ctx.getCurrentWorkspaceUri();
    
    if (!currentWorkspaceUri) {
      ctx.sendResponse(requestId, {
        valid: false,
        error: t('webview.errors.noWorkspaceOpen'),
        errorCode: 'NO_WORKSPACE'
      });
      return;
    }
    
    const result = await validateFileInWorkspace(filePath, providedWorkspaceUri || currentWorkspaceUri);
    ctx.sendResponse(requestId, result);
  } catch (error: any) {
    ctx.sendResponse(requestId, { valid: false, error: error.message, errorCode: 'UNKNOWN' });
  }
};

// ========== 提示词上下文文件读取 ==========

export const readFileForContext: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { uri } = data;
    
    if (!uri) {
      ctx.sendResponse(requestId, {
        success: false,
        error: t('webview.errors.invalidFileUri')
      });
      return;
    }
    
    // 解析 URI
    let fileUri: vscode.Uri;
    try {
      fileUri = vscode.Uri.parse(uri);
    } catch {
      ctx.sendResponse(requestId, {
        success: false,
        error: t('webview.errors.invalidFileUri')
      });
      return;
    }
    
    // 获取相对路径
    const relativePath = getRelativePathFromAbsolute(fileUri.fsPath);
    if (!relativePath) {
      ctx.sendResponse(requestId, {
        success: false,
        error: t('webview.errors.fileNotInWorkspace')
      });
      return;
    }
    
    // 读取文件内容
    const content = await vscode.workspace.fs.readFile(fileUri);
    const textContent = Buffer.from(content).toString('utf-8');
    
    ctx.sendResponse(requestId, {
      success: true,
      path: relativePath,
      content: textContent
    });
  } catch (error: any) {
    ctx.sendResponse(requestId, {
      success: false,
      error: error.message || t('webview.errors.readFileFailed')
    });
  }
};

// 通过相对路径读取工作区内文件内容（用于 @ 选择文件后生成徽章）
export const readWorkspaceTextFile: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { path: relativePath } = data;

    if (!relativePath || typeof relativePath !== 'string') {
      ctx.sendResponse(requestId, { success: false, error: t('webview.errors.invalidFileUri') });
      return;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      ctx.sendResponse(requestId, { success: false, error: t('webview.errors.noWorkspaceOpen') });
      return;
    }

    const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, relativePath);
    const content = await vscode.workspace.fs.readFile(fileUri);
    const textContent = Buffer.from(content).toString('utf-8');

    ctx.sendResponse(requestId, {
      success: true,
      path: relativePath,
      content: textContent
    });
  } catch (error: any) {
    ctx.sendResponse(requestId, {
      success: false,
      error: error.message || t('webview.errors.readFileFailed')
    });
  }
};

// 在 VSCode 中显示上下文内容（使用临时文件）
let contextPreviewDoc: vscode.TextDocument | null = null;

export const showContextContent: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { title, content, language } = data;
    
    // 创建临时文件来显示内容
    const tempDir = path.join(os.tmpdir(), 'limcode-context-preview');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // 根据语言确定扩展名
    const extMap: Record<string, string> = {
      'typescript': '.ts',
      'typescriptreact': '.tsx',
      'javascript': '.js',
      'javascriptreact': '.jsx',
      'python': '.py',
      'vue': '.vue',
      'html': '.html',
      'css': '.css',
      'json': '.json',
      'markdown': '.md',
      'yaml': '.yaml',
      'xml': '.xml',
      'rust': '.rs',
      'go': '.go',
      'java': '.java',
      'csharp': '.cs',
      'cpp': '.cpp',
      'c': '.c',
      'ruby': '.rb',
      'php': '.php',
      'swift': '.swift',
      'kotlin': '.kt',
      'sql': '.sql',
      'shellscript': '.sh'
    };
    const ext = extMap[language || ''] || '.txt';
    
    // 使用固定文件名，这样每次都会复用同一个文件
    const safeTitle = (title || 'context').replace(/[<>:"/\\|?*]/g, '_').slice(0, 50);
    const tempFilePath = path.join(tempDir, `preview_${safeTitle}${ext}`);
    
    // 写入内容
    fs.writeFileSync(tempFilePath, content, 'utf-8');
    
    const uri = vscode.Uri.file(tempFilePath);
    
    // 打开文档，使用 preview 模式（单击预览，再次点击同一文件会复用）
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, {
      preview: true,           // 预览模式，不会持久占用标签
      preserveFocus: true      // 保持焦点在原来的编辑器
    });
    
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendResponse(requestId, {
      success: false,
      error: error.message || 'Failed to show context content'
    });
  }
};

// ========== 附件和图片处理 ==========

export const previewAttachment: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { name, mimeType, data: base64Data } = data;
    
    const tempDir = path.join(os.tmpdir(), 'limcode-preview');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const timestamp = Date.now();
    const safeFileName = name.replace(/[<>:"/\\|?*]/g, '_');
    const tempFilePath = path.join(tempDir, `${timestamp}_${safeFileName}`);
    
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(tempFilePath, buffer);
    
    const uri = vscode.Uri.file(tempFilePath);
    await vscode.commands.executeCommand('vscode.open', uri);
    
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendError(requestId, 'PREVIEW_ATTACHMENT_ERROR', error.message || t('webview.errors.previewAttachmentFailed'));
  }
};

export const readWorkspaceImage: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { path: imgPath } = data;
    
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      ctx.sendResponse(requestId, { success: false, error: t('webview.errors.noWorkspaceOpen') });
      return;
    }
    
    const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, imgPath);
    const content = await vscode.workspace.fs.readFile(fileUri);
    
    const ext = path.extname(imgPath).toLowerCase();
    let mimeType = 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') {
      mimeType = 'image/jpeg';
    } else if (ext === '.gif') {
      mimeType = 'image/gif';
    } else if (ext === '.webp') {
      mimeType = 'image/webp';
    } else if (ext === '.svg') {
      mimeType = 'image/svg+xml';
    } else if (ext === '.bmp') {
      mimeType = 'image/bmp';
    }
    
    const base64 = Buffer.from(content).toString('base64');
    
    ctx.sendResponse(requestId, {
      success: true,
      data: base64,
      mimeType
    });
  } catch (error: any) {
    ctx.sendResponse(requestId, {
      success: false,
      error: `无法读取图片: ${error.message}`
    });
  }
};

export const openWorkspaceFile: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { path: filePath } = data;
    
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error(t('webview.errors.noWorkspaceOpen'));
    }
    
    const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
    
    try {
      await vscode.workspace.fs.stat(fileUri);
    } catch {
      throw new Error(t('webview.errors.fileNotExists'));
    }
    
    await vscode.commands.executeCommand('vscode.open', fileUri);
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendError(requestId, 'OPEN_WORKSPACE_FILE_ERROR', error.message || t('webview.errors.openFileFailed'));
  }
};

// ========== 工作区文件跳转（带行号/临时高亮） ==========

let jumpHighlightDecorationType: vscode.TextEditorDecorationType | null = null;
const jumpHighlightTimers = new Map<string, ReturnType<typeof setTimeout>>();

function getJumpHighlightDecorationType(ctx: HandlerContext): vscode.TextEditorDecorationType {
  if (!jumpHighlightDecorationType) {
    jumpHighlightDecorationType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
      overviewRulerColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
      overviewRulerLane: vscode.OverviewRulerLane.Right
    });

    // 绑定到扩展生命周期，避免资源泄漏
    ctx.context?.subscriptions?.push(jumpHighlightDecorationType);
  }
  return jumpHighlightDecorationType;
}

function clearJumpHighlightForUri(uriString: string): void {
  if (!jumpHighlightDecorationType) return;
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document.uri.toString() === uriString) {
      editor.setDecorations(jumpHighlightDecorationType, []);
    }
  }
}

function applyTemporaryJumpHighlight(ctx: HandlerContext, uri: vscode.Uri, range: vscode.Range, durationMs: number): void {
  const deco = getJumpHighlightDecorationType(ctx);
  const uriString = uri.toString();

  const existingTimer = jumpHighlightTimers.get(uriString);
  if (existingTimer) {
    clearTimeout(existingTimer);
    jumpHighlightTimers.delete(uriString);
  }

  // 先清理旧的装饰，再应用新的范围
  clearJumpHighlightForUri(uriString);
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document.uri.toString() === uriString) {
      editor.setDecorations(deco, [{ range }]);
    }
  }

  const timer = setTimeout(() => {
    clearJumpHighlightForUri(uriString);
    jumpHighlightTimers.delete(uriString);
  }, durationMs);
  jumpHighlightTimers.set(uriString, timer);
}

function toPositiveInt(value: any): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.trunc(n);
}

function normalizeIncomingWorkspacePath(raw: any): string {
  let p = typeof raw === 'string' ? raw.trim() : '';
  if (!p) return '';

  // 去掉常见包裹符号（例如 AI 输出时的引号/反引号）
  p = p.replace(/^["'`]+/, '').replace(/["'`]+$/, '');

  // 相对路径：将反斜杠转为正斜杠，避免 vscode.Uri.joinPath 把 \" 当作文件名字符
  const isWindowsDriveAbs = /^[A-Za-z]:[\\/]/.test(p);
  const isUri = /^(file:\/\/|vscode-remote:\/\/)/i.test(p);
  if (!isWindowsDriveAbs && !isUri && !path.isAbsolute(p)) {
    p = p.replace(/\\/g, '/');
  }

  // 去掉 ./ 或 .\ 前缀
  p = p.replace(/^(?:\.\/|\.\\)/, '');

  return p;
}

export const openWorkspaceFileAt: MessageHandler = async (data, requestId, ctx) => {
  try {
    const filePathRaw = data?.path;
    const filePath = normalizeIncomingWorkspacePath(filePathRaw);
    if (!filePath) {
      ctx.sendError(requestId, 'OPEN_WORKSPACE_FILE_AT_ERROR', t('webview.errors.invalidFileUri'));
      return;
    }

    const highlight = data?.highlight !== false;
    const highlightDurationMs = toPositiveInt(data?.highlightDurationMs) ?? 3200;

    const startLineInput = toPositiveInt(data?.startLine);
    const endLineInput = toPositiveInt(data?.endLine) ?? startLineInput;

    const startCharacterInput = toPositiveInt(data?.startCharacter);
    const endCharacterInput = toPositiveInt(data?.endCharacter);

    const currentWorkspaceUri = ctx.getCurrentWorkspaceUri?.() || undefined;
    const validation = await validateFileInWorkspace(filePath, currentWorkspaceUri);
    if (!validation.valid || !validation.relativePath) {
      const msg = validation.error || t('webview.errors.fileNotInWorkspace');
      ctx.sendError(requestId, 'OPEN_WORKSPACE_FILE_AT_ERROR', msg);
      return;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.find(f => f.uri.toString() === validation.workspaceUri) ||
      vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      ctx.sendError(requestId, 'OPEN_WORKSPACE_FILE_AT_ERROR', t('webview.errors.noWorkspaceOpen'));
      return;
    }

    const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, validation.relativePath);
    const doc = await vscode.workspace.openTextDocument(fileUri);

    // 仅当提供了行号时才定位/高亮
    if (startLineInput) {
      const maxLine = Math.max(1, doc.lineCount);
      let startLine = Math.min(Math.max(1, startLineInput), maxLine);
      let endLine = Math.min(Math.max(1, endLineInput || startLine), maxLine);
      if (endLine < startLine) {
        const tmp = startLine;
        startLine = endLine;
        endLine = tmp;
      }

      const startLine0 = startLine - 1;
      const endLine0 = endLine - 1;

      const startLineText = doc.lineAt(startLine0).text;
      const endLineText = doc.lineAt(endLine0).text;

      const startChar = Math.min(Math.max(0, (startCharacterInput ?? 0)), startLineText.length);
      const endChar = endCharacterInput !== undefined
        ? Math.min(Math.max(0, endCharacterInput), endLineText.length)
        : endLineText.length;

      // 光标定位在起始行；高亮覆盖范围用 whole-line（更醒目）
      const selection = new vscode.Range(startLine0, startChar, startLine0, startChar);
      const highlightRange = new vscode.Range(startLine0, 0, endLine0, endLineText.length);

      const editor = await vscode.window.showTextDocument(doc, {
        preview: true,
        preserveFocus: false,
        selection
      });

      editor.revealRange(highlightRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);

      if (highlight) {
        applyTemporaryJumpHighlight(ctx, doc.uri, highlightRange, highlightDurationMs);
      }
    } else {
      // 无行号：仅打开文件
      await vscode.window.showTextDocument(doc, {
        preview: true,
        preserveFocus: false
      });
    }

    ctx.sendResponse(requestId, { success: true, path: validation.relativePath });
  } catch (error: any) {
    ctx.sendError(requestId, 'OPEN_WORKSPACE_FILE_AT_ERROR', error.message || t('webview.errors.openFileFailed'));
  }
};

export const saveImageToPath: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { data: base64Data, path: imgPath } = data;
    
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error(t('webview.errors.noWorkspaceOpen'));
    }
    
    const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, imgPath);
    
    const dirUri = vscode.Uri.joinPath(fileUri, '..');
    try {
      await vscode.workspace.fs.createDirectory(dirUri);
    } catch {
      // 目录可能已存在
    }
    
    const buffer = Buffer.from(base64Data, 'base64');
    await vscode.workspace.fs.writeFile(fileUri, buffer);
    
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendResponse(requestId, {
      success: false,
      error: error.message || t('webview.errors.saveImageFailed')
    });
  }
};

// ========== 对话文件管理 ==========

export const revealConversationInExplorer: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { conversationId } = data;
    const conversationsDir = ctx.storagePathManager.getConversationsPath();
    const conversationFile = vscode.Uri.file(path.join(conversationsDir, `${conversationId}.json`));
    
    try {
      await vscode.workspace.fs.stat(conversationFile);
    } catch {
      throw new Error(t('webview.errors.conversationFileNotExists'));
    }
    
    await vscode.commands.executeCommand('revealFileInOS', conversationFile);
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendError(requestId, 'REVEAL_IN_EXPLORER_ERROR', error.message || t('webview.errors.cannotRevealInExplorer'));
  }
};

// ========== 上下文总结 ==========

export const summarizeContext: MessageHandler = async (data, requestId, ctx) => {
  const abortManager = ctx.streamAbortControllers as any;
  const controller = abortManager?.createSummary
    ? abortManager.createSummary(data.conversationId)
    : new AbortController();

  try {
    const result = await ctx.chatHandler.handleSummarizeContext({
      conversationId: data.conversationId,
      configId: data.configId,
      abortSignal: controller.signal
    });
    ctx.sendResponse(requestId, result);
  } catch (error: any) {
    const aborted = controller.signal.aborted || error?.name === 'AbortError';
    if (aborted) {
      ctx.sendResponse(requestId, {
        success: false,
        error: {
          code: 'ABORTED',
          message: t('modules.api.chat.errors.summarizeAborted')
        }
      });
      return;
    }

    ctx.sendError(requestId, 'SUMMARIZE_ERROR', error.message || t('webview.errors.summarizeFailed'));
  } finally {
    if (abortManager?.deleteSummary) {
      abortManager.deleteSummary(data.conversationId);
    }
  }
};

// ========== 工作区文件搜索 ==========

// 排除的目录模式
const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'out', 
  '.vscode', '.idea', '__pycache__', '.cache', 'coverage'
]);

// 递归搜索文件夹
async function searchDirectories(
  baseUri: vscode.Uri, 
  query: string, 
  limit: number,
  results: { path: string; name: string; isDirectory: boolean }[],
  currentPath: string = ''
): Promise<void> {
  if (results.length >= limit) return;
  
  try {
    const entries = await vscode.workspace.fs.readDirectory(baseUri);
    
    for (const [name, type] of entries) {
      if (results.length >= limit) break;
      
      // 跳过排除的目录
      if (EXCLUDED_DIRS.has(name)) continue;
      
      const relativePath = currentPath ? `${currentPath}/${name}` : name;
      
      if (type === vscode.FileType.Directory) {
        // 检查文件夹名是否匹配查询
        if (!query || name.toLowerCase().includes(query.toLowerCase())) {
          results.push({
            path: relativePath,
            name,
            isDirectory: true
          });
        }
        
        // 递归搜索子目录（限制深度避免性能问题）
        const depth = relativePath.split('/').length;
        if (depth < 5) {
          const subUri = vscode.Uri.joinPath(baseUri, name);
          await searchDirectories(subUri, query, limit, results, relativePath);
        }
      }
    }
  } catch {
    // 忽略无法访问的目录
  }
}

export const searchWorkspaceFiles: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { query = '', limit = 50 } = data;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    
    if (!workspaceFolder) {
      ctx.sendResponse(requestId, { files: [], activeFilePath: null });
      return;
    }
    
    const results: { path: string; name: string; isDirectory: boolean; isOpen?: boolean }[] = [];
    const addedPaths = new Set<string>();
    const openPaths = new Set<string>(); // 记录所有已打开的文件路径
    
    // 获取当前活跃编辑器的文件路径（相对路径）
    let activeFilePath: string | null = null;
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && !activeEditor.document.isUntitled) {
      const activeUri = activeEditor.document.uri;
      // 检查文件是否在工作区内
      if (activeUri.fsPath.startsWith(workspaceFolder.uri.fsPath)) {
        activeFilePath = vscode.workspace.asRelativePath(activeUri);
      }
    }
    
    // 收集所有已打开的标签页文件路径
    for (const tabGroup of vscode.window.tabGroups.all) {
      for (const tab of tabGroup.tabs) {
        if (tab.input instanceof vscode.TabInputText) {
          const uri = tab.input.uri;
          // 检查文件是否在工作区内
          if (uri.fsPath.startsWith(workspaceFolder.uri.fsPath)) {
            const relativePath = vscode.workspace.asRelativePath(uri);
            openPaths.add(relativePath);
          }
        }
      }
    }
    
    // 如果没有搜索查询，优先显示已打开的标签页
    if (!query.trim()) {
      // 收集所有打开的标签页文件
      const openFiles: { path: string; name: string; isDirectory: boolean; isActive: boolean }[] = [];
      
      for (const tabGroup of vscode.window.tabGroups.all) {
        for (const tab of tabGroup.tabs) {
          if (tab.input instanceof vscode.TabInputText) {
            const uri = tab.input.uri;
            // 检查文件是否在工作区内
            if (uri.fsPath.startsWith(workspaceFolder.uri.fsPath)) {
              const relativePath = vscode.workspace.asRelativePath(uri);
              if (!addedPaths.has(relativePath)) {
                addedPaths.add(relativePath);
                const isActive = activeFilePath === relativePath;
                openFiles.push({
                  path: relativePath,
                  name: path.basename(uri.fsPath),
                  isDirectory: false,
                  isActive
                });
              }
            }
          }
        }
      }
      
      // 排序：当前活跃文件在最前，其他按路径排序
      openFiles.sort((a, b) => {
        if (a.isActive !== b.isActive) {
          return a.isActive ? -1 : 1;
        }
        return a.path.localeCompare(b.path);
      });
      
      // 添加已打开的文件到结果
      for (const file of openFiles) {
        if (results.length >= limit) break;
        results.push({
          path: file.path,
          name: file.name,
          isDirectory: false,
          isOpen: true
        });
      }
    }
    
    // 1. 搜索文件夹
    const folderResults: { path: string; name: string; isDirectory: boolean }[] = [];
    await searchDirectories(workspaceFolder.uri, query.trim(), Math.floor(limit / 2), folderResults);
    
    // 添加文件夹（排除已添加的）
    for (const folder of folderResults) {
      if (results.length >= limit) break;
      if (!addedPaths.has(folder.path)) {
        addedPaths.add(folder.path);
        results.push(folder);
      }
    }
    
    // 2. 搜索文件
    const pattern = query.trim() ? `**/*${query}*` : '**/*';
    const excludePattern = '{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/.next/**,**/out/**,**/.vscode/**,**/.idea/**,**/__pycache__/**,**/.cache/**,**/coverage/**}';
    const files = await vscode.workspace.findFiles(pattern, excludePattern, limit * 2); // 获取更多以便过滤
    
    // 添加文件结果（排除已添加的）
    for (const uri of files) {
      if (results.length >= limit) break;
      const relativePath = vscode.workspace.asRelativePath(uri);
      if (!addedPaths.has(relativePath)) {
        addedPaths.add(relativePath);
        results.push({
          path: relativePath,
          name: path.basename(uri.fsPath),
          isDirectory: false,
          isOpen: openPaths.has(relativePath)
        });
      }
    }
    
    // 如果有查询，需要重新排序：文件夹在前，然后按路径长度排序
    if (query.trim()) {
      results.sort((a, b) => {
        // 文件夹优先
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        // 然后按路径长度
        return a.path.length - b.path.length;
      });
    }
    
    ctx.sendResponse(requestId, { files: results, activeFilePath });
  } catch (error: any) {
    ctx.sendError(requestId, 'SEARCH_FILES_ERROR', error.message || t('webview.errors.searchFilesFailed'));
  }
};

// ========== 通知 ==========

export const showNotification: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { message, type } = data;
    
    switch (type) {
      case 'error':
        vscode.window.showErrorMessage(message);
        break;
      case 'warning':
        vscode.window.showWarningMessage(message);
        break;
      case 'info':
      default:
        vscode.window.showInformationMessage(message);
        break;
    }
    
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendError(requestId, 'SHOW_NOTIFICATION_ERROR', error.message || t('webview.errors.showNotificationFailed'));
  }
};

// ========== Plan 执行确认 ==========

export const planConfirmExecution: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { path: planPath, originalContent, conversationId } = data || {};
    const confirmedPrompt = 'User confirmed this plan.';
    const originalText = typeof originalContent === 'string' ? originalContent : '';

    const syncTodosFromPlanContent = async (planContent: string) => {
      const todos = extractPlanTodoListFromContent(planContent || '');

      if (typeof conversationId === 'string' && conversationId.trim()) {
        try {
          await ctx.conversationManager.setCustomMetadata(conversationId.trim(), 'todoList', todos);
        } catch (todoError) {
          console.error('[plan.confirmExecution] Failed to sync todos from plan document:', todoError);
        }
      }

      return todos;
    };

    const replyWithPlan = async (prompt: string, planContent: string) => {
      const todos = await syncTodosFromPlanContent(planContent);
      ctx.sendResponse(requestId, {
        success: true,
        prompt,
        planContent,
        todos
      });
    };

    if (!planPath || typeof planPath !== 'string') {
      await replyWithPlan(confirmedPrompt, originalText);
      return;
    }

    const { uri } = resolveUriWithInfo(planPath);
    if (!uri) return await replyWithPlan(confirmedPrompt, originalText);

    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const currentContent = Buffer.from(bytes).toString('utf-8');

      const currentTrimmed = (currentContent || '').trim();
      const originalTrimmed = originalText.trim();

      if (currentTrimmed !== originalTrimmed) {
        await replyWithPlan(
          `User modified this plan and provided a new execution plan. Please execute accordingly:\n\n${currentContent}`,
          currentContent
        );
      } else {
        // 即使内容未变，也同步一次文档中的 TODO LIST（用户可能仅做了不影响 trim 的微调）
        await replyWithPlan(
          confirmedPrompt,
          originalText || currentContent || ''
        );
      }
    } catch {
      // File read failed, fallback to confirm
      await replyWithPlan(confirmedPrompt, originalText);
    }
  } catch (error: any) {
    ctx.sendError(requestId, 'PLAN_CONFIRM_ERROR', error.message || 'Failed to confirm plan execution');
  }
};

/**
 * 注册文件处理器
 */
export function registerFileHandlers(registry: Map<string, MessageHandler>): void {
  // 工作区信息
  registry.set('getWorkspaceUri', getWorkspaceUri);
  registry.set('getRelativePath', getRelativePath);
  
  // 固定文件管理
  registry.set('getPinnedFilesConfig', getPinnedFilesConfig);
  registry.set('checkPinnedFilesExistence', checkPinnedFilesExistence);
  registry.set('checkWorkspaceFilesExist', checkWorkspaceFilesExist);
  registry.set('updatePinnedFilesConfig', updatePinnedFilesConfig);
  registry.set('addPinnedFile', addPinnedFile);
  registry.set('removePinnedFile', removePinnedFile);
  registry.set('setPinnedFileEnabled', setPinnedFileEnabled);
  registry.set('validatePinnedFile', validatePinnedFile);
  
  // 提示词上下文
  registry.set('readFileForContext', readFileForContext);
  registry.set('readWorkspaceTextFile', readWorkspaceTextFile);
  registry.set('showContextContent', showContextContent);
  
  // 附件和图片
  registry.set('previewAttachment', previewAttachment);
  registry.set('readWorkspaceImage', readWorkspaceImage);
  registry.set('openWorkspaceFile', openWorkspaceFile);
  registry.set('openWorkspaceFileAt', openWorkspaceFileAt);
  registry.set('saveImageToPath', saveImageToPath);
  
  // 对话文件
  registry.set('conversation.revealInExplorer', revealConversationInExplorer);
  
  // 上下文总结
  registry.set('summarizeContext', summarizeContext);
  
  // 工作区文件搜索
  registry.set('searchWorkspaceFiles', searchWorkspaceFiles);
  
  // 通知
  registry.set('showNotification', showNotification);
  
  // Plan 执行确认
  registry.set('plan.confirmExecution', planConfirmExecution);
}
