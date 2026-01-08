/**
 * 固定文件和工作区文件消息处理器
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { t } from '../../backend/i18n';
import type { HandlerContext, MessageHandler } from '../types';
import { validateFileInWorkspace, checkFileExists, getRelativePathFromAbsolute } from '../utils/WorkspaceUtils';

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

export const getPinnedFilesConfig: MessageHandler = async (data, requestId, ctx) => {
  try {
    const workspaceUri = ctx.getCurrentWorkspaceUri();
    if (!workspaceUri) {
      ctx.sendResponse(requestId, { files: [], sectionTitle: 'PINNED FILES CONTENT' });
      return;
    }
    
    const allConfig = ctx.settingsManager.getPinnedFilesConfig();
    const workspaceFiles = allConfig.files.filter(f => f.workspaceUri === workspaceUri);
    
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
    const { path: filePath, workspaceUri: providedWorkspaceUri } = data;
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
    const file = await ctx.settingsManager.addPinnedFile(validation.relativePath!, actualWorkspaceUri);
    ctx.sendResponse(requestId, { success: true, file });
  } catch (error: any) {
    ctx.sendError(requestId, 'ADD_PINNED_FILE_ERROR', error.message || t('webview.errors.addPinnedFileFailed'));
  }
};

export const removePinnedFile: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { id } = data;
    await ctx.settingsManager.removePinnedFile(id);
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendError(requestId, 'REMOVE_PINNED_FILE_ERROR', error.message || t('webview.errors.removePinnedFileFailed'));
  }
};

export const setPinnedFileEnabled: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { id, enabled } = data;
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
  try {
    const result = await ctx.chatHandler.handleSummarizeContext({
      conversationId: data.conversationId,
      configId: data.configId
    });
    ctx.sendResponse(requestId, result);
  } catch (error: any) {
    ctx.sendError(requestId, 'SUMMARIZE_ERROR', error.message || t('webview.errors.summarizeFailed'));
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
      ctx.sendResponse(requestId, { files: [] });
      return;
    }
    
    const results: { path: string; name: string; isDirectory: boolean }[] = [];
    
    // 1. 搜索文件夹
    await searchDirectories(workspaceFolder.uri, query.trim(), Math.floor(limit / 2), results);
    
    // 2. 搜索文件
    const pattern = query.trim() ? `**/*${query}*` : '**/*';
    const excludePattern = '{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/.next/**,**/out/**,**/.vscode/**,**/.idea/**,**/__pycache__/**,**/.cache/**,**/coverage/**}';
    const files = await vscode.workspace.findFiles(pattern, excludePattern, limit - results.length);
    
    // 添加文件结果
    for (const uri of files) {
      if (results.length >= limit) break;
      const relativePath = vscode.workspace.asRelativePath(uri);
      results.push({
        path: relativePath,
        name: path.basename(uri.fsPath),
        isDirectory: false
      });
    }
    
    // 排序：文件夹在前，然后按路径长度排序
    results.sort((a, b) => {
      // 文件夹优先
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      // 然后按路径长度
      return a.path.length - b.path.length;
    });
    
    ctx.sendResponse(requestId, { files: results });
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
  registry.set('updatePinnedFilesConfig', updatePinnedFilesConfig);
  registry.set('addPinnedFile', addPinnedFile);
  registry.set('removePinnedFile', removePinnedFile);
  registry.set('setPinnedFileEnabled', setPinnedFileEnabled);
  registry.set('validatePinnedFile', validatePinnedFile);
  
  // 附件和图片
  registry.set('previewAttachment', previewAttachment);
  registry.set('readWorkspaceImage', readWorkspaceImage);
  registry.set('openWorkspaceFile', openWorkspaceFile);
  registry.set('saveImageToPath', saveImageToPath);
  
  // 对话文件
  registry.set('conversation.revealInExplorer', revealConversationInExplorer);
  
  // 上下文总结
  registry.set('summarizeContext', summarizeContext);
  
  // 工作区文件搜索
  registry.set('searchWorkspaceFiles', searchWorkspaceFiles);
  
  // 通知
  registry.set('showNotification', showNotification);
}
