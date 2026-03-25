/**
 * LimCode - Skills 管理器
 *
 * 负责扫描、解析和管理所有 skills
 * Skills 现在支持从多个目录加载，包括项目级和用户级。
 * 不再使用拼接注入模式，AI 按需通过工具读取 Skill 内容。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { t } from '../../i18n';
import { getActualLanguage } from '../../i18n/index';
import type { Skill, SkillFrontmatter, SkillsChangeEvent, SkillsChangeListener, SkillSource } from './types';

/**
 * Skills 管理器
 *
 * 功能：
 * 1. 扫描多个 skills 目录（项目级和用户级）
 * 2. 解析 SKILL.md 文件（frontmatter + 正文），带校验
 * 3. 管理 skill 的启用/禁用状态
 * 4. 提供已启用 Skill 的摘要给 read_skill 工具
 * 5. 根据名称查找并返回 Skill 详情
 */
export class SkillsManager {
    /** 所有已加载的 skills (id -> Skill) */
    private skills: Map<string, Skill> = new Map();
    
    /** 已启用的 skill IDs */
    private enabledSkillIds: Set<string> = new Set();
    
    /** 变更监听器 */
    private listeners: Set<SkillsChangeListener> = new Set();
    
    /** 待扫描的目录列表及来源 */
    private scanDirs: Array<{ path: string; source: SkillSource }> = [];

    /** Legacy 目录（存放示例技能等） */
    private legacySkillsDir: string;
    
    /** 是否已初始化 */
    private initialized: boolean = false;
    
    constructor(options: { workspacePath?: string; globalStoragePath: string }) {
        this.legacySkillsDir = path.join(options.globalStoragePath, 'skills');
        this.buildScanDirs(options);
    }

    /**
     * 构建待扫描的目录列表
     * 按优先级排序（先扫到的优先）
     */
    private buildScanDirs(options: { workspacePath?: string; globalStoragePath: string }) {
        // 1. 项目级目录 (优先级最高)
        if (options.workspacePath) {
            this.scanDirs.push({ 
                path: path.join(options.workspacePath, '.limcode', 'skills'), 
                source: 'project-limcode' 
            });
            this.scanDirs.push({ 
                path: path.join(options.workspacePath, '.agents', 'skills'), 
                source: 'project-agents' 
            });
        }

        // 2. Legacy 目录 (原有插件存储目录)
        this.scanDirs.push({ 
            path: this.legacySkillsDir, 
            source: 'legacy' 
        });

        // 3. 用户全局目录
        this.scanDirs.push({ 
            path: path.join(os.homedir(), '.limcode', 'skills'), 
            source: 'user-limcode' 
        });
        this.scanDirs.push({ 
            path: path.join(os.homedir(), '.agents', 'skills'), 
            source: 'user-agents' 
        });
    }
    
    /**
     * 初始化 Skills 管理器
     *
     * 确保 Legacy 目录存在并扫描所有 skills
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }
        
        // 确保 legacy 目录存在
        await this.ensureSkillsDirectory();
        
        // 创建示例 skill (在 legacy 目录)
        await this.createExampleSkillIfNotExists();
        
        // 扫描并加载所有 skills
        await this.refresh();
        
        this.initialized = true;
    }
    
    /**
     * 确保 legacy skills 目录存在
     */
    private async ensureSkillsDirectory(): Promise<void> {
        try {
            await fs.promises.mkdir(this.legacySkillsDir, { recursive: true });
        } catch (error) {
            console.error('[SkillsManager] Failed to create legacy skills directory:', error);
        }
    }
    
    /**
     * 创建示例 skill（如果不存在）
     */
    private async createExampleSkillIfNotExists(): Promise<void> {
        // 文件夹名改为 how-to-create-skill，内容突出注意事项和常见错误
        const exampleDir = path.join(this.legacySkillsDir, 'how-to-create-skill');
        const exampleFile = path.join(exampleDir, 'SKILL.md');
        
        // 兼容旧版本：如果旧文件夹已存在，也跳过创建
        const legacyExampleDir = path.join(this.legacySkillsDir, 'example-skill', 'SKILL.md');
        const legacyChineseDir = path.join(this.legacySkillsDir, '示例技能', 'SKILL.md');        
        if (fs.existsSync(exampleFile) || fs.existsSync(legacyExampleDir) || fs.existsSync(legacyChineseDir)) {
            return;
        }
        
        try {
            await fs.promises.mkdir(exampleDir, { recursive: true });
            
            // 从 i18n 获取本地化的描述和内容
            const description = t('tools.skills.exampleSkill.description');
            const content = t('tools.skills.exampleSkill.content');
            
            const exampleContent = `---
name: how-to-create-skill
description: "${description}"
---

${content}
`;
            
            const lang = getActualLanguage();
            await fs.promises.writeFile(exampleFile, exampleContent, 'utf-8');
            console.log(`[SkillsManager] Created example skill (${lang})`);
        } catch (error) {
            console.warn('[SkillsManager] Failed to create example skill:', error);
        }
    }
    
    /**
     * 获取第一个用户级目录路径（用于打开目录功能）
     */
    getSkillsDirectory(): string {
        const userDir = this.scanDirs.find(d => d.source === 'user-limcode');
        return userDir ? userDir.path : this.legacySkillsDir;
    }
    
    /**
     * 刷新 skills 列表
     *
     * 重新扫描所有配置的目录并加载 skills
     */
    async refresh(): Promise<void> {
        this.skills.clear();
        
        for (const dirInfo of this.scanDirs) {
            await this.scanDirectory(dirInfo.path, dirInfo.source);
        }
        
        // 通知监听器
        this.notifyChange({
            type: 'refresh',
            skillIds: Array.from(this.skills.keys())
        });
    }

    /**
     * 扫描单个目录并加载 skills
     */
    private async scanDirectory(dirPath: string, source: SkillSource): Promise<void> {
        try {
            if (!fs.existsSync(dirPath)) {
                return;
            }
            
            const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
            
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    // 如果已存在同名 Skill (id 相同)，由于 scanDirs 顺序决定了优先级，后扫到的跳过
                    if (this.skills.has(entry.name)) {
                        continue;
                    }

                    const skillFile = path.join(dirPath, entry.name, 'SKILL.md');
                    if (fs.existsSync(skillFile)) {
                        try {
                            const skill = await this.loadSkill(entry.name, skillFile, source);
                            if (skill) {
                                this.skills.set(skill.id, skill);
                            }
                        } catch (error) {
                            console.warn(`[SkillsManager] Failed to load skill ${entry.name} from ${source}:`, error);
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`[SkillsManager] Failed to scan directory ${dirPath}:`, error);
        }
    }
    
    /**
     * 加载单个 skill
     *
     * @param id Skill ID（文件夹名称）
     * @param filePath SKILL.md 文件路径
     * @param source 来源
     */
    private async loadSkill(id: string, filePath: string, source: SkillSource): Promise<Skill | null> {
        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            const { frontmatter, body } = this.parseFrontmatter(content);
            
            if (!frontmatter.name || !frontmatter.description) {
                console.warn(`[SkillsManager] Skill ${id} missing required frontmatter fields`);
                return null;
            }

            // 新增：frontmatter 中的 name 必须与 id (文件夹名) 一致
            if (frontmatter.name !== id) {
                console.warn(`[SkillsManager] Skill ${id} name mismatch: frontmatter name "${frontmatter.name}" does not match folder name "${id}". Skipping.`);
                return null;
            }

            // 新增：name 格式校验
            const nameRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
            if (!nameRegex.test(frontmatter.name) || frontmatter.name.length > 64 || frontmatter.name.includes('--')) {
                console.warn(`[SkillsManager] Skill ${id} name "${frontmatter.name}" is invalid. Must be 1-64 chars, lowercase, digits, and hyphens only, no consecutive hyphens. Skipping.`);
                return null;
            }
            
            return {
                id,
                name: frontmatter.name,
                description: frontmatter.description,
                content: body.trim(),
                path: filePath,
                basePath: path.dirname(filePath),
                source,
                enabled: this.enabledSkillIds.has(id),
                sendContent: false // Deprecated 模式下不再使用拼接
            };
        } catch (error) {
            console.error(`[SkillsManager] Failed to load skill ${id}:`, error);
            return null;
        }
    }
    
    /**
     * 解析 frontmatter
     */
    private parseFrontmatter(content: string): { frontmatter: Partial<SkillFrontmatter>; body: string } {
        const frontmatter: Partial<SkillFrontmatter> = {};
        let body = content;
        
        if (content.startsWith('---')) {
            const endIndex = content.indexOf('---', 3);
            if (endIndex !== -1) {
                const frontmatterContent = content.substring(3, endIndex).trim();
                body = content.substring(endIndex + 3).trim();
                
                const lines = frontmatterContent.split('\n');
                for (const line of lines) {
                    const colonIndex = line.indexOf(':');
                    if (colonIndex !== -1) {
                        const key = line.substring(0, colonIndex).trim();
                        let value = line.substring(colonIndex + 1).trim();
                        
                        if ((value.startsWith('"') && value.endsWith('"')) ||
                            (value.startsWith("'") && value.endsWith("'"))) {
                            value = value.slice(1, -1);
                        }
                        
                        if (key === 'name') {
                            frontmatter.name = value;
                        } else if (key === 'description') {
                            frontmatter.description = value;
                        }
                    }
                }
            }
        }
        
        return { frontmatter, body };
    }
    
    /**
     * 获取所有已加载的 skills
     */
    getAllSkills(): Skill[] {
        return Array.from(this.skills.values());
    }
    
    /**
     * 获取指定 skill
     */
    getSkill(id: string): Skill | undefined {
        return this.skills.get(id);
    }

    /**
     * 按名称获取 Skill (用于 read_skill 工具)
     * 注意：AI 可能在知道已禁用的情况下尝试读取，我们需要返回对象以便 read_skill 处理提示语。
     */
    getSkillByName(name: string): Skill | undefined {
        return Array.from(this.skills.values()).find(s => s.name === name);
    }

    /**
     * 获取所有已启用 Skill 的摘要信息
     */
    getSkillSummaries(): Array<{ name: string; description: string }> {
        return this.getEnabledSkills().map(s => ({ 
            name: s.name, 
            description: s.description 
        }));
    }
    
    /**
     * 获取已启用的 skills
     */
    getEnabledSkills(): Skill[] {
        return Array.from(this.skills.values()).filter(skill => this.enabledSkillIds.has(skill.id));
    }
    
    /**
     * 检查 skill 是否启用
     */
    isSkillEnabled(id: string): boolean {
        return this.enabledSkillIds.has(id);
    }
    
    /**
     * 启用 skill
     */
    enableSkill(id: string): boolean {
        if (!this.skills.has(id)) {
            return false;
        }
        
        if (!this.enabledSkillIds.has(id)) {
            this.enabledSkillIds.add(id);
            
            const skill = this.skills.get(id);
            if (skill) {
                skill.enabled = true;
            }
            
            this.notifyChange({
                type: 'enabled',
                skillIds: [id]
            });
        }
        
        return true;
    }
    
    /**
     * 禁用 skill
     */
    disableSkill(id: string): boolean {
        if (this.enabledSkillIds.has(id)) {
            this.enabledSkillIds.delete(id);
            
            const skill = this.skills.get(id);
            if (skill) {
                skill.enabled = false;
            }
            
            this.notifyChange({
                type: 'disabled',
                skillIds: [id]
            });
            
            return true;
        }
        
        return false;
    }
    
    /**
     * 批量设置 skills 状态
     */
    setSkillsState(skillStates: Record<string, boolean>): void {
        const changedIds: string[] = [];
        
        for (const [id, enabled] of Object.entries(skillStates)) {
            if (!this.skills.has(id)) {
                continue;
            }
            
            const currentlyEnabled = this.enabledSkillIds.has(id);
            
            if (enabled && !currentlyEnabled) {
                this.enabledSkillIds.add(id);
                const skill = this.skills.get(id);
                if (skill) skill.enabled = true;
                changedIds.push(id);
            } else if (!enabled && currentlyEnabled) {
                this.enabledSkillIds.delete(id);
                const skill = this.skills.get(id);
                if (skill) skill.enabled = false;
                changedIds.push(id);
            }
        }
        
        if (changedIds.length > 0) {
            this.notifyChange({ type: 'update', skillIds: changedIds });
        }
    }
    
    /**
     * 禁用所有 skills
     */
    disableAllSkills(): void {
        const disabledIds = Array.from(this.enabledSkillIds);
        
        for (const id of disabledIds) {
            const skill = this.skills.get(id);
            if (skill) {
                skill.enabled = false;
            }
        }
        
        this.enabledSkillIds.clear();
        
        if (disabledIds.length > 0) {
            this.notifyChange({ type: 'disabled', skillIds: disabledIds });
        }
    }
    
    /**
     * 添加变更监听器
     */
    addChangeListener(listener: SkillsChangeListener): void {
        this.listeners.add(listener);
    }
    
    /**
     * 移除变更监听器
     */
    removeChangeListener(listener: SkillsChangeListener): void {
        this.listeners.delete(listener);
    }
    
    /**
     * 通知变更
     */
    private notifyChange(event: SkillsChangeEvent): void {
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch (error) {
                console.error('[SkillsManager] Listener error:', error);
            }
        }
    }
    
    /**
     * 获取 skills 数量
     */
    getSkillsCount(): number {
        return this.skills.size;
    }
    
    /**
     * 获取启用的 skills 数量
     */
    getEnabledSkillsCount(): number {
        return this.enabledSkillIds.size;
    }
    
    /**
     * 释放资源
     */
    dispose(): void {
        this.listeners.clear();
    }
}

// 全局实例
let globalSkillsManager: SkillsManager | null = null;

/**
 * 获取全局 SkillsManager 实例
 */
export function getSkillsManager(): SkillsManager | null {
    return globalSkillsManager;
}

/**
 * 设置全局 SkillsManager 实例
 */
export function setSkillsManager(manager: SkillsManager): void {
    globalSkillsManager = manager;
}

/**
 * 创建并初始化 SkillsManager
 *
 * @param options 初始化选项，包含工作区路径和全局存储路径
 */
export async function createSkillsManager(options: {
    workspacePath?: string;
    globalStoragePath: string;
}): Promise<SkillsManager> {
    const manager = new SkillsManager(options);
    await manager.initialize();
    setSkillsManager(manager);
    return manager;
}
