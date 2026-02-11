/**
 * 在文件中搜索（和替换）内容工具
 *
 * 支持多工作区（Multi-root Workspaces）
 * 支持正则表达式搜索和替换
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { Tool, ToolResult } from '../types';
import { getWorkspaceRoot, getAllWorkspaces, parseWorkspacePath, toRelativePath, normalizeLineEndingsToLF } from '../utils';
import { getGlobalSettingsManager } from '../../core/settingsContext';
import { getDiffStorageManager } from '../../modules/conversation';
import { getDiffManager } from '../file/diffManager';
import { DEFAULT_SEARCH_IN_FILES_CONFIG } from '../../modules/settings/types';
import type { SearchInFilesToolConfig } from '../../modules/settings/types';

/**
 * 默认排除模式
 */
const DEFAULT_EXCLUDE = '**/node_modules/**';

/**
 * 获取 search_in_files 工具配置（带默认值兜底）
 */
function getSearchInFilesConfig(): Readonly<SearchInFilesToolConfig> {
    const settingsManager = getGlobalSettingsManager();
    if (settingsManager) {
        return settingsManager.getSearchInFilesConfig();
    }
    return DEFAULT_SEARCH_IN_FILES_CONFIG;
}

/**
 * 获取排除模式
 *
 * 从设置管理器获取用户配置的排除模式，如果未配置则使用默认值
 * 将多个模式合并为单个 glob 模式（用大括号语法）
 */
function getExcludePattern(): string {
    const config = getSearchInFilesConfig();
    if (config.excludePatterns && config.excludePatterns.length > 0) {
        // 多个模式用 {} 语法组合
        if (config.excludePatterns.length === 1) {
            return config.excludePatterns[0];
        }
        return `{${config.excludePatterns.join(',')}}`;
    }
    return DEFAULT_EXCLUDE;
}

/**
 * 转义正则特殊字符
 */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 搜索匹配项
 */
interface SearchMatch {
    file: string;
    workspace?: string;
    line: number;
    column: number;
    match: string;
    context: string;
}

/**
 * 替换结果
 */
interface ReplaceResult {
    file: string;
    workspace?: string;
    replacements: number;
    status?: 'accepted' | 'rejected' | 'pending';
    diffContentId?: string;
    /** Pending diff ID，用于确认/拒绝 */
    pendingDiffId?: string;
}

// ==================== 二进制/文本检测与输出裁剪辅助 ====================

type TextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be';

interface TextDetectionResult {
    isText: boolean;
    encoding: TextEncoding;
    /** BOM 字节数（需要跳过） */
    bomLength: number;
    reason?: string;
}

interface SearchBudget {
    remainingChars: number;
    truncated: boolean;
}

function clampNonNegativeNumber(value: unknown, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }
    return value < 0 ? 0 : value;
}

async function tryGetFileSizeBytes(uri: vscode.Uri): Promise<number | undefined> {
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        return typeof stat.size === 'number' ? stat.size : undefined;
    } catch {
        return undefined;
    }
}

async function readHeaderBytes(uri: vscode.Uri, maxBytes: number): Promise<Uint8Array> {
    const n = Math.max(0, Math.floor(maxBytes));
    if (n <= 0) {
        return new Uint8Array();
    }

    // 本地文件优先用 Node fs 做真正的“只读文件头”
    if (uri.scheme === 'file' && uri.fsPath) {
        try {
            const handle = await fs.open(uri.fsPath, 'r');
            try {
                const buffer = Buffer.alloc(n);
                const { bytesRead } = await handle.read(buffer, 0, n, 0);
                return buffer.subarray(0, bytesRead);
            } finally {
                await handle.close();
            }
        } catch {
            // 回退到 vscode fs
        }
    }

    // 非 file scheme：无法保证部分读取，退化为读取后截取（有大小护栏即可）
    const content = await vscode.workspace.fs.readFile(uri);
    return content.subarray(0, Math.min(n, content.length));
}

function detectTextFromHeader(header: Uint8Array): TextDetectionResult {
    if (!header || header.length === 0) {
        return { isText: true, encoding: 'utf-8', bomLength: 0 };
    }

    // BOM 检测
    if (header.length >= 3 && header[0] === 0xEF && header[1] === 0xBB && header[2] === 0xBF) {
        return { isText: true, encoding: 'utf-8', bomLength: 3 };
    }
    if (header.length >= 2 && header[0] === 0xFF && header[1] === 0xFE) {
        return { isText: true, encoding: 'utf-16le', bomLength: 2 };
    }
    if (header.length >= 2 && header[0] === 0xFE && header[1] === 0xFF) {
        return { isText: true, encoding: 'utf-16be', bomLength: 2 };
    }

    // UTF-16（无 BOM）启发式：大量 NUL 且集中在偶/奇位
    const sampleLen = Math.min(header.length, 1024);
    let evenZeros = 0;
    let oddZeros = 0;
    for (let i = 0; i < sampleLen; i++) {
        if (header[i] === 0x00) {
            if (i % 2 === 0) evenZeros++;
            else oddZeros++;
        }
    }
    const evenCount = Math.ceil(sampleLen / 2);
    const oddCount = Math.floor(sampleLen / 2) || 1;
    const evenZeroRatio = evenZeros / (evenCount || 1);
    const oddZeroRatio = oddZeros / oddCount;

    if (oddZeroRatio > 0.3 && evenZeroRatio < 0.05) {
        return { isText: true, encoding: 'utf-16le', bomLength: 0 };
    }
    if (evenZeroRatio > 0.3 && oddZeroRatio < 0.05) {
        return { isText: true, encoding: 'utf-16be', bomLength: 0 };
    }

    // NUL 基本可判为二进制（非 UTF-16）
    for (let i = 0; i < sampleLen; i++) {
        if (header[i] === 0x00) {
            return { isText: false, encoding: 'utf-8', bomLength: 0, reason: 'NUL byte detected' };
        }
    }

    // 控制字符占比过高：倾向二进制
    let suspicious = 0;
    for (let i = 0; i < sampleLen; i++) {
        const b = header[i];
        const isAllowedWhitespace = b === 0x09 || b === 0x0A || b === 0x0D; // \t \n \r
        const isControl =
            (b < 0x20 && !isAllowedWhitespace) ||
            b === 0x7F;
        if (isControl) suspicious++;
    }
    const suspiciousRatio = suspicious / (sampleLen || 1);
    if (suspiciousRatio > 0.3) {
        return { isText: false, encoding: 'utf-8', bomLength: 0, reason: `High control-char ratio: ${suspiciousRatio.toFixed(2)}` };
    }

    return { isText: true, encoding: 'utf-8', bomLength: 0 };
}

function swapByteOrder16(data: Uint8Array): Uint8Array {
    const len = data.length - (data.length % 2);
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i += 2) {
        out[i] = data[i + 1];
        out[i + 1] = data[i];
    }
    return out;
}

function decodeTextBytes(bytes: Uint8Array, detection: TextDetectionResult): string {
    const start = Math.max(0, detection.bomLength || 0);
    const sliced = bytes.subarray(start);

    if (detection.encoding === 'utf-16be') {
        const swapped = swapByteOrder16(sliced);
        return new TextDecoder('utf-16le').decode(swapped);
    }

    if (detection.encoding === 'utf-16le') {
        return new TextDecoder('utf-16le').decode(sliced);
    }

    return new TextDecoder('utf-8').decode(sliced);
}

function truncateWithEllipsis(text: string, maxChars: number): string {
    const limit = Math.max(0, Math.floor(maxChars));
    if (limit <= 0) {
        return '';
    }
    if (text.length <= limit) {
        return text;
    }
    // 留一个字符给省略号
    const sliceLen = Math.max(0, limit - 1);
    return `${text.slice(0, sliceLen)}…`;
}

function createMatchLineSnippet(line: string, matchStart: number, matchLength: number, maxChars: number): string {
    const limit = Math.max(0, Math.floor(maxChars));
    if (limit <= 0) {
        return '';
    }
    if (line.length <= limit) {
        return line;
    }

    const start = Math.max(0, matchStart);
    const end = Math.max(start, start + Math.max(0, matchLength));

    // 让窗口尽量把 match 放在中间
    const half = Math.floor(limit / 2);
    let windowStart = Math.max(0, start - half);
    let windowEnd = windowStart + limit;
    if (windowEnd < end) {
        windowEnd = Math.min(line.length, end + half);
        windowStart = Math.max(0, windowEnd - limit);
    }
    if (windowEnd > line.length) {
        windowEnd = line.length;
        windowStart = Math.max(0, windowEnd - limit);
    }

    let snippet = line.slice(windowStart, windowEnd);
    if (windowStart > 0) {
        snippet = `…${snippet}`;
    }
    if (windowEnd < line.length) {
        snippet = `${snippet}…`;
    }
    return snippet;
}

function estimateMatchCost(relativePath: string, matchText: string, context: string): number {
    // 近似预算：路径 + match + context + 结构开销
    return (relativePath?.length || 0) + (matchText?.length || 0) + (context?.length || 0) + 80;
}

/**
 * 在单个目录中搜索（仅搜索，不替换）
 */
async function searchInDirectory(
    searchRoot: vscode.Uri,
    filePattern: string,
    searchRegex: RegExp,
    maxResults: number,
    workspaceName: string | null,
    excludePattern: string,
    config: Readonly<SearchInFilesToolConfig>,
    budget?: SearchBudget
): Promise<SearchMatch[]> {
    const results: SearchMatch[] = [];
    
    const pattern = new vscode.RelativePattern(searchRoot, filePattern);
    const files = await vscode.workspace.findFiles(pattern, excludePattern, 1000);

    const enableHeaderTextCheck = config.enableHeaderTextCheck !== false;
    const headerSampleBytes = Math.max(64, clampNonNegativeNumber(config.headerSampleBytes, 4096));
    const maxFileSizeBytes = clampNonNegativeNumber(config.maxFileSizeBytes, 5 * 1024 * 1024);
    const contextBefore = Math.floor(clampNonNegativeNumber(config.contextLinesBefore, 1));
    const contextAfter = Math.floor(clampNonNegativeNumber(config.contextLinesAfter, 1));
    const maxLinePreviewChars = Math.floor(clampNonNegativeNumber(config.maxLinePreviewChars, 300));
    const maxMatchPreviewChars = Math.floor(clampNonNegativeNumber(config.maxMatchPreviewChars, 220));
    
    for (const fileUri of files) {
        if (results.length >= maxResults) {
            break;
        }
        if (budget && budget.remainingChars <= 0) {
            budget.truncated = true;
            break;
        }
        
        try {
            // 文件大小护栏（避免读入超大文件）
            if (maxFileSizeBytes > 0) {
                const size = await tryGetFileSizeBytes(fileUri);
                if (typeof size === 'number' && size > maxFileSizeBytes) {
                    continue;
                }
            }

            // 文件头文本检测（跳过二进制）
            let detection: TextDetectionResult = { isText: true, encoding: 'utf-8', bomLength: 0 };
            if (enableHeaderTextCheck) {
                try {
                    const header = await readHeaderBytes(fileUri, headerSampleBytes);
                    detection = detectTextFromHeader(header);
                    if (!detection.isText) {
                        continue;
                    }
                } catch {
                    // header 检测失败时退化为旧行为（仍有大小/输出护栏）
                    detection = { isText: true, encoding: 'utf-8', bomLength: 0 };
                }
            }

            const content = await vscode.workspace.fs.readFile(fileUri);
            const text = normalizeLineEndingsToLF(decodeTextBytes(content, detection));
            const lines = text.split('\n');

            // 使用支持多工作区的相对路径（每文件只计算一次）
            const relativePath = toRelativePath(fileUri, workspaceName !== null);
            
            for (let i = 0; i < lines.length; i++) {
                if (results.length >= maxResults) {
                    break;
                }
                if (budget && budget.remainingChars <= 0) {
                    budget.truncated = true;
                    break;
                }
                
                const line = lines[i];
                let match;
                searchRegex.lastIndex = 0;
                
                while ((match = searchRegex.exec(line)) !== null) {
                    if (results.length >= maxResults) {
                        break;
                    }
                    if (budget && budget.remainingChars <= 0) {
                        budget.truncated = true;
                        break;
                    }
                    
                    const rawMatchText = match[0] ?? '';
                    const matchText = rawMatchText.length > maxMatchPreviewChars
                        ? truncateWithEllipsis(rawMatchText, maxMatchPreviewChars)
                        : rawMatchText;

                    // 获取上下文（可配置行数，且对超长行做裁剪）
                    const contextLines: string[] = [];

                    const beforeStart = Math.max(0, i - contextBefore);
                    for (let j = beforeStart; j < i; j++) {
                        contextLines.push(`${j + 1}: ${truncateWithEllipsis(lines[j], maxLinePreviewChars)}`);
                    }

                    const matchLinePreview = createMatchLineSnippet(line, match.index ?? 0, rawMatchText.length, maxMatchPreviewChars);
                    contextLines.push(`${i + 1}: ${matchLinePreview}`);

                    const afterEnd = Math.min(lines.length - 1, i + contextAfter);
                    for (let j = i + 1; j <= afterEnd; j++) {
                        contextLines.push(`${j + 1}: ${truncateWithEllipsis(lines[j], maxLinePreviewChars)}`);
                    }

                    const context = contextLines.join('\n');

                    // 输出预算护栏
                    const cost = estimateMatchCost(relativePath, matchText, context);
                    if (budget && budget.remainingChars - cost < 0) {
                        budget.truncated = true;
                        break;
                    }
                    
                    results.push({
                        file: relativePath,
                        workspace: workspaceName || undefined,
                        line: i + 1,
                        column: match.index + 1,
                        match: matchText,
                        context
                    });

                    if (budget) {
                        budget.remainingChars -= cost;
                    }

                    // 防止空匹配导致死循环
                    if ((match[0] ?? '').length === 0) {
                        searchRegex.lastIndex++;
                    }
                }
            }
        } catch {
            // 跳过无法读取的文件
        }
    }
    
    return results;
}

/**
 * 在单个目录中搜索并替换
 * 使用 DiffManager 创建待审阅的 diff
 */
async function searchAndReplaceInDirectory(
    searchRoot: vscode.Uri,
    filePattern: string,
    searchRegex: RegExp,
    replacement: string,
    maxFiles: number,
    workspaceName: string | null,
    excludePattern: string,
    config: Readonly<SearchInFilesToolConfig>,
    toolId?: string,
    abortSignal?: AbortSignal
): Promise<{
    matches: SearchMatch[];
    replacements: ReplaceResult[];
    totalReplacements: number;
    cancelled: boolean;
}> {
    const matches: SearchMatch[] = [];
    const replacements: ReplaceResult[] = [];
    let totalReplacements = 0;
    let cancelledBySignal = false;
    
    const pattern = new vscode.RelativePattern(searchRoot, filePattern);
    const files = await vscode.workspace.findFiles(pattern, excludePattern, 1000);

    const enableHeaderTextCheck = config.enableHeaderTextCheck !== false;
    const headerSampleBytes = Math.max(64, clampNonNegativeNumber(config.headerSampleBytes, 4096));
    const maxReplaceFileSizeBytes = clampNonNegativeNumber(config.maxReplaceFileSizeBytes, 1 * 1024 * 1024);
    const maxMatchPreviewChars = Math.floor(clampNonNegativeNumber(config.maxMatchPreviewChars, 220));
    
    let processedFiles = 0;
    const diffManager = getDiffManager();
    
    for (const fileUri of files) {
        // 检查是否已取消
        if (abortSignal?.aborted) {
            cancelledBySignal = true;
            break;
        }

        if (processedFiles >= maxFiles) {
            break;
        }
        
        try {
            // 文件大小护栏（替换模式更保守，避免生成超大 diff）
            if (maxReplaceFileSizeBytes > 0) {
                const size = await tryGetFileSizeBytes(fileUri);
                if (typeof size === 'number' && size > maxReplaceFileSizeBytes) {
                    continue;
                }
            }

            // 文件头文本检测（跳过二进制）
            let detection: TextDetectionResult = { isText: true, encoding: 'utf-8', bomLength: 0 };
            if (enableHeaderTextCheck) {
                try {
                    const header = await readHeaderBytes(fileUri, headerSampleBytes);
                    detection = detectTextFromHeader(header);
                    if (!detection.isText) {
                        continue;
                    }
                } catch {
                    detection = { isText: true, encoding: 'utf-8', bomLength: 0 };
                }
            }

            const content = await vscode.workspace.fs.readFile(fileUri);
            const originalText = normalizeLineEndingsToLF(decodeTextBytes(content, detection));
            const lines = originalText.split('\n');
            
            // 检查是否有匹配
            searchRegex.lastIndex = 0;
            if (!searchRegex.test(originalText)) {
                continue;
            }
            
            processedFiles++;
            
            // 使用支持多工作区的相对路径
            const relativePath = toRelativePath(fileUri, workspaceName !== null);
            
            // 收集该文件的匹配信息
            let fileReplacementCount = 0;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                let match;
                searchRegex.lastIndex = 0;
                
                while ((match = searchRegex.exec(line)) !== null) {
                    const rawMatchText = match[0] ?? '';
                    const matchText = rawMatchText.length > maxMatchPreviewChars
                        ? truncateWithEllipsis(rawMatchText, maxMatchPreviewChars)
                        : rawMatchText;

                    matches.push({
                        file: relativePath,
                        workspace: workspaceName || undefined,
                        line: i + 1,
                        column: match.index + 1,
                        match: matchText,
                        // 替换模式下不会在返回体中使用 context，这里置空避免无谓的字符串拼接
                        context: ''
                    });
                    
                    fileReplacementCount++;

                    // 防止空匹配导致死循环
                    if ((match[0] ?? '').length === 0) {
                        searchRegex.lastIndex++;
                    }
                }
            }
            
            // 执行替换
            searchRegex.lastIndex = 0;
            const newText = originalText.replace(searchRegex, replacement);
            
            if (newText !== originalText) {
                totalReplacements += fileReplacementCount;
                
                let diffContentId: string | undefined;
                let status: 'accepted' | 'rejected' | 'pending' = 'pending';
                let pendingDiffId: string | undefined;

                // 使用 DiffManager 创建待审阅的 diff
                const newContentLines = newText.split('\n').length;
                const blocks = [{
                    index: 0,
                    startLine: 1,
                    endLine: newContentLines
                }];

                const pendingDiff = await diffManager.createPendingDiff(
                    relativePath,
                    fileUri.fsPath,
                    originalText,
                    newText,
                    blocks,
                    undefined,
                    toolId
                );

                // 等待 diff 被处理（保存或拒绝）或用户中断/取消
                const interruptReason = await new Promise<'none' | 'abort' | 'user'>((resolve) => {
                    let resolved = false;
                    let abortHandler: (() => void) | undefined;

                    const finish = (reason: 'none' | 'abort' | 'user') => {
                        if (resolved) return;
                        resolved = true;
                        if (abortHandler && abortSignal) {
                            try {
                                abortSignal.removeEventListener('abort', abortHandler);
                            } catch {
                                // ignore
                            }
                        }
                        resolve(reason);
                    };

                    abortHandler = () => {
                        diffManager.rejectDiff(pendingDiff.id).catch(() => {});
                        finish('abort');
                    };

                    if (abortSignal) {
                        if (abortSignal.aborted) {
                            abortHandler();
                            return;
                        }
                        abortSignal.addEventListener('abort', abortHandler, { once: true } as any);
                    }

                    const checkStatus = () => {
                        // 检查用户中断
                        if (diffManager.isUserInterrupted()) {
                            diffManager.rejectDiff(pendingDiff.id).catch(() => {});
                            finish('user');
                            return;
                        }

                        const diff = diffManager.getDiff(pendingDiff.id);
                        if (!diff || diff.status !== 'pending') {
                            finish('none');
                        } else {
                            setTimeout(checkStatus, 100);
                        }
                    };
                    checkStatus();
                });

                const wasInterrupted = interruptReason !== 'none';
                if (wasInterrupted) {
                    cancelledBySignal = true;
                }

                const finalDiff = diffManager.getDiff(pendingDiff.id);
                const wasAccepted = !wasInterrupted && (!finalDiff || finalDiff.status === 'accepted');

                // 取消/中断视为 rejected，避免前端继续显示 waiting
                status = wasAccepted ? 'accepted' : 'rejected';
                pendingDiffId = undefined;

                // 保存 diff 内容用于前端显示
                const diffStorageManager = getDiffStorageManager();
                if (diffStorageManager) {
                    try {
                        const diffRef = await diffStorageManager.saveGlobalDiff({
                            originalContent: originalText,
                            newContent: newText,
                            filePath: relativePath
                        });
                        diffContentId = diffRef.diffId;
                    } catch (e) {
                        console.warn('Failed to save diff content:', e);
                    }
                }
                
                replacements.push({
                    file: relativePath,
                    workspace: workspaceName || undefined,
                    replacements: fileReplacementCount,
                    status,
                    diffContentId,
                    pendingDiffId
                });
            }
        } catch {
            // 跳过无法读取/写入的文件
        }
    }
    
    return { matches, replacements, totalReplacements, cancelled: cancelledBySignal };
}

/**
 * 根据 workspace 根和相对路径，判断是目录还是单个文件，并返回合适的搜索根和文件匹配模式。
 *
 * 使用约定：
 * - 目录 path 末尾应带有 "/"（例如 "src/" 或 "workspace_name/src/"）。
 * - 文件 path 不带末尾斜杠（例如 "src/index.ts"）。
 *
 * 实现上仍会通过 fs.stat 精确判断文件/目录，但在工具定义中会提示 AI 使用上述约定，
 * 以减少歧义。
 *
 * - 如果 relativePath 指向一个存在的文件，则：
 *   - searchRoot 为该文件所在的目录；
 *   - effectivePattern 为该文件名（只搜索这一文件）。
 * - 其它情况按目录处理：
 *   - searchRoot = rootUri + relativePath；
 *   - effectivePattern = 原始 filePattern。
 */
async function getSearchRootAndPattern(
    rootUri: vscode.Uri,
    relativePath: string,
    filePattern: string
): Promise<{ searchRoot: vscode.Uri; effectivePattern: string }> {
    // 空路径或当前目录，直接用 workspace 根目录
    if (!relativePath || relativePath === '.' || relativePath === './') {
        return { searchRoot: rootUri, effectivePattern: filePattern };
    }

    const fullUri = vscode.Uri.joinPath(rootUri, relativePath);

    try {
        const stat = await vscode.workspace.fs.stat(fullUri);
        if (stat.type === vscode.FileType.File) {
            // 是单个文件：搜索根为所在目录，pattern 为文件名
            const fsPath = fullUri.fsPath;
            const dirPath = path.dirname(fsPath);
            const fileName = path.basename(fsPath);
            return {
                searchRoot: vscode.Uri.file(dirPath),
                effectivePattern: fileName

            };
        }
    } catch {
        // stat 失败（路径不存在或权限问题），按目录处理
    }

    // 默认按目录处理
    return {
        searchRoot: fullUri,
        effectivePattern: filePattern
    };
}

/**
 * 创建搜索文件内容工具
 */
export function createSearchInFilesTool(): Tool {
    // 获取工作区信息用于描述
    const workspaces = getAllWorkspaces();
    const isMultiRoot = workspaces.length > 1;
    
    let pathDescription = 'Search path relative to workspace root. Use "dir/" (trailing slash) for directories, or "dir/file.ext" for a single file. Default "." searches the entire workspace.';
    if (isMultiRoot) {
        pathDescription = `Search path, use "workspace_name/path" format. Use "workspace_name/dir/" (trailing slash) for directories, or "workspace_name/file.ext" for a single file. Use "." to search all workspaces. Available workspaces: ${workspaces.map(w => w.name).join(', ')}`;
    }
    
    return {
        declaration: {
            name: 'search_in_files',
            description: isMultiRoot
                ? `Search or search-and-replace content in multiple workspace files. Supports regular expressions. Use "workspace_name/dir/" (trailing slash) for directories, or "workspace_name/file.ext" for a single file. Use "." to search all workspaces. Available workspaces: ${workspaces.map(w => w.name).join(', ')}.`
                : 'Search or search-and-replace content in workspace files. Supports regular expressions. Use "dir/" (trailing slash) for directories, or "dir/file.ext" for a single file. Returns matching files and context.',
            category: 'search',
            parameters: {
                type: 'object',
                properties: {
                    mode: {
                        type: 'string',
                        enum: ['search', 'replace'],
                        description: 'Operation mode. Use "search" for finding content only, use "replace" for search and replace.',
                        default: 'search'
                    },
                    query: {
                        type: 'string',
                        description: 'Search keyword or regular expression'
                    },
                    path: {
                        type: 'string',
                        description: pathDescription,
                        default: '.'
                    },
                    pattern: {
                        type: 'string',
                        description: 'File matching pattern, e.g., "*.ts" or "**/*.js"',
                        default: '**/*'
                    },
                    isRegex: {
                        type: 'boolean',
                        description: 'Whether to treat query as a regular expression',
                        default: false
                    },
                    maxResults: {
                        type: 'number',
                        description: '[Search mode] Maximum number of match results',
                        default: 100
                    },
                    replace: {
                        type: 'string',
                        description: '[Replace mode] Replacement string. Supports regex capture groups like $1, $2 when isRegex is true.'
                    },
                    maxFiles: {
                        type: 'number',
                        description: '[Replace mode] Maximum number of files to process',
                        default: 50
                    }
                },
                required: ['query']
            }
        },
        handler: async (args, context?: import('../types').ToolContext): Promise<ToolResult> => {
            const query = args.query as string;
            const searchPath = (args.path as string) || '.';
            const filePattern = (args.pattern as string) || '**/*';
            const isRegex = (args.isRegex as boolean) || false;
            
            // 严格按照 mode 字段决定模式，忽略其他不相关的参数
            const mode = (args.mode as string) || 'search';
            const isReplaceMode = mode === 'replace';
            
            // 搜索模式参数
            const maxResults = (args.maxResults as number) || 100;
            
            // 替换模式参数（仅在替换模式下使用）
            const replacement = isReplaceMode ? (args.replace as string || '') : undefined;
            const maxFiles = isReplaceMode ? ((args.maxFiles as number) || 50) : 50;

            if (!query) {
                return { success: false, error: 'query is required' };
            }

            const workspaces = getAllWorkspaces();
            if (workspaces.length === 0) {
                return { success: false, error: 'No workspace folder open' };
            }

            try {
                // 创建搜索正则表达式
                // 对于搜索模式，使用 'gim' 标志（全局、不区分大小写、多行）
                // 对于替换模式，使用 'g' 标志（全局匹配）确保替换所有匹配项
                const flags = isReplaceMode ? 'g' : 'gim';
                const searchRegex = isRegex
                    ? new RegExp(query, flags)
                    : new RegExp(escapeRegex(query), flags);
                
                // 获取配置与排除模式
                const searchConfig = getSearchInFilesConfig();
                const excludePattern = (searchConfig.excludePatterns && searchConfig.excludePatterns.length > 0)
                    ? (searchConfig.excludePatterns.length === 1
                        ? searchConfig.excludePatterns[0]
                        : `{${searchConfig.excludePatterns.join(',')}}`)
                    : DEFAULT_EXCLUDE;
                
                // 解析路径，确定搜索范围
                const { workspace: targetWorkspace, relativePath, isExplicit } = parseWorkspacePath(searchPath);
                
                if (isReplaceMode) {
                    // 替换模式
                    let allMatches: SearchMatch[] = [];
                    let allReplacements: ReplaceResult[] = [];
                    let totalReplacements = 0;
                    let anyCancelled = false;
                    
                    if (isExplicit && targetWorkspace) {
                        // 显式指定了工作区，只搜索该工作区
                        const { searchRoot, effectivePattern } = await getSearchRootAndPattern(
                            targetWorkspace.uri,
                            relativePath,
                            filePattern
                        );
                        const result = await searchAndReplaceInDirectory(
                            searchRoot,
                            effectivePattern,
                            searchRegex,
                            replacement,
                            maxFiles,
                            workspaces.length > 1 ? targetWorkspace.name : null,
                            excludePattern,
                            searchConfig,
                            context?.toolId,
                            context?.abortSignal
                        );
                        allMatches = result.matches;
                        allReplacements = result.replacements;
                        totalReplacements = result.totalReplacements;
                        anyCancelled = result.cancelled;
                    } else if (searchPath === '.' && workspaces.length > 1) {
                        // 搜索所有工作区
                        let remainingFiles = maxFiles;
                        for (const ws of workspaces) {
                            if (remainingFiles <= 0) break;
                            
                            const result = await searchAndReplaceInDirectory(
                                ws.uri,
                                filePattern,
                                searchRegex,
                                replacement,
                                remainingFiles,
                                ws.name,
                                excludePattern,
                                searchConfig,
                                context?.toolId,
                                context?.abortSignal
                            );
                            allMatches.push(...result.matches);
                            allReplacements.push(...result.replacements);
                            totalReplacements += result.totalReplacements;
                            remainingFiles -= result.replacements.length;

                            anyCancelled = anyCancelled || result.cancelled;
                            if (anyCancelled) {
                                break;
                            }
                        }
                    } else {
                        // 单工作区或未指定，使用默认
                        const root = targetWorkspace?.uri || workspaces[0].uri;
                        const { searchRoot, effectivePattern } = await getSearchRootAndPattern(
                            root,
                            relativePath,
                            filePattern
                        );
                        const result = await searchAndReplaceInDirectory(
                            searchRoot,
                            effectivePattern,
                            searchRegex,
                            replacement,
                            maxFiles,
                            workspaces.length > 1 ? (targetWorkspace?.name || workspaces[0].name) : null,
                            excludePattern,
                            searchConfig,
                            context?.toolId,
                            context?.abortSignal
                        );
                        allMatches = result.matches;
                        allReplacements = result.replacements;
                        totalReplacements = result.totalReplacements;
                        anyCancelled = result.cancelled;
                    }
                    
                    return {
                        success: !anyCancelled,
                        cancelled: anyCancelled,
                        data: {
                            isReplaceMode: true,
                            matches: allMatches.map(m => ({
                                file: m.file,
                                workspace: m.workspace,
                                line: m.line,
                                column: m.column,
                                match: m.match
                                // 替换模式下不返回 context，减小体积，前端已有 diff 视图
                            })),
                            results: allReplacements,
                            filesModified: allReplacements.length,
                            totalReplacements,
                            multiRoot: workspaces.length > 1
                        },
                        error: anyCancelled ? 'Search/replace was cancelled by user' : undefined
                    };
                } else {
                    // 仅搜索模式
                    let allResults: SearchMatch[] = [];
                    const configuredMaxTotal = searchConfig.maxTotalResultChars;
                    const maxTotalChars = (typeof configuredMaxTotal === 'number' && Number.isFinite(configuredMaxTotal))
                        ? Math.floor(configuredMaxTotal)
                        : 200000;
                    const budget: SearchBudget | undefined = maxTotalChars > 0
                        ? { remainingChars: maxTotalChars, truncated: false }
                        : undefined;
                    
                    if (isExplicit && targetWorkspace) {
                        // 显式指定了工作区，只搜索该工作区
                        const { searchRoot, effectivePattern } = await getSearchRootAndPattern(
                            targetWorkspace.uri,
                            relativePath,
                            filePattern
                        );
                        allResults = await searchInDirectory(
                            searchRoot,
                            effectivePattern,
                            searchRegex,
                            maxResults,
                            workspaces.length > 1 ? targetWorkspace.name : null,
                            excludePattern,
                            searchConfig,
                            budget
                        );
                    } else if (searchPath === '.' && workspaces.length > 1) {
                        // 搜索所有工作区
                        for (const ws of workspaces) {
                            if (allResults.length >= maxResults) break;
                            if (budget && budget.remainingChars <= 0) break;
                            
                            const remaining = maxResults - allResults.length;
                            const wsResults = await searchInDirectory(
                                ws.uri,
                                filePattern,
                                searchRegex,
                                remaining,
                                ws.name,
                                excludePattern,
                                searchConfig,
                                budget
                            );
                            allResults.push(...wsResults);
                        }
                    } else {
                        // 单工作区或未指定，使用默认
                        const root = targetWorkspace?.uri || workspaces[0].uri;
                        const { searchRoot, effectivePattern } = await getSearchRootAndPattern(
                            root,
                            relativePath,
                            filePattern
                        );
                        allResults = await searchInDirectory(
                            searchRoot,
                            effectivePattern,
                            searchRegex,
                            maxResults,
                            workspaces.length > 1 ? (targetWorkspace?.name || workspaces[0].name) : null,
                            excludePattern,
                            searchConfig,
                            budget
                        );
                    }

                    return {
                        success: true,
                        data: {
                            results: allResults,
                            count: allResults.length,
                            truncated: allResults.length >= maxResults || !!budget?.truncated,
                            multiRoot: workspaces.length > 1
                        }
                    };
                }
            } catch (error) {
                return {
                    success: false,
                    error: `Search failed: ${error instanceof Error ? error.message : String(error)}`
                };
            }
        }
    };
}

/**
 * 注册搜索文件内容工具
 */
export function registerSearchInFiles(): Tool {
    return createSearchInFilesTool();
}