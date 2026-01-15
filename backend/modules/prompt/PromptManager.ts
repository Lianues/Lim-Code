/**
 * LimCode - 系统提示词管理器
 *
 * 负责组装和管理系统提示词
 * 
 * 分为两部分以最大化 API 提供商的 prompt caching：
 * 1. 静态系统提示词（可缓存）：操作系统、时区、用户语言、工作区路径、工具定义
 * 2. 动态上下文消息（不缓存）：时间、文件树、标签页、活动编辑器、诊断、固定文件
 *
 * 支持模板化系统提示词，使用 {{$MODULE_NAME}} 占位符引用模块
 */

import * as vscode from 'vscode'
import * as os from 'os'
import * as fs from 'fs'
import * as path from 'path'
import type { PromptConfig, PromptContext } from './types'
import type { Content } from '../conversation/types'
import { getWorkspaceFileTree, getWorkspaceRoot, getWorkspacesDescription, getAllWorkspaces } from './fileTree'
import { getGlobalSettingsManager } from '../../core/settingsContext'
import { getSkillsManager } from '../skills'

/**
 * 系统提示词管理器
 * 
 * 功能：
 * 1. 生成静态系统提示词（可缓存）
 * 2. 生成动态上下文消息（每次请求时插入，不存储）
 * 3. 支持自定义前缀/后缀
 * 4. 缓存和更新机制
 * 
 * 静态部分（放入系统提示词，可被 API provider 缓存）：
 * - 操作系统信息
 * - 时区
 * - 用户语言
 * - 工作区路径
 * - 工具定义（{{$TOOLS}}、{{$MCP_TOOLS}}）
 * 
 * 动态部分（作为 user 消息插入，不存储到历史记录）：
 * - 当前时间
 * - 工作区文件树
 * - 打开的标签页
 * - 当前活动编辑器
 * - 诊断信息
 * - 固定文件内容
 */
export class PromptManager {
    private config: PromptConfig
    private cachedPrompt: string | null = null
    private lastGeneratedAt: number = 0
    
    // 缓存有效期（毫秒）- 1分钟
    private static readonly CACHE_TTL = 60000
    
    constructor(config: Partial<PromptConfig> = {}) {
        this.config = {
            includeWorkspaceFiles: true,
            maxDepth: 2,
            ...config
        }
    }
    
    /**
     * 更新配置
     */
    updateConfig(config: Partial<PromptConfig>): void {
        this.config = { ...this.config, ...config }
        // 清除缓存
        this.invalidateCache()
    }
    
    /**
     * 使缓存失效
     */
    invalidateCache(): void {
        this.cachedPrompt = null
        this.lastGeneratedAt = 0
    }
    
    /**
     * 获取系统提示词（使用缓存）
     */
    getSystemPrompt(forceRefresh: boolean = false): string {
        const now = Date.now()
        
        // 检查缓存是否有效
        if (!forceRefresh && 
            this.cachedPrompt !== null && 
            (now - this.lastGeneratedAt) < PromptManager.CACHE_TTL) {
            return this.cachedPrompt
        }
        
        // 生成新的提示词
        this.cachedPrompt = this.generatePrompt()
        this.lastGeneratedAt = now
        
        return this.cachedPrompt
    }
    
    /**
     * 强制刷新并获取系统提示词
     * 
     * 在以下情况下调用：
     * - 新对话的第一条消息
     * - 用户删除首条消息后重新发送
     * - 用户编辑首条消息后重试
     */
    refreshAndGetPrompt(): string {
        return this.getSystemPrompt(true)
    }
    
    /**
     * 生成系统提示词
     *
     * 始终使用模板模式生成提示词
     * 用户可以通过设置自定义模板内容
     */
    private generatePrompt(): string {
        const settingsManager = getGlobalSettingsManager()
        const promptConfig = settingsManager?.getSystemPromptConfig()
        
        // 始终使用模板化生成
        const template = promptConfig?.template || ''
        return this.generateFromTemplate(template, promptConfig?.customPrefix || '', promptConfig?.customSuffix || '')
    }
    
    /**
     * 从模板生成系统提示词（静态部分）
     *
     * 只包含静态内容，可被 API provider 缓存：
     * - {{$ENVIRONMENT}} - 静态环境信息（操作系统、时区、用户语言、工作区路径）
     * - {{$TOOLS}} - 工具定义（由外部填充）
     * - {{$MCP_TOOLS}} - MCP 工具定义（由外部填充）
     * 
     * 动态内容（时间、文件树、标签页等）由 getDynamicContextMessages() 方法生成
     */
    private generateFromTemplate(template: string, customPrefix: string, customSuffix: string): string {
        // 静态模块（不会频繁变化）
        const modules: Record<string, string> = {
            'ENVIRONMENT': this.wrapSection('ENVIRONMENT', this.generateStaticEnvironmentSection()),
            // 动态内容占位符 - 这些将被移到动态上下文消息中
            // 为了向后兼容，如果模板中包含这些占位符，替换为空字符串
            'WORKSPACE_FILES': '',
            'OPEN_TABS': '',
            'ACTIVE_EDITOR': '',
            'DIAGNOSTICS': '',
            'PINNED_FILES': '',
            // 工具定义由外部在发送前填充，这里返回占位符
            'TOOLS': '{{$TOOLS}}',
            'MCP_TOOLS': '{{$MCP_TOOLS}}'
        }
        
        // 替换模板中的占位符（使用 {{$xxx}} 格式）
        let result = template
        for (const [key, value] of Object.entries(modules)) {
            const regex = new RegExp(`\\{\\{\\$${key}\\}\\}`, 'g')
            result = result.replace(regex, value)
        }
        
        // 清理多余的空行
        return this.cleanupEmptyLines(result)
    }
    
    /**
     * 从动态模板生成上下文内容
     *
     * 支持的变量：
     * - {{$WORKSPACE_FILES}} - 工作区文件树
     * - {{$OPEN_TABS}} - 打开的标签页
     * - {{$ACTIVE_EDITOR}} - 当前活动编辑器
     * - {{$DIAGNOSTICS}} - 诊断信息
     * - {{$PINNED_FILES}} - 固定文件内容
     * - {{$SKILLS}} - 启用的 Skills 内容
     */
    private generateDynamicFromTemplate(template: string, contextConfig: any): string {
        const settingsManager = getGlobalSettingsManager()
        
        // 动态模块
        const modules: Record<string, string> = {
            'WORKSPACE_FILES': '',
            'OPEN_TABS': '',
            'ACTIVE_EDITOR': '',
            'DIAGNOSTICS': '',
            'PINNED_FILES': '',
            'SKILLS': ''
        }
        
        // 工作区文件树
        if (contextConfig?.includeWorkspaceFiles ?? this.config.includeWorkspaceFiles) {
            const fileTreeContent = this.generateFileTreeSection(
                contextConfig?.maxFileDepth ?? this.config.maxDepth ?? 10,
                contextConfig?.ignorePatterns ?? []
            )
            if (fileTreeContent) {
                modules['WORKSPACE_FILES'] = this.wrapSection('WORKSPACE FILES', fileTreeContent)
            }
        }
        
        // 打开的标签页
        if (contextConfig?.includeOpenTabs) {
            const openTabsContent = this.generateOpenTabsSection(
                contextConfig.maxOpenTabs,
                contextConfig.ignorePatterns || []
            )
            if (openTabsContent) {
                modules['OPEN_TABS'] = this.wrapSection('OPEN TABS', openTabsContent)
            }
        }
        
        // 当前活动编辑器
        if (contextConfig?.includeActiveEditor) {
            const activeEditorContent = this.generateActiveEditorSection(
                contextConfig.ignorePatterns || []
            )
            if (activeEditorContent) {
                modules['ACTIVE_EDITOR'] = this.wrapSection('ACTIVE EDITOR', activeEditorContent)
            }
        }
        
        // 诊断信息
        const diagnosticsContent = this.generateDiagnosticsSection()
        if (diagnosticsContent) {
            modules['DIAGNOSTICS'] = this.wrapSection('DIAGNOSTICS', diagnosticsContent)
        }
        
        // 固定文件内容
        const pinnedFilesContent = this.generatePinnedFilesSection()
        if (pinnedFilesContent) {
            const sectionTitle = settingsManager?.getPinnedFilesConfig()?.sectionTitle || 'PINNED FILES CONTENT'
            modules['PINNED_FILES'] = this.wrapSection(sectionTitle, pinnedFilesContent)
        }
        
        // Skills 内容
        const skillsContent = this.generateSkillsSection()
        if (skillsContent) {
            modules['SKILLS'] = this.wrapSection('ACTIVE SKILLS', skillsContent)
        }
        
        // 替换模板中的占位符
        let result = template
        for (const [key, value] of Object.entries(modules)) {
            const regex = new RegExp(`\\{\\{\\$${key}\\}\\}`, 'g')
            result = result.replace(regex, value)
        }
        
        // 清理多余的空行
        return this.cleanupEmptyLines(result)
    }
    
    /**
     * 将内容包装为带标题的段落
     */
    private wrapSection(title: string, content: string | null): string {
        if (!content) return ''
        return `====\n\n${title}\n\n${content}`
    }
    
    /**
     * 清理文本中的多余空行
     * 
     * 将连续 3 个或以上的换行符压缩为 2 个
     */
    private cleanupEmptyLines(text: string): string {
        return text.replace(/\n{3,}/g, '\n\n').trim()
    }
    
    /**
     * 生成静态环境信息段落（用于系统提示词，可缓存）
     * 
     * 包含：
     * - 工作区路径
     * - 操作系统信息
     * - 时区
     * - 用户语言
     */
    private generateStaticEnvironmentSection(): string {
        const context = this.getContext()
        const lines: string[] = []
        
        // 工作区信息（支持多工作区）
        const workspaces = getAllWorkspaces()
        if (workspaces.length === 0) {
            lines.push('No workspace open')
        } else if (workspaces.length === 1) {
            lines.push(`Current Workspace: ${workspaces[0].fsPath}`)
        } else {
            lines.push('Multi-root Workspace:')
            for (const ws of workspaces) {
                lines.push(`  - ${ws.name}: ${ws.fsPath}`)
            }
            lines.push('')
            lines.push('Use "workspace_name/path" format to access files in specific workspace.')
        }
        
        if (context.os) {
            lines.push(`Operating System: ${context.os}`)
        }
        
        if (context.timezone) {
            lines.push(`Timezone: ${context.timezone}`)
        }
        
        // User language environment
        const userLanguage = this.getUserLanguage()
        if (userLanguage) {
            lines.push(`User Language: ${userLanguage}`)
            lines.push(`Please respond using the user's language by default.`)
        }
        
        return lines.join('\n')
    }
    
    /**
     * 获取动态上下文消息
     * 
     * 返回动态上下文消息（包含时间、文件树、标签页、诊断等）
     * 
     * **重要：** 这些消息应该只在用户主动发送消息时插入，
     * 在 AI 连续调用工具的迭代循环中不应该重复添加。
     * 
     * 这样做的好处：
     * 1. 避免重复发送相同的上下文信息，节省 token
     * 2. 减少 AI 处理的冗余信息
     * 3. 动态上下文反映的是用户发送消息时的状态
     * 
     * 输出格式：
     * - 前缀说明："这是当前可以使用的全局变量信息，如不需要请忽略"
     * - 中间：动态上下文内容（文件树、标签页、诊断等）
     * 
     * @returns 动态上下文消息数组（一条 user 消息）
     */
    getDynamicContextMessages(): Content[] {
        const settingsManager = getGlobalSettingsManager()
        const promptConfig = settingsManager?.getSystemPromptConfig()
        const contextConfig = settingsManager?.getContextAwarenessConfig()
        
        // 检查是否启用动态上下文模板
        const dynamicTemplateEnabled = promptConfig?.dynamicTemplateEnabled ?? true
        if (!dynamicTemplateEnabled) {
            return []
        }
        
        // 如果有自定义动态模板，使用模板生成
        const dynamicTemplate = promptConfig?.dynamicTemplate || ''
        if (dynamicTemplate.trim()) {
            const content = this.generateDynamicFromTemplate(dynamicTemplate, contextConfig)
            if (content) {
                return [{
                    role: 'user' as const,
                    parts: [{ text: content }]
                }]
            }
            return []
        }
        
        // 否则使用默认逻辑
        const sections: string[] = []
        
        // 前缀说明
        sections.push('This is the current global variable information you can use. Continue with the previous task if the information is not needed and ingore it.')
        
        // 当前时间
        const now = new Date()
        sections.push(`Current Time: ${now.toISOString()}`)
        
        // 工作区文件树
        if (contextConfig?.includeWorkspaceFiles ?? this.config.includeWorkspaceFiles) {
            const fileTreeContent = this.generateFileTreeSection(
                contextConfig?.maxFileDepth ?? this.config.maxDepth ?? 10,
                contextConfig?.ignorePatterns ?? []
            )
            if (fileTreeContent) {
                sections.push(this.wrapSection('WORKSPACE FILES', fileTreeContent))
            }
        }
        
        // 打开的标签页
        if (contextConfig?.includeOpenTabs) {
            const openTabsContent = this.generateOpenTabsSection(
                contextConfig.maxOpenTabs,
                contextConfig.ignorePatterns || []
            )
            if (openTabsContent) {
                sections.push(this.wrapSection('OPEN TABS', openTabsContent))
            }
        }
        
        // 当前活动编辑器
        if (contextConfig?.includeActiveEditor) {
            const activeEditorContent = this.generateActiveEditorSection(
                contextConfig.ignorePatterns || []
            )
            if (activeEditorContent) {
                sections.push(this.wrapSection('ACTIVE EDITOR', activeEditorContent))
            }
        }
        
        // 诊断信息
        const diagnosticsContent = this.generateDiagnosticsSection()
        if (diagnosticsContent) {
            sections.push(this.wrapSection('DIAGNOSTICS', diagnosticsContent))
        }
        
        // 固定文件内容
        const pinnedFilesContent = this.generatePinnedFilesSection()
        if (pinnedFilesContent) {
            const sectionTitle = getGlobalSettingsManager()?.getPinnedFilesConfig()?.sectionTitle || 'PINNED FILES CONTENT'
            sections.push(this.wrapSection(sectionTitle, pinnedFilesContent))
        }
        
        // Skills 内容
        const skillsContent = this.generateSkillsSection()
        if (skillsContent) {
            sections.push(this.wrapSection('ACTIVE SKILLS', skillsContent))
        }
        
        // 返回单个动态上下文消息（清理多余空行）
        const content = this.cleanupEmptyLines(sections.join('\n\n'))
        return [{
            role: 'user' as const,
            parts: [{ text: content }]
        }]
    }
    
    /**
     * 获取动态上下文的纯文本内容
     * 
     * 用于 token 计数，返回实际填充后的动态内容
     * （包括文件树、标签页、诊断信息等的实际内容）
     * 
     * @returns 动态上下文的纯文本，如果没有内容则返回空字符串
     */
    getDynamicContextText(): string {
        const messages = this.getDynamicContextMessages()
        if (messages.length === 0) {
            return ''
        }
        
        // 从 Content[] 中提取所有文本
        return messages
            .map(msg => msg.parts?.map(p => p.text || '').join('') || '')
            .join('\n\n')
    }
    
    /**
     * @deprecated 使用 generateStaticEnvironmentSection 代替
     * 保留用于向后兼容
     */
    private generateEnvironmentSection(): string {
        return this.generateStaticEnvironmentSection()
    }
    
    /**
     * 获取用户语言环境
     *
     * 根据设置返回用户当前使用的语言
     * - 如果设置为 'auto'，使用 VS Code 的语言设置
     * - 否则使用用户选择的语言
     */
    private getUserLanguage(): string {
        const settingsManager = getGlobalSettingsManager()
        const uiSettings = settingsManager?.getUISettings()
        const languageSetting = uiSettings?.language || 'auto'
        
        if (languageSetting === 'auto') {
            // 使用 VS Code 的语言设置
            return vscode.env.language || 'en'
        }
        
        return languageSetting
    }
    
    /**
     * 生成文件树段落
     */
    private generateFileTreeSection(maxDepth: number, ignorePatterns: string[]): string {
        const effectiveMaxDepth = maxDepth === -1 ? 100 : maxDepth  // -1 表示无限制，使用大值代替
        const fileTree = getWorkspaceFileTree(effectiveMaxDepth, ignorePatterns)
        
        if (!fileTree) {
            return ''
        }
        
        return `The following is a list of files in the current workspace:\n\n${fileTree}`
    }
    
    /**
     * 生成打开的标签页段落
     */
    private generateOpenTabsSection(maxTabs: number, ignorePatterns: string[]): string {
        const workspaceFolders = vscode.workspace.workspaceFolders
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return ''
        }
        
        const tabs: string[] = []
        
        // 遍历所有 tab groups
        for (const tabGroup of vscode.window.tabGroups.all) {
            for (const tab of tabGroup.tabs) {
                // 只处理文件类型的 tab
                if (tab.input instanceof vscode.TabInputText) {
                    const uri = tab.input.uri
                    
                    // 检查是否在工作区内
                    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri)
                    if (workspaceFolder) {
                        // 获取相对路径
                        const relativePath = vscode.workspace.asRelativePath(uri, false)
                        
                        // 检查是否应该被忽略
                        if (!this.shouldIgnorePath(relativePath, ignorePatterns)) {
                            tabs.push(relativePath)
                        }
                    }
                }
            }
        }
        
        // 去重
        const uniqueTabs = [...new Set(tabs)]
        
        // 应用最大数量限制
        const effectiveMaxTabs = maxTabs === -1 ? uniqueTabs.length : maxTabs
        const limitedTabs = uniqueTabs.slice(0, effectiveMaxTabs)
        
        if (limitedTabs.length === 0) {
            return ''
        }
        
        let result = `Currently open files in editor:\n`
        for (const tab of limitedTabs) {
            result += `  - ${tab}\n`
        }
        
        if (uniqueTabs.length > limitedTabs.length) {
            result += `  ... and ${uniqueTabs.length - limitedTabs.length} more files`
        }
        
        return result
    }
    
    /**
     * 生成当前活动编辑器段落
     */
    private generateActiveEditorSection(ignorePatterns: string[]): string {
        const activeEditor = vscode.window.activeTextEditor
        if (!activeEditor) {
            return ''
        }
        
        const uri = activeEditor.document.uri
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri)
        
        if (!workspaceFolder) {
            return ''
        }
        
        const relativePath = vscode.workspace.asRelativePath(uri, false)
        
        if (this.shouldIgnorePath(relativePath, ignorePatterns)) {
            return ''
        }
        
        return `Currently active file: ${relativePath}`
    }
    
    /**
     * 生成诊断信息段落
     *
     * 从 VSCode 获取工作区的诊断信息（错误、警告等）
     * 根据配置过滤严重程度和文件范围
     */
    private generateDiagnosticsSection(): string {
        const settingsManager = getGlobalSettingsManager()
        if (!settingsManager) {
            return ''
        }
        
        const diagnosticsConfig = settingsManager.getDiagnosticsConfig()
        
        // 如果功能未启用，返回空
        if (!diagnosticsConfig.enabled) {
            return ''
        }
        
        const workspaceFolders = vscode.workspace.workspaceFolders
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return ''
        }
        
        // 获取所有诊断信息
        const allDiagnostics = vscode.languages.getDiagnostics()
        
        // 严重程度映射
        const severityMap: Record<vscode.DiagnosticSeverity, 'error' | 'warning' | 'information' | 'hint'> = {
            [vscode.DiagnosticSeverity.Error]: 'error',
            [vscode.DiagnosticSeverity.Warning]: 'warning',
            [vscode.DiagnosticSeverity.Information]: 'information',
            [vscode.DiagnosticSeverity.Hint]: 'hint'
        }
        
        // 严重程度显示名称
        const severityLabels: Record<string, string> = {
            'error': 'Error',
            'warning': 'Warning',
            'information': 'Info',
            'hint': 'Hint'
        }
        
        // 获取打开的文件 URI 列表（如果需要只显示打开文件的诊断）
        const openFileUris = new Set<string>()
        if (diagnosticsConfig.openFilesOnly) {
            for (const tabGroup of vscode.window.tabGroups.all) {
                for (const tab of tabGroup.tabs) {
                    if (tab.input instanceof vscode.TabInputText) {
                        openFileUris.add(tab.input.uri.toString())
                    }
                }
            }
        }
        
        const fileResults: string[] = []
        let fileCount = 0
        
        for (const [uri, diagnostics] of allDiagnostics) {
            // 检查文件数量限制
            if (diagnosticsConfig.maxFiles !== -1 && fileCount >= diagnosticsConfig.maxFiles) {
                break
            }
            
            // 检查是否在工作区内
            if (diagnosticsConfig.workspaceOnly) {
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri)
                if (!workspaceFolder) {
                    continue
                }
            }
            
            // 如果只显示打开文件的诊断
            if (diagnosticsConfig.openFilesOnly && !openFileUris.has(uri.toString())) {
                continue
            }
            
            // 过滤诊断信息
            const filteredDiagnostics = diagnostics
                .filter(d => {
                    const severity = severityMap[d.severity]
                    return diagnosticsConfig.includeSeverities.includes(severity)
                })
                .slice(0, diagnosticsConfig.maxDiagnosticsPerFile === -1 ? undefined : diagnosticsConfig.maxDiagnosticsPerFile)
            
            if (filteredDiagnostics.length > 0) {
                const relativePath = vscode.workspace.asRelativePath(uri, false)
                const lines: string[] = []
                
                for (const d of filteredDiagnostics) {
                    const severity = severityMap[d.severity]
                    const severityLabel = severityLabels[severity]
                    const line = d.range.start.line + 1 // 转为 1-based 行号
                    const source = d.source ? ` (${d.source})` : ''
                    lines.push(`  Line ${line}: [${severityLabel}] ${d.message}${source}`)
                }
                
                fileResults.push(`${relativePath}:\n${lines.join('\n')}`)
                fileCount++
            }
        }
        
        if (fileResults.length === 0) {
            return ''
        }
        
        return `The following diagnostics were found in the workspace:\n\n${fileResults.join('\n\n')}`
    }
    
    /**
     * 生成固定文件内容段落
     *
     * 按工作区过滤固定文件，支持多工作区场景
     */
    private generatePinnedFilesSection(): string {
        const settingsManager = getGlobalSettingsManager()
        if (!settingsManager) {
            return ''
        }
        
        const workspaceFolders = vscode.workspace.workspaceFolders
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return ''
        }
        
        const results: string[] = []
        
        // 遍历所有工作区，获取每个工作区的固定文件
        for (const workspaceFolder of workspaceFolders) {
            const workspaceUri = workspaceFolder.uri.toString()
            const pinnedFiles = settingsManager.getEnabledPinnedFilesForWorkspace(workspaceUri)
            
            for (const pinnedFile of pinnedFiles) {
                try {
                    let filePath = pinnedFile.path
                    let fullPath: string
                    
                    // 判断是相对路径还是绝对路径
                    if (path.isAbsolute(filePath)) {
                        fullPath = filePath
                    } else {
                        // 相对路径，基于当前工作区根目录
                        fullPath = path.join(workspaceFolder.uri.fsPath, filePath)
                    }
                    
                    // 检查文件是否存在
                    if (!fs.existsSync(fullPath)) {
                        // 文件不存在时不添加到结果，也不报错
                        // 这样文件被删除后不会影响 AI 响应
                        continue
                    }
                    
                    // 读取文件内容
                    const content = fs.readFileSync(fullPath, 'utf-8')
                    
                    // 多工作区时显示工作区名称前缀
                    const displayPath = workspaceFolders.length > 1
                        ? `${workspaceFolder.name}/${pinnedFile.path}`
                        : pinnedFile.path
                    
                    // 添加到结果
                    results.push(`--- ${displayPath} ---\n${content}`)
                } catch (error: any) {
                    // 读取错误时静默跳过
                    console.warn(`Failed to read pinned file ${pinnedFile.path}:`, error.message)
                }
            }
        }
        
        if (results.length === 0) {
            return ''
        }
        
        return `The following are pinned files that should be read and considered for every response:\n\n${results.join('\n\n')}`
    }
    
    /**
     * 生成 Skills 内容段落
     *
     * 获取当前启用的 skills 内容
     */
    private generateSkillsSection(): string {
        const skillsManager = getSkillsManager()
        if (!skillsManager) {
            return ''
        }
        
        const skillsContent = skillsManager.getEnabledSkillsContent()
        if (!skillsContent) {
            return ''
        }
        
        return `The following skills are currently active and provide specialized knowledge and instructions:\n\n${skillsContent}`
    }
    
    /**
     * 检查路径是否应该被忽略
     */
    private shouldIgnorePath(relativePath: string, ignorePatterns: string[]): boolean {
        for (const pattern of ignorePatterns) {
            if (this.matchGlobPattern(relativePath, pattern)) {
                return true
            }
        }
        return false
    }
    
    /**
     * 简单的 glob 模式匹配
     */
    private matchGlobPattern(path: string, pattern: string): boolean {
        const regexPattern = pattern
            .replace(/\\/g, '/')
            .replace(/\./g, '\\.')
            .replace(/\*\*/g, '<<<GLOBSTAR>>>')
            .replace(/\*/g, '[^/]*')
            .replace(/<<<GLOBSTAR>>>/g, '.*')
            .replace(/\//g, '[/\\\\]')
        
        const regex = new RegExp(`^${regexPattern}$|[/\\\\]${regexPattern}$|^${regexPattern}[/\\\\]|[/\\\\]${regexPattern}[/\\\\]`, 'i')
        return regex.test(path.replace(/\\/g, '/'))
    }
    
    /**
     * 获取上下文信息
     */
    private getContext(): PromptContext {
        const now = new Date()
        
        return {
            workspaceRoot: getWorkspaceRoot(),
            currentTime: now.toISOString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            os: this.getOSInfo()
        }
    }
    
    /**
     * 获取操作系统信息
     */
    private getOSInfo(): string {
        const platform = os.platform()
        const release = os.release()
        
        switch (platform) {
            case 'win32':
                return `Windows ${release}`
            case 'darwin':
                return `macOS ${release}`
            case 'linux':
                return `Linux ${release}`
            default:
                return `${platform} ${release}`
        }
    }
    
    /**
     * 检查是否需要刷新（用于首条消息判断）
     * 
     * @param isFirstMessage 是否是对话的第一条用户消息
     * @returns 是否需要刷新系统提示词
     */
    shouldRefresh(isFirstMessage: boolean): boolean {
        return isFirstMessage
    }
}

// 导出单例创建函数
let globalPromptManager: PromptManager | null = null

export function getPromptManager(): PromptManager {
    if (!globalPromptManager) {
        globalPromptManager = new PromptManager()
    }
    return globalPromptManager
}

export function setPromptManager(manager: PromptManager): void {
    globalPromptManager = manager
}