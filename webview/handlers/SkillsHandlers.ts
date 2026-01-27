/**
 * Skills 消息处理器
 */

import * as vscode from 'vscode';
import { t } from '../../backend/i18n';
import type { MessageHandler } from '../types';
import { getSkillsManager } from '../../backend/modules/skills';
import type { SkillConfigItem } from '../../backend/modules/settings/types';

// ========== Skills 类型 ==========

export interface SkillItem {
    id: string;
    name: string;
    description: string;
    enabled: boolean;          // 是否在当前对话中启用
    sendContent: boolean;      // 是否发送具体内容给 AI
    exists?: boolean;          // skill 是否存在
}

export interface SkillsConfigResponse {
    skills: SkillItem[];
}

// ========== Skills 管理 ==========

/**
 * 获取所有 skills 列表
 */
export const getSkillsConfig: MessageHandler = async (data, requestId, ctx) => {
    try {
        const skillsManager = getSkillsManager();
        
        if (!skillsManager) {
            ctx.sendResponse(requestId, { skills: [] });
            return;
        }
        
        // 从 settingsManager 获取持久化的 skills 配置
        const savedConfig = ctx.settingsManager.getSkillsConfig() || { skills: [] };
        const savedSkillsMap = new Map<string, { enabled: boolean; sendContent: boolean }>();
        for (const skill of savedConfig.skills) {
            savedSkillsMap.set(skill.id, { enabled: skill.enabled, sendContent: skill.sendContent });
        }
        
        // 获取所有 skills 并合并持久化配置
        const allSkills = skillsManager.getAllSkills();
        const skills: SkillItem[] = allSkills.map(skill => {
            const saved = savedSkillsMap.get(skill.id);
            const enabled = saved?.enabled ?? true;          // 默认启用
            const sendContent = saved?.sendContent ?? true;  // 默认发送内容
            
            // 同步状态到 SkillsManager
            if (enabled) {
                skillsManager.enableSkill(skill.id);
            } else {
                skillsManager.disableSkill(skill.id);
            }
            skillsManager.setSkillSendContent(skill.id, sendContent);
            
            return {
                id: skill.id,
                name: skill.name,
                description: skill.description,
                enabled,
                sendContent,
                exists: true
            };
        });

        // 将最新的元数据（名称、描述）同步回 SettingsManager，确保 settings.json 中不再是空的
        // 同时保留那些在配置中存在但目前不在磁盘上的 skill，避免被误删
        const finalSkillsToSync: SkillConfigItem[] = [];
        
        // 1. 添加当前存在的 skills
        for (const s of skills) {
            if (s.exists) {
                finalSkillsToSync.push({
                    id: s.id,
                    name: s.name,
                    description: s.description,
                    enabled: s.enabled,
                    sendContent: s.sendContent
                });
            }
        }
        
        // 2. 补充配置中存在但磁盘上缺失的 skills（保留其原样）
        for (const savedSkill of savedConfig.skills) {
            if (!finalSkillsToSync.some(s => s.id === savedSkill.id)) {
                finalSkillsToSync.push(savedSkill);
            }
        }
        
        if (finalSkillsToSync.length > 0) {
            // 批量更新配置，确保元数据得到同步
            await ctx.settingsManager.updateSkillsConfig({ skills: finalSkillsToSync });
        }
        
        // 检查已保存但不再存在的 skills (保留它们在 UI 显示为已丢失)
        for (const savedSkill of savedConfig.skills) {
            if (!allSkills.find(s => s.id === savedSkill.id)) {
                skills.push({
                    id: savedSkill.id,
                    name: savedSkill.name,
                    description: savedSkill.description,
                    enabled: savedSkill.enabled,
                    sendContent: savedSkill.sendContent,
                    exists: false
                });
            }
        }
        
        ctx.sendResponse(requestId, { skills });
    } catch (error: any) {
        ctx.sendError(requestId, 'GET_SKILLS_CONFIG_ERROR', error.message || 'Failed to get skills config');
    }
};

/**
 * 检查 skills 是否存在
 */
export const checkSkillsExistence: MessageHandler = async (data, requestId, ctx) => {
    try {
        const { skills } = data;
        const skillsManager = getSkillsManager();
        
        if (!skillsManager || !skills) {
            ctx.sendResponse(requestId, { skills: [] });
            return;
        }
        
        const skillsWithExistence = skills.map((skill: { id: string }) => {
            const exists = skillsManager.getSkill(skill.id) !== undefined;
            return { id: skill.id, exists };
        });
        
        ctx.sendResponse(requestId, { skills: skillsWithExistence });
    } catch (error: any) {
        ctx.sendError(requestId, 'CHECK_SKILLS_EXISTENCE_ERROR', error.message || 'Failed to check skills existence');
    }
};

/**
 * 更新 skill 的启用状态
 */
export const setSkillEnabled: MessageHandler = async (data, requestId, ctx) => {
    try {
        const { id, enabled } = data;
        
        // 获取实时元数据（名称、描述）
        const skillsManager = getSkillsManager();
        const skill = skillsManager?.getSkill(id);
        
        // 保存到持久化配置（带上最新的名称和描述）
        await ctx.settingsManager.setSkillEnabled(id, enabled, {
            name: skill?.name,
            description: skill?.description
        });
        
        // 同步到 SkillsManager
        if (skillsManager) {
            if (enabled) {
                skillsManager.enableSkill(id);
            } else {
                skillsManager.disableSkill(id);
            }
        }
        
        ctx.sendResponse(requestId, { success: true });
    } catch (error: any) {
        ctx.sendError(requestId, 'SET_SKILL_ENABLED_ERROR', error.message || 'Failed to set skill enabled');
    }
};

/**
 * 更新 skill 的发送内容状态
 */
export const setSkillSendContent: MessageHandler = async (data, requestId, ctx) => {
    try {
        const { id, sendContent } = data;
        
        // 获取实时元数据（名称、描述）
        const skillsManager = getSkillsManager();
        const skill = skillsManager?.getSkill(id);
        
        // 保存到持久化配置（带上最新的名称和描述）
        await ctx.settingsManager.setSkillSendContent(id, sendContent, {
            name: skill?.name,
            description: skill?.description
        });
        
        // 同步到 SkillsManager
        if (skillsManager) {
            skillsManager.setSkillSendContent(id, sendContent);
        }
        
        ctx.sendResponse(requestId, { success: true });
    } catch (error: any) {
        ctx.sendError(requestId, 'SET_SKILL_SEND_CONTENT_ERROR', error.message || 'Failed to set skill send content');
    }
};

/**
 * 移除不存在的 skill 配置
 */
export const removeSkillConfig: MessageHandler = async (data, requestId, ctx) => {
    try{
        const { id } = data;
        await ctx.settingsManager.removeSkillConfig(id);
        ctx.sendResponse(requestId, { success: true });
    } catch (error: any) {
        ctx.sendError(requestId, 'REMOVE_SKILL_CONFIG_ERROR', error.message || 'Failed to remove skill config');
    }
};

/**
 * 刷新 skills 列表
 */
export const refreshSkills: MessageHandler = async (data, requestId, ctx) => {
    try {
        const skillsManager = getSkillsManager();
        
        if (skillsManager) {
            await skillsManager.refresh();
        }
        
        ctx.sendResponse(requestId, { success: true });
    } catch (error: any) {
        ctx.sendError(requestId, 'REFRESH_SKILLS_ERROR', error.message || 'Failed to refresh skills');
    }
};

/**
 * 获取 skills 目录路径
 */
export const getSkillsDirectory: MessageHandler = async (data, requestId, ctx) => {
    try {
        const skillsManager = getSkillsManager();
        
        if (skillsManager) {
            ctx.sendResponse(requestId, { path: skillsManager.getSkillsDirectory() });
        } else {
            ctx.sendResponse(requestId, { path: null });
        }
    } catch (error: any) {
        ctx.sendError(requestId, 'GET_SKILLS_DIRECTORY_ERROR', error.message || 'Failed to get skills directory');
    }
};

/**
 * 打开目录
 */
export const openDirectory: MessageHandler = async (data, requestId, ctx) => {
    try {
        const { path: dirPath } = data;
        if (dirPath) {
            const uri = vscode.Uri.file(dirPath);
            // 使用 openExternal 直接打开文件夹内部
            await vscode.env.openExternal(uri);
        }
        ctx.sendResponse(requestId, { success: true });
    } catch (error: any) {
        ctx.sendError(requestId, 'OPEN_DIRECTORY_ERROR', error.message || 'Failed to open directory');
    }
};

/**
 * 注册 Skills 处理器
 */
export function registerSkillsHandlers(registry: Map<string, MessageHandler>): void {
    registry.set('getSkillsConfig', getSkillsConfig);
    registry.set('checkSkillsExistence', checkSkillsExistence);
    registry.set('setSkillEnabled', setSkillEnabled);
    registry.set('setSkillSendContent', setSkillSendContent);
    registry.set('removeSkillConfig', removeSkillConfig);
    registry.set('refreshSkills', refreshSkills);
    registry.set('getSkillsDirectory', getSkillsDirectory);
    registry.set('openDirectory', openDirectory);
}
