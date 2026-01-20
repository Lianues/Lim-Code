/**
 * 图像生成工具 - 使用第三方模型生成图片
 *
 * 支持调用 Gemini Image 等模型生成图片
 * 支持单张生成和批量生成两种模式
 * 返回图片和文字解释作为工具响应
 */

import * as vscode from 'vscode';
import * as path from 'path';
import type { Tool, ToolResult, MultimodalData, ToolContext } from '../types';
import { resolveUri, getAllWorkspaces, calculateAspectRatio } from '../utils';
import { createProxyFetch } from '../../modules/channel/proxyFetch';
import { TaskManager, type TaskEvent } from '../taskManager';

/** 图像生成任务类型常量 */
const TASK_TYPE_IMAGE_GEN = 'image_generation';

/**
 * 图像生成输出事件类型（保持向后兼容）
 */
export interface ImageGenOutputEvent {
    toolId: string;
    type: 'start' | 'progress' | 'complete' | 'cancelled' | 'error';
    data?: {
        message?: string;
        progress?: number;
        totalTasks?: number;
        completedTasks?: number;
    };
    error?: string;
}

/**
 * 订阅图像生成输出（使用 TaskManager）
 * @param listener 监听器函数
 * @returns 取消订阅函数
 */
export function onImageGenOutput(listener: (event: ImageGenOutputEvent) => void): () => void {
    // 将 TaskEvent 转换为 ImageGenOutputEvent
    return TaskManager.onTaskEventByType(TASK_TYPE_IMAGE_GEN, (taskEvent: TaskEvent) => {
        const imageGenEvent: ImageGenOutputEvent = {
            toolId: taskEvent.taskId,
            type: taskEvent.type as ImageGenOutputEvent['type'],
            data: taskEvent.data as ImageGenOutputEvent['data'],
            error: taskEvent.error
        };
        listener(imageGenEvent);
    });
}

/**
 * 生成唯一工具调用 ID（使用 TaskManager）
 */
export function generateToolId(): string {
    return TaskManager.generateTaskId('tool');
}

/**
 * 取消图像生成任务（使用 TaskManager）
 * @param toolId 工具调用 ID
 * @returns 取消结果
 */
export function cancelImageGeneration(toolId: string): {
    success: boolean;
    error?: string;
} {
    return TaskManager.cancelTask(toolId);
}

/**
 * 获取所有活跃的图像生成任务（使用 TaskManager）
 */
export function getActiveImageTasks(): Array<{
    toolId: string;
    startTime: number;
}> {
    return TaskManager.getTasksByType(TASK_TYPE_IMAGE_GEN).map(task => ({
        toolId: task.id,
        startTime: task.startTime
    }));
}

/**
 * 支持的宽高比
 */
const SUPPORTED_ASPECT_RATIOS = [
    '1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'
] as const;

type AspectRatio = typeof SUPPORTED_ASPECT_RATIOS[number];

/**
 * 支持的图片尺寸
 */
const SUPPORTED_IMAGE_SIZES = ['1K', '2K', '4K'] as const;
type ImageSize = typeof SUPPORTED_IMAGE_SIZES[number];

/**
 * 单个图像生成任务
 */
interface ImageTask {
    /** 图片生成的自然语言提示词 */
    prompt: string;
    /** 参考图片路径数组 */
    reference_images?: string[];
    /** 图片宽高比 */
    aspect_ratio?: AspectRatio;
    /** 图片分辨率 */
    image_size?: ImageSize;
    /** 输出文件路径 */
    output_path: string;
}

/**
 * 图像生成工具配置（从 context.config 获取）
 */
interface GenerateImageConfig {
    /** API URL */
    url?: string;
    /** API Key */
    apiKey?: string;
    /** 模型名称 */
    model?: string;
    /** 是否启用宽高比参数 */
    enableAspectRatio?: boolean;
    /** 默认宽高比（启用时生效） */
    defaultAspectRatio?: string;
    /** 是否启用图片尺寸参数 */
    enableImageSize?: boolean;
    /** 默认图片尺寸（启用时生效） */
    defaultImageSize?: string;
    /** 单次调用允许的最大任务数（批量模式） */
    maxBatchTasks?: number;
    /** 单个任务的最大图片数 */
    maxImagesPerTask?: number;
    /** 代理 URL */
    proxyUrl?: string;
    /** 取消信号 */
    abortSignal?: AbortSignal;
    /** 是否将图片返回给 AI */
    returnImageToAI?: boolean;
}

/**
 * 工具参数配置（传递给 createGenerateImageTool）
 */
interface ToolParamsConfig {
    /** 是否启用宽高比参数 */
    enableAspectRatio: boolean;
    /** 强制宽高比（如果设置，AI 不能更改） */
    forcedAspectRatio?: string;
    /** 是否启用图片尺寸参数 */
    enableImageSize: boolean;
    /** 强制图片尺寸（如果设置，AI 不能更改） */
    forcedImageSize?: string;
}

/**
 * 单个任务的生成结果
 */
interface TaskResult {
    /** 任务索引 */
    index: number;
    /** 是否成功 */
    success: boolean;
    /** 错误信息 */
    error?: string;
    /** 保存的文件路径 */
    paths?: string[];
    /** 生成的图片数量 */
    count?: number;
    /** 图片尺寸信息 */
    dimensions?: Array<{ width: number; height: number; aspectRatio: string }>;
    /** 模型描述文本 */
    description?: string;
    /** 多模态数据 */
    multimodal?: MultimodalData[];
    /** 是否被用户取消 */
    cancelled?: boolean;
}

/**
 * Gemini Image API 响应
 */
interface GeminiImageResponse {
    candidates?: Array<{
        content?: {
            parts?: Array<{
                text?: string;
                inlineData?: {
                    mimeType: string;
                    data: string;
                };
            }>;
        };
    }>;
    error?: {
        code: number;
        message: string;
    };
}

/**
 * 读取参考图片
 */
async function readReferenceImage(imgPath: string): Promise<{ data: string; mimeType: string } | null> {
    const uri = resolveUri(imgPath);
    if (!uri) {
        return null;
    }

    try {
        const content = await vscode.workspace.fs.readFile(uri);
        const ext = path.extname(imgPath).toLowerCase();
        let mimeType = 'image/png';
        if (ext === '.jpg' || ext === '.jpeg') {
            mimeType = 'image/jpeg';
        } else if (ext === '.webp') {
            mimeType = 'image/webp';
        }

        return {
            data: Buffer.from(content).toString('base64'),
            mimeType
        };
    } catch (error) {
        return null;
    }
}

/**
 * 调用 Gemini Image API 生成图片
 */
async function callGeminiImageApi(
    prompt: string,
    referenceImages: Array<{ data: string; mimeType: string }>,
    aspectRatio: string | undefined,
    imageSize: string | undefined,
    config: GenerateImageConfig,
    abortSignal?: AbortSignal
): Promise<GeminiImageResponse> {
    const apiKey = config.apiKey;
    if (!apiKey) {
        throw new Error('API Key not configured. Please configure generate_image tool in settings.');
    }

    const model = config.model || 'gemini-3-pro-image-preview';
    const baseUrl = config.url || 'https://generativelanguage.googleapis.com/v1beta';
    const url = `${baseUrl}/models/${model}:generateContent?key=${apiKey}`;

    // 构建 parts
    const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [];

    // 添加文本提示
    parts.push({ text: prompt });

    // 添加参考图片
    if (referenceImages && referenceImages.length > 0) {
        for (const img of referenceImages) {
            parts.push({
                inline_data: {
                    mime_type: img.mimeType,
                    data: img.data
                }
            });
        }
    }

    // 构建请求体
    const requestBody: Record<string, unknown> = {
        contents: [{
            role: 'user',
            parts
        }],
        generationConfig: {
            responseModalities: ['TEXT', 'IMAGE']
        }
    };

    // 配置图片选项
    // 只有当参数有值时才传入 imageConfig
    if (aspectRatio || imageSize) {
        const imageConfig: Record<string, string> = {};
        if (aspectRatio) {
            imageConfig.aspectRatio = aspectRatio;
        }
        if (imageSize) {
            imageConfig.imageSize = imageSize;
        }
        if (Object.keys(imageConfig).length > 0) {
            (requestBody.generationConfig as Record<string, unknown>).imageConfig = imageConfig;
        }
    }

    // 检查是否已取消
    if (abortSignal?.aborted) {
        throw new Error('Request cancelled');
    }

    // 创建 fetch 函数（支持代理）
    const fetchFn = createProxyFetch(config.proxyUrl);

    // 发送请求（传递取消信号）
    const response = await fetchFn(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: abortSignal
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API request failed: ${response.status} ${errorText}`);
    }

    return await response.json() as GeminiImageResponse;
}

/**
 * 解析 base64 图片数据获取尺寸（支持 PNG, JPEG, WebP）
 */
function parseImageDimensionsFromBase64(base64Data: string, mimeType: string): { width: number; height: number } | null {
    try {
        const buffer = Buffer.from(base64Data, 'base64');
        
        if (mimeType === 'image/png') {
            // PNG: 宽度在偏移 16-19，高度在 20-23（大端序）
            if (buffer.length >= 24 &&
                buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
                const width = (buffer[16] << 24) | (buffer[17] << 16) | (buffer[18] << 8) | buffer[19];
                const height = (buffer[20] << 24) | (buffer[21] << 16) | (buffer[22] << 8) | buffer[23];
                if (width > 0 && height > 0) {
                    return { width, height };
                }
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
                    const height = (buffer[offset + 5] << 8) | buffer[offset + 6];
                    const width = (buffer[offset + 7] << 8) | buffer[offset + 8];
                    if (width > 0 && height > 0) {
                        return { width, height };
                    }
                    break;
                }
                // 跳到下一个标记
                const length = (buffer[offset + 2] << 8) | buffer[offset + 3];
                offset += 2 + length;
            }
        } else if (mimeType === 'image/webp') {
            // WebP: 检查 RIFF 头
            if (buffer.length >= 30 &&
                buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
                buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
                // VP8X (扩展格式)
                if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x58) {
                    const width = ((buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)) + 1);
                    const height = ((buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)) + 1);
                    if (width > 0 && height > 0) {
                        return { width, height };
                    }
                }
                // VP8 (有损格式)
                else if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x20) {
                    if (buffer.length >= 30) {
                        const width = (buffer[26] | (buffer[27] << 8)) & 0x3FFF;
                        const height = (buffer[28] | (buffer[29] << 8)) & 0x3FFF;
                        if (width > 0 && height > 0) {
                            return { width, height };
                        }
                    }
                }
            }
        }
    } catch {
        // 解析失败
    }
    return null;
}

/**
 * 从响应中提取图片和文本
 */
function extractFromResponse(response: GeminiImageResponse): {
    images: Array<{ data: string; mimeType: string; dimensions?: { width: number; height: number } }>;
    texts: string[];
} {
    const images: Array<{ data: string; mimeType: string; dimensions?: { width: number; height: number } }> = [];
    const texts: string[] = [];

    if (response.candidates) {
        for (const candidate of response.candidates) {
            if (candidate.content?.parts) {
                for (const part of candidate.content.parts) {
                    if (part.inlineData) {
                        const dimensions = parseImageDimensionsFromBase64(part.inlineData.data, part.inlineData.mimeType);
                        images.push({
                            data: part.inlineData.data,
                            mimeType: part.inlineData.mimeType,
                            dimensions: dimensions || undefined
                        });
                    }
                    if (part.text) {
                        texts.push(part.text);
                    }
                }
            }
        }
    }

    return { images, texts };
}

/**
 * 保存图片到文件
 */
async function saveImage(buffer: Buffer, outputPath: string): Promise<void> {
    const uri = resolveUri(outputPath);
    if (!uri) {
        throw new Error('No workspace folder open');
    }

    // 确保目录存在
    const dirUri = vscode.Uri.joinPath(uri, '..');
    try {
        await vscode.workspace.fs.createDirectory(dirUri);
    } catch {
        // 目录可能已存在
    }

    // 写入文件
    await vscode.workspace.fs.writeFile(uri, buffer);
}

/**
 * 获取文件扩展名
 */
/**
 * 根据 Buffer 嗅探图片真实后缀名，如果嗅探失败则回退到 mimeType
 */
function detectExtension(buffer: Buffer, mimeType?: string): string {
    // 嗅探 Magic Number
    if (buffer.length > 4) {
        // JPEG: FF D8
        if (buffer[0] === 0xFF && buffer[1] === 0xD8) return '.jpg';
        // PNG: 89 50 4E 47
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return '.png';
        // GIF: 47 49 46 (GIF87a 或 GIF89a)
        if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return '.gif';
        // WebP: RIFF .... WEBP
        if (buffer.length >= 12 && 
            buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 && 
            buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
            return '.webp';
        }
    }

    // 回退到基于 MIME 类型的映射
    const mimeToExt: Record<string, string> = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/webp': '.webp',
        'image/gif': '.gif',
        'image/x-icon': '.ico',
        'image/heic': '.heic',
        'image/heif': '.heif'
    };
    
    return (mimeType ? mimeToExt[mimeType] : null) || '.png';
}

/**
 * 执行单个图像生成任务
 */
async function executeImageTask(
    task: ImageTask,
    index: number,
    config: GenerateImageConfig,
    maxImagesPerTask: number,
    abortSignal?: AbortSignal
): Promise<TaskResult> {
    const { prompt, reference_images, aspect_ratio, image_size, output_path } = task;

    // 验证参数
    if (!prompt) {
        return { index, success: false, error: 'Task ' + (index + 1) + ': prompt is required' };
    }

    if (!output_path) {
        return { index, success: false, error: 'Task ' + (index + 1) + ': output_path is required' };
    }

    if (aspect_ratio && !SUPPORTED_ASPECT_RATIOS.includes(aspect_ratio as AspectRatio)) {
        return {
            index,
            success: false,
            error: `Task ${index + 1}: Invalid aspect_ratio. Supported: ${SUPPORTED_ASPECT_RATIOS.join(', ')}`
        };
    }

    if (image_size && !SUPPORTED_IMAGE_SIZES.includes(image_size as ImageSize)) {
        return {
            index,
            success: false,
            error: `Task ${index + 1}: Invalid image_size. Supported: ${SUPPORTED_IMAGE_SIZES.join(', ')}`
        };
    }

    if (reference_images && reference_images.length > 14) {
        return {
            index,
            success: false,
            error: `Task ${index + 1}: Maximum 14 reference images allowed`
        };
    }

    try {
        // 检查是否已取消
        if (abortSignal?.aborted) {
            return { index, success: false, error: `Task ${index + 1}: User cancelled image generation`, cancelled: true };
        }
        
        // 读取参考图片
        const referenceImages: Array<{ data: string; mimeType: string }> = [];
        if (reference_images && reference_images.length > 0) {
            for (const imgPath of reference_images) {
                // 检查是否已取消
                if (abortSignal?.aborted) {
                    return { index, success: false, error: `Task ${index + 1}: User cancelled image generation`, cancelled: true };
                }
                const img = await readReferenceImage(imgPath);
                if (!img) {
                    return {
                        index,
                        success: false,
                        error: `Task ${index + 1}: Cannot read reference image: ${imgPath}`
                    };
                }
                referenceImages.push(img);
            }
        }

        // 决定最终的参数值
        // 规则：
        // - 如果启用参数且有强制值（defaultXxx 非空），使用强制值
        // - 如果启用参数且无强制值，使用 AI 传入的值
        // - 如果禁用参数，不传
        let finalAspectRatio: string | undefined;
        if (config.enableAspectRatio) {
            // 如果有设定的默认值，强制使用（AI 不能覆盖）
            // 如果没有默认值，使用 AI 传入的值
            finalAspectRatio = config.defaultAspectRatio || aspect_ratio;
        }
        
        let finalImageSize: string | undefined;
        if (config.enableImageSize) {
            // 如果有设定的默认值，强制使用
            // 如果没有默认值，使用 AI 传入的值
            finalImageSize = config.defaultImageSize || image_size;
        }

        // 调用 API 生成图片（传递取消信号）
        const response = await callGeminiImageApi(
            prompt,
            referenceImages,
            finalAspectRatio,
            finalImageSize,
            config,
            abortSignal
        );

        if (response.error) {
            return {
                index,
                success: false,
                error: `Task ${index + 1}: API error - ${response.error.message}`
            };
        }

        // 提取图片和文本
        const { images, texts } = extractFromResponse(response);
        
        if (images.length === 0) {
            return {
                index,
                success: false,
                error: `Task ${index + 1}: No images generated. Content may have been filtered or an error occurred.`
            };
        }

        // 保存图片（限制数量）
        const savedPaths: string[] = [];
        const multimodal: MultimodalData[] = [];
        const allDimensions: Array<{ width: number; height: number; aspectRatio: string }> = [];
        const limitedImages = images.slice(0, maxImagesPerTask);

        for (let i = 0; i < limitedImages.length; i++) {
            const img = limitedImages[i];
            const buffer = Buffer.from(img.data, 'base64');
            const ext = detectExtension(buffer, img.mimeType);
            
            // 确定输出路径
            let finalOutputPath: string;
            if (i === 0) {
                const currentExt = path.extname(output_path).toLowerCase();
                const targetExt = ext.toLowerCase();
                
                // 定义同义后缀组，防止不必要的更正
                const areSynonyms = (ext1: string, ext2: string) => {
                    const jpegExts = ['.jpg', '.jpeg', '.jfif'];
                    return jpegExts.includes(ext1) && jpegExts.includes(ext2);
                };

                if (currentExt !== targetExt && !areSynonyms(currentExt, targetExt)) {
                    // 仅在后缀名完全不匹配且不是同义词时更正
                    const dirName = path.dirname(output_path);
                    const currentExtName = path.extname(output_path);
                    const baseNameWithoutExt = path.basename(output_path, currentExtName);
                    
                    const newFileName = baseNameWithoutExt + targetExt;
                    finalOutputPath = dirName === '.' ? newFileName : path.join(dirName, newFileName);
                } else {
                    finalOutputPath = output_path;
                }
            } else {
                const baseName = output_path.replace(/\.[^.]+$/, '');
                finalOutputPath = `${baseName}_${i}${ext}`;
            }

            // 保存图片
            await saveImage(buffer, finalOutputPath);
            savedPaths.push(finalOutputPath);

            // 收集尺寸信息
            if (img.dimensions) {
                allDimensions.push({
                    width: img.dimensions.width,
                    height: img.dimensions.height,
                    aspectRatio: calculateAspectRatio(img.dimensions.width, img.dimensions.height)
                });
            }

            // 添加到多模态返回
            multimodal.push({
                mimeType: img.mimeType,
                data: img.data,
                name: path.basename(finalOutputPath)
            });
        }

        // 组合文本说明
        const textDescription = texts.length > 0
            ? texts.join('\n')
            : `Task ${index + 1}: Successfully generated ${images.length} images`;

        return {
            index,
            success: true,
            paths: savedPaths,
            count: images.length,
            dimensions: allDimensions.length > 0 ? allDimensions : undefined,
            description: textDescription,
            multimodal
        };
    } catch (error) {
        // 检查是否是取消导致的错误
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorName = error instanceof Error ? error.name : '';
        
        // 检测各种可能的取消错误
        const isCancelled = abortSignal?.aborted ||
            errorName === 'AbortError' ||
            errorMessage.includes('aborted') ||
            errorMessage.includes('cancelled') ||
            errorMessage.includes('canceled') ||
            errorMessage.includes('Request cancelled') ||
            errorMessage.includes('The operation was aborted') ||
            errorMessage.includes('signal is aborted') ||
            errorMessage.includes('fetch failed');  // Node.js fetch 的 abort 错误
        
        return {
            index,
            success: false,
            error: isCancelled
                ? `Task ${index + 1}: User cancelled image generation`
                : `Task ${index + 1}: ${errorMessage}`,
            cancelled: isCancelled
        };
    }
}

/**
 * 创建图像生成工具（支持动态配置）
 *
 * @param maxBatchTasks 单次调用允许的最大任务数
 * @param maxImagesPerTask 单个任务的最大图片数
 * @param paramsConfig 参数配置
 */
export function createGenerateImageTool(
    maxBatchTasks: number = 5,
    maxImagesPerTask: number = 1,
    paramsConfig?: ToolParamsConfig
): Tool {
    // 默认配置
    const config: ToolParamsConfig = paramsConfig || {
        enableAspectRatio: false,
        enableImageSize: false
    };
    
    // 获取工作区信息
    const workspaces = getAllWorkspaces();
    const isMultiRoot = workspaces.length > 1;
    
    // 构建参数说明
    const paramNotes: string[] = [];
    
    // 宽高比说明
    if (config.enableAspectRatio) {
        if (config.forcedAspectRatio) {
            paramNotes.push(`- **Aspect Ratio**: User set to ${config.forcedAspectRatio} (cannot be changed)`);
        } else {
            paramNotes.push(`- **Aspect Ratio**: Can use aspect_ratio parameter (optional)`);
        }
    }
    
    // 图片尺寸说明
    if (config.enableImageSize) {
        if (config.forcedImageSize) {
            paramNotes.push(`- **Image Size**: User set to ${config.forcedImageSize} (cannot be changed)`);
        } else {
            paramNotes.push(`- **Image Size**: Can use image_size parameter (optional)`);
        }
    }
    
    const paramSection = paramNotes.length > 0
        ? `\n\n**Parameter Configuration**:\n${paramNotes.join('\n')}`
        : '';

    // 动态生成描述
    let description = `Generate images using AI model. Supports single and batch generation modes.

**Important**: Generated images have solid backgrounds, NOT transparent backgrounds. If you need transparent background images, use the remove_background tool after generation.

**Limits**:
- Maximum ${maxBatchTasks} generation tasks per call
- Maximum ${maxImagesPerTask} images saved per task${paramSection}

**Single Mode**: Use prompt + output_path parameters
**Batch Mode**: Use images array parameter (max ${maxBatchTasks} tasks), generate multiple images with different prompts

**Prompt Format**:
- Natural language: Describe the scene in complete sentences (e.g., "an orange cat sitting on a windowsill, sunlight shining on it")
- Tag-style: Comma-separated keywords (e.g., "orange cat, sitting on windowsill, sunlight, warm lighting, high quality")
- Mixed: Combine both styles

Features:
- Text-to-image: Generate images from prompts
- Image editing: Modify based on reference images
- Multi-image composition: Create new scenes using multiple reference images
- Batch generation: Generate multiple different images in one request

Generated images will be saved to the specified path and returned for viewing.`;
    
    // 多工作区说明
    if (isMultiRoot) {
        description += `\n\n**Multi-root Workspace**: Paths must use "workspace_name/path" format. Available workspaces: ${workspaces.map(w => w.name).join(', ')}`;
    }

    // 构建批量任务的属性定义
    const batchItemProperties: Record<string, unknown> = {
        prompt: {
            type: 'string',
            description: 'Image generation prompt. Supports natural language, tags, or mixed.'
        },
        reference_images: {
            type: 'array',
            description: 'Reference image paths array (optional). Maximum 14 images. MUST be an array even for single image, e.g., ["image.png"]',
            items: { type: 'string' }
        },
        output_path: {
            type: 'string',
            description: 'Output file path (required)'
        }
    };

    // 仅当启用宽高比且没有强制值时，才包含 aspect_ratio 参数
    if (config.enableAspectRatio && !config.forcedAspectRatio) {
        batchItemProperties.aspect_ratio = {
            type: 'string',
            description: 'Image aspect ratio (optional)',
            enum: [...SUPPORTED_ASPECT_RATIOS]
        };
    }
    
    // 仅当启用图片尺寸且没有强制值时，才包含 image_size 参数
    if (config.enableImageSize && !config.forcedImageSize) {
        batchItemProperties.image_size = {
            type: 'string',
            description: 'Image resolution (optional)',
            enum: [...SUPPORTED_IMAGE_SIZES]
        };
    }

    // 构建单张模式的属性定义
    const singleModeProperties: Record<string, unknown> = {
        prompt: {
            type: 'string',
            description: 'Single mode: Image generation prompt. Supports: 1) Natural language description; 2) Comma-separated tags/keywords; 3) Mixed style.'
        },
        reference_images: {
            type: 'array',
            description: isMultiRoot
                ? `Single mode: Reference image paths array (optional). Maximum 14 images. Use "workspace_name/path" format. MUST be an array even for single image.`
                : 'Single mode: Reference image paths array (optional). Maximum 14 images. MUST be an array even for single image, e.g., ["image.png"]',
            items: {
                type: 'string',
                description: isMultiRoot
                    ? 'Reference image file path, use "workspace_name/path" format'
                    : 'Reference image file path (relative to workspace)'
            }
        },
        output_path: {
            type: 'string',
            description: isMultiRoot
                ? `Single mode: Output file path (required). Use "workspace_name/path" format.`
                : 'Single mode: Output file path (required). Relative to workspace directory.'
        }
    };

    // 仅当启用宽高比且没有强制值时，才包含 aspect_ratio 参数
    if (config.enableAspectRatio && !config.forcedAspectRatio) {
        singleModeProperties.aspect_ratio = {
            type: 'string',
            description: 'Single mode: Image aspect ratio (optional). Supported: 1:1, 3:2, 2:3, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9',
            enum: [...SUPPORTED_ASPECT_RATIOS]
        };
    }
    
    // 仅当启用图片尺寸且没有强制值时，才包含 image_size 参数
    if (config.enableImageSize && !config.forcedImageSize) {
        singleModeProperties.image_size = {
            type: 'string',
            description: 'Single mode: Image resolution (optional). 1K=1024px, 2K=2048px, 4K=4096px.',
            enum: [...SUPPORTED_IMAGE_SIZES]
        };
    }

    return {
        declaration: {
            name: 'generate_image',
            description,
            category: 'media',
            parameters: {
                type: 'object',
                properties: {
                    // 批量生成模式参数
                    images: {
                        type: 'array',
                        description: 'Batch mode: Image generation task array. Each task can independently configure prompt, reference images, and output path. MUST be an array even for single task, e.g., [{"prompt": "...", "output_path": "..."}]',
                        items: {
                            type: 'object',
                            properties: batchItemProperties,
                            required: ['prompt', 'output_path']
                        }
                    },
                    // 单张生成模式参数（动态构建）
                    ...singleModeProperties
                }
            }
        },
        handler: async (args, context?: ToolContext): Promise<ToolResult> => {
            // 从 context 获取配置和工具 ID
            const config = (context?.config || {}) as GenerateImageConfig;
            const toolId = context?.toolId || generateToolId();
            
            // 创建本地取消控制器
            const abortController = new AbortController();
            const abortSignal = abortController.signal;
            
            // 如果外部传入了取消信号，将其连接到本地控制器
            if (context?.abortSignal) {
                context.abortSignal.addEventListener('abort', () => {
                    abortController.abort();
                });
            }
            
            // 使用 TaskManager 注册任务
            TaskManager.registerTask(toolId, TASK_TYPE_IMAGE_GEN, abortController, {
                prompt: args.prompt,
                outputPath: args.output_path
            });
            
            // 验证配置
            if (!config.apiKey) {
                TaskManager.unregisterTask(toolId, 'error', { error: 'API Key not configured' });
                return {
                    success: false,
                    error: 'API Key not configured. Please configure generate_image tool in settings (Tools Settings -> Image Generation).'
                };
            }

            // 检查使用哪种模式
            const imagesArray = args.images as ImageTask[] | undefined;
            const singlePrompt = args.prompt as string | undefined;
            const singleOutputPath = args.output_path as string | undefined;

            let tasks: ImageTask[] = [];

            if (imagesArray && Array.isArray(imagesArray) && imagesArray.length > 0) {
                // 批量生成模式
                tasks = imagesArray;
            } else if (singlePrompt && singleOutputPath) {
                // 单张生成模式 - 转换为单任务数组
                tasks = [{
                    prompt: singlePrompt,
                    reference_images: args.reference_images as string[] | undefined,
                    aspect_ratio: args.aspect_ratio as AspectRatio | undefined,
                    image_size: args.image_size as ImageSize | undefined,
                    output_path: singleOutputPath
                }];
            } else {
                return {
                    success: false,
                    error: 'Please use one of the following:\n1. Single mode: Provide prompt and output_path\n2. Batch mode: Provide images array'
                };
            }

            // 获取配置限制
            const configMaxBatchTasks = config.maxBatchTasks || 5;
            const configMaxImagesPerTask = config.maxImagesPerTask || 1;

            // 验证任务数量
            if (tasks.length === 0) {
                TaskManager.unregisterTask(toolId, 'error', { error: 'No valid generation tasks' });
                return { success: false, error: 'No valid generation tasks' };
            }

            if (tasks.length > configMaxBatchTasks) {
                TaskManager.unregisterTask(toolId, 'error', { error: `Maximum ${configMaxBatchTasks} generation tasks per call` });
                return { success: false, error: `Maximum ${configMaxBatchTasks} generation tasks per call (current: ${tasks.length})` };
            }

            try {
                // 并发执行所有任务（传递取消信号）
                const results = await Promise.all(
                    tasks.map((task, index) => executeImageTask(task, index, config, configMaxImagesPerTask, abortSignal))
                );

                // 统计结果
                const successResults = results.filter(r => r.success);
                const failedResults = results.filter(r => !r.success);
                const cancelledResults = results.filter(r => r.cancelled);
                
                // 任务完成，使用 TaskManager 注销
                TaskManager.unregisterTask(toolId, 'completed', {
                    totalTasks: tasks.length,
                    completedTasks: successResults.length
                });
                
                // 如果所有任务都被取消，返回用户中断信息
                if (cancelledResults.length === results.length) {
                    return {
                        success: false,
                        error: 'User cancelled the image generation request. Please wait for user\'s next instruction.',
                        cancelled: true
                    };
                }

            // 收集所有多模态数据
            const allMultimodal: MultimodalData[] = [];
            const allPaths: string[] = [];
            const allDimensions: Array<{ width: number; height: number; aspectRatio: string }> = [];
            let totalCount = 0;
            const descriptions: string[] = [];

            for (const result of successResults) {
                if (result.multimodal) {
                    allMultimodal.push(...result.multimodal);
                }
                if (result.paths) {
                    allPaths.push(...result.paths);
                }
                if (result.count) {
                    totalCount += result.count;
                }
                if (result.dimensions) {
                    allDimensions.push(...result.dimensions);
                }
                if (result.description) {
                    descriptions.push(result.description);
                }
            }

            // 生成报告
            const isBatch = tasks.length > 1;
            let message: string;

            if (failedResults.length === 0) {
                // 全部成功
                if (isBatch) {
                    message = `✅ Batch generation completed: ${successResults.length}/${tasks.length} tasks succeeded, ${totalCount} images generated\n\nSaved to:\n${allPaths.map(p => `• ${p}`).join('\n')}`;
                } else {
                    // 单张模式显示尺寸
                    const dimInfo = allDimensions.length > 0
                        ? `\n\nDimensions: ${allDimensions.map(d => `${d.width}×${d.height} (${d.aspectRatio})`).join(', ')}`
                        : '';
                    message = `✅ Successfully generated ${totalCount} images${dimInfo}\n\nSaved to: ${allPaths.join(', ')}`;
                }
            } else if (successResults.length === 0) {
                // 全部失败
                const errors = failedResults.map(r => r.error).join('\n');
                return {
                    success: false,
                    error: isBatch
                        ? `Batch generation failed: All ${tasks.length} tasks failed\n\n${errors}`
                        : failedResults[0].error || 'Generation failed'
                };
            } else {
                // 部分成功
                const errors = failedResults.map(r => r.error).join('\n');
                message = `⚠️ Batch generation partially completed: ${successResults.length}/${tasks.length} succeeded, ${failedResults.length}/${tasks.length} failed\n\n`;
                message += `Saved to:\n${allPaths.map(p => `• ${p}`).join('\n')}\n\n`;
                message += `Failure reasons:\n${errors}`;
            }

            // 如果有部分任务被取消
            const hasCancelled = cancelledResults.length > 0;
            const cancelledNote = hasCancelled
                ? `\n\n⚠️ Note: ${cancelledResults.length} tasks were cancelled by user`
                : '';

                // 根据配置决定是否返回多模态数据给 AI（默认关闭以节省 token）
                const shouldReturnImageToAI = config.returnImageToAI === true;
                
                return {
                    success: true,
                    data: {
                        message: message + cancelledNote,
                        toolId,
                        totalTasks: tasks.length,
                        successCount: successResults.length,
                        failedCount: failedResults.length,
                        cancelledCount: cancelledResults.length,
                        totalImages: totalCount,
                        paths: allPaths,
                        dimensions: allDimensions.length > 0 ? allDimensions : undefined,
                        model: config.model || 'gemini-2.5-flash-preview-05-20',
                        details: descriptions
                    },
                    multimodal: shouldReturnImageToAI && allMultimodal.length > 0 ? allMultimodal : undefined,
                    cancelled: hasCancelled
                };
            } catch (error) {
                // 检查是否是取消导致的错误
                const errorMessage = error instanceof Error ? error.message : String(error);
                const errorName = error instanceof Error ? error.name : '';
                
                const isCancelled = abortSignal.aborted ||
                    errorName === 'AbortError' ||
                    errorMessage.includes('aborted') ||
                    errorMessage.includes('cancelled') ||
                    errorMessage.includes('canceled');
                
                // 使用 TaskManager 注销任务
                TaskManager.unregisterTask(
                    toolId,
                    isCancelled ? 'cancelled' : 'error',
                    isCancelled ? undefined : { error: errorMessage }
                );
                
                if (isCancelled) {
                    return {
                        success: false,
                        error: 'User cancelled the image generation request. Please wait for user\'s next instruction.',
                        cancelled: true
                    };
                }
                
                throw error;
            }
        }
    };
}

/**
 * 注册图像生成工具（默认配置）
 */
export function registerGenerateImage(): Tool {
    return createGenerateImageTool();
}