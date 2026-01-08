/**
 * LimCode - 消息构建服务
 *
 * 负责构建各种消息和历史选项：
 * - 用户消息 Parts 构建
 * - 历史选项构建
 * - 思考内容检测
 */

import type { ContentPart } from '../../../conversation/types';
import type { GetHistoryOptions } from '../../../conversation/ConversationManager';
import type { BaseChannelConfig } from '../../../config/configs/base';
import { getMultimodalCapability, type ChannelType as UtilChannelType, type ToolMode as UtilToolMode } from '../../../../tools/utils';
import type { AttachmentData } from '../types';

/**
 * 消息构建服务
 *
 * 职责：
 * 1. 构建用户消息 Parts（文本 + 附件）
 * 2. 构建历史记录获取选项
 * 3. 检测思考内容和签名
 */
export class MessageBuilderService {
    /**
     * 将附件转换为 ContentPart[] 格式（Gemini inlineData）
     *
     * 存储时包含以下字段：
     * - id: 附件唯一标识，仅用于存储和前端显示
     * - name: 附件名称，仅用于存储和前端显示
     *
     * 注意：displayName 不在此处添加，因为它只适合用于 Gemini function call 格式。
     * 用户输入的附件在发送给 API 时，由 ConversationManager.getHistoryForAPI 统一处理。
     *
     * @param message 用户消息文本
     * @param attachments 附件列表
     * @returns ContentPart[] 包含文本和附件的 parts
     */
    buildUserMessageParts(message: string, attachments?: AttachmentData[]): ContentPart[] {
        const parts: ContentPart[] = [];
        
        // 先添加附件（作为 inlineData，包含 id 和 name 用于存储和前端显示）
        // 注意：不添加 displayName，因为它只适用于 Gemini function call 格式
        if (attachments && attachments.length > 0) {
            for (const attachment of attachments) {
                parts.push({
                    inlineData: {
                        mimeType: attachment.mimeType,
                        data: attachment.data,
                        id: attachment.id,
                        name: attachment.name
                    }
                });
            }
        }
        
        // 再添加文本消息
        if (message) {
            parts.push({ text: message });
        }
        
        return parts;
    }
    
    /**
     * 构建历史记录获取选项
     *
     * 根据渠道配置生成适当的历史选项，包括：
     * - 思考内容配置
     * - 多模态能力
     * - 渠道类型
     *
     * @param config 渠道配置
     * @returns 历史获取选项
     */
    buildHistoryOptions(config: BaseChannelConfig): GetHistoryOptions {
        // 检查是否启用了思考配置
        // Gemini 使用 options.thinkingConfig，Anthropic 使用 options 中的相关字段
        const thinkingEnabled = config.type === 'gemini'
            ? !!(config as any).optionsEnabled?.thinkingConfig
            : false;  // 其他提供商暂不支持
        
        // 获取多模态能力
        const channelType = (config.type || 'custom') as UtilChannelType;
        const toolMode = (config.toolMode || 'function_call') as UtilToolMode;
        const multimodalEnabled = config.multimodalToolsEnabled ?? false;
        const capability = getMultimodalCapability(channelType, toolMode, multimodalEnabled);
        
        // 历史思考回合数配置
        // 仅在发送历史思考内容或签名时生效
        const sendHistoryThoughts = config.sendHistoryThoughts ?? false;
        const sendHistoryThoughtSignatures = config.sendHistoryThoughtSignatures ?? false;
        const historyThinkingRounds = (sendHistoryThoughts || sendHistoryThoughtSignatures)
            ? (config.historyThinkingRounds ?? -1)
            : -1;
        
        return {
            // 当前轮次是否包含思考
            includeThoughts: thinkingEnabled,
            // 是否发送历史思考内容
            sendHistoryThoughts,
            // 是否发送历史思考签名
            sendHistoryThoughtSignatures,
            // 是否发送当前思考内容 (默认: Anthropic 为 true, OAI/Gemini/OAI-Responses 为 false)
            sendCurrentThoughts: config.sendCurrentThoughts ?? (config.type === 'anthropic'),
            // 是否发送当前思考签名 (默认: OAI 为 false, Gemini/OAI-Responses 为 true)
            sendCurrentThoughtSignatures: config.sendCurrentThoughtSignatures ?? (config.type === 'gemini' || config.type === 'openai-responses'),
            // 渠道类型，用于选择对应格式的签名
            channelType: config.type as 'gemini' | 'openai' | 'anthropic' | 'openai-responses' | 'custom',
            // 多模态能力，用于过滤历史中的多模态数据
            multimodalCapability: capability,
            // 历史思考回合数
            historyThinkingRounds
        };
    }
    
    /**
     * 检查消息的 parts 中是否包含思考内容
     *
     * @param parts 消息内容片段
     * @returns 是否包含思考内容
     */
    hasThoughtContent(parts: ContentPart[]): boolean {
        return parts.some(part => part.thought === true);
    }
    
    /**
     * 检查消息的 parts 中是否包含思考签名
     *
     * @param parts 消息内容片段
     * @returns 是否包含思考签名
     */
    hasThoughtSignatures(parts: ContentPart[]): boolean {
        return parts.some(part => part.thoughtSignatures);
    }
}
