/**
 * 工作区工具函数
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { t } from '../../backend/i18n';

/**
 * 检查路径是否应该被忽略
 */
export function shouldIgnorePath(relativePath: string, ignorePatterns: string[]): boolean {
  for (const pattern of ignorePatterns) {
    if (matchGlobPattern(relativePath, pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * 简单的 glob 模式匹配
 * 支持 * 和 ** 通配符
 */
export function matchGlobPattern(filePath: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/\\/g, '/')
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '<<<GLOBSTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<GLOBSTAR>>>/g, '.*')
    .replace(/\//g, '[/\\\\]');
  
  const regex = new RegExp(`^${regexPattern}$|[/\\\\]${regexPattern}$|^${regexPattern}[/\\\\]|[/\\\\]${regexPattern}[/\\\\]`, 'i');
  return regex.test(filePath.replace(/\\/g, '/'));
}

/**
 * 获取当前工作区 URI
 */
export function getCurrentWorkspaceUri(): string | null {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  return workspaceFolder ? workspaceFolder.uri.toString() : null;
}

/**
 * 将绝对路径或 URI 转换为相对路径
 * 支持 file:// 和 vscode-remote:// URI 格式
 */
export function getRelativePathFromAbsolute(absolutePath: string): string {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    throw new Error(t('webview.errors.noWorkspaceOpen'));
  }
  
  let filePath = absolutePath;
  
  // 支持 file:// 和 vscode-remote:// URI 格式
  if (absolutePath.startsWith('file://') || absolutePath.startsWith('vscode-remote://')) {
    try {
      const uri = vscode.Uri.parse(absolutePath);
      // 使用 uri.path 而不是 uri.fsPath，因为远程 URI 的 fsPath 可能不正确
      filePath = uri.path;
    } catch {
      // 解析失败，保持原始路径
    }
  }
  
  // 获取工作区路径（使用 uri.path 以支持远程工作区）
  const workspaceRoot = workspaceFolder.uri.path;
  
  // 计算相对路径
  if (filePath.startsWith(workspaceRoot + '/')) {
    return filePath.substring(workspaceRoot.length + 1);
  } else if (filePath === workspaceRoot) {
    return '';
  }
  
  // 回退到 node 的 path.relative（仅适用于本地路径）
  const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);
  
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return filePath;
  }
  
  return relativePath.replace(/\\/g, '/');
}

/**
 * 检查文件是否存在
 */
export async function checkFileExists(relativePath: string, workspaceUri: string): Promise<boolean> {
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return false;
    }
    
    const workspaceFolder = workspaceFolders.find(f => f.uri.toString() === workspaceUri);
    if (!workspaceFolder) {
      return false;
    }
    
    const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, relativePath);
    
    try {
      const stat = await vscode.workspace.fs.stat(fileUri);
      return stat.type === vscode.FileType.File;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * 验证文件是否在工作区内
 */
export async function validateFileInWorkspace(filePath: string, workspaceUri?: string): Promise<{
  valid: boolean;
  relativePath?: string;
  workspaceUri?: string;
  error?: string;
  errorCode?: 'NO_WORKSPACE' | 'WORKSPACE_NOT_FOUND' | 'INVALID_URI' | 'NOT_FILE' | 'FILE_NOT_EXISTS' | 'NOT_IN_ANY_WORKSPACE' | 'NOT_IN_CURRENT_WORKSPACE' | 'UNKNOWN';
}> {
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return { valid: false, error: t('webview.errors.noWorkspaceOpen'), errorCode: 'NO_WORKSPACE' };
    }
    
    let fileUri: vscode.Uri;
    
    // 支持 file:// 和 vscode-remote:// URI 格式
    if (filePath.startsWith('file://') || filePath.startsWith('vscode-remote://')) {
      try {
        fileUri = vscode.Uri.parse(filePath);
      } catch (e: any) {
        return { valid: false, error: t('webview.errors.invalidFileUri'), errorCode: 'INVALID_URI' };
      }
    } else if (path.isAbsolute(filePath)) {
      fileUri = vscode.Uri.file(filePath);
    } else {
      const targetWorkspace = workspaceUri
        ? workspaceFolders.find(f => f.uri.toString() === workspaceUri)
        : workspaceFolders[0];
      if (!targetWorkspace) {
        return { valid: false, error: t('webview.errors.workspaceNotFound'), errorCode: 'WORKSPACE_NOT_FOUND' };
      }
      fileUri = vscode.Uri.joinPath(targetWorkspace.uri, filePath);
    }
    
    // 检查文件是否存在
    try {
      const stat = await vscode.workspace.fs.stat(fileUri);
      if (stat.type !== vscode.FileType.File) {
        return { valid: false, error: t('webview.errors.pathNotFile'), errorCode: 'NOT_FILE' };
      }
    } catch (e: any) {
      return { valid: false, error: t('webview.errors.fileNotExists'), errorCode: 'FILE_NOT_EXISTS' };
    }
    
    // 尝试使用 VSCode API 获取工作区
    let belongingWorkspace = vscode.workspace.getWorkspaceFolder(fileUri);
    
    // 如果 API 返回 null，手动通过路径匹配（解决远程 SSH scheme 不一致问题）
    // 例如：文件是 vscode-remote://ssh-remote+host/path 但工作区是 file:///path
    if (!belongingWorkspace) {
      const fileFsPath = fileUri.path; // 获取文件系统路径部分
      
      for (const folder of workspaceFolders) {
        const workspaceFsPath = folder.uri.path;
        // 检查文件路径是否以工作区路径开头
        if (fileFsPath.startsWith(workspaceFsPath + '/') || fileFsPath === workspaceFsPath) {
          belongingWorkspace = folder;
          break;
        }
      }
    }
    
    if (!belongingWorkspace) {
      return {
        valid: false,
        error: t('webview.errors.fileNotInAnyWorkspace'),
        errorCode: 'NOT_IN_ANY_WORKSPACE'
      };
    }
    
    if (workspaceUri && belongingWorkspace.uri.toString() !== workspaceUri) {
      // 同样需要检查路径匹配（scheme 可能不同）
      const providedWorkspacePath = vscode.Uri.parse(workspaceUri).path;
      if (belongingWorkspace.uri.path !== providedWorkspacePath) {
        const belongingWorkspaceName = belongingWorkspace.name;
        return {
          valid: false,
          error: t('webview.errors.fileInOtherWorkspace', { workspaceName: belongingWorkspaceName }),
          errorCode: 'NOT_IN_CURRENT_WORKSPACE'
        };
      }
    }
    
    // 计算相对路径
    const workspacePath = belongingWorkspace.uri.path;
    const fileFsPath = fileUri.path;
    let relativePath: string;
    
    if (fileFsPath.startsWith(workspacePath + '/')) {
      relativePath = fileFsPath.substring(workspacePath.length + 1);
    } else if (fileFsPath === workspacePath) {
      relativePath = '';
    } else {
      // 回退到 VSCode API
      relativePath = vscode.workspace.asRelativePath(fileUri, false);
    }
    
    return {
      valid: true,
      relativePath,
      workspaceUri: belongingWorkspace.uri.toString()
    };
  } catch (error: any) {
    return { valid: false, error: error.message, errorCode: 'UNKNOWN' };
  }
}
