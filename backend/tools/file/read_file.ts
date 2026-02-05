/**
 * 读取文件工具
 *
 * 支持读取单个或多个文件
 * 支持多工作区（Multi-root Workspaces）
 */

import * as vscode from 'vscode';
import * as path from 'path';
import type { Tool, ToolResult, MultimodalData, MultimodalCapability } from '../types';
import { t } from '../../i18n';
import {
    resolveUri,
    resolveUriWithInfo,
    getAllWorkspaces,
    isMultimodalSupported,
    getMultimodalMimeType,
    isBinaryFile,
    formatFileSize,
    canReadFile,
    getReadFileError,
    isMultimodalSupportedWithConfig,
    canReadFileWithCapability,
    getReadFileErrorWithCapability,
    isImageFile,
    isPdfFile,
    normalizeLineEndingsToLF
} from '../utils';

const LINE_RANGE_NOT_SUPPORTED_FOR_BINARY_ERROR =
    'Line ranges (startLine/endLine) are only supported for text files. Do not provide them for binary/multimodal files (PDF/images/audio/video).';

/**
 * 图片尺寸信息
 */
interface ImageDimensions {
    width: number;
    height: number;
    aspectRatio: string;  // 如 "16:9", "4:3", "1:1"
}

/**
 * 行范围选项
 */
interface LineRange {
    startLine?: number;  // 1-based, 包含，不指定则从第 1 行开始
    endLine?: number;    // 1-based, 包含，不指定则读取到文件末尾
}

/**
 * 文件读取请求（支持单独的行范围）
 */
interface FileReadRequest {
    path: string;
    startLine?: number;
    endLine?: number;
}

/**
 * 单个文件读取结果
 */
interface ReadResult {
    path: string;
    workspace?: string;
    success: boolean;
    type?: 'text' | 'multimodal' | 'binary';
    content?: string;
    lineCount?: number;      // 返回的行数（如果指定了范围）或总行数
    totalLines?: number;     // 文件总行数（仅在指定范围时返回）
    startLine?: number;      // 实际读取的起始行（仅在指定范围时返回）
    endLine?: number;        // 实际读取的结束行（仅在指定范围时返回）
    mimeType?: string;
    size?: number;
    dimensions?: ImageDimensions;  // 图片尺寸信息
    error?: string;
}

/**
 * 计算最大公约数
 */
function gcd(a: number, b: number): number {
    return b === 0 ? a : gcd(b, a % b);
}

/**
 * 计算宽高比字符串
 */
function calculateAspectRatio(width: number, height: number): string {
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
        // 返回小数比例
        return `${ratio.toFixed(2)}:1`;
    }
    
    return `${ratioW}:${ratioH}`;
}

/**
 * 从图片数据解析尺寸
 * 支持 PNG, JPEG, WebP, GIF
 */
function parseImageDimensions(buffer: Uint8Array, mimeType: string): ImageDimensions | undefined {
    try {
        let width: number | undefined;
        let height: number | undefined;
        
        if (mimeType === 'image/png') {
            // PNG: 宽度在偏移 16-19，高度在 20-23（大端序）
            if (buffer.length >= 24 &&
                buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
                width = (buffer[16] << 24) | (buffer[17] << 16) | (buffer[18] << 8) | buffer[19];
                height = (buffer[20] << 24) | (buffer[21] << 16) | (buffer[22] << 8) | buffer[23];
            }
        } else if (mimeType === 'image/jpeg') {
            // JPEG: 需要查找 SOF0/SOF2 标记
            let offset = 2;  // 跳过 FFD8
            while (offset < buffer.length - 9) {
                if (buffer[offset] !== 0xFF) {
                    offset++;
                    continue;
                }
                const marker = buffer[offset + 1];
                // SOF0 (0xC0) 或 SOF2 (0xC2) 标记包含尺寸
                if (marker === 0xC0 || marker === 0xC2) {
                    height = (buffer[offset + 5] << 8) | buffer[offset + 6];
                    width = (buffer[offset + 7] << 8) | buffer[offset + 8];
                    break;
                }
                // 跳到下一个标记
                const length = (buffer[offset + 2] << 8) | buffer[offset + 3];
                offset += 2 + length;
            }
        } else if (mimeType === 'image/webp') {
            // WebP: 检查 RIFF 头和 VP8/VP8L/VP8X 块
            if (buffer.length >= 30 &&
                buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
                buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
                // VP8X (扩展格式)
                if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x58) {
                    width = ((buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)) + 1);
                    height = ((buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)) + 1);
                }
                // VP8L (无损格式)
                else if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x4C) {
                    const signature = buffer[21];
                    if (signature === 0x2F) {
                        const bits = (buffer[22] | (buffer[23] << 8) | (buffer[24] << 16) | (buffer[25] << 24));
                        width = (bits & 0x3FFF) + 1;
                        height = ((bits >> 14) & 0x3FFF) + 1;
                    }
                }
                // VP8 (有损格式)
                else if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x20) {
                    // VP8 格式需要查找帧头
                    if (buffer.length >= 30) {
                        // 帧头在偏移 23 开始
                        width = (buffer[26] | (buffer[27] << 8)) & 0x3FFF;
                        height = (buffer[28] | (buffer[29] << 8)) & 0x3FFF;
                    }
                }
            }
        } else if (mimeType === 'image/gif') {
            // GIF: 宽度在偏移 6-7，高度在 8-9（小端序）
            if (buffer.length >= 10 &&
                buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
                width = buffer[6] | (buffer[7] << 8);
                height = buffer[8] | (buffer[9] << 8);
            }
        }
        
        if (width && height && width > 0 && height > 0) {
            return {
                width,
                height,
                aspectRatio: calculateAspectRatio(width, height)
            };
        }
    } catch (e) {
        // 解析失败，返回 undefined
    }
    return undefined;
}

/**
 * 读取单个文件
 *
 * @param filePath 文件路径
 * @param capability 多模态能力
 * @param isMultiRoot 是否是多工作区模式
 * @param lineRange 行范围（可选）
 */
async function readSingleFile(
    filePath: string,
    capability: MultimodalCapability,
    isMultiRoot: boolean,
    lineRange?: LineRange
): Promise<{
    result: ReadResult;
    multimodal?: MultimodalData[];
}> {
    const { uri, workspace, error } = resolveUriWithInfo(filePath);
    if (!uri) {
        return {
            result: {
                path: filePath,
                success: false,
                error: error || 'No workspace folder open'
            }
        };
    }

    // 非文本（binary）文件不支持行号范围
    // 注意：这是安全网。正常情况下 handler 会在调用 readSingleFile 之前拦截。
    if (lineRange && isBinaryFile(filePath)) {
        return {
            result: {
                path: filePath,
                workspace: isMultiRoot ? workspace?.name : undefined,
                success: false,
                error: LINE_RANGE_NOT_SUPPORTED_FOR_BINARY_ERROR
            }
        };
    }

    // 检查是否允许读取此文件
    if (!canReadFileWithCapability(filePath, capability)) {
        const readError = getReadFileErrorWithCapability(filePath, true, capability);
        return {
            result: {
                path: filePath,
                workspace: isMultiRoot ? workspace?.name : undefined,
                success: false,
                error: readError || t('tools.file.readFile.cannotReadFile')
            }
        };
    }

    try {
        const content = await vscode.workspace.fs.readFile(uri);
        const fileName = path.basename(filePath);
        
        // 检查是否支持多模态返回
        let shouldReturnMultimodal = false;
        if (isImageFile(filePath) && capability.supportsImages) {
            shouldReturnMultimodal = true;
        } else if (isPdfFile(filePath) && capability.supportsDocuments) {
            shouldReturnMultimodal = true;
        }
        
        if (shouldReturnMultimodal) {
            const mimeType = getMultimodalMimeType(filePath);
            if (mimeType) {
                const base64Data = Buffer.from(content).toString('base64');
                
                // 解析图片尺寸（仅对图片文件）
                let dimensions: ImageDimensions | undefined;
                if (isImageFile(filePath)) {
                    dimensions = parseImageDimensions(content, mimeType);
                }
                
                return {
                    result: {
                        path: filePath,
                        workspace: isMultiRoot ? workspace?.name : undefined,
                        success: true,
                        type: 'multimodal',
                        mimeType,
                        size: content.byteLength,
                        dimensions
                    },
                    multimodal: [{
                        mimeType,
                        data: base64Data,
                        name: fileName
                    }]
                };
            }
        }
        
        // 检查是否是其他二进制文件（不支持多模态返回）
        if (isBinaryFile(filePath)) {
            return {
                result: {
                    path: filePath,
                    workspace: isMultiRoot ? workspace?.name : undefined,
                    success: true,
                    type: 'binary',
                    size: content.byteLength
                }
            };
        }
        
        // 文本文件：返回带行号的内容
        const text = normalizeLineEndingsToLF(new TextDecoder().decode(content));
        const allLines = text.split('\n');
        const totalLines = allLines.length;
        
        // 处理行范围
        let selectedLines: string[];
        let actualStartLine: number | undefined;
        let actualEndLine: number | undefined;
        
        if (lineRange) {
            // 确定起始行：默认从第 1 行开始
            let startLine = lineRange.startLine ?? 1;
            if (startLine < 1) startLine = 1;
            if (startLine > totalLines) {
                return {
                    result: {
                        path: filePath,
                        workspace: isMultiRoot ? workspace?.name : undefined,
                        success: false,
                        totalLines,
                        error: `startLine (${startLine}) exceeds total lines (${totalLines})`
                    }
                };
            }
            
            // 确定结束行：默认读取到文件末尾
            let endLine = lineRange.endLine ?? totalLines;
            if (endLine > totalLines) endLine = totalLines;
            if (endLine < startLine) endLine = startLine;
            
            actualStartLine = startLine;
            actualEndLine = endLine;
            selectedLines = allLines.slice(startLine - 1, endLine);
        } else {
            selectedLines = allLines;
        }
        
        // 添加行号前缀
        const startLineNum = actualStartLine ?? 1;
        const numberedLines = selectedLines.map((line, index) => {
            const lineNum = startLineNum + index;
            return `${lineNum.toString().padStart(4)} | ${line}`;
        });
        
        // 构建返回结果
        const result: ReadResult = {
            path: filePath,
            workspace: isMultiRoot ? workspace?.name : undefined,
            success: true,
            type: 'text',
            content: numberedLines.join('\n'),
            lineCount: selectedLines.length
        };
        
        // 如果指定了行范围，添加额外信息
        if (lineRange) {
            result.totalLines = totalLines;
            result.startLine = actualStartLine;
            result.endLine = actualEndLine;
        }
        
        return { result };
    } catch (error) {
        return {
            result: {
                path: filePath,
                workspace: isMultiRoot ? workspace?.name : undefined,
                success: false,
                error: error instanceof Error ? error.message : String(error)
            }
        };
    }
}

/**
 * 创建读取文件工具
 *
 * @param multimodalEnabled 是否启用多模态工具（可选，用于生成不同的工具声明）
 * @param channelType 渠道类型（可选）
 * @param toolMode 工具模式（可选）
 */
export function createReadFileTool(
    multimodalEnabled?: boolean,
    channelType?: 'gemini' | 'openai' | 'anthropic' | 'openai-responses' | 'custom',
    toolMode?: 'function_call' | 'xml' | 'json'
): Tool {
    // 获取工作区信息
    const workspaces = getAllWorkspaces();
    const isMultiRoot = workspaces.length > 1;
    
    // 根据多模态配置和渠道类型生成不同的工具描述
    let description: string;
    
    // 行号格式说明
    const lineNumberNote = '\n\n**Note**: Text files return content with line number prefixes (e.g., "   1 | code here"). The numbers and "|" are line markers and not part of the file content. Please ignore these prefixes when editing files.';
    
    // 数组格式强调说明
    const arrayFormatNote = '\n\n**IMPORTANT**: The `files` parameter MUST be an array, even for a single file. Example: `{"files": [{"path": "file.txt"}]}` or `{"files": [{"path": "file.txt", "startLine": 100, "endLine": 200}]}`.';
    
    // 行范围说明
    const lineRangeNote = '\n\n**Line Range**: Each file can have its own `startLine` and `endLine`. ONLY use line range when you have PRECISE line numbers (e.g., from get_symbols, goto_definition, find_references, or previous read_file results). Do NOT guess line numbers - if uncertain, read the entire file without specifying line range.';

    // 多模态/二进制行范围限制说明（多模态开启时强调）
    const lineRangeBinaryRestrictionNote =
        '\n\n**IMPORTANT**: Line ranges (`startLine`/`endLine`) are supported for TEXT files only. Do NOT provide them for PDF/images/audio/video or other binary files; the tool will return an error.';
    
    if (!multimodalEnabled) {
        // 未启用多模态时，只支持文本文件
        description = 'Read the content of one or more files in the workspace. Supported types: text files.' + lineNumberNote + arrayFormatNote + lineRangeNote;
    } else if (channelType === 'openai') {
        // OpenAI 格式有特殊限制
        if (toolMode === 'function_call') {
            // OpenAI function_call 模式不支持多模态
            description = 'Read the content of one or more files in the workspace. Supported types: text files.' + lineNumberNote + arrayFormatNote + lineRangeNote;
        } else {
            // OpenAI xml/json 模式只支持图片
            description = 'Read the content of one or more files in the workspace. Supported types: text files, images (PNG/JPEG/WebP). Images are returned as multimodal data.' + lineNumberNote + arrayFormatNote + lineRangeNote + lineRangeBinaryRestrictionNote;
        }
    } else {
        // Gemini 和 Anthropic 全面支持
        description = 'Read the content of one or more files in the workspace. Supported types: text files, images (PNG/JPEG/WebP), documents (PDF). Images and documents are returned as multimodal data.' + lineNumberNote + arrayFormatNote + lineRangeNote + lineRangeBinaryRestrictionNote;
    }
    
    // 多工作区说明
    if (isMultiRoot) {
        description += '\n\nMulti-root workspace: Use "workspace_name/path" format to specify the workspace.';
    }
    
    // 路径参数描述
    let filesDescription = 'Array of file objects. Each object has: path (required), startLine (optional), endLine (optional). Example: [{"path": "src/main.ts", "startLine": 100}]';
    if (isMultiRoot) {
        filesDescription = `Array of file objects. Path must use "workspace_name/path" format. Available workspaces: ${workspaces.map(w => w.name).join(', ')}`;
    }
    
    return {
        declaration: {
            name: 'read_file',
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
                                    description: 'File path (relative to workspace root)'
                                },
                                startLine: {
                                    type: 'number',
                                    description: 'Start line number (1-based, inclusive). TEXT FILES ONLY. Reads from this line to end of file, or to endLine if specified.'
                                },
                                endLine: {
                                    type: 'number',
                                    description: 'End line number (1-based, inclusive). TEXT FILES ONLY. Reads from beginning (or startLine) to this line.'
                                }
                            },
                            required: ['path']
                        },
                        description: filesDescription
                    }
                },
                required: ['files']
            }
        },
        handler: async (args, context): Promise<ToolResult> => {
            // 从 context 中获取多模态能力
            const capability = context?.capability as MultimodalCapability ?? {
                supportsImages: false,
                supportsDocuments: false,
                supportsHistoryMultimodal: false
            };
            
            // 获取工作区信息
            const workspaces = getAllWorkspaces();
            const isMultiRoot = workspaces.length > 1;
            
            // 获取文件列表参数
            const fileList = args.files as FileReadRequest[];
            if (!fileList || !Array.isArray(fileList) || fileList.length === 0) {
                return { success: false, error: 'files is required and must be a non-empty array' };
            }

            const results: ReadResult[] = [];
            const allMultimodal: MultimodalData[] = [];
            let successCount = 0;
            let failCount = 0;

            for (const fileReq of fileList) {
                // 验证每个文件请求
                if (!fileReq || typeof fileReq.path !== 'string') {
                    results.push({
                        path: String(fileReq?.path || 'unknown'),
                        success: false,
                        error: 'Invalid file request: path is required'
                    });
                    failCount++;
                    continue;
                }

                // 禁止对任何非文本（binary）文件使用行号范围
                // 只要显式传入 startLine/endLine（包括 0/null/字符串等），就视为传入行号范围
                const hasLineRangeParam = (fileReq as any).startLine != null || (fileReq as any).endLine != null;
                if (hasLineRangeParam && isBinaryFile(fileReq.path)) {
                    results.push({
                        path: fileReq.path,
                        success: false,
                        error: LINE_RANGE_NOT_SUPPORTED_FOR_BINARY_ERROR
                    });
                    failCount++;
                    continue;
                }
                
                // 构建行范围对象（每个文件单独的行范围）
                let lineRange: LineRange | undefined;
                const startLine = fileReq.startLine;
                const endLine = fileReq.endLine;
                
                if ((typeof startLine === 'number' && startLine >= 1) || (typeof endLine === 'number' && endLine >= 1)) {
                    lineRange = {};
                    if (typeof startLine === 'number' && startLine >= 1) {
                        lineRange.startLine = startLine;
                    }
                    if (typeof endLine === 'number' && endLine >= 1) {
                        lineRange.endLine = endLine;
                    }
                }
                
                const { result, multimodal } = await readSingleFile(fileReq.path, capability, isMultiRoot, lineRange);
                results.push(result);
                
                if (result.success) {
                    successCount++;
                    if (multimodal) {
                        allMultimodal.push(...multimodal);
                    }
                } else {
                    failCount++;
                }
            }

            const allSuccess = failCount === 0;
            return {
                success: allSuccess,
                data: {
                    results,
                    successCount,
                    failCount,
                    totalCount: fileList.length,
                    multiRoot: isMultiRoot
                },
                multimodal: allMultimodal.length > 0 ? allMultimodal : undefined,
                error: allSuccess ? undefined : `${failCount} files failed to read`
            };
        }
    };
}

/**
 * 注册读取文件工具
 */
export function registerReadFile(): Tool {
    return createReadFileTool();
}