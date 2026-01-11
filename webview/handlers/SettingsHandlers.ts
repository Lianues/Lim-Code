/**
 * 设置管理消息处理器
 */

import { t } from '../../backend/i18n';
import type { HandlerContext, MessageHandler } from '../types';

/**
 * 获取设置
 */
export const getSettings: MessageHandler = async (data, requestId, ctx) => {
  const result = await ctx.settingsHandler.getSettings({});
  ctx.sendResponse(requestId, result);
};

/**
 * 更新设置
 */
export const updateSettings: MessageHandler = async (data, requestId, ctx) => {
  const result = await ctx.settingsHandler.updateSettings(data);
  ctx.sendResponse(requestId, result);
};

/**
 * 更新代理设置
 */
export const updateProxySettings: MessageHandler = async (data, requestId, ctx) => {
  const result = await ctx.settingsHandler.updateProxySettings(data);
  ctx.sendResponse(requestId, result);
};

/**
 * 更新 UI 设置
 */
export const updateUISettings: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { ui } = data;
    await ctx.settingsManager.updateUISettings(ui);
    
    // 如果语言设置变更，同步到后端 i18n
    if (ui.language) {
      ctx.syncLanguageToBackend();
    }
    
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendError(requestId, 'UPDATE_UI_SETTINGS_ERROR', error.message || t('webview.errors.updateUISettingsFailed'));
  }
};

/**
 * 获取活动渠道 ID
 */
export const getActiveChannelId: MessageHandler = async (data, requestId, ctx) => {
  const channelId = ctx.settingsManager.getActiveChannelId();
  ctx.sendResponse(requestId, { channelId });
};

/**
 * 设置活动渠道 ID
 */
export const setActiveChannelId: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { channelId } = data;
    await ctx.settingsManager.setActiveChannelId(channelId);
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendError(requestId, 'SET_ACTIVE_CHANNEL_ERROR', error.message || t('webview.errors.setActiveChannelFailed'));
  }
};

/**
 * 获取总结配置
 */
export const getSummarizeConfig: MessageHandler = async (data, requestId, ctx) => {
  try {
    const config = ctx.settingsManager.getSummarizeConfig();
    ctx.sendResponse(requestId, config);
  } catch (error: any) {
    ctx.sendError(requestId, 'GET_SUMMARIZE_CONFIG_ERROR', error.message || t('webview.errors.getSummarizeConfigFailed'));
  }
};

/**
 * 更新总结配置
 */
export const updateSummarizeConfig: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { config } = data;
    await ctx.settingsManager.updateSummarizeConfig(config);
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendError(requestId, 'UPDATE_SUMMARIZE_CONFIG_ERROR', error.message || t('webview.errors.updateSummarizeConfigFailed'));
  }
};

/**
 * 获取图像生成配置
 */
export const getGenerateImageConfig: MessageHandler = async (data, requestId, ctx) => {
  try {
    const config = ctx.settingsManager.getGenerateImageConfig();
    ctx.sendResponse(requestId, config);
  } catch (error: any) {
    ctx.sendError(requestId, 'GET_GENERATE_IMAGE_CONFIG_ERROR', error.message || t('webview.errors.getGenerateImageConfigFailed'));
  }
};

/**
 * 更新图像生成配置
 */
export const updateGenerateImageConfig: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { config } = data;
    await ctx.settingsManager.updateGenerateImageConfig(config);
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendError(requestId, 'UPDATE_GENERATE_IMAGE_CONFIG_ERROR', error.message || t('webview.errors.updateGenerateImageConfigFailed'));
  }
};

/**
 * 获取系统提示词配置
 */
export const getSystemPromptConfig: MessageHandler = async (data, requestId, ctx) => {
  try {
    const config = ctx.settingsManager.getSystemPromptConfig();
    ctx.sendResponse(requestId, config);
  } catch (error: any) {
    ctx.sendError(requestId, 'GET_SYSTEM_PROMPT_CONFIG_ERROR', error.message || t('webview.errors.getSystemPromptConfigFailed'));
  }
};

/**
 * 更新系统提示词配置
 */
export const updateSystemPromptConfig: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { config } = data;
    await ctx.settingsManager.updateSystemPromptConfig(config);
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendError(requestId, 'UPDATE_SYSTEM_PROMPT_CONFIG_ERROR', error.message || t('webview.errors.updateSystemPromptConfigFailed'));
  }
};

/**
 * 计算系统提示词 Token 数（分别计算静态和动态部分）
 */
export const countSystemPromptTokens: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { staticText, channelType } = data;
    const result = await ctx.settingsHandler.countSystemPromptTokensSeparate({ staticText, channelType });
    if (result.success) {
      ctx.sendResponse(requestId, { 
        success: true, 
        staticTokens: result.staticTokens,
        dynamicTokens: result.dynamicTokens
      });
    } else {
      ctx.sendResponse(requestId, { success: false, error: result.error?.message });
    }
  } catch (error: any) {
    ctx.sendResponse(requestId, { success: false, error: error.message || 'Token count failed' });
  }
};

/**
 * 注册设置管理处理器
 */
export function registerSettingsHandlers(registry: Map<string, MessageHandler>): void {
  registry.set('getSettings', getSettings);
  registry.set('updateSettings', updateSettings);
  registry.set('updateProxySettings', updateProxySettings);
  registry.set('updateUISettings', updateUISettings);
  registry.set('settings.getActiveChannelId', getActiveChannelId);
  registry.set('settings.setActiveChannelId', setActiveChannelId);
  registry.set('getSummarizeConfig', getSummarizeConfig);
  registry.set('updateSummarizeConfig', updateSummarizeConfig);
  registry.set('getGenerateImageConfig', getGenerateImageConfig);
  registry.set('updateGenerateImageConfig', updateGenerateImageConfig);
  registry.set('getSystemPromptConfig', getSystemPromptConfig);
  registry.set('updateSystemPromptConfig', updateSystemPromptConfig);
  registry.set('countSystemPromptTokens', countSystemPromptTokens);
  registry.set('checkAnnouncement', checkAnnouncement);
  registry.set('markAnnouncementRead', markAnnouncementRead);
}

/**
 * 检查是否需要显示版本更新公告
 */
export const checkAnnouncement: MessageHandler = async (data, requestId, ctx) => {
  try {
    const result = await ctx.settingsHandler.checkAnnouncement();
    ctx.sendResponse(requestId, result);
  } catch (error: any) {
    ctx.sendError(requestId, 'CHECK_ANNOUNCEMENT_ERROR', error.message || 'Failed to check announcement');
  }
};

/**
 * 标记公告已读
 */
export const markAnnouncementRead: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { version } = data;
    await ctx.settingsHandler.markAnnouncementRead(version);
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendError(requestId, 'MARK_ANNOUNCEMENT_READ_ERROR', error.message || 'Failed to mark announcement as read');
  }
};
