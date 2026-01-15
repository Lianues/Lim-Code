/**
 * LimCode - Skills 管理器
 *
 * 负责扫描、解析和管理所有 skills
 * Skills 存储在应用配置目录的 skills 文件夹中
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Skill, SkillFrontmatter, SkillsChangeEvent, SkillsChangeListener } from './types';

/**
 * Skills 管理器
 *
 * 功能：
 * 1. 扫描 skills 目录
 * 2. 解析 SKILL.md 文件（frontmatter + 正文）
 * 3. 管理 skill 的启用/禁用状态
 * 4. 提供 skill 内容给动态提示词
 */
export class SkillsManager {
    /** 所有已加载的 skills */
    private skills: Map<string, Skill> = new Map();
    
    /** 已启用的 skill IDs */
    private enabledSkillIds: Set<string> = new Set();
    
    /** 需要发送内容的 skill IDs */
    private sendContentSkillIds: Set<string> = new Set();
    
    /** 变更监听器 */
    private listeners: Set<SkillsChangeListener> = new Set();
    
    /** Skills 目录路径 */
    private skillsDir: string;
    
    /** 是否已初始化 */
    private initialized: boolean = false;
    
    constructor(basePath: string) {
        this.skillsDir = path.join(basePath, 'skills');
    }
    
    /**
     * 初始化 Skills 管理器
     *
     * 确保目录存在并扫描所有 skills
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }
        
        // 确保 skills 目录存在
        await this.ensureSkillsDirectory();
        
        // 扫描并加载所有 skills
        await this.refresh();
        
        this.initialized = true;
    }
    
    /**
     * 确保 skills 目录存在
     */
    private async ensureSkillsDirectory(): Promise<void> {
        try {
            await fs.promises.mkdir(this.skillsDir, { recursive: true });
        } catch (error) {
            console.error('[SkillsManager] Failed to create skills directory:', error);
        }
    }
    
    /**
     * 创建示例 skill（如果不存在）
     */
    private async createExampleSkillIfNotExists(): Promise<void> {
        const exampleDir = path.join(this.skillsDir, 'example-skill');
        const exampleFile = path.join(exampleDir, 'SKILL.md');
        
        // 检查示例 skill 是否已存在
        if (fs.existsSync(exampleFile)) {
            return;
        }
        
        try {
            await fs.promises.mkdir(exampleDir, { recursive: true });
            
            const exampleContent = `---
name: example-skill
description: "This is an example skill demonstrating the skill format. Enable this skill to learn how to create your own skills."
---

# Example Skill

## Overview

This is an example skill file that demonstrates the proper format for creating skills.

## Instructions

1. Create a new folder in the \`skills\` directory with your skill name
2. Create a \`SKILL.md\` file inside that folder
3. Add frontmatter with \`name\` and \`description\` fields
4. Add your skill content after the frontmatter

## Skill Format

\`\`\`markdown
---
name: your-skill-name
description: "Brief description of what this skill does and when to use it"
---

# Your Skill Name

## Instructions
[Clear, step-by-step guidance for the AI to follow]

## Examples
[Specific examples of using this skill]
\`\`\`

## Required Fields

- **name**: The skill identifier (should be unique)
- **description**: A brief description shown in the toggle_skills tool

## How Skills Work

1. Skills are stored in the \`skills\` folder under the extension's data directory
2. Each skill has its own subfolder containing a \`SKILL.md\` file
3. The AI can enable/disable skills using the \`toggle_skills\` tool
4. When enabled, the skill content is injected into the dynamic context

## Example Use Cases

- Programming language best practices
- Framework-specific guidance
- Domain knowledge (e.g., materials science, data analysis)
- Project-specific conventions
- Code style guidelines
`;
            
            await fs.promises.writeFile(exampleFile, exampleContent, 'utf-8');
            console.log('[SkillsManager] Created example skill');
        } catch (error) {
            console.warn('[SkillsManager] Failed to create example skill:', error);
        }
    }
    
    /**
     * 获取 skills 目录路径
     */
    getSkillsDirectory(): string {
        return this.skillsDir;
    }
    
    /**
     * 刷新 skills 列表
     *
     * 重新扫描目录并加载所有 skills
     */
    async refresh(): Promise<void> {
        this.skills.clear();
        
        try {
            // 检查目录是否存在
            const exists = fs.existsSync(this.skillsDir);
            if (!exists) {
                return;
            }
            
            // 读取 skills 目录
            const entries = await fs.promises.readdir(this.skillsDir, { withFileTypes: true });
            
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const skillPath = path.join(this.skillsDir, entry.name, 'SKILL.md');
                    
                    // 检查 SKILL.md 是否存在
                    if (fs.existsSync(skillPath)) {
                        try {
                            const skill = await this.loadSkill(entry.name, skillPath);
                            if (skill) {
                                this.skills.set(skill.id, skill);
                            }
                        } catch (error) {
                            console.warn(`[SkillsManager] Failed to load skill ${entry.name}:`, error);
                        }
                    }
                }
            }
            
            // 通知监听器
            this.notifyChange({
                type: 'refresh',
                skillIds: Array.from(this.skills.keys())
            });
            
        } catch (error) {
            console.error('[SkillsManager] Failed to refresh skills:', error);
        }
    }
    
    /**
     * 加载单个 skill
     *
     * @param id Skill ID（文件夹名称）
     * @param filePath SKILL.md 文件路径
     */
    private async loadSkill(id: string, filePath: string): Promise<Skill | null> {
        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            const { frontmatter, body } = this.parseFrontmatter(content);
            
            if (!frontmatter.name || !frontmatter.description) {
                console.warn(`[SkillsManager] Skill ${id} missing required frontmatter fields`);
                return null;
            }
            
            return {
                id,
                name: frontmatter.name,
                description: frontmatter.description,
                content: body.trim(),
                path: filePath,
                enabled: this.enabledSkillIds.has(id),
                sendContent: this.sendContentSkillIds.has(id)
            };
        } catch (error) {
            console.error(`[SkillsManager] Failed to load skill ${id}:`, error);
            return null;
        }
    }
    
    /**
     * 解析 frontmatter
     *
     * 支持 YAML frontmatter 格式：
     * ---
     * name: skill-name
     * description: skill description
     * ---
     */
    private parseFrontmatter(content: string): { frontmatter: Partial<SkillFrontmatter>; body: string } {
        const frontmatter: Partial<SkillFrontmatter> = {};
        let body = content;
        
        // 检查是否以 --- 开头
        if (content.startsWith('---')) {
            const endIndex = content.indexOf('---', 3);
            if (endIndex !== -1) {
                const frontmatterContent = content.substring(3, endIndex).trim();
                body = content.substring(endIndex + 3).trim();
                
                // 简单解析 YAML（只支持简单的 key: value 格式）
                const lines = frontmatterContent.split('\n');
                for (const line of lines) {
                    const colonIndex = line.indexOf(':');
                    if (colonIndex !== -1) {
                        const key = line.substring(0, colonIndex).trim();
                        let value = line.substring(colonIndex + 1).trim();
                        
                        // 移除引号
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
     * 获取所有 skills
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
            
            // 更新 skill 对象的 enabled 状态
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
            
            // 更新 skill 对象的 enabled 状态
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
     *
     * @param skillStates skill ID 到启用状态的映射
     */
    setSkillsState(skillStates: Record<string, boolean>): void {
        const enabledIds: string[] = [];
        const disabledIds: string[] = [];
        
        for (const [id, enabled] of Object.entries(skillStates)) {
            if (!this.skills.has(id)) {
                continue;
            }
            
            const currentlyEnabled = this.enabledSkillIds.has(id);
            
            if (enabled && !currentlyEnabled) {
                this.enabledSkillIds.add(id);
                const skill = this.skills.get(id);
                if (skill) skill.enabled = true;
                enabledIds.push(id);
            } else if (!enabled && currentlyEnabled) {
                this.enabledSkillIds.delete(id);
                const skill = this.skills.get(id);
                if (skill) skill.enabled = false;
                disabledIds.push(id);
            }
        }
        
        // 通知变更
        if (enabledIds.length > 0) {
            this.notifyChange({ type: 'enabled', skillIds: enabledIds });
        }
        if (disabledIds.length > 0) {
            this.notifyChange({ type: 'disabled', skillIds: disabledIds });
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
     * 设置 skill 是否发送内容
     *
     * @param id Skill ID
     * @param sendContent 是否发送内容
     */
    setSkillSendContent(id: string, sendContent: boolean): void {
        const skill = this.skills.get(id);
        if (!skill) {
            return;
        }
        
        if (sendContent) {
            this.sendContentSkillIds.add(id);
            skill.sendContent = true;
        } else {
            this.sendContentSkillIds.delete(id);
            skill.sendContent = false;
        }
        
        // Notify change
        this.notifyChange({ type: 'enabled', skillIds: [id] });
    }
    
    /**
     * 获取已启用且需要发送内容的 skills 内容（用于动态提示词）
     *
     * @returns 格式化的 skills 内容
     */
    getEnabledSkillsContent(): string {
        // 只返回 enabled 且 sendContent 为 true 的 skills
        const skillsToSend = this.getAllSkills().filter(s => s.enabled && s.sendContent);
        
        if (skillsToSend.length === 0) {
            return '';
        }
        
        const sections: string[] = [];
        
        for (const skill of skillsToSend) {
            // 使用明确的分隔符和名称标识
            sections.push(`===== SKILL: ${skill.name} =====\n\n${skill.content}\n\n===== END: ${skill.name} =====`);
        }
        
        return sections.join('\n\n');
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
 * @param basePath 基础存储路径（通常是 globalStorageUri.fsPath）
 */
export async function createSkillsManager(basePath: string): Promise<SkillsManager> {
    const manager = new SkillsManager(basePath);
    await manager.initialize();
    setSkillsManager(manager);
    return manager;
}
