/**
 * Skills 消息处理器
 */

import * as vscode from 'vscode';
import { t } from '../../backend/i18n';
import type { MessageHandler } from '../types';
import { getSkillsManager } from '../../backend/modules/skills';

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
        
        // 检查已保存但不再存在的 skills
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
        
        // 保存到持久化配置
        await ctx.settingsManager.setSkillEnabled(id, enabled);
        
        // 同步到 SkillsManager
        const skillsManager = getSkillsManager();
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
        
        // 保存到持久化配置
        await ctx.settingsManager.setSkillSendContent(id, sendContent);
        
        // 同步到 SkillsManager
        const skillsManager = getSkillsManager();
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
