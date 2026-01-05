/**
 * VSCode 工具共享辅助函数
 *
 * 支持多工作区（Multi-root Workspaces）
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { t } from '../i18n';

// ==================== 多工作区支持 ====================

/**
 * 工作区信息
 */
export interface WorkspaceInfo {
    /** 工作区名称 */
    name: string;
    /** 工作区 URI */
    uri: vscode.Uri;
    /** 工作区文件系统路径 */
    fsPath: string;
    /** 索引（在 workspaceFolders 中的位置） */
    index: number;
}

/**
 * 获取所有工作区
 */
export function getAllWorkspaces(): WorkspaceInfo[] {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return [];
    }
    
    return folders.map((folder, index) => ({
        name: folder.name,
        uri: folder.uri,
        fsPath: folder.uri.fsPath,
        index
    }));
}

/**
 * 获取工作区根目录（默认返回第一个工作区，保持向后兼容）
 */
export function getWorkspaceRoot(): vscode.Uri | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri;
}

/**
 * 根据名称或索引获取工作区
 *
 * @param identifier 工作区名称或索引
 * @returns 工作区信息，如果未找到则返回 undefined
 */
export function getWorkspaceByIdentifier(identifier: string | number): WorkspaceInfo | undefined {
    const workspaces = getAllWorkspaces();
    
    if (typeof identifier === 'number') {
        return workspaces[identifier];
    }
    
    // 按名称查找（不区分大小写）
    return workspaces.find(w => w.name.toLowerCase() === identifier.toLowerCase());
}

/**
 * 解析带工作区前缀的路径
 *
 * 支持格式：
 * - `workspace_name/path/to/file` - 工作区名称前缀带路径
 * - `workspace_name` - 只有工作区名称（访问根目录）
 * - `@workspace_name/path/to/file` - @ 前缀格式带路径
 * - `@workspace_name` - @ 前缀只有工作区名称（访问根目录）
 *
 * 单工作区时：直接使用该工作区
 * 多工作区时：必须显式指定工作区前缀
 *
 * @param pathStr 路径字符串
 * @returns 解析结果，包含工作区信息和相对路径
 */
export function parseWorkspacePath(pathStr: string): {
    workspace: WorkspaceInfo | undefined;
    relativePath: string;
    isExplicit: boolean;  // 是否显式指定了工作区
    error?: string;       // 错误信息
} {
    const workspaces = getAllWorkspaces();
    
    // 如果没有工作区
    if (workspaces.length === 0) {
        return { workspace: undefined, relativePath: pathStr, isExplicit: false, error: 'No workspace folder open' };
    }
    
    // 如果只有一个工作区，直接返回
    if (workspaces.length === 1) {
        return { workspace: workspaces[0], relativePath: pathStr, isExplicit: false };
    }
    
    // 多工作区模式，必须显式指定前缀
    
    // 处理 @ 前缀格式
    if (pathStr.startsWith('@')) {
        const slashIndex = pathStr.indexOf('/');
        if (slashIndex > 1) {
            // @workspace_name/path 格式
            const workspaceName = pathStr.substring(1, slashIndex);
            const relativePath = pathStr.substring(slashIndex + 1);
            const workspace = getWorkspaceByIdentifier(workspaceName);
            if (workspace) {
                return { workspace, relativePath, isExplicit: true };
            }
            return {
                workspace: undefined,
                relativePath: pathStr,
                isExplicit: false,
                error: `Unknown workspace: ${workspaceName}. Available workspaces: ${workspaces.map(w => w.name).join(', ')}`
            };
        } else {
            // @workspace_name 格式（没有路径，访问根目录）
            const workspaceName = pathStr.substring(1);
            const workspace = getWorkspaceByIdentifier(workspaceName);
            if (workspace) {
                return { workspace, relativePath: '.', isExplicit: true };
            }
            return {
                workspace: undefined,
                relativePath: pathStr,
                isExplicit: false,
                error: `Unknown workspace: ${workspaceName}. Available workspaces: ${workspaces.map(w => w.name).join(', ')}`
            };
        }
    }
    
    // 检查是否以工作区名称开头（带 /）
    for (const workspace of workspaces) {
        const prefix = workspace.name + '/';
        if (pathStr.startsWith(prefix)) {
            return {
                workspace,
                relativePath: pathStr.substring(prefix.length),
                isExplicit: true
            };
        }
    }
    
    // 检查是否精确匹配工作区名称（不带 /，访问根目录）
    for (const workspace of workspaces) {
        if (pathStr === workspace.name) {
            return {
                workspace,
                relativePath: '.',
                isExplicit: true
            };
        }
    }
    
    // 多工作区时未指定前缀，返回错误
    return {
        workspace: undefined,
        relativePath: pathStr,
        isExplicit: false,
        error: `Multi-root workspace requires workspace prefix. Use "workspace_name/path" format. Available workspaces: ${workspaces.map(w => w.name).join(', ')}`
    };
}

/**
 * 解析相对路径为绝对 URI（支持多工作区）
 *
 * @param relativePath 相对路径（可带工作区前缀）
 * @returns URI，如果无法解析则返回 undefined
 */
export function resolveUri(relativePath: string): vscode.Uri | undefined {
    const { workspace, relativePath: actualPath } = parseWorkspacePath(relativePath);
    if (!workspace) {
        return undefined;
    }
    return vscode.Uri.joinPath(workspace.uri, actualPath);
}

/**
 * 解析相对路径为绝对 URI，并返回详细信息
 *
 * @param relativePath 相对路径（可带工作区前缀）
 * @returns 解析结果
 */
export function resolveUriWithInfo(relativePath: string): {
    uri: vscode.Uri | undefined;
    workspace: WorkspaceInfo | undefined;
    relativePath: string;
    isExplicit: boolean;
    error?: string;
} {
    const { workspace, relativePath: actualPath, isExplicit, error } = parseWorkspacePath(relativePath);
    if (!workspace) {
        return { uri: undefined, workspace: undefined, relativePath: actualPath, isExplicit, error };
    }
    return {
        uri: vscode.Uri.joinPath(workspace.uri, actualPath),
        workspace,
        relativePath: actualPath,
        isExplicit
    };
}

/**
 * 将绝对路径转换为相对路径（支持多工作区）
 *
 * @param absolutePath 绝对路径或 URI
 * @param includeWorkspacePrefix 是否包含工作区前缀（多工作区时）
 * @returns 相对路径，如果不在任何工作区内则返回原路径
 */
export function toRelativePath(absolutePath: string | vscode.Uri, includeWorkspacePrefix: boolean = false): string {
    const fsPath = typeof absolutePath === 'string' ? absolutePath : absolutePath.fsPath;
    const workspaces = getAllWorkspaces();
    
    // 查找包含此路径的工作区
    for (const workspace of workspaces) {
        if (fsPath.startsWith(workspace.fsPath)) {
            let relativePath = path.relative(workspace.fsPath, fsPath);
            // 统一使用正斜杠
            relativePath = relativePath.replace(/\\/g, '/');
            
            // 如果有多个工作区且需要前缀
            if (includeWorkspacePrefix && workspaces.length > 1) {
                return `${workspace.name}/${relativePath}`;
            }
            return relativePath;
        }
    }
    
    // 不在任何工作区内，返回原路径
    return fsPath;
}

/**
 * 检查路径是否在工作区内
 *
 * @param pathStr 路径
 * @returns 是否在工作区内
 */
export function isInWorkspace(pathStr: string): boolean {
    const { workspace } = parseWorkspacePath(pathStr);
    return workspace !== undefined;
}

/**
 * 获取多工作区描述（用于提示词）
 */
export function getWorkspacesDescription(): string {
    const workspaces = getAllWorkspaces();
    
    if (workspaces.length === 0) {
        return t('workspace.noWorkspaceOpen');
    }
    
    if (workspaces.length === 1) {
        return t('workspace.singleWorkspace', { path: workspaces[0].fsPath });
    }
    
    const lines = [t('workspace.multiRootMode')];
    for (const ws of workspaces) {
        lines.push(`- ${ws.name}: ${ws.fsPath}`);
    }
    lines.push('');
    lines.push(t('workspace.useWorkspaceFormat'));
    
    return lines.join('\n');
}

/**
 * MIME 类型映射（仅限多模态工具调用支持的格式）
 *
 * 支持的类型：
 * - 图片：image/png, image/jpeg, image/webp
 * - 文档：application/pdf, text/plain
 */
const MULTIMODAL_MIME_TYPES: Record<string, string> = {
    // 图片（仅支持这 3 种）
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    // 文档（仅支持 PDF）
    '.pdf': 'application/pdf',
};

/**
 * 支持多模态返回的文件扩展名（图片和 PDF）
 */
const MULTIMODAL_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.webp',  // 图片
    '.pdf',                              // 文档
]);

/**
 * 多模态工具支持的 MIME 类型
 */
export const MULTIMODAL_SUPPORTED_TYPES = {
    /** 图片类型 */
    images: ['image/png', 'image/jpeg', 'image/webp'],
    /** 文档类型 */
    documents: ['application/pdf', 'text/plain'],
    /** 所有支持的类型 */
    all: ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain']
};

/**
 * 所有已知的二进制文件扩展名
 */
const BINARY_EXTENSIONS = new Set([
    // 图片
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.heif', '.bmp', '.svg', '.ico', '.tiff',
    // 音频
    '.mp3', '.wav', '.aiff', '.aac', '.ogg', '.flac', '.m4a', '.wma',
    // 视频
    '.mp4', '.mov', '.avi', '.wmv', '.webm', '.mkv', '.3gp', '.flv', '.m4v',
    // 文档
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    // 其他二进制
    '.zip', '.rar', '.7z', '.tar', '.gz', '.exe', '.dll', '.so', '.dylib',
    '.woff', '.woff2', '.ttf', '.otf', '.eot',
]);

/**
 * 获取文件的 MIME 类型
 */
export function getMultimodalMimeType(filePath: string): string | null {
    const ext = path.extname(filePath).toLowerCase();
    return MULTIMODAL_MIME_TYPES[ext] || null;
}

/**
 * 检查是否支持多模态返回
 */
export function isMultimodalSupported(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return MULTIMODAL_EXTENSIONS.has(ext);
}

/**
 * 检查是否是二进制文件
 */
export function isBinaryFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return BINARY_EXTENSIONS.has(ext);
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * 检查文件扩展名是否为图片
 */
export function isImageFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ['.png', '.jpg', '.jpeg', '.webp'].includes(ext);
}

/**
 * 检查文件扩展名是否为 PDF
 */
export function isPdfFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.pdf';
}

/**
 * 检查是否支持多模态返回（根据配置）
 *
 * @param filePath 文件路径
 * @param multimodalEnabled 是否启用多模态工具
 * @returns 是否支持多模态返回
 */
export function isMultimodalSupportedWithConfig(filePath: string, multimodalEnabled: boolean): boolean {
    if (!multimodalEnabled) {
        // 禁用多模态时，不返回任何多模态数据
        return false;
    }
    return isMultimodalSupported(filePath);
}

/**
 * 检查文件是否允许读取（根据多模态配置）
 *
 * @param filePath 文件路径
 * @param multimodalEnabled 是否启用多模态工具
 * @returns 是否允许读取
 */
export function canReadFile(filePath: string, multimodalEnabled: boolean): boolean {
    // 文本文件总是允许读取
    if (!isBinaryFile(filePath)) {
        return true;
    }
    
    // 二进制文件只有在启用多模态且支持多模态返回时才允许读取
    if (multimodalEnabled && isMultimodalSupported(filePath)) {
        return true;
    }
    
    return false;
}

/**
 * 获取不支持读取的原因
 *
 * @param filePath 文件路径
 * @param multimodalEnabled 是否启用多模态工具
 * @returns 错误消息，如果允许读取则返回 null
 */
export function getReadFileError(filePath: string, multimodalEnabled: boolean): string | null {
    if (canReadFile(filePath, multimodalEnabled)) {
        return null;
    }
    
    const ext = path.extname(filePath).toLowerCase();
    
    if (isImageFile(filePath) || isPdfFile(filePath)) {
        return t('multimodal.cannotReadFile', { ext });
    }
    
    return t('multimodal.cannotReadBinaryFile', { ext });
}

// ==================== 渠道类型多模态支持 ====================

/**
 * 渠道类型
 */
export type ChannelType = 'gemini' | 'openai' | 'anthropic' | 'openai-responses';

/**
 * 工具模式
 */
export type ToolMode = 'function_call' | 'xml' | 'json';

/**
 * 多模态能力
 */
export interface MultimodalCapability {
    /** 是否支持图片 */
    supportsImages: boolean;
    /** 是否支持文档（PDF） */
    supportsDocuments: boolean;
    /** 是否支持回传多模态数据到历史记录 */
    supportsHistoryMultimodal: boolean;
}

/**
 * 获取渠道的多模态能力
 * 
 * 根据渠道类型和工具模式，定义不同的多模态支持级别：
 * - gemini: 全面支持所有多模态功能
 * - openai: 
 *   - function_call 模式不支持多模态工具
 *   - xml/json 模式只支持图片，不支持文档
 * - anthropic: 全部支持
 * - custom: 保守处理，假设全部支持
 * 
 * @param channelType 渠道类型
 * @param toolMode 工具模式
 * @param multimodalEnabled 是否启用多模态工具
 * @returns 多模态能力
 */
export function getMultimodalCapability(
    channelType: ChannelType,
    toolMode: ToolMode,
    multimodalEnabled: boolean
): MultimodalCapability {
    // 如果未启用多模态工具，不支持任何多模态功能
    if (!multimodalEnabled) {
        return {
            supportsImages: false,
            supportsDocuments: false,
            supportsHistoryMultimodal: false,
        };
    }
    
    switch (channelType) {
        case 'gemini':
            // Gemini 全面支持
            return {
                supportsImages: true,
                supportsDocuments: true,
                supportsHistoryMultimodal: true,
            };
            
        case 'openai':
            if (toolMode === 'function_call') {
                // OpenAI function_call 模式：工具响应不能包含图片数据
                // （OpenAI API 要求 tool result 必须是字符串）
                return {
                    supportsImages: false,
                    supportsDocuments: false,
                    supportsHistoryMultimodal: false,
                };
            } else {
                // OpenAI xml/json 模式：
                // - 支持图片（作为 user 消息附件发送）
                // - 不支持文档（PDF）
                // - 历史中的图片可以正常发送（作为 user 消息的 image_url 类型）
                return {
                    supportsImages: true,
                    supportsDocuments: false,
                    supportsHistoryMultimodal: true, // 历史中的图片可以作为 user 消息发送
                };
            }
            
        case 'openai-responses':
            // OpenAI Responses API 全面支持多模态（图片和文档）
            return {
                supportsImages: true,
                supportsDocuments: true,
                supportsHistoryMultimodal: true,
            };
            
        case 'anthropic':
            // Anthropic 全面支持多模态（图片和文档）
            return {
                supportsImages: true,
                supportsDocuments: true,
                supportsHistoryMultimodal: true,
            };
            
        default:
            return {
                supportsImages: false,
                supportsDocuments: false,
                supportsHistoryMultimodal: false,
            };
    }
}

/**
 * 根据渠道能力检查文件是否允许读取
 * 
 * @param filePath 文件路径
 * @param capability 多模态能力
 * @returns 是否允许读取
 */
export function canReadFileWithCapability(filePath: string, capability: MultimodalCapability): boolean {
    // 文本文件总是允许读取
    if (!isBinaryFile(filePath)) {
        return true;
    }
    
    // 检查图片支持
    if (isImageFile(filePath)) {
        return capability.supportsImages;
    }
    
    // 检查文档支持（PDF）
    if (isPdfFile(filePath)) {
        return capability.supportsDocuments;
    }
    
    return false;
}

/**
 * 获取不支持读取的详细原因（带渠道能力信息）
 *
 * @param filePath 文件路径
 * @param multimodalEnabled 是否启用多模态工具
 * @param capability 多模态能力（可选）
 * @returns 错误消息，如果允许读取则返回 null
 */
export function getReadFileErrorWithCapability(
    filePath: string,
    multimodalEnabled: boolean,
    capability?: MultimodalCapability
): string | null {
    // 如果有能力信息，使用能力检查
    if (capability) {
        if (canReadFileWithCapability(filePath, capability)) {
            return null;
        }
    } else {
        if (canReadFile(filePath, multimodalEnabled)) {
            return null;
        }
    }
    
    const ext = path.extname(filePath).toLowerCase();
    
    if (!multimodalEnabled) {
        if (isImageFile(filePath) || isPdfFile(filePath)) {
            return t('multimodal.cannotReadFile', { ext });
        }
    } else if (capability) {
        if (isImageFile(filePath) && !capability.supportsImages) {
            return t('multimodal.cannotReadImage', { ext });
        }
        if (isPdfFile(filePath) && !capability.supportsDocuments) {
            return t('multimodal.cannotReadDocument', { ext });
        }
    }
    
    return t('multimodal.cannotReadBinaryFile', { ext });
}

/**
 * 检查 MIME 类型是否为图片
 */
export function isMimeTypeImage(mimeType: string): boolean {
    return MULTIMODAL_SUPPORTED_TYPES.images.includes(mimeType);
}

/**
 * 检查 MIME 类型是否为文档
 */
export function isMimeTypeDocument(mimeType: string): boolean {
    return MULTIMODAL_SUPPORTED_TYPES.documents.includes(mimeType);
}

// ==================== 图片尺寸计算工具 ====================

/**
 * 图片尺寸信息
 */
export interface ImageDimensions {
    width: number;
    height: number;
    aspectRatio: string;  // 如 "16:9", "4:3", "1:1"
}

/**
 * 计算最大公约数
 */
function gcd(a: number, b: number): number {
    return b === 0 ? a : gcd(b, a % b);
}

/**
 * 计算宽高比字符串
 *
 * @param width 宽度
 * @param height 高度
 * @returns 宽高比字符串，如 "16:9", "4:3", "1:1"
 */
export function calculateAspectRatio(width: number, height: number): string {
    if (width <= 0 || height <= 0) {
        return '1:1';
    }
    
    const divisor = gcd(width, height);
    const ratioW = width / divisor;
    const ratioH = height / divisor;
    
    // 如果比例数字太大，使用近似值
    if (ratioW > 100 || ratioH > 100) {
        const ratio = width / height;
        // 常见比例检测
        if (Math.abs(ratio - 16/9) < 0.05) return '16:9';
        if (Math.abs(ratio - 9/16) < 0.05) return '9:16';
        if (Math.abs(ratio - 4/3) < 0.05) return '4:3';
        if (Math.abs(ratio - 3/4) < 0.05) return '3:4';
        if (Math.abs(ratio - 3/2) < 0.05) return '3:2';
        if (Math.abs(ratio - 2/3) < 0.05) return '2:3';
        if (Math.abs(ratio - 1) < 0.05) return '1:1';
        if (Math.abs(ratio - 21/9) < 0.05) return '21:9';
        if (Math.abs(ratio - 9/21) < 0.05) return '9:21';
        // 返回小数比例
        return `${ratio.toFixed(2)}:1`;
    }
    
    return `${ratioW}:${ratioH}`;
}

/**
 * 从宽高创建完整的尺寸信息
 */
export function createImageDimensions(width: number, height: number): ImageDimensions {
    return {
        width,
        height,
        aspectRatio: calculateAspectRatio(width, height)
    };
}