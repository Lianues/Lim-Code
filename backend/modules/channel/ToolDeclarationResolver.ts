/**
 * LimCode - 工具声明解析器
 *
 * 修改原因：ChannelManager 和 SubAgent 过去各自生成工具声明，导致 read_file 多模态描述、图片工具过滤、MCP schema 清理等逻辑容易漏同步。
 * 修改方式：把原 ChannelManager.getFilteredTools 的核心逻辑抽成共享解析器，并提供工具来源、白名单、黑名单等通用过滤选项。
 * 修改目的：主会话和 SubAgent 都从同一个入口获取工具声明，避免以后主工具声明升级但 SubAgent 没有升级。
 */

import type { ToolDeclaration } from '../../tools/types';
import type { ToolRegistry } from '../../tools/ToolRegistry';
import type { SettingsManager } from '../settings/SettingsManager';
import type { ResolvedPromptModeSnapshot } from '../settings/types';
import type { McpManager } from '../mcp/McpManager';
import { createReadFileTool } from '../../tools/file/read_file';
import { createGenerateImageTool, createRemoveBackgroundTool, createCropImageTool, createResizeImageTool, createRotateImageTool } from '../../tools/media';
import { subAgentRegistry } from '../../tools/subagents';

export type DeclarationChannelType = 'gemini' | 'openai' | 'anthropic' | 'openai-responses' | 'custom';
export type DeclarationToolMode = 'function_call' | 'xml' | 'json';

export interface ToolDeclarationResolveOptions {
    multimodalEnabled?: boolean;
    channelType?: DeclarationChannelType;
    toolMode?: DeclarationToolMode;
    promptModeSnapshot?: ResolvedPromptModeSnapshot;
    includeBuiltins?: boolean;
    includeMcp?: boolean;
    allowlist?: string[];
    denylist?: string[];
    excludeToolNames?: string[];
}

export class ToolDeclarationResolver {
    constructor(
        private readonly toolRegistry?: ToolRegistry,
        private readonly settingsManager?: SettingsManager,
        private readonly mcpManager?: McpManager
    ) {}

    resolve(options: ToolDeclarationResolveOptions = {}): ToolDeclaration[] | undefined {
        const includeBuiltins = options.includeBuiltins !== false;
        const includeMcp = options.includeMcp !== false;
        const tools: ToolDeclaration[] = [];

        if (includeBuiltins) {
            tools.push(...this.resolveBuiltinDeclarations(options));
        }

        if (includeMcp) {
            tools.push(...this.resolveMcpDeclarations());
        }

        const filtered = this.applyFinalFilters(tools, options);
        return filtered.length > 0 ? filtered : undefined;
    }

    private resolveBuiltinDeclarations(options: ToolDeclarationResolveOptions): ToolDeclaration[] {
        if (!this.toolRegistry) {
            return [];
        }

        const builtinTools = this.settingsManager
            ? this.toolRegistry.getDeclarationsBy(toolName => this.settingsManager!.isToolEnabled(toolName))
            : this.toolRegistry.getAllDeclarations();

        const declarations: ToolDeclaration[] = [];
        for (const tool of builtinTools) {
            const declaration = this.buildDynamicBuiltinDeclaration(tool, options);
            if (!declaration) {
                continue;
            }
            declarations.push({
                ...declaration,
                parameters: this.cleanJsonSchema(declaration.parameters)
            });
        }
        return declarations;
    }

    private buildDynamicBuiltinDeclaration(
        tool: ToolDeclaration,
        options: ToolDeclarationResolveOptions
    ): ToolDeclaration | null {
        let declaration: ToolDeclaration = { ...tool };
        const multimodalEnabled = options.multimodalEnabled;
        const channelType = options.channelType;
        const toolMode = options.toolMode;

        if (tool.name === 'read_file') {
            const dynamicTool = createReadFileTool(multimodalEnabled, channelType, toolMode);
            declaration = {
                ...declaration,
                description: dynamicTool.declaration.description,
                parameters: dynamicTool.declaration.parameters
            };
        }

        if (tool.name === 'generate_image') {
            const shouldExclude = !multimodalEnabled ||
                (channelType === 'openai' && toolMode === 'function_call');
            if (shouldExclude) return null;

            const imageConfig = this.settingsManager?.getGenerateImageConfig();
            const maxBatchTasks = imageConfig?.maxBatchTasks || 5;
            const maxImagesPerTask = imageConfig?.maxImagesPerTask || 1;
            const paramsConfig = {
                enableAspectRatio: imageConfig?.enableAspectRatio ?? false,
                forcedAspectRatio: imageConfig?.defaultAspectRatio || undefined,
                enableImageSize: imageConfig?.enableImageSize ?? false,
                forcedImageSize: imageConfig?.defaultImageSize || undefined
            };
            const dynamicTool = createGenerateImageTool(maxBatchTasks, maxImagesPerTask, paramsConfig);
            declaration = {
                ...declaration,
                description: dynamicTool.declaration.description,
                parameters: dynamicTool.declaration.parameters
            };
        }

        if (tool.name === 'remove_background') {
            const shouldExclude = !multimodalEnabled ||
                (channelType === 'openai' && toolMode === 'function_call');
            if (shouldExclude) return null;

            const imageConfig = this.settingsManager?.getGenerateImageConfig();
            const maxBatchTasks = imageConfig?.maxBatchTasks || 5;
            const dynamicTool = createRemoveBackgroundTool(maxBatchTasks);
            declaration = { ...declaration, description: dynamicTool.declaration.description };
        }

        if (tool.name === 'crop_image') {
            const shouldExclude = !multimodalEnabled ||
                (channelType === 'openai' && toolMode === 'function_call');
            if (shouldExclude) return null;

            const imageConfig = this.settingsManager?.getGenerateImageConfig();
            const maxBatchTasks = imageConfig?.maxBatchTasks || 10;
            const dynamicTool = createCropImageTool(maxBatchTasks);
            declaration = { ...declaration, description: dynamicTool.declaration.description };
        }

        if (tool.name === 'resize_image') {
            const shouldExclude = !multimodalEnabled ||
                (channelType === 'openai' && toolMode === 'function_call');
            if (shouldExclude) return null;

            const imageConfig = this.settingsManager?.getGenerateImageConfig();
            const maxBatchTasks = imageConfig?.maxBatchTasks || 10;
            const dynamicTool = createResizeImageTool(maxBatchTasks);
            declaration = { ...declaration, description: dynamicTool.declaration.description };
        }

        if (tool.name === 'rotate_image') {
            const shouldExclude = !multimodalEnabled ||
                (channelType === 'openai' && toolMode === 'function_call');
            if (shouldExclude) return null;

            const imageConfig = this.settingsManager?.getGenerateImageConfig();
            const maxBatchTasks = imageConfig?.maxBatchTasks || 10;
            const dynamicTool = createRotateImageTool(maxBatchTasks);
            declaration = { ...declaration, description: dynamicTool.declaration.description };
        }

        if (tool.name === 'subagents' && subAgentRegistry.countEnabled() === 0) {
            return null;
        }

        return declaration;
    }

    private resolveMcpDeclarations(): ToolDeclaration[] {
        if (!this.mcpManager) {
            return [];
        }

        const tools: ToolDeclaration[] = [];
        const mcpTools = this.mcpManager.getAllTools();
        for (const serverTools of mcpTools) {
            for (const tool of serverTools.tools || []) {
                const toolName = `mcp__${serverTools.serverId}__${tool.name}`;
                const rawSchema = tool.inputSchema || { type: 'object', properties: {} };
                const schema = serverTools.cleanSchema
                    ? this.cleanJsonSchema(rawSchema)
                    : rawSchema;

                tools.push({
                    name: toolName,
                    description: tool.description || `MCP tool: ${tool.name}`,
                    parameters: schema
                });
            }
        }
        return tools;
    }

    private applyFinalFilters(
        tools: ToolDeclaration[],
        options: ToolDeclarationResolveOptions
    ): ToolDeclaration[] {
        let filtered = tools;

        if (options.excludeToolNames && options.excludeToolNames.length > 0) {
            const excludeSet = new Set(options.excludeToolNames);
            filtered = filtered.filter(tool => !excludeSet.has(tool.name));
        }

        if (options.allowlist && options.allowlist.length > 0) {
            const allowlistSet = new Set(options.allowlist);
            filtered = filtered.filter(tool => allowlistSet.has(tool.name));
        }

        if (options.denylist && options.denylist.length > 0) {
            const denylistSet = new Set(options.denylist);
            filtered = filtered.filter(tool => !denylistSet.has(tool.name));
        }

        const promptAllowlist = Array.isArray(options.promptModeSnapshot?.toolPolicy) && options.promptModeSnapshot.toolPolicy.length > 0
            ? options.promptModeSnapshot.toolPolicy
            : undefined;
        if (promptAllowlist && promptAllowlist.length > 0) {
            const promptAllowlistSet = new Set(promptAllowlist);
            filtered = filtered.filter(tool => promptAllowlistSet.has(tool.name));
        }

        return filtered;
    }

    /**
     * 清理 JSON Schema，移除目标模型普遍不接受的字段。
     *
     * 修改原因：主会话和 SubAgent 都会把工具声明发送给模型，schema 清理不能各写一份。
     * 修改方式：递归移除 `$schema` 和 `additionalProperties`。
     * 修改目的：避免 SubAgent 通过 toolOverrides 发送未经清理的 schema，导致 Gemini 等接口 400。
     */
    private cleanJsonSchema(schema: any): any {
        if (!schema || typeof schema !== 'object') {
            return schema;
        }

        if (Array.isArray(schema)) {
            return schema.map(item => this.cleanJsonSchema(item));
        }

        const cleaned: Record<string, any> = {};
        for (const [key, value] of Object.entries(schema)) {
            if (key === '$schema' || key === 'additionalProperties') {
                continue;
            }
            cleaned[key] = this.cleanJsonSchema(value);
        }
        return cleaned;
    }
}
