/**
 * 缩放图片工具
 *
 * 将图片缩放到指定的目标尺寸：
 * - 支持指定目标宽度和高度
 * - 支持多种填充模式（fill/cover/contain/inside/outside）
 * - 支持多种缩放算法（lanczos3/lanczos2/cubic/mitchell/nearest）
 * - 使用 sharp 进行缩放
 * - 返回缩放后的图片
 *
 * 支持单张和批量两种模式
 */

import * as vscode from 'vscode';
import * as path from 'path';
import type { Tool, ToolResult, MultimodalData, ToolContext } from '../types';
import { resolveUri, getAllWorkspaces, calculateAspectRatio } from '../utils';
import { TaskManager, type TaskEvent } from '../taskManager';
import { getSharp } from '../../modules/dependencies';

/** 缩放任务类型常量 */
const TASK_TYPE_RESIZE = 'resize_image';

/**
 * 缩放图片工具配置（从 context.config 获取）
 */
interface ResizeImageConfig {
    /** 是否将图片返回给 AI */
    returnImageToAI?: boolean;
}

/**
 * 缩放输出事件类型
 */
export interface ResizeImageOutputEvent {
    toolId: string;
    type: 'start' | 'progress' | 'complete' | 'cancelled' | 'error';
    data?: {
        message?: string;
        currentTask?: number;
        totalTasks?: number;
    };
    error?: string;
}

/**
 * 订阅缩放输出
 */
export function onResizeImageOutput(listener: (event: ResizeImageOutputEvent) => void): () => void {
    return TaskManager.onTaskEventByType(TASK_TYPE_RESIZE, (taskEvent: TaskEvent) => {
        const event: ResizeImageOutputEvent = {
            toolId: taskEvent.taskId,
            type: taskEvent.type as ResizeImageOutputEvent['type'],
            data: taskEvent.data as ResizeImageOutputEvent['data'],
            error: taskEvent.error
        };
        listener(event);
    });
}

/**
 * 取消缩放任务
 */
export function cancelResizeImage(toolId: string): { success: boolean; error?: string } {
    return TaskManager.cancelTask(toolId);
}

/** 支持的填充模式 */
type FitMode = 'fill' | 'cover' | 'contain' | 'inside' | 'outside';

/** 支持的缩放算法 */
type KernelMode = 'lanczos3' | 'lanczos2' | 'cubic' | 'mitchell' | 'nearest';

/** 有效的填充模式列表 */
const VALID_FIT_MODES: FitMode[] = ['fill', 'cover', 'contain', 'inside', 'outside'];

/** 有效的缩放算法列表 */
const VALID_KERNEL_MODES: KernelMode[] = ['lanczos3', 'lanczos2', 'cubic', 'mitchell', 'nearest'];

/**
 * 单个缩放任务
 */
interface ResizeTask {
    /** 原始图片路径 */
    image_path: string;
    /** 输出文件路径 */
    output_path: string;
    /** 目标宽度（像素） */
    width: number;
    /** 目标高度（像素） */
    height: number;
    /** 填充模式（可选，默认 fill） */
    fit?: FitMode;
    /** 缩放算法（可选，默认 lanczos3） */
    kernel?: KernelMode;
}

/**
 * 单个任务的结果
 */
interface TaskResult {
    index: number;
    success: boolean;
    error?: string;
    outputPath?: string;
    originalDimensions?: { width: number; height: number; aspectRatio: string };
    resizedDimensions?: { width: number; height: number; aspectRatio: string };
    multimodal?: MultimodalData[];
    cancelled?: boolean;
}

/**
 * 读取图片文件
 */
async function readImageFile(imagePath: string): Promise<{ data: Buffer; mimeType: string } | null> {
    const uri = resolveUri(imagePath);
    if (!uri) {
        return null;
    }

    try {
        const content = await vscode.workspace.fs.readFile(uri);
        const ext = path.extname(imagePath).toLowerCase();
        let mimeType = 'image/png';
        if (ext === '.jpg' || ext === '.jpeg') {
            mimeType = 'image/jpeg';
        } else if (ext === '.webp') {
            mimeType = 'image/webp';
        } else if (ext === '.gif') {
            mimeType = 'image/gif';
        }

        return {
            data: Buffer.from(content),
            mimeType
        };
    } catch (error) {
        return null;
    }
}

/**
 * 执行单个缩放任务
 */
async function executeResizeTask(
    task: ResizeTask,
    index: number,
    abortSignal?: AbortSignal
): Promise<TaskResult> {
    const { image_path, output_path, width, height, fit = 'fill', kernel = 'lanczos3' } = task;

    // 验证参数
    if (!image_path) {
        return { index, success: false, error: `Task ${index + 1}: image_path is required` };
    }

    if (!output_path) {
        return { index, success: false, error: `Task ${index + 1}: output_path is required` };
    }

    // 验证目标尺寸
    if (!width || width <= 0) {
        return { index, success: false, error: `Task ${index + 1}: width must be a positive integer` };
    }

    if (!height || height <= 0) {
        return { index, success: false, error: `Task ${index + 1}: height must be a positive integer` };
    }

    // 验证尺寸范围（防止过大导致内存问题）
    const MAX_DIMENSION = 16384;  // 16K
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        return { index, success: false, error: `Task ${index + 1}: Target dimensions cannot exceed ${MAX_DIMENSION}x${MAX_DIMENSION}` };
    }

    try {
        // 检查是否已取消
        if (abortSignal?.aborted) {
            return { index, success: false, error: `Task ${index + 1}: User cancelled the resize operation`, cancelled: true };
        }

        // 获取 sharp（工具依赖已在 ToolRegistry 层面检查）
        const sharp = await getSharp();
        
        if (!sharp) {
            return { index, success: false, error: `Task ${index + 1}: sharp library not installed, please install in Settings -> Extension Dependencies` };
        }

        // 读取原图
        const imageFile = await readImageFile(image_path);
        if (!imageFile) {
            return { index, success: false, error: `Task ${index + 1}: Cannot read image: ${image_path}` };
        }

        // 获取图片尺寸
        const metadata = await sharp(imageFile.data).metadata();
        if (!metadata.width || !metadata.height) {
            return { index, success: false, error: `Task ${index + 1}: Cannot get image dimensions` };
        }

        const originalWidth = metadata.width;
        const originalHeight = metadata.height;

        // 检查是否已取消
        if (abortSignal?.aborted) {
            return { index, success: false, error: `Task ${index + 1}: User cancelled the resize operation`, cancelled: true };
        }

        // 执行缩放
        const resizedBuffer = await sharp(imageFile.data)
            .resize(width, height, {
                fit,     // 填充模式
                kernel   // 缩放算法
            })
            .toBuffer();

        // 获取缩放后的实际尺寸（contain/inside/outside 模式下可能与指定尺寸不同）
        const resizedMetadata = await sharp(resizedBuffer).metadata();
        const actualWidth = resizedMetadata.width || width;
        const actualHeight = resizedMetadata.height || height;

        // 确定输出格式
        const outputExt = path.extname(output_path).toLowerCase();
        let finalBuffer: Buffer;
        let outputMimeType = 'image/png';

        if (outputExt === '.jpg' || outputExt === '.jpeg') {
            finalBuffer = await sharp(resizedBuffer).jpeg({ quality: 90 }).toBuffer();
            outputMimeType = 'image/jpeg';
        } else if (outputExt === '.webp') {
            finalBuffer = await sharp(resizedBuffer).webp({ quality: 90 }).toBuffer();
            outputMimeType = 'image/webp';
        } else {
            finalBuffer = await sharp(resizedBuffer).png().toBuffer();
            outputMimeType = 'image/png';
        }

        // 保存结果
        const outputUri = resolveUri(output_path);
        if (!outputUri) {
            return { index, success: false, error: `Task ${index + 1}: Cannot resolve output path` };
        }

        // 确保目录存在
        const dirUri = vscode.Uri.joinPath(outputUri, '..');
        try {
            await vscode.workspace.fs.createDirectory(dirUri);
        } catch {
            // 目录可能已存在
        }

        await vscode.workspace.fs.writeFile(outputUri, finalBuffer);

        // 构建多模态数据
        const multimodal: MultimodalData[] = [{
            mimeType: outputMimeType,
            data: finalBuffer.toString('base64'),
            name: path.basename(output_path)
        }];

        return {
            index,
            success: true,
            outputPath: output_path,
            originalDimensions: {
                width: originalWidth,
                height: originalHeight,
                aspectRatio: calculateAspectRatio(originalWidth, originalHeight)
            },
            resizedDimensions: {
                width: actualWidth,
                height: actualHeight,
                aspectRatio: calculateAspectRatio(actualWidth, actualHeight)
            },
            multimodal
        };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorName = error instanceof Error ? error.name : '';
        
        const isCancelled = abortSignal?.aborted ||
            errorName === 'AbortError' ||
            errorMessage.includes('aborted') ||
            errorMessage.includes('cancelled');
        
        return {
            index,
            success: false,
            error: isCancelled
                ? `Task ${index + 1}: User cancelled the resize operation`
                : `Task ${index + 1}: ${errorMessage}`,
            cancelled: isCancelled
        };
    }
}

/**
 * 创建缩放图片工具
 *
 * @param maxBatchTasks 单次调用允许的最大任务数
 */
export function createResizeImageTool(maxBatchTasks: number = 10): Tool {
    const workspaces = getAllWorkspaces();
    const isMultiRoot = workspaces.length > 1;

    let description = `Resize image tool. Resizes images to specified target dimensions.

**Features**:
- Resize image to specified width and height
- Multiple fit modes for aspect ratio control
- Multiple resize algorithms for quality/speed tradeoff

**Parameters**:
- width: Target width (pixels, required)
- height: Target height (pixels, required)
- image_path: Source image path (required)
- output_path: Output file path (required)
- fit: Fit mode (optional, default: fill)
- kernel: Resize algorithm (optional, default: lanczos3)

**Fit Modes**:
- fill: Stretch to fill (ignores aspect ratio) - default
- cover: Preserve ratio, crop to fill target
- contain: Preserve ratio, fit within target (may have padding)
- inside: Preserve ratio, ensure image fits inside target
- outside: Preserve ratio, ensure image covers target

**Kernel Algorithms**:
- lanczos3: Lanczos 3-lobe (highest quality) - default
- lanczos2: Lanczos 2-lobe
- cubic: Bicubic interpolation
- mitchell: Mitchell-Netravali filter
- nearest: Nearest neighbor (fastest, good for pixel art)

**Examples**:
- Resize to 800x600: width=800, height=600
- Resize keeping ratio: width=800, height=600, fit=contain
- Fast resize for pixel art: width=256, height=256, fit=fill, kernel=nearest

**Supported Formats**: PNG, JPEG, WebP (auto-selected based on output path extension)

**Limits**:
- Maximum ${maxBatchTasks} resize tasks per call
- Target dimensions cannot exceed 16384x16384`;

    if (isMultiRoot) {
        description += `\n\n**Multi-root Workspace**: Use "workspace_name/path" format for paths. Available workspaces: ${workspaces.map(w => w.name).join(', ')}`;
    }

    return {
        declaration: {
            name: 'resize_image',
            description,
            category: 'media',
            dependencies: ['sharp'],  // 声明依赖 sharp
            parameters: {
                type: 'object',
                properties: {
                    // 批量模式参数
                    images: {
                        type: 'array',
                        description: 'Batch mode: Resize task array. Each task can independently configure input, output, and target dimensions. MUST be an array even for single task.',
                        items: {
                            type: 'object',
                            properties: {
                                image_path: {
                                    type: 'string',
                                    description: 'Source image path (required)'
                                },
                                output_path: {
                                    type: 'string',
                                    description: 'Output file path (required)'
                                },
                                width: {
                                    type: 'integer',
                                    description: 'Target width (pixels, required)'
                                },
                                height: {
                                    type: 'integer',
                                    description: 'Target height (pixels, required)'
                                },
                                fit: {
                                    type: 'string',
                                    enum: ['fill', 'cover', 'contain', 'inside', 'outside'],
                                    description: 'Fit mode: fill (stretch), cover (crop), contain (fit within), inside, outside. Default: fill'
                                },
                                kernel: {
                                    type: 'string',
                                    enum: ['lanczos3', 'lanczos2', 'cubic', 'mitchell', 'nearest'],
                                    description: 'Resize algorithm: lanczos3 (best quality), lanczos2, cubic, mitchell, nearest (fastest). Default: lanczos3'
                                }
                            },
                            required: ['image_path', 'output_path', 'width', 'height']
                        }
                    },
                    // 单张模式参数（向后兼容）
                    image_path: {
                        type: 'string',
                        description: isMultiRoot
                            ? 'Single mode: Source image path (required). Use "workspace_name/path" format.'
                            : 'Single mode: Source image path (required). Relative to workspace.'
                    },
                    output_path: {
                        type: 'string',
                        description: isMultiRoot
                            ? 'Single mode: Output file path (required). Use "workspace_name/path" format.'
                            : 'Single mode: Output file path (required).'
                    },
                    width: {
                        type: 'integer',
                        description: 'Single mode: Target width (pixels, required)'
                    },
                    height: {
                        type: 'integer',
                        description: 'Single mode: Target height (pixels, required)'
                    },
                    fit: {
                        type: 'string',
                        enum: ['fill', 'cover', 'contain', 'inside', 'outside'],
                        description: 'Single mode: Fit mode - fill (stretch, default), cover (crop), contain (fit within), inside, outside'
                    },
                    kernel: {
                        type: 'string',
                        enum: ['lanczos3', 'lanczos2', 'cubic', 'mitchell', 'nearest'],
                        description: 'Single mode: Resize algorithm - lanczos3 (best, default), lanczos2, cubic, mitchell, nearest (fastest)'
                    }
                }
            }
        },
        handler: async (args, context?: ToolContext): Promise<ToolResult> => {
            const toolId = context?.toolId || TaskManager.generateTaskId('resize');
            const config = (context?.config || {}) as ResizeImageConfig;

            const abortController = new AbortController();
            const abortSignal = abortController.signal;

            if (context?.abortSignal) {
                context.abortSignal.addEventListener('abort', () => {
                    abortController.abort();
                });
            }

            // 检查使用哪种模式
            const imagesArray = args.images as ResizeTask[] | undefined;
            const singleImagePath = args.image_path as string | undefined;
            const singleOutputPath = args.output_path as string | undefined;
            const singleWidth = args.width as number | undefined;
            const singleHeight = args.height as number | undefined;
            const singleFit = args.fit as FitMode | undefined;
            const singleKernel = args.kernel as KernelMode | undefined;

            let tasks: ResizeTask[] = [];

            if (imagesArray && Array.isArray(imagesArray) && imagesArray.length > 0) {
                // 批量模式 - 验证并规范化 fit 和 kernel 参数
                tasks = imagesArray.map(task => ({
                    ...task,
                    fit: task.fit && VALID_FIT_MODES.includes(task.fit) ? task.fit : 'fill',
                    kernel: task.kernel && VALID_KERNEL_MODES.includes(task.kernel) ? task.kernel : 'lanczos3'
                }));
            } else if (singleImagePath && singleOutputPath && 
                       singleWidth !== undefined && singleHeight !== undefined) {
                // 单张模式 - 转换为单任务数组
                tasks = [{
                    image_path: singleImagePath,
                    output_path: singleOutputPath,
                    width: singleWidth,
                    height: singleHeight,
                    fit: singleFit && VALID_FIT_MODES.includes(singleFit) ? singleFit : 'fill',
                    kernel: singleKernel && VALID_KERNEL_MODES.includes(singleKernel) ? singleKernel : 'lanczos3'
                }];
            } else {
                return {
                    success: false,
                    error: 'Please use one of the following:\n1. Single mode: Provide image_path, output_path, width, height\n2. Batch mode: Provide images array'
                };
            }

            // 验证任务数量
            if (tasks.length === 0) {
                return { success: false, error: 'No valid resize tasks' };
            }

            if (tasks.length > maxBatchTasks) {
                return { success: false, error: `Maximum ${maxBatchTasks} resize tasks per call (current: ${tasks.length})` };
            }

            // 注册任务
            TaskManager.registerTask(toolId, TASK_TYPE_RESIZE, abortController, {
                totalTasks: tasks.length
            });

            try {
                // 并发执行所有任务
                const results = await Promise.all(
                    tasks.map((task, index) => executeResizeTask(task, index, abortSignal))
                );

                // 统计结果
                const successResults = results.filter(r => r.success);
                const failedResults = results.filter(r => !r.success && !r.cancelled);
                const cancelledResults = results.filter(r => r.cancelled);

                // 任务完成
                TaskManager.unregisterTask(toolId, 'completed', {
                    totalTasks: tasks.length,
                    successCount: successResults.length
                });

                // 如果所有任务都被取消
                if (cancelledResults.length === results.length) {
                    return {
                        success: false,
                        error: 'User cancelled the resize request. Please wait for user\'s next instruction.',
                        cancelled: true
                    };
                }

                // 收集所有多模态数据
                const allMultimodal: MultimodalData[] = [];
                const allPaths: string[] = [];

                for (const result of successResults) {
                    if (result.multimodal) {
                        allMultimodal.push(...result.multimodal);
                    }
                    if (result.outputPath) {
                        allPaths.push(result.outputPath);
                    }
                }

                // 生成报告
                const isBatch = tasks.length > 1;
                let message: string;

                if (failedResults.length === 0 && cancelledResults.length === 0) {
                    // 全部成功
                    if (isBatch) {
                        message = `✅ Batch resize completed: ${successResults.length}/${tasks.length} tasks succeeded\n\nSaved to:\n${allPaths.map(p => `• ${p}`).join('\n')}`;
                    } else {
                        const r = successResults[0];
                        const t = tasks[0];
                        message = `✅ Resize completed!\n\nOriginal: ${r.originalDimensions?.width}×${r.originalDimensions?.height} (${r.originalDimensions?.aspectRatio})\nResized: ${r.resizedDimensions?.width}×${r.resizedDimensions?.height} (${r.resizedDimensions?.aspectRatio})\nFit: ${t.fit || 'fill'}, Kernel: ${t.kernel || 'lanczos3'}\n\nOutput: ${allPaths[0]}`;
                    }
                } else if (successResults.length === 0) {
                    // 全部失败
                    const errors = failedResults.map(r => r.error).join('\n');
                    return {
                        success: false,
                        error: isBatch
                            ? `Batch resize failed: All ${tasks.length} tasks failed\n\n${errors}`
                            : failedResults[0]?.error || 'Resize failed'
                    };
                } else {
                    // 部分成功
                    const errors = failedResults.map(r => r.error).join('\n');
                    message = `⚠️ Batch resize partially completed: ${successResults.length}/${tasks.length} succeeded, ${failedResults.length} failed\n\n`;
                    message += `Saved to:\n${allPaths.map(p => `• ${p}`).join('\n')}\n\n`;
                    if (failedResults.length > 0) {
                        message += `Failure reasons:\n${errors}`;
                    }
                }

                // 如果有部分任务被取消
                if (cancelledResults.length > 0) {
                    message += `\n\n⚠️ Note: ${cancelledResults.length} tasks were cancelled by user`;
                }

                // 根据配置决定是否返回多模态数据给 AI（默认关闭以节省 token）
                const shouldReturnImageToAI = config.returnImageToAI === true;
                
                return {
                    success: true,
                    data: {
                        message,
                        toolId,
                        totalTasks: tasks.length,
                        successCount: successResults.length,
                        failedCount: failedResults.length,
                        cancelledCount: cancelledResults.length,
                        paths: allPaths
                    },
                    multimodal: shouldReturnImageToAI && allMultimodal.length > 0 ? allMultimodal : undefined,
                    cancelled: cancelledResults.length > 0
                };

            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                const isCancelled = abortSignal.aborted ||
                    errorMessage.includes('aborted') ||
                    errorMessage.includes('cancelled');

                TaskManager.unregisterTask(
                    toolId,
                    isCancelled ? 'cancelled' : 'error',
                    isCancelled ? undefined : { error: errorMessage }
                );

                if (isCancelled) {
                    return {
                        success: false,
                        error: 'User cancelled the resize operation.',
                        cancelled: true
                    };
                }

                return {
                    success: false,
                    error: `Resize failed: ${errorMessage}`
                };
            }
        }
    };
}

/**
 * 注册缩放图片工具（默认配置）
 */
export function registerResizeImage(): Tool {
    return createResizeImageTool();
}