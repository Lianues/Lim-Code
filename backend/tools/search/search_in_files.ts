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
import { getWorkspaceRoot, getAllWorkspaces, parseWorkspacePath, toRelativePath, normalizeLineEndingsToLF, escapeRegExp } from '../utils';
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
 * 将非正则查询拆成空白分隔关键词，用于搜索模式的二阶段兜底。
 *
 * 为什么要改：模型经常自然地用空格罗列多个代码关键词；旧实现把整串当成字面短语，容易在文件搜索中零命中，
 * 还会让模型误以为 search_in_files 支持 history_search 的读取语法。
 * 怎么改：只在非正则搜索模式中使用该拆分，先完整短语搜索，零命中后再用这些关键词构造 OR 正则。
 * 目的：让 search_in_files 与 history_search 的多关键词兜底体验一致，同时不改变 replace 模式的精确替换语义。
 */
function splitWhitespaceFallbackKeywords(query: string): string[] {
    const seen = new Set<string>();
    const keywords: string[] = [];

    for (const rawKeyword of query.trim().split(/\s+/)) {
        const keyword = rawKeyword.trim();
        if (!keyword) continue;

        const dedupeKey = keyword.toLocaleLowerCase();
        if (seen.has(dedupeKey)) continue;

        seen.add(dedupeKey);
        keywords.push(keyword);
    }

    return keywords.length > 1 ? keywords : [];
}

/**
 * 根据关键词构造非正则 OR 搜索表达式。
 *
 * 为什么要单独封装：`|` 在普通查询里可能是 TypeScript 联合类型、Shell 管道或 Markdown 表格内容，不能把它当作分隔符。
 * 怎么改：只把空白拆出的关键词逐个 escape 后用正则 OR 连接，显式正则 OR 仍然由 isRegex=true 的调用承担。
 * 目的：避免普通查询误伤 `|` 字面量，同时保留正则模式下 `foo|bar` 的原生 OR 能力。
 */
function createFallbackKeywordRegex(keywords: string[], flags: string): RegExp {
    // WP13b：复用 backend/tools/utils.ts::escapeRegExp，避免 search_in_files 保留同语义 escapeRegex 副本。
    return new RegExp(keywords.map(escapeRegExp).join('|'), flags);
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
    /** 自动保存失败原因；用于让 search/replace 的文件级结果解释 rejected 的真实原因 */
    autoSaveError?: string;
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

interface SearchPassResult {
    results: SearchMatch[];
    budgetTruncated: boolean;
}

interface SearchQueryFallbackInfo {
    applied: boolean;
    originalQuery: string;
    keywords: string[];
}

interface SearchPathWarningInfo {
    type: 'possible_multiple_paths';
    path: string;
    candidates: string[];
    message: string;
}

/**
 * 判断 path 参数是否像是把多个路径用空格塞进了一个字符串。
 *
 * 为什么要改：模型会把“路径：a b c”直接放进 search_in_files.path；工具实际只支持一个文件或目录，旧行为会静默搜索一个不存在的路径。
 * 怎么改：只做保守检测，不自动拆分；要求至少两个空白片段都像路径，避免误伤带空格的真实文件夹名。
 * 目的：在零命中时给模型可读的纠错信号，引导它并行发起多次 search_in_files，而不是继续沿用错误 path。
 */
function createPossibleMultiplePathsWarning(searchPath: string): SearchPathWarningInfo | undefined {
    const normalized = (searchPath || '').trim();
    if (!normalized || normalized === '.') {
        return undefined;
    }

    const parts = normalized.split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
        return undefined;
    }

    const pathLikeParts = parts.filter(part => part.includes('/') || part.includes('\\') || part.startsWith('@'));
    if (pathLikeParts.length < 2) {
        return undefined;
    }

    return {
        type: 'possible_multiple_paths',
        path: searchPath,
        candidates: parts,
        message: `The path parameter accepts exactly one file or directory. The supplied path looks like multiple whitespace-separated paths (${parts.join(', ')}). Run separate parallel search_in_files calls for each path instead of putting them in one path string.`
    };
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

                // 等待 diff 被处理（保存、拒绝、abort 或用户新请求中断）。
                // 为什么 search/replace 也要统一：replace 模式同样创建 pending diff，历史上和文件工具各自复制等待逻辑，容易修一处漏一处。
                // 怎么改：调用 DiffManager.waitForDiffResolution，把状态事件、轮询兜底和 abort 清理集中到一个生命周期入口。
                // 目的：让 search_in_files replace 模式与 apply_diff/write_file/insert/delete 的 pending 收敛规则完全一致。
                const interruptReason = await diffManager.waitForDiffResolution(pendingDiff.id, abortSignal);

                const wasInterrupted = interruptReason !== 'none';
                if (wasInterrupted) {
                    cancelledBySignal = true;
                }

                const finalDiff = diffManager.getDiff(pendingDiff.id);
                const wasAccepted = !wasInterrupted && (!finalDiff || finalDiff.status === 'accepted');
                const autoSaveError = finalDiff?.autoSaveError;

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
                    autoSaveError,
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
    
    let pathDescription = '搜索路径，相对于工作区根目录。该参数只能填写一个文件或一个目录，不能填写用空格分隔的多个路径。搜索一个目录时使用 "dir/"（末尾斜杠），搜索一个文件时使用 "dir/file.ext"。如果要搜索多个目录或文件，请分别并行调用多次 search_in_files。默认 "." 表示搜索整个工作区。';
    if (isMultiRoot) {
        pathDescription = `搜索路径，使用 "workspace_name/path" 格式。该参数只能填写一个文件或一个目录，不能填写用空格分隔的多个路径。搜索一个目录时使用 "workspace_name/dir/"（末尾斜杠），搜索一个文件时使用 "workspace_name/file.ext"。如果要搜索多个目录或文件，请分别并行调用多次 search_in_files。使用 "." 搜索所有工作区。可用工作区：${workspaces.map(w => w.name).join(', ')}`;
    }
    
    return {
        declaration: {
            name: 'search_in_files',
            strict: true,  // API 端强制 schema 校验
            // 这段 description 是模型实际看到的工具提示词。
            // 为什么要改：旧文案只说“搜索关键词或正则”，没有说明多关键词兜底，也没有区分文件搜索与 history_search 的 read 流程。
            // 怎么改：把非正则空格关键词兜底、`|` 仅属于正则模式、path 只能填一个路径、以及后续读取必须用 read_file 写进主描述，并把面向模型的说明统一改为中文。
            // 目的：降低模型把 history_search 的 start_line/end_line 语法或“多个路径塞进一个 path 字符串”的错误用法迁移到 search_in_files 的概率，同时让中文用户场景下的模型更容易遵循工具边界。
            description: isMultiRoot
                ? `在多个工作区文件中搜索内容，或执行搜索并替换。支持正则表达式。搜索模式下，当 isRegex=false 时，空格分隔的多关键词查询会先尝试完整短语；如果没有命中，会自动降级为关键词 OR 搜索。需要使用 "foo|bar" 这类正则 OR 时，请设置 isRegex=true；非正则模式下 "|" 是普通字面字符。本工具没有 read 模式，也没有 start_line/end_line 参数；需要读取匹配文件时请使用 read_file。path 参数只能填写一个文件或一个目录，不能填写多个空格分隔路径；如果要搜索多个路径，请分别并行调用多次 search_in_files。搜索一个目录时使用 "workspace_name/dir/"（末尾斜杠），搜索一个文件时使用 "workspace_name/file.ext"。使用 "." 搜索所有工作区。可用工作区：${workspaces.map(w => w.name).join(', ')}。`
                : '在工作区文件中搜索内容，或执行搜索并替换。支持正则表达式。搜索模式下，当 isRegex=false 时，空格分隔的多关键词查询会先尝试完整短语；如果没有命中，会自动降级为关键词 OR 搜索。需要使用 "foo|bar" 这类正则 OR 时，请设置 isRegex=true；非正则模式下 "|" 是普通字面字符。本工具没有 read 模式，也没有 start_line/end_line 参数；需要读取匹配文件时请使用 read_file。path 参数只能填写一个文件或一个目录，不能填写多个空格分隔路径；如果要搜索多个路径，请分别并行调用多次 search_in_files。搜索一个目录时使用 "dir/"（末尾斜杠），搜索一个文件时使用 "dir/file.ext"。返回匹配文件和上下文。',
            category: 'search',
            parameters: {
                type: 'object',
                properties: {
                    mode: {
                        type: 'string',
                        enum: ['search', 'replace'],
                        description: '操作模式。使用 "search" 只搜索内容；使用 "replace" 执行搜索并替换。',
                        default: 'search'
                    },
                    query: {
                        type: 'string',
                        description: '搜索关键词、完整短语或正则表达式。搜索模式下，当 isRegex=false 时，空格分隔的多关键词查询会先尝试完整短语；如果没有命中，会自动降级为关键词 OR 搜索。需要使用 "foo|bar" 这类显式正则 OR 时，请设置 isRegex=true；非正则模式下 "|" 会按普通字面字符搜索。'
                    },
                    path: {
                        type: 'string',
                        description: pathDescription,
                        default: '.'
                    },
                    pattern: {
                        type: 'string',
                        // 为什么要改：模型会把 "*.ts" 当成递归搜索，导致在 webview/handlers 这类子目录中漏搜。
                        // 怎么改：在 pattern 参数描述里明确 glob 递归语义，说明 "*.ts" 只匹配当前搜索根的一级文件，递归要用 "**/*.ts"；同时把说明改为中文。
                        // 目的：让模型在不知道具体子目录时优先使用递归 pattern，减少“正则正确但文件模式过窄”的零命中。
                        description: '文件匹配模式，例如 "*.ts" 或 "**/*.js"。"*.ts" 只匹配搜索路径直属的一层文件；如果要递归搜索子目录，请使用 "**/*.ts"。',
                        default: '**/*'
                    },
                    isRegex: {
                        type: 'boolean',
                        description: '是否把 query 当作正则表达式处理。',
                        default: false
                    },
                    maxResults: {
                        type: 'number',
                        description: '[search 模式] 最大匹配结果数量。',
                        default: 100
                    },
                    replace: {
                        type: 'string',
                        description: '[replace 模式] 替换字符串。当 isRegex=true 时，支持 $1、$2 这类正则捕获组引用。'
                    },
                    maxFiles: {
                        type: 'number',
                        description: '[replace 模式] 最多处理的文件数量。',
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
                    // WP13b：非正则查询仍按字面量转义，只把本地副本替换为共享 helper，不改搜索行为。
                    : new RegExp(escapeRegExp(query), flags);
                
                // 获取配置与排除模式
                const searchConfig = getSearchInFilesConfig();
                const excludePattern = (searchConfig.excludePatterns && searchConfig.excludePatterns.length > 0)
                    ? (searchConfig.excludePatterns.length === 1
                        ? searchConfig.excludePatterns[0]
                        : `{${searchConfig.excludePatterns.join(',')}}`)
                    : DEFAULT_EXCLUDE;
                
                // 解析路径，确定搜索范围
                const { workspace: targetWorkspace, relativePath, isExplicit } = parseWorkspacePath(searchPath);
                const pathWarning = createPossibleMultiplePathsWarning(searchPath);
                
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
                            multiRoot: workspaces.length > 1,
                            pathWarning: allMatches.length === 0 && allReplacements.length === 0 ? pathWarning : undefined
                        },
                        error: anyCancelled ? 'Search/replace was cancelled by user' : undefined
                    };
                } else {
                    // 仅搜索模式
                    const runSearchPass = async (regex: RegExp): Promise<SearchPassResult> => {
                        let results: SearchMatch[] = [];
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
                            results = await searchInDirectory(
                                searchRoot,
                                effectivePattern,
                                regex,
                                maxResults,
                                workspaces.length > 1 ? targetWorkspace.name : null,
                                excludePattern,
                                searchConfig,
                                budget
                            );
                        } else if (searchPath === '.' && workspaces.length > 1) {
                            // 搜索所有工作区
                            for (const ws of workspaces) {
                                if (results.length >= maxResults) break;
                                if (budget && budget.remainingChars <= 0) break;

                                const remaining = maxResults - results.length;
                                const wsResults = await searchInDirectory(
                                    ws.uri,
                                    filePattern,
                                    regex,
                                    remaining,
                                    ws.name,
                                    excludePattern,
                                    searchConfig,
                                    budget
                                );
                                results.push(...wsResults);
                            }
                        } else {
                            // 单工作区或未指定，使用默认
                            const root = targetWorkspace?.uri || workspaces[0].uri;
                            const { searchRoot, effectivePattern } = await getSearchRootAndPattern(
                                root,
                                relativePath,
                                filePattern
                            );
                            results = await searchInDirectory(
                                searchRoot,
                                effectivePattern,
                                regex,
                                maxResults,
                                workspaces.length > 1 ? (targetWorkspace?.name || workspaces[0].name) : null,
                                excludePattern,
                                searchConfig,
                                budget
                            );
                        }

                        return {
                            results,
                            budgetTruncated: !!budget?.truncated
                        };
                    };

                    // 非正则搜索采用“完整短语优先，零命中后关键词 OR 兜底”。
                    // 为什么只放在 search 模式：replace 模式如果把“foo bar”降级为 foo 或 bar，会产生用户没有明确授权的批量替换。
                    // 怎么改：第一次沿用原有完整 query；只有零命中且未因预算截断时，才用空白关键词构造 OR 正则重跑一次。
                    // 目的：提高文件搜索召回率，同时保持替换模式和正则模式的可预测性。
                    let searchPass = await runSearchPass(searchRegex);
                    let allResults = searchPass.results;
                    let fallbackInfo: SearchQueryFallbackInfo | undefined;

                    const fallbackKeywords = !isRegex ? splitWhitespaceFallbackKeywords(query) : [];
                    if (allResults.length === 0 && !searchPass.budgetTruncated && fallbackKeywords.length > 0) {
                        const fallbackRegex = createFallbackKeywordRegex(fallbackKeywords, flags);
                        searchPass = await runSearchPass(fallbackRegex);
                        allResults = searchPass.results;
                        fallbackInfo = {
                            applied: true,
                            originalQuery: query,
                            keywords: fallbackKeywords
                        };
                    }

                    return {
                        success: true,
                        data: {
                            results: allResults,
                            count: allResults.length,
                            truncated: allResults.length >= maxResults || searchPass.budgetTruncated,
                            multiRoot: workspaces.length > 1,
                            queryFallback: fallbackInfo,
                            pathWarning: allResults.length === 0 ? pathWarning : undefined
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