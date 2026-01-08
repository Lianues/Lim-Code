/**
 * LimCode - 工具执行服务
 *
 * 负责执行工具调用、处理 MCP 工具、管理工具确认逻辑
 */

import { t } from '../../../../i18n';
import type { ToolRegistry } from '../../../../tools/ToolRegistry';
import type { CheckpointRecord } from '../../../checkpoint';
import type { SettingsManager } from '../../../settings/SettingsManager';
import type { McpManager } from '../../../mcp/McpManager';
import type { ContentPart } from '../../../conversation/types';
import type { BaseChannelConfig } from '../../../config/configs/base';
import { getMultimodalCapability, type ChannelType as UtilChannelType, type ToolMode as UtilToolMode } from '../../../../tools/utils';
import type { FunctionCallInfo, ToolExecutionResult } from '../utils';
import type { CheckpointService } from './CheckpointService';

/**
 * 工具执行完整结果
 */
export interface ToolExecutionFullResult {
    /** 函数响应 parts（用于添加到历史） */
    responseParts: ContentPart[];
    /** 工具执行结果（用于前端显示） */
    toolResults: ToolExecutionResult[];
    /** 创建的检查点 */
    checkpoints: CheckpointRecord[];
    /** 多模态附件（仅 xml/json 模式时使用） */
    multimodalAttachments?: ContentPart[];
}

/**
 * 工具执行服务
 *
 * 职责：
 * 1. 执行内置工具和 MCP 工具
 * 2. 处理工具确认逻辑
 * 3. 创建工具执行前后的检查点
 * 4. 处理多模态工具返回数据
 */
export class ToolExecutionService {
    private settingsManager?: SettingsManager;
    private mcpManager?: McpManager;
    private toolRegistry?: ToolRegistry;

    constructor(
        toolRegistry?: ToolRegistry,
        mcpManager?: McpManager,
        settingsManager?: SettingsManager,
        private checkpointService?: CheckpointService
    ) {
        this.toolRegistry = toolRegistry;
        this.mcpManager = mcpManager;
        this.settingsManager = settingsManager;
    }

    /**
     * 设置设置管理器
     */
    setSettingsManager(settingsManager: SettingsManager): void {
        this.settingsManager = settingsManager;
    }

    /**
     * 设置 MCP 管理器
     */
    setMcpManager(mcpManager: McpManager): void {
        this.mcpManager = mcpManager;
    }

    /**
     * 设置工具注册表
     */
    setToolRegistry(toolRegistry: ToolRegistry): void {
        this.toolRegistry = toolRegistry;
    }

    /**
     * 执行函数调用并返回函数响应 parts
     *
     * @param calls 函数调用列表
     * @param conversationId 对话 ID（用于创建检查点）
     * @param messageIndex 消息索引（用于创建检查点）
     * @returns 函数响应 parts
     */
    async executeFunctionCalls(
        calls: FunctionCallInfo[],
        conversationId?: string,
        messageIndex?: number
    ): Promise<ContentPart[]> {
        const { responseParts } = await this.executeFunctionCallsWithResults(
            calls,
            conversationId,
            messageIndex
        );
        return responseParts;
    }

    /**
     * 执行函数调用并返回完整结果
     *
     * 检查点策略：
     * - 在所有工具执行前创建一个检查点（使用 'tool_batch' 作为 toolName）
     * - 在所有工具执行后创建一个检查点
     * - 这样一条消息无论有多少个工具调用，只会创建一对检查点
     *
     * 多模态数据处理：
     * - 对于 function_call 模式：使用 functionResponse.parts 包含多模态数据
     * - 对于 xml/json 模式：将多模态数据作为用户消息的 inlineData 附件发送
     *
     * @param calls 函数调用列表
     * @param conversationId 对话 ID（用于创建检查点）
     * @param messageIndex 消息索引（用于创建检查点）
     * @param config 渠道配置（用于获取多模态工具设置和工具模式）
     * @param abortSignal 取消信号（用于中断工具执行）
     * @returns 完整执行结果
     */
    async executeFunctionCallsWithResults(
        calls: FunctionCallInfo[],
        conversationId?: string,
        messageIndex?: number,
        config?: BaseChannelConfig,
        abortSignal?: AbortSignal
    ): Promise<ToolExecutionFullResult> {
        const responseParts: ContentPart[] = [];
        const toolResults: ToolExecutionResult[] = [];
        const checkpoints: CheckpointRecord[] = [];
        const multimodalAttachments: ContentPart[] = [];

        // 获取工具调用模式
        const toolMode = config?.toolMode || 'function_call';
        const isPromptMode = toolMode === 'xml' || toolMode === 'json';

        // 确定检查点的工具名称
        // 如果只有一个工具调用，使用该工具名称
        // 如果有多个工具调用，使用 'tool_batch'
        const toolNameForCheckpoint = calls.length === 1 ? calls[0].name : 'tool_batch';

        // 在所有工具执行前创建一个检查点
        if (this.checkpointService && conversationId !== undefined && messageIndex !== undefined) {
            const beforeCheckpoint = await this.checkpointService.createToolExecutionCheckpoint(
                conversationId,
                messageIndex,
                toolNameForCheckpoint,
                'before'
            );
            if (beforeCheckpoint) {
                checkpoints.push(beforeCheckpoint);
            }
        }

        // 执行所有工具
        for (const call of calls) {
            // 检查是否已取消
            if (abortSignal?.aborted) {
                break;
            }

            let response: Record<string, unknown>;

            try {
                // 检查是否是 MCP 工具（格式：mcp__{serverId}__{toolName}）
                if (call.name.startsWith('mcp__') && this.mcpManager) {
                    response = await this.executeMcpTool(call);
                } else {
                    response = await this.executeBuiltinTool(call, config, abortSignal);
                }
            } catch (error) {
                const err = error as Error;
                response = {
                    success: false,
                    error: err.message || t('modules.api.chat.errors.toolExecutionFailed')
                };
            }

            // 添加到工具结果（使用深拷贝，保留完整数据供前端显示）
            // 注意：后续会删除 response.multimodal，但 toolResults 需要保留原始数据
            toolResults.push({
                id: call.id,
                name: call.name,
                result: JSON.parse(JSON.stringify(response))
            });

            // 处理多模态数据
            const multimodalData = (response as any).multimodal as Array<{
                mimeType: string;
                data: string;
                name?: string;
            }> | undefined;

            // 根据工具模式和渠道类型处理多模态数据
            if (multimodalData && multimodalData.length > 0) {
                this.processMultimodalData(
                    multimodalData,
                    response,
                    call,
                    config,
                    toolMode,
                    isPromptMode,
                    responseParts,
                    multimodalAttachments
                );
                continue; // 已在 processMultimodalData 中处理了 responseParts
            }

            // 构建函数响应 part（包含 id 用于 Anthropic API）
            responseParts.push({
                functionResponse: {
                    name: call.name,
                    response,
                    id: call.id
                }
            });
        }

        // 在所有工具执行后创建一个检查点
        if (this.checkpointService && conversationId !== undefined && messageIndex !== undefined) {
            const afterCheckpoint = await this.checkpointService.createToolExecutionCheckpoint(
                conversationId,
                messageIndex,
                toolNameForCheckpoint,
                'after'
            );
            if (afterCheckpoint) {
                checkpoints.push(afterCheckpoint);
            }
        }

        return {
            responseParts,
            toolResults,
            checkpoints,
            multimodalAttachments: multimodalAttachments.length > 0 ? multimodalAttachments : undefined
        };
    }

    /**
     * 执行 MCP 工具
     */
    private async executeMcpTool(call: FunctionCallInfo): Promise<Record<string, unknown>> {
        const parts = call.name.split('__');
        if (parts.length >= 3) {
            const serverId = parts[1];
            const toolName = parts.slice(2).join('__');

            const result = await this.mcpManager!.callTool({
                serverId,
                toolName,
                arguments: call.args
            });

            if (result.success) {
                // 将 MCP 响应转换为标准格式
                const textContent = result.content
                    ?.filter(c => c.type === 'text')
                    .map(c => c.text)
                    .join('\n') || '';

                return {
                    success: true,
                    content: textContent || t('modules.api.chat.errors.toolExecutionSuccess')
                };
            } else {
                return {
                    success: false,
                    error: result.error || t('modules.api.chat.errors.mcpToolCallFailed')
                };
            }
        } else {
            return {
                success: false,
                error: t('modules.api.chat.errors.invalidMcpToolName', { toolName: call.name })
            };
        }
    }

    /**
     * 执行内置工具
     */
    private async executeBuiltinTool(
        call: FunctionCallInfo,
        config?: BaseChannelConfig,
        abortSignal?: AbortSignal
    ): Promise<Record<string, unknown>> {
        const tool = this.toolRegistry?.getTool(call.name);

        if (!tool) {
            return {
                success: false,
                error: t('modules.api.chat.errors.toolNotFound', { toolName: call.name })
            };
        }

        // 获取渠道多模态能力
        const toolMode = config?.toolMode || 'function_call';
        const channelType = (config?.type || 'custom') as UtilChannelType;
        const currentToolMode = (toolMode || 'function_call') as UtilToolMode;
        const multimodalEnabled = config?.multimodalToolsEnabled ?? false;
        const capability = getMultimodalCapability(channelType, currentToolMode, multimodalEnabled);

        // 构建工具执行上下文，包含多模态配置、能力、取消信号和工具调用 ID
        const toolContext: Record<string, unknown> = {
            multimodalEnabled,
            capability,
            abortSignal,
            toolId: call.id,  // 使用函数调用 ID 作为工具 ID，用于追踪和取消
            toolOptions: config?.toolOptions  // 传递工具配置
        };

        // 为特定工具添加配置
        this.addToolSpecificConfig(call.name, toolContext);

        // 执行工具
        const result = await tool.handler(call.args, toolContext);
        return result as unknown as Record<string, unknown>;
    }

    /**
     * 为特定工具添加配置
     */
    private addToolSpecificConfig(toolName: string, toolContext: Record<string, unknown>): void {
        if (!this.settingsManager) {
            return;
        }

        // generate_image 工具配置
        if (toolName === 'generate_image') {
            const imageConfig = this.settingsManager.getGenerateImageConfig();
            toolContext.config = {
                ...imageConfig,
                proxyUrl: this.settingsManager.getEffectiveProxyUrl()
            };
        }

        // remove_background 工具复用 generate_image 的 API 配置，但使用自己的返回图片配置
        if (toolName === 'remove_background') {
            const imageConfig = this.settingsManager.getGenerateImageConfig();
            const removeConfig = this.settingsManager.getRemoveBackgroundConfig();
            toolContext.config = {
                ...imageConfig,
                ...removeConfig,
                proxyUrl: this.settingsManager.getEffectiveProxyUrl()
            };
        }

        // crop_image 工具配置
        if (toolName === 'crop_image') {
            const cropConfig = this.settingsManager.getCropImageConfig();
            toolContext.config = {
                ...cropConfig
            };
        }

        // resize_image 工具配置
        if (toolName === 'resize_image') {
            const resizeConfig = this.settingsManager.getResizeImageConfig();
            toolContext.config = {
                ...resizeConfig
            };
        }

        // rotate_image 工具配置
        if (toolName === 'rotate_image') {
            const rotateConfig = this.settingsManager.getRotateImageConfig();
            toolContext.config = {
                ...rotateConfig
            };
        }
    }

    /**
     * 处理多模态数据
     */
    private processMultimodalData(
        multimodalData: Array<{ mimeType: string; data: string; name?: string }>,
        response: Record<string, unknown>,
        call: FunctionCallInfo,
        config: BaseChannelConfig | undefined,
        toolMode: string,
        isPromptMode: boolean,
        responseParts: ContentPart[],
        multimodalAttachments: ContentPart[]
    ): void {
        // 获取渠道能力
        const channelType = (config?.type || 'custom') as UtilChannelType;
        const currentToolMode = (toolMode || 'function_call') as UtilToolMode;
        const multimodalEnabled = config?.multimodalToolsEnabled ?? false;
        const capability = getMultimodalCapability(channelType, currentToolMode, multimodalEnabled);

        if (isPromptMode) {
            // XML/JSON 模式：将多模态数据作为用户消息附件
            for (const item of multimodalData) {
                multimodalAttachments.push({
                    inlineData: {
                        mimeType: item.mimeType,
                        data: item.data,
                        displayName: item.name
                    }
                });
            }
            // 从响应中移除 multimodal 数据（因为已经单独处理）
            delete (response as any).multimodal;

            // 构建函数响应 part
            responseParts.push({
                functionResponse: {
                    name: call.name,
                    response,
                    id: call.id
                }
            });
        } else {
            // function_call 模式
            if (capability.supportsImages || capability.supportsDocuments) {
                // Gemini/Anthropic 支持在 functionResponse 中包含多模态数据
                const multimodalParts: ContentPart[] = multimodalData.map(item => ({
                    inlineData: {
                        mimeType: item.mimeType,
                        data: item.data,
                        displayName: item.name
                    }
                }));

                // 从响应中移除 multimodal 数据（将放入 parts 中）
                delete (response as any).multimodal;

                // 构建带 parts 的函数响应
                responseParts.push({
                    functionResponse: {
                        name: call.name,
                        response,
                        id: call.id,
                        parts: multimodalParts
                    }
                });
            } else {
                // 渠道不支持 function_call 模式的多模态（如 OpenAI）
                console.log(`[Multimodal] Channel ${channelType} does not support function_call multimodal, image data will be discarded`);
                delete (response as any).multimodal;

                // 构建函数响应 part
                responseParts.push({
                    functionResponse: {
                        name: call.name,
                        response,
                        id: call.id
                    }
                });
            }
        }
    }

    /**
     * 检查工具是否需要用户确认
     *
     * 使用统一的工具自动执行配置来判断
     * 如果工具被配置为自动执行（autoExec = true），则不需要确认
     * 如果工具被配置为需要确认（autoExec = false），则需要用户确认
     *
     * @param toolName 工具名称
     * @returns 是否需要确认
     */
    toolNeedsConfirmation(toolName: string): boolean {
        if (!this.settingsManager) {
            return false;
        }

        // 使用统一的自动执行配置
        // isToolAutoExec 返回 true 表示自动执行，不需要确认
        // isToolAutoExec 返回 false 表示需要确认
        return !this.settingsManager.isToolAutoExec(toolName);
    }

    /**
     * 从函数调用列表中筛选出需要确认的工具
     *
     * @param calls 函数调用列表
     * @returns 需要确认的函数调用列表
     */
    getToolsNeedingConfirmation(calls: FunctionCallInfo[]): FunctionCallInfo[] {
        return calls.filter(call => this.toolNeedsConfirmation(call.name));
    }
}
