/**
 * LimCode - 设置处理器
 *
 * 负责处理设置相关的所有请求
 */

import { t } from '../../../i18n';
import type { SettingsManager } from '../../settings/SettingsManager';
import type { ToolRegistry } from '../../../tools/ToolRegistry';
import { TokenCountService } from '../../channel/TokenCountService';
import { getPromptManager } from '../../prompt/PromptManager';
import type {
    GetSettingsRequest,
    GetSettingsResponse,
    UpdateSettingsRequest,
    UpdateSettingsResponse,
    SetActiveChannelRequest,
    SetToolEnabledRequest,
    SetToolsEnabledRequest,
    SetDefaultToolModeRequest,
    UpdateUISettingsRequest,
    UpdateProxySettingsRequest,
    ResetSettingsRequest,
    GetToolsListRequest,
    GetToolsListResponse,
    ToolInfo,
    GetToolConfigRequest,
    GetToolConfigResponse,
    UpdateToolConfigRequest,
    UpdateToolConfigResponse,
    UpdateListFilesConfigRequest,
    UpdateApplyDiffConfigRequest
} from './types';

/**
 * 设置处理器
 * 
 * 职责：
 * 1. 获取和更新全局设置
 * 2. 管理工具启用状态
 * 3. 管理活动渠道
 * 4. 处理 UI 设置
 */
export class SettingsHandler {
    private tokenCountService: TokenCountService;
    
    constructor(
        private settingsManager: SettingsManager,
        private toolRegistry?: ToolRegistry
    ) {
        const proxySettings = this.settingsManager.getProxySettings();
        this.tokenCountService = new TokenCountService(
            proxySettings?.enabled ? proxySettings.url : undefined
        );
    }
    
    /**
     * 获取设置
     */
    async getSettings(request: GetSettingsRequest): Promise<GetSettingsResponse> {
        try {
            const settings = this.settingsManager.getSettings();
            
            return {
                success: true,
                settings
            };
        } catch (error) {
            const err = error as any;
            return {
                success: false,
                error: {
                    code: err.code || 'UNKNOWN_ERROR',
                    message: err.message || t('modules.api.settings.errors.getSettingsFailed')
                }
            };
        }
    }
    
    /**
     * 更新设置
     */
    async updateSettings(request: UpdateSettingsRequest): Promise<UpdateSettingsResponse> {
        try {
            await this.settingsManager.updateSettings(request.settings);
            const settings = this.settingsManager.getSettings();
            
            return {
                success: true,
                settings
            };
        } catch (error) {
            const err = error as any;
            return {
                success: false,
                error: {
                    code: err.code || 'UNKNOWN_ERROR',
                    message: err.message || t('modules.api.settings.errors.updateSettingsFailed')
                }
            };
        }
    }
    
    /**
     * 设置活动渠道
     */
    async setActiveChannel(request: SetActiveChannelRequest): Promise<UpdateSettingsResponse> {
        try {
            await this.settingsManager.setActiveChannelId(request.channelId);
            const settings = this.settingsManager.getSettings();
            
            return {
                success: true,
                settings
            };
        } catch (error) {
            const err = error as any;
            return {
                success: false,
                error: {
                    code: err.code || 'UNKNOWN_ERROR',
                    message: err.message || t('modules.api.settings.errors.setActiveChannelFailed')
                }
            };
        }
    }
    
    /**
     * 设置单个工具启用状态
     */
    async setToolEnabled(request: SetToolEnabledRequest): Promise<UpdateSettingsResponse> {
        try {
            await this.settingsManager.setToolEnabled(request.toolName, request.enabled);
            const settings = this.settingsManager.getSettings();
            
            return {
                success: true,
                settings
            };
        } catch (error) {
            const err = error as any;
            return {
                success: false,
                error: {
                    code: err.code || 'UNKNOWN_ERROR',
                    message: err.message || t('modules.api.settings.errors.setToolStatusFailed')
                }
            };
        }
    }
    
    /**
     * 批量设置工具启用状态
     */
    async setToolsEnabled(request: SetToolsEnabledRequest): Promise<UpdateSettingsResponse> {
        try {
            await this.settingsManager.setToolsEnabled(request.toolsEnabled);
            const settings = this.settingsManager.getSettings();
            
            return {
                success: true,
                settings
            };
        } catch (error) {
            const err = error as any;
            return {
                success: false,
                error: {
                    code: err.code || 'UNKNOWN_ERROR',
                    message: err.message || t('modules.api.settings.errors.batchSetToolStatusFailed')
                }
            };
        }
    }
    
    /**
     * 设置默认工具模式
     */
    async setDefaultToolMode(request: SetDefaultToolModeRequest): Promise<UpdateSettingsResponse> {
        try {
            await this.settingsManager.setDefaultToolMode(request.mode);
            const settings = this.settingsManager.getSettings();
            
            return {
                success: true,
                settings
            };
        } catch (error) {
            const err = error as any;
            return {
                success: false,
                error: {
                    code: err.code || 'UNKNOWN_ERROR',
                    message: err.message || t('modules.api.settings.errors.setDefaultToolModeFailed')
                }
            };
        }
    }
    
    /**
     * 更新 UI 设置
     */
    async updateUISettings(request: UpdateUISettingsRequest): Promise<UpdateSettingsResponse> {
        try {
            await this.settingsManager.updateUISettings(request.uiSettings);
            const settings = this.settingsManager.getSettings();
            
            return {
                success: true,
                settings
            };
        } catch (error) {
            const err = error as any;
            return {
                success: false,
                error: {
                    code: err.code || 'UNKNOWN_ERROR',
                    message: err.message || t('modules.api.settings.errors.updateUISettingsFailed')
                }
            };
        }
    }
    
    /**
     * 更新代理设置
     */
    async updateProxySettings(request: UpdateProxySettingsRequest): Promise<UpdateSettingsResponse> {
        try {
            await this.settingsManager.updateProxySettings(request.proxySettings);
            const settings = this.settingsManager.getSettings();
            
            return {
                success: true,
                settings
            };
        } catch (error) {
            const err = error as any;
            return {
                success: false,
                error: {
                    code: err.code || 'UNKNOWN_ERROR',
                    message: err.message || t('modules.api.settings.errors.updateProxySettingsFailed')
                }
            };
        }
    }
    
    /**
     * 重置设置
     */
    async resetSettings(request: ResetSettingsRequest): Promise<UpdateSettingsResponse> {
        try {
            await this.settingsManager.reset();
            const settings = this.settingsManager.getSettings();
            
            return {
                success: true,
                settings
            };
        } catch (error) {
            const err = error as any;
            return {
                success: false,
                error: {
                    code: err.code || 'UNKNOWN_ERROR',
                    message: err.message || t('modules.api.settings.errors.resetSettingsFailed')
                }
            };
        }
    }
    
    /**
     * 获取工具列表
     */
    async getToolsList(request: GetToolsListRequest): Promise<GetToolsListResponse> {
        try {
            if (!this.toolRegistry) {
                return {
                    success: false,
                    error: {
                        code: 'TOOL_REGISTRY_NOT_AVAILABLE',
                        message: t('modules.api.settings.errors.toolRegistryNotAvailable')
                    }
                };
            }
            
            // 获取所有工具
            const allTools = this.toolRegistry.getAllTools();
            
            // 构建工具信息列表
            const tools: ToolInfo[] = allTools.map(tool => ({
                name: tool.declaration.name,
                description: tool.declaration.description,
                enabled: this.settingsManager.isToolEnabled(tool.declaration.name),
                category: tool.declaration.category
            }));
            
            return {
                success: true,
                tools
            };
        } catch (error) {
            const err = error as any;
            return {
                success: false,
                error: {
                    code: err.code || 'UNKNOWN_ERROR',
                    message: err.message || t('modules.api.settings.errors.getToolsListFailed')
                }
            };
        }
    }
    
    /**
     * 获取工具配置
     */
    async getToolConfig(request: GetToolConfigRequest): Promise<GetToolConfigResponse> {
        try {
            const { toolName } = request;
            
            if (toolName === 'list_files') {
                const config = this.settingsManager.getListFilesConfig();
                return {
                    success: true,
                    config
                };
            }
            
            if (toolName === 'apply_diff') {
                const config = this.settingsManager.getApplyDiffConfig();
                return {
                    success: true,
                    config
                };
            }
            
            if (toolName === 'delete_file') {
                const config = this.settingsManager.getDeleteFileConfig();
                return {
                    success: true,
                    config
                };
            }

            if (toolName === 'generate_image') {
                const config = this.settingsManager.getGenerateImageConfig();
                return {
                    success: true,
                    config
                };
            }

            if (toolName === 'remove_background') {
                const config = this.settingsManager.getRemoveBackgroundConfig();
                return {
                    success: true,
                    config
                };
            }

            if (toolName === 'crop_image') {
                const config = this.settingsManager.getCropImageConfig();
                return {
                    success: true,
                    config
                };
            }

            if (toolName === 'resize_image') {
                const config = this.settingsManager.getResizeImageConfig();
                return {
                    success: true,
                    config
                };
            }

            if (toolName === 'rotate_image') {
                const config = this.settingsManager.getRotateImageConfig();
                return {
                    success: true,
                    config
                };
            }
            
            // 获取通用工具配置
            const toolsConfig = this.settingsManager.getToolsConfig();
            const config = toolsConfig[toolName] || {};
            
            return {
                success: true,
                config
            };
        } catch (error) {
            const err = error as any;
            return {
                success: false,
                error: {
                    code: err.code || 'UNKNOWN_ERROR',
                    message: err.message || t('modules.api.settings.errors.getToolConfigFailed')
                }
            };
        }
    }
    
    /**
     * 更新工具配置
     */
    async updateToolConfig(request: UpdateToolConfigRequest): Promise<UpdateToolConfigResponse> {
        try {
            const { toolName, config } = request;
            
            // 优先使用特定更新方法
            if (toolName === 'list_files') {
                await this.settingsManager.updateListFilesConfig(config);
            } else if (toolName === 'find_files') {
                await this.settingsManager.updateFindFilesConfig(config);
            } else if (toolName === 'search_in_files') {
                await this.settingsManager.updateSearchInFilesConfig(config);
            } else if (toolName === 'apply_diff') {
                await this.settingsManager.updateApplyDiffConfig(config);
            } else if (toolName === 'delete_file') {
                await this.settingsManager.updateDeleteFileConfig(config);
            } else if (toolName === 'execute_command') {
                await this.settingsManager.updateExecuteCommandConfig(config);
            } else if (toolName === 'checkpoint') {
                await this.settingsManager.updateCheckpointConfig(config);
            } else if (toolName === 'summarize') {
                await this.settingsManager.updateSummarizeConfig(config);
            } else if (toolName === 'generate_image') {
                await this.settingsManager.updateGenerateImageConfig(config);
            } else if (toolName === 'remove_background') {
                await this.settingsManager.updateRemoveBackgroundConfig(config);
            } else if (toolName === 'crop_image') {
                await this.settingsManager.updateCropImageConfig(config);
            } else if (toolName === 'resize_image') {
                await this.settingsManager.updateResizeImageConfig(config);
            } else if (toolName === 'rotate_image') {
                await this.settingsManager.updateRotateImageConfig(config);
            } else if (toolName === 'context_awareness') {
                await this.settingsManager.updateContextAwarenessConfig(config);
            } else if (toolName === 'pinned_files') {
                await this.settingsManager.updatePinnedFilesConfig(config);
            } else if (toolName === 'system_prompt') {
                await this.settingsManager.updateSystemPromptConfig(config);
            } else if (toolName === 'token_count') {
                await this.settingsManager.updateTokenCountConfig(config);
            } else {
                // 通用更新
                await this.settingsManager.updateToolConfig(toolName, config);
            }
            
            const settings = this.settingsManager.getSettings();
            
            return {
                success: true,
                settings
            };
        } catch (error) {
            const err = error as any;
            return {
                success: false,
                error: {
                    code: err.code || 'UNKNOWN_ERROR',
                    message: err.message || t('modules.api.settings.errors.updateToolConfigFailed')
                }
            };
        }
    }
    
    /**
     * 更新 list_files 配置
     */
    async updateListFilesConfig(request: UpdateListFilesConfigRequest): Promise<UpdateToolConfigResponse> {
        try {
            await this.settingsManager.updateListFilesConfig(request.config);
            const settings = this.settingsManager.getSettings();
            
            return {
                success: true,
                settings
            };
        } catch (error) {
            const err = error as any;
            return {
                success: false,
                error: {
                    code: err.code || 'UNKNOWN_ERROR',
                    message: err.message || t('modules.api.settings.errors.updateListFilesConfigFailed')
                }
            };
        }
    }
    
    /**
     * 更新 apply_diff 配置
     */
    async updateApplyDiffConfig(request: UpdateApplyDiffConfigRequest): Promise<UpdateToolConfigResponse> {
        try {
            await this.settingsManager.updateApplyDiffConfig(request.config);
            const settings = this.settingsManager.getSettings();
            
            return {
                success: true,
                settings
            };
        } catch (error) {
            const err = error as any;
            return {
                success: false,
                error: {
                    code: err.code || 'UNKNOWN_ERROR',
                    message: err.message || t('modules.api.settings.errors.updateApplyDiffConfigFailed')
                }
            };
        }
    }
    
    /**
     * 获取存档点配置
     */
    async getCheckpointConfig(): Promise<GetToolConfigResponse> {
        try {
            const config = this.settingsManager.getCheckpointConfig();
            return {
                success: true,
                config
            };
        } catch (error) {
            const err = error as any;
            return {
                success: false,
                error: {
                    code: err.code || 'UNKNOWN_ERROR',
                    message: err.message || t('modules.api.settings.errors.getCheckpointConfigFailed')
                }
            };
        }
    }
    
    /**
     * 更新存档点配置
     */
    async updateCheckpointConfig(request: { config: any }): Promise<UpdateToolConfigResponse> {
        try {
            await this.settingsManager.updateCheckpointConfig(request.config);
            const settings = this.settingsManager.getSettings();
            
            return {
                success: true,
                settings
            };
        } catch (error) {
            const err = error as any;
            return {
                success: false,
                error: {
                    code: err.code || 'UNKNOWN_ERROR',
                    message: err.message || t('modules.api.settings.errors.updateCheckpointConfigFailed')
                }
            };
        }
    }
    
    /**
     * 获取总结配置
     */
    async getSummarizeConfig(): Promise<GetToolConfigResponse> {
        try {
            const config = this.settingsManager.getSummarizeConfig();
            return {
                success: true,
                config
            };
        } catch (error) {
            const err = error as any;
            return {
                success: false,
                error: {
                    code: err.code || 'UNKNOWN_ERROR',
                    message: err.message || t('modules.api.settings.errors.getSummarizeConfigFailed')
                }
            };
        }
    }
    
    /**
     * 更新总结配置
     */
    async updateSummarizeConfig(request: { config: any }): Promise<UpdateToolConfigResponse> {
        try {
            await this.settingsManager.updateSummarizeConfig(request.config);
            const settings = this.settingsManager.getSettings();
            
            return {
                success: true,
                settings
            };
        } catch (error) {
            const err = error as any;
            return {
                success: false,
                error: {
                    code: err.code || 'UNKNOWN_ERROR',
                    message: err.message || t('modules.api.settings.errors.updateSummarizeConfigFailed')
                }
            };
        }
    }
    
    /**
     * 获取图像生成配置
     */
    async getGenerateImageConfig(): Promise<GetToolConfigResponse> {
        try {
            const config = this.settingsManager.getGenerateImageConfig();
            return {
                success: true,
                config
            };
        } catch (error) {
            const err = error as any;
            return {
                success: false,
                error: {
                    code: err.code || 'UNKNOWN_ERROR',
                    message: err.message || t('modules.api.settings.errors.getGenerateImageConfigFailed')
                }
            };
        }
    }
    
    /**
     * 更新图像生成配置
     */
    async updateGenerateImageConfig(request: { config: any }): Promise<UpdateToolConfigResponse> {
        try {
            await this.settingsManager.updateGenerateImageConfig(request.config);
            const settings = this.settingsManager.getSettings();
            
            return {
                success: true,
                settings
            };
        } catch (error) {
            const err = error as any;
            return {
                success: false,
                error: {
                    code: err.code || 'UNKNOWN_ERROR',
                    message: err.message || t('modules.api.settings.errors.updateGenerateImageConfigFailed')
                }
            };
        }
    }
    
    /**
     * 计算系统提示词的 token 数
     *
     * @param request 包含文本内容和渠道类型
     * @returns token 计数结果
     */
    async countSystemPromptTokens(request: {
        text: string;
        channelType: 'gemini' | 'openai' | 'anthropic';
    }): Promise<{
        success: boolean;
        totalTokens?: number;
        error?: { code: string; message: string };
    }> {
        try {
            const { text, channelType } = request;
            
            // 获取 token 计数配置
            const tokenCountConfig = this.settingsManager.getTokenCountConfig();
            
            // 更新代理设置
            const proxySettings = this.settingsManager.getProxySettings();
            this.tokenCountService.setProxyUrl(
                proxySettings?.enabled ? proxySettings.url : undefined
            );
            
            // 构建一个简单的 Content 对象
            const contents = [{
                role: 'user' as const,
                parts: [{ text }]
            }];
            
            // 调用 token 计数服务
            const result = await this.tokenCountService.countTokens(
                channelType,
                tokenCountConfig,
                contents
            );
            
            if (result.success) {
                return {
                    success: true,
                    totalTokens: result.totalTokens
                };
            } else {
                return {
                    success: false,
                    error: {
                        code: 'TOKEN_COUNT_FAILED',
                        message: result.error || 'Token count failed'
                    }
                };
            }
        } catch (error) {
            const err = error as any;
            return {
                success: false,
                error: {
                    code: err.code || 'UNKNOWN_ERROR',
                    message: err.message || 'Token count failed'
                }
            };
        }
    }
    
    /**
     * 分别计算静态模板和动态上下文的 token 数
     *
     * 静态部分：模板本身的 token 数
     * 动态部分：实际填充后的内容（文件树、诊断等）
     *
     * @param request 包含静态模板文本和渠道类型
     * @returns 分别的 token 计数结果
     */
    async countSystemPromptTokensSeparate(request: {
        staticText: string;
        channelType: 'gemini' | 'openai' | 'anthropic';
    }): Promise<{
        success: boolean;
        staticTokens?: number;
        dynamicTokens?: number;
        error?: { code: string; message: string };
    }> {
        try {
            const { channelType } = request;
            
            // 获取 token 计数配置
            const tokenCountConfig = this.settingsManager.getTokenCountConfig();
            
            // 更新代理设置
            const proxySettings = this.settingsManager.getProxySettings();
            this.tokenCountService.setProxyUrl(
                proxySettings?.enabled ? proxySettings.url : undefined
            );
            
            // 使用 PromptManager 生成实际的系统提示词（替换占位符后的内容）
            const promptManager = getPromptManager();
            const actualSystemPrompt = promptManager.refreshAndGetPrompt();
            
            // 计算静态模板的 token 数
            const staticContents = [{
                role: 'user' as const,
                parts: [{ text: actualSystemPrompt }]
            }];
            
            const staticResult = await this.tokenCountService.countTokens(
                channelType,
                tokenCountConfig,
                staticContents
            );
            
            // 获取实际的动态上下文内容
            const dynamicText = promptManager.getDynamicContextText();
            
            let dynamicTokens = 0;
            if (dynamicText) {
                const dynamicContents = [{
                    role: 'user' as const,
                    parts: [{ text: dynamicText }]
                }];
                
                const dynamicResult = await this.tokenCountService.countTokens(
                    channelType,
                    tokenCountConfig,
                    dynamicContents
                );
                
                if (dynamicResult.success && dynamicResult.totalTokens !== undefined) {
                    dynamicTokens = dynamicResult.totalTokens;
                }
            }
            
            if (staticResult.success) {
                return {
                    success: true,
                    staticTokens: staticResult.totalTokens || 0,
                    dynamicTokens
                };
            } else {
                return {
                    success: false,
                    error: {
                        code: 'TOKEN_COUNT_FAILED',
                        message: staticResult.error || 'Token count failed'
                    }
                };
            }
        } catch (error) {
            const err = error as any;
            return {
                success: false,
                error: {
                    code: err.code || 'UNKNOWN_ERROR',
                    message: err.message || 'Token count failed'
                }
            };
        }
    }
    
    /**
     * 检查是否需要显示版本更新公告
     * 
     * 比较当前版本与用户上次查看的版本，如果不同则返回更新内容
     * 如果用户跨越多个版本升级，会返回所有跨越版本的 changelog
     */
    async checkAnnouncement(): Promise<{
        shouldShow: boolean;
        version: string;
        changelog: string;
    }> {
        try {
            // 获取当前版本
            const currentVersion = this.getCurrentVersion();
            
            // 获取用户上次查看的版本
            const lastReadVersion = this.settingsManager.getLastReadAnnouncementVersion();
            
            // 如果版本相同，不显示公告
            if (lastReadVersion === currentVersion) {
                return {
                    shouldShow: false,
                    version: currentVersion,
                    changelog: ''
                };
            }
            
            // 读取从上次版本到当前版本的所有 changelog
            const changelog = await this.getChangelogSinceVersion(lastReadVersion, currentVersion);
            
            return {
                shouldShow: true,
                version: currentVersion,
                changelog
            };
        } catch (error) {
            console.error('Failed to check announcement:', error);
            return {
                shouldShow: false,
                version: '',
                changelog: ''
            };
        }
    }
    
    /**
     * 标记公告已读
     */
    async markAnnouncementRead(version: string): Promise<void> {
        this.settingsManager.setLastReadAnnouncementVersion(version);
    }
    
    /**
     * 获取当前插件版本
     */
    private getCurrentVersion(): string {
        try {
            const vscode = require('vscode');
            const extension = vscode.extensions.getExtension('Lianues.limcode');
            if (extension) {
                return extension.packageJSON.version || '';
            }
            return '';
        } catch {
            return '';
        }
    }
    
    /**
     * 比较两个版本号
     * 返回: -1 表示 a < b, 0 表示 a == b, 1 表示 a > b
     */
    private compareVersions(a: string, b: string): number {
        const aParts = a.split('.').map(n => parseInt(n, 10) || 0);
        const bParts = b.split('.').map(n => parseInt(n, 10) || 0);
        
        const maxLen = Math.max(aParts.length, bParts.length);
        for (let i = 0; i < maxLen; i++) {
            const aNum = aParts[i] || 0;
            const bNum = bParts[i] || 0;
            if (aNum < bNum) return -1;
            if (aNum > bNum) return 1;
        }
        return 0;
    }
    
    /**
     * 获取从指定版本到当前版本的所有 changelog
     * 
     * @param fromVersion 上次读取的版本（不包含），如果为空则只返回当前版本
     * @param toVersion 当前版本（包含）
     */
    private async getChangelogSinceVersion(fromVersion: string | undefined, toVersion: string): Promise<string> {
        try {
            const vscode = require('vscode');
            const fs = require('fs');
            const path = require('path');
            
            // 获取插件路径
            const extension = vscode.extensions.getExtension('Lianues.limcode');
            if (!extension) {
                return '';
            }
            
            const changelogPath = path.join(extension.extensionPath, 'CHANGELOG.md');
            
            if (!fs.existsSync(changelogPath)) {
                return '';
            }
            
            const content = fs.readFileSync(changelogPath, 'utf-8');
            
            // 解析所有版本及其内容
            const versionBlockRegex = /## \[(\d+\.\d+\.\d+)\][^\n]*\n([\s\S]*?)(?=## \[|$)/g;
            const versions: { version: string; content: string }[] = [];
            
            let match;
            while ((match = versionBlockRegex.exec(content)) !== null) {
                versions.push({
                    version: match[1],
                    content: match[2].trim()
                });
            }
            
            // 筛选需要的版本（大于 fromVersion 且小于等于 toVersion）
            const relevantVersions = versions.filter(v => {
                // 版本必须 <= toVersion
                if (this.compareVersions(v.version, toVersion) > 0) {
                    return false;
                }
                // 如果没有 fromVersion，只返回当前版本
                if (!fromVersion) {
                    return v.version === toVersion;
                }
                // 版本必须 > fromVersion
                return this.compareVersions(v.version, fromVersion) > 0;
            });
            
            // 按版本号降序排列（新版本在前）
            relevantVersions.sort((a, b) => this.compareVersions(b.version, a.version));
            
            // 组合所有版本的 changelog
            if (relevantVersions.length === 0) {
                return '';
            }
            
            // 如果只有一个版本，直接返回内容
            if (relevantVersions.length === 1) {
                return relevantVersions[0].content;
            }
            
            // 多个版本，每个版本加上版本号标题
            return relevantVersions
                .map(v => `## v${v.version}\n${v.content}`)
                .join('\n\n');
        } catch (error) {
            console.error('Failed to read changelog:', error);
            return '';
        }
    }
}