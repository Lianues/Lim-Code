/**
 * LimCode - 工具执行服务
 *
 * 负责执行工具调用、处理 MCP 工具、管理工具确认逻辑
 */

import { t } from '../../../../i18n';
import type { ToolRegistry } from '../../../../tools/ToolRegistry';
import type { ConversationStore } from '../../../../tools/types';
import type { CheckpointRecord } from '../../../checkpoint';
import type { SettingsManager } from '../../../settings/SettingsManager';
import { isPlanPathAllowed } from '../../../settings/modeToolsPolicy';
import type { McpManager } from '../../../mcp/McpManager';
import { mcpResultToToolResult } from '../../../mcp/toolAdapter';
import type { ContentPart } from '../../../conversation/types';
import type { BaseChannelConfig } from '../../../config/configs/base';
import { getAllWorkspaces, getMultimodalCapability, type ChannelType as UtilChannelType, type ToolMode as UtilToolMode } from '../../../../tools/utils';
import type { FunctionCallInfo, ToolExecutionResult } from '../utils';
import type { CheckpointService } from './CheckpointService';

/**
 * 工具执行完整结果
 */
export type ToolExecutionProgressEvent =
    | {
          type: 'start';
          call: FunctionCallInfo;
      }
    | {
          type: 'end';
          call: FunctionCallInfo;
          toolResult: ToolExecutionResult;
      };

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
    private conversationStore?: ConversationStore;

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
     * 注入对话存储（用于工具持久化对话元数据）
     */
    setConversationStore(store: ConversationStore): void {
        this.conversationStore = store;
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

        // 处理 subagents 调用数量限制
        const processedCalls = this.applySubagentsLimit(calls);

        // 确定检查点的工具名称
        // 如果只有一个工具调用，使用该工具名称
        // 如果有多个工具调用，使用 'tool_batch'
        const toolNameForCheckpoint = processedCalls.allowed.length === 1 ? processedCalls.allowed[0].name : 'tool_batch';

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

        // 处理被限制的 subagents 调用（直接返回拒绝结果）
        for (const call of processedCalls.rejected) {
            const maxConcurrent = this.settingsManager?.getSubAgentsConfig()?.maxConcurrentAgents ?? 3;
            const response: Record<string, unknown> = {
                success: false,
                error: `Exceeded maximum concurrent sub-agents limit (${maxConcurrent}). This call was automatically rejected.`,
                rejected: true
            };

            toolResults.push({
                id: call.id,
                name: call.name,
                result: response
            });

            responseParts.push({
                functionResponse: {
                    id: call.id,
                    name: call.name,
                    response
                }
            });
        }

        // 执行允许的工具
        for (const call of processedCalls.allowed) {
            // 检查是否已取消
            if (abortSignal?.aborted) {
                break;
            }

            // 执行前强制过滤（模式 toolPolicy / 全局 toolsEnabled / Plan write_file 路径限制）
            const rejectionReason = this.getToolRejectionReason(call.name, call.args);
            if (rejectionReason) {
                const response: Record<string, unknown> = {
                    success: false,
                    error: rejectionReason,
                    rejected: true
                };

                toolResults.push({
                    id: call.id,
                    name: call.name,
                    result: JSON.parse(JSON.stringify(response))
                });

                responseParts.push({
                    functionResponse: {
                        id: call.id,
                        name: call.name,
                        response
                    }
                });
                continue;
            }

            let response: Record<string, unknown>;

            try {
                // 检查是否是 MCP 工具（格式：mcp__{serverId}__{toolName}）
                if (call.name.startsWith('mcp__') && this.mcpManager) {
                    response = await this.executeMcpTool(call);
                } else {
                    response = await this.executeBuiltinTool(call, conversationId, config, abortSignal);
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
     * 执行函数调用（带进度事件）
     *
     * 用于：前端“实时排队推进”展示。
     *
     * - 在每个工具开始前 yield {type:'start'}
     * - 在每个工具结束后 yield {type:'end'}（包含该工具的 ToolExecutionResult）
     * - 最终通过 generator return 返回完整 ToolExecutionFullResult（供调用方持久化 / 后续流程使用）
     */
    async *executeFunctionCallsWithProgress(
        calls: FunctionCallInfo[],
        conversationId?: string,
        messageIndex?: number,
        config?: BaseChannelConfig,
        abortSignal?: AbortSignal
    ): AsyncGenerator<ToolExecutionProgressEvent, ToolExecutionFullResult, void> {
        const responseParts: ContentPart[] = [];
        const toolResults: ToolExecutionResult[] = [];
        const checkpoints: CheckpointRecord[] = [];
        const multimodalAttachments: ContentPart[] = [];

        // 获取工具调用模式
        const toolMode = config?.toolMode || 'function_call';
        const isPromptMode = toolMode === 'xml' || toolMode === 'json';

        // 处理 subagents 调用数量限制
        const processedCalls = this.applySubagentsLimit(calls);

        const toolNameForCheckpoint = processedCalls.allowed.length === 1 ? processedCalls.allowed[0].name : 'tool_batch';

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

        // 处理被限制的 subagents 调用（直接返回拒绝结果）
        for (const call of processedCalls.rejected) {
            const maxConcurrent = this.settingsManager?.getSubAgentsConfig()?.maxConcurrentAgents ?? 3;
            const response: Record<string, unknown> = {
                success: false,
                error: `Exceeded maximum concurrent sub-agents limit (${maxConcurrent}). This call was automatically rejected.`,
                rejected: true
            };

            const tr: ToolExecutionResult = {
                id: call.id,
                name: call.name,
                result: response
            };

            toolResults.push(tr);
            responseParts.push({
                functionResponse: {
                    id: call.id,
                    name: call.name,
                    response
                }
            });

            // 对于被自动拒绝的工具，直接给一个 end 事件（不发 start，避免 UI 把它当作“执行中”）
            yield { type: 'end', call, toolResult: tr };
        }

        // 执行允许的工具
        for (const call of processedCalls.allowed) {
            if (abortSignal?.aborted) {
                break;
            }

            // 执行前强制过滤（模式 toolPolicy / 全局 toolsEnabled / Plan write_file 路径限制）
            const rejectionReason = this.getToolRejectionReason(call.name, call.args);
            if (rejectionReason) {
                const response: Record<string, unknown> = {
                    success: false,
                    error: rejectionReason,
                    rejected: true
                };

                const toolResult: ToolExecutionResult = {
                    id: call.id,
                    name: call.name,
                    result: JSON.parse(JSON.stringify(response))
                };
                toolResults.push(toolResult);
                responseParts.push({
                    functionResponse: {
                        id: call.id,
                        name: call.name,
                        response
                    }
                });

                // 被策略拒绝的工具：直接给 end 事件（不发 start，避免 UI 把它当作“执行中”）
                yield { type: 'end', call, toolResult };
                continue;
            }

            yield { type: 'start', call };

            let response: Record<string, unknown>;

            try {
                if (call.name.startsWith('mcp__') && this.mcpManager) {
                    response = await this.executeMcpTool(call);
                } else {
                    response = await this.executeBuiltinTool(call, conversationId, config, abortSignal);
                }
            } catch (error) {
                const err = error as Error;
                response = {
                    success: false,
                    error: err.message || t('modules.api.chat.errors.toolExecutionFailed')
                };
            }

            const toolResult: ToolExecutionResult = {
                id: call.id,
                name: call.name,
                // 深拷贝：保留完整数据供前端显示
                result: JSON.parse(JSON.stringify(response))
            };
            toolResults.push(toolResult);

            // 处理多模态数据
            const multimodalData = (response as any).multimodal as Array<{
                mimeType: string;
                data: string;
                name?: string;
            }> | undefined;

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
            } else {
                responseParts.push({
                    functionResponse: {
                        name: call.name,
                        response,
                        id: call.id
                    }
                });
            }

            yield { type: 'end', call, toolResult };
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

            // 统一转换 MCP 结果（支持 text / image / resource）
            const toolResult = mcpResultToToolResult(result);

            if (toolResult.success) {
                const textContent = typeof toolResult.data === 'string' ? toolResult.data : '';
                const response: Record<string, unknown> = {
                    success: true,
                    content: textContent || t('modules.api.chat.errors.toolExecutionSuccess')
                };

                // 保留多模态数据，后续由 processMultimodalData 统一处理
                if (toolResult.multimodal && toolResult.multimodal.length > 0) {
                    response.multimodal = toolResult.multimodal.map(item => ({
                        mimeType: item.mimeType,
                        data: item.data,
                        name: item.name
                    }));
                }

                return response;
            } else {
                return {
                    success: false,
                    error:
                        toolResult.error ||
                        result.error ||
                        t('modules.api.chat.errors.mcpToolCallFailed')
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
        conversationId?: string,
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
            toolOptions: config?.toolOptions,  // 传递工具配置
            // 注入对话上下文（供 todo_write 等工具使用）
            conversationId,
            conversationStore: this.conversationStore
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

        // 如果工具在当前模式被禁用（mode allowlist / Plan write_file 路径限制 / toolsEnabled），则不等待确认
        if (this.getToolRejectionReason(toolName) !== null) {
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

    /**
     * 应用 subagents 数量限制
     * 
     * 检查工具调用列表中的 subagents 调用数量，
     * 如果超过 maxConcurrentAgents 限制，将超出的调用标记为拒绝
     * 
     * @param calls 工具调用列表
     * @returns 分离后的允许和拒绝调用列表
     */
    private applySubagentsLimit(calls: FunctionCallInfo[]): {
        allowed: FunctionCallInfo[];
        rejected: FunctionCallInfo[];
    } {
        // 获取配置
        const maxConcurrent = this.settingsManager?.getSubAgentsConfig()?.maxConcurrentAgents ?? 3;
        
        // -1 表示无限制
        if (maxConcurrent === -1) {
            return { allowed: calls, rejected: [] };
        }
        
        const allowed: FunctionCallInfo[] = [];
        const rejected: FunctionCallInfo[] = [];
        let subagentsCount = 0;
        
        for (const call of calls) {
            if (call.name === 'subagents') {
                if (subagentsCount < maxConcurrent) {
                    allowed.push(call);
                    subagentsCount++;
                } else {
                    rejected.push(call);
                }
            } else {
                allowed.push(call);
            }
        }
        
        if (rejected.length > 0) {
            console.log(`[ToolExecution] Rejected ${rejected.length} subagents calls due to maxConcurrentAgents limit (${maxConcurrent})`);
        }
        
        return { allowed, rejected };
    }

    /**
     * 获取工具在当前模式下的拒绝原因（若允许则返回 null）
     *
     * 强制策略：
     * - 全局 toolsEnabled（SettingsManager.isToolEnabled）
     * - 当前模式 allowlist（mode.toolPolicy 仅当为非空数组时启用过滤）
     * - Plan 模式 write_file 仅允许写入 .limcode/plans/**.md（多工作区支持 workspaceName/.limcode/plans/**.md）
     */
    private getToolRejectionReason(toolName: string, args?: Record<string, unknown>): string | null {
        // 1) 全局 toolsEnabled
        if (this.settingsManager && this.settingsManager.isToolEnabled(toolName) === false) {
            return `Tool "${toolName}" is disabled by settings (toolsEnabled).`;
        }

        // 2) 当前模式 allowlist（仅当 toolPolicy 为非空数组时启用过滤）
        const mode = this.settingsManager?.getCurrentPromptMode();
        const allowlist = Array.isArray(mode?.toolPolicy) && mode.toolPolicy.length > 0
            ? mode.toolPolicy
            : undefined;
        if (allowlist && !allowlist.includes(toolName)) {
            return `Tool "${toolName}" is not allowed in mode "${mode?.id ?? 'unknown'}".`;
        }

        // 3) Plan 模式 write_file 受控例外：只允许写入 .limcode/plans/**.md
        if (mode?.id === 'plan' && toolName === 'write_file') {
            const validation = this.validatePlanModeWriteFileArgs(args);
            if (validation.ok === false) {
                return validation.error;
            }
        }

        return null;
    }

    private validatePlanModeWriteFileArgs(
        args?: Record<string, unknown>
    ): { ok: true } | { ok: false; error: string } {
        const files = (args as any)?.files;
        if (!Array.isArray(files) || files.length === 0) {
            return { ok: false, error: 'In plan mode, write_file requires a non-empty "files" array.' };
        }

        for (const entry of files) {
            if (!entry || typeof entry !== 'object') {
                return { ok: false, error: 'In plan mode, write_file.files entries must be objects.' };
            }
            const path = (entry as any).path;
            if (typeof path !== 'string' || !path.trim()) {
                return { ok: false, error: 'In plan mode, write_file.files[].path must be a non-empty string.' };
            }
            if (!this.isPlanModeWriteFilePathAllowed(path)) {
                return {
                    ok: false,
                    error: `In plan mode, write_file is only allowed to write ".limcode/plans/**.md". Rejected path: ${path}`
                };
            }
        }

        return { ok: true };
    }

    private isPlanModeWriteFilePathAllowed(path: string): boolean {
        // 先尝试单工作区格式：.limcode/plans/...
        if (isPlanPathAllowed(path)) {
            return true;
        }

        // 多工作区：允许 workspaceName/.limcode/plans/...
        let isMultiRoot = false;
        try {
            isMultiRoot = getAllWorkspaces().length > 1;
        } catch {
            isMultiRoot = false;
        }

        if (!isMultiRoot) {
            return false;
        }

        const normalized = path.replace(/\\/g, '/');
        const slashIndex = normalized.indexOf('/');
        if (slashIndex <= 0) {
            return false;
        }
        const withoutWorkspacePrefix = normalized.substring(slashIndex + 1);
        return isPlanPathAllowed(withoutWorkspacePrefix);
    }
}
