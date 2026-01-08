/**
 * LimCode - 流式响应处理器
 *
 * 封装流式响应处理的公共逻辑，包括：
 * - 流式响应累积
 * - 取消处理
 * - Chunk 处理和增量计算
 * - 部分内容保存
 */

import type { Content, ContentPart } from '../../../conversation/types';
import type { StreamChunk, GenerateResponse } from '../../../channel/types';
import { StreamAccumulator } from '../../../channel/StreamAccumulator';
import { ChannelError, ErrorType } from '../../../channel/types';

/**
 * 流式处理配置
 */
export interface StreamProcessorConfig {
    /** 请求开始时间（用于计算响应持续时间） */
    requestStartTime: number;
    /** 渠道类型 */
    providerType: 'gemini' | 'openai' | 'anthropic' | 'openai-responses' | 'custom';
    /** 取消信号 */
    abortSignal?: AbortSignal;
    /** 对话 ID */
    conversationId: string;
}

/**
 * 流式处理结果
 */
export interface StreamProcessorResult {
    /** 最终内容 */
    content: Content;
    /** 是否被取消 */
    cancelled: boolean;
}

/**
 * 流式 chunk 数据（用于 yield）
 */
export interface ProcessedChunkData {
    conversationId: string;
    chunk: StreamChunk & { thinkingStartTime?: number };
}

/**
 * 取消数据（用于 yield）
 */
export interface CancelledData {
    conversationId: string;
    cancelled: true;
    content?: Content;
}

/**
 * 流式响应处理器
 *
 * 提供统一的流式响应处理逻辑，减少 ChatHandler 中的重复代码
 */
export class StreamResponseProcessor {
    private accumulator: StreamAccumulator;
    private config: StreamProcessorConfig;
    private lastPartsLength: number = 0;
    private cancelled: boolean = false;

    constructor(config: StreamProcessorConfig) {
        this.config = config;
        this.accumulator = new StreamAccumulator();
        this.accumulator.setRequestStartTime(config.requestStartTime);
        this.accumulator.setProviderType(config.providerType);
    }

    /**
     * 处理流式响应
     *
     * 这是一个生成器函数，会 yield 处理后的 chunk 数据
     *
     * @param response 流式响应生成器
     * @yields 处理后的 chunk 数据
     */
    async *processStream(
        response: AsyncGenerator<StreamChunk>
    ): AsyncGenerator<ProcessedChunkData> {
        try {
            for await (const chunk of response) {
                // 检查是否已取消
                if (this.config.abortSignal?.aborted) {
                    this.cancelled = true;
                    break;
                }

                this.accumulator.add(chunk);

                // 获取累加器处理后的 parts（实时转换工具调用标记）
                const currentContent = this.accumulator.getContent();
                const currentParts = currentContent.parts;

                // 计算增量 delta
                const newDelta = currentParts.slice(this.lastPartsLength);
                this.lastPartsLength = currentParts.length;

                // 构建处理后的 chunk
                const processedChunk: StreamChunk & { thinkingStartTime?: number } = {
                    ...chunk,
                    delta: newDelta.length > 0 ? newDelta : chunk.delta
                };

                // 如果有思考开始时间，添加到 chunk
                const thinkingStartTime = currentContent.thinkingStartTime;
                if (thinkingStartTime !== undefined) {
                    processedChunk.thinkingStartTime = thinkingStartTime;
                }

                yield {
                    conversationId: this.config.conversationId,
                    chunk: processedChunk
                };
            }
        } catch (err) {
            // 如果是取消错误，设置 cancelled 为 true
            if (this.config.abortSignal?.aborted ||
                (err instanceof ChannelError && err.type === ErrorType.CANCELLED_ERROR)) {
                this.cancelled = true;
            } else {
                throw err;
            }
        }
    }

    /**
     * 获取处理结果
     */
    getResult(): StreamProcessorResult {
        return {
            content: this.accumulator.getContent(),
            cancelled: this.cancelled
        };
    }

    /**
     * 获取最终内容
     */
    getContent(): Content {
        return this.accumulator.getContent();
    }

    /**
     * 是否已取消
     */
    isCancelled(): boolean {
        return this.cancelled;
    }

    /**
     * 获取取消数据（用于 yield）
     */
    getCancelledData(): CancelledData {
        const content = this.accumulator.getContent();
        if (content.parts.length > 0) {
            return {
                conversationId: this.config.conversationId,
                cancelled: true,
                content
            };
        } else {
            return {
                conversationId: this.config.conversationId,
                cancelled: true
            };
        }
    }

    /**
     * 处理非流式响应
     *
     * @param response 非流式响应
     * @returns 处理后的数据
     */
    processNonStream(response: GenerateResponse): {
        content: Content;
        chunkData: ProcessedChunkData;
    } {
        const content = response.content;
        // 添加响应持续时间
        content.responseDuration = Date.now() - this.config.requestStartTime;
        content.chunkCount = 1;

        // 模拟一个完成块
        const chunkData: ProcessedChunkData = {
            conversationId: this.config.conversationId,
            chunk: {
                delta: content.parts,
                done: true
            }
        };

        return { content, chunkData };
    }
}

/**
 * 检查响应是否是 AsyncGenerator
 */
export function isAsyncGenerator<T = unknown>(obj: any): obj is AsyncGenerator<T> {
    return obj && typeof obj[Symbol.asyncIterator] === 'function';
}
