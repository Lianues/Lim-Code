/**
 * 工具管理消息处理器
 */

import { t } from '../../backend/i18n';
import { checkAllShellsAvailability, killTerminalProcess, getTerminalOutput, cancelImageGeneration, TaskManager } from '../../backend/tools';
import type { HandlerContext, MessageHandler } from '../types';

// ========== 工具列表和配置 ==========

export const getTools: MessageHandler = async (data, requestId, ctx) => {
  const result = await ctx.settingsHandler.getToolsList({});
  if (result.success) {
    ctx.sendResponse(requestId, { tools: result.tools });
  } else {
    const errorResult = result as { success: false; error: { code: string; message: string } };
    ctx.sendError(requestId, 'GET_TOOLS_ERROR', errorResult.error?.message || t('webview.errors.getToolsFailed'));
  }
};

export const setToolEnabled: MessageHandler = async (data, requestId, ctx) => {
  const { toolName, enabled } = data;
  const result = await ctx.settingsHandler.setToolEnabled({ toolName, enabled });
  if (result.success) {
    ctx.sendResponse(requestId, { success: true });
  } else {
    const errorResult = result as { success: false; error: { code: string; message: string } };
    ctx.sendError(requestId, 'SET_TOOL_ENABLED_ERROR', errorResult.error?.message || t('webview.errors.setToolEnabledFailed'));
  }
};

export const getToolConfig: MessageHandler = async (data, requestId, ctx) => {
  const { toolName } = data;
  const result = await ctx.settingsHandler.getToolConfig({ toolName });
  if (result.success) {
    ctx.sendResponse(requestId, { config: result.config });
  } else {
    const errorResult = result as { success: false; error: { code: string; message: string } };
    ctx.sendError(requestId, 'GET_TOOL_CONFIG_ERROR', errorResult.error?.message || t('webview.errors.getToolConfigFailed'));
  }
};

export const updateToolConfig: MessageHandler = async (data, requestId, ctx) => {
  const { toolName, config } = data;
  const result = await ctx.settingsHandler.updateToolConfig({ toolName, config });
  if (result.success) {
    ctx.sendResponse(requestId, { success: true });
  } else {
    const errorResult = result as { success: false; error: { code: string; message: string } };
    ctx.sendError(requestId, 'UPDATE_TOOL_CONFIG_ERROR', errorResult.error?.message || t('webview.errors.updateToolConfigFailed'));
  }
};

export const getAutoExecConfig: MessageHandler = async (data, requestId, ctx) => {
  try {
    const config = ctx.settingsManager.getToolAutoExecConfig();
    ctx.sendResponse(requestId, { config });
  } catch (error: any) {
    ctx.sendError(requestId, 'GET_AUTO_EXEC_CONFIG_ERROR', error.message || t('webview.errors.getAutoExecConfigFailed'));
  }
};

export const getMcpTools: MessageHandler = async (data, requestId, ctx) => {
  try {
    const allMcpTools = ctx.mcpManager.getAllTools();
    const mcpTools: Array<{
      name: string;
      description: string;
      enabled: boolean;
      category: string;
      serverId: string;
      serverName: string;
    }> = [];
    
    for (const serverTools of allMcpTools) {
      for (const tool of serverTools.tools) {
        const fullToolName = `mcp__${serverTools.serverId}__${tool.name}`;
        mcpTools.push({
          name: fullToolName,
          description: tool.description || '',
          enabled: true,
          category: 'mcp',
          serverId: serverTools.serverId,
          serverName: serverTools.serverName
        });
      }
    }
    
    ctx.sendResponse(requestId, { tools: mcpTools });
  } catch (error: any) {
    ctx.sendError(requestId, 'GET_MCP_TOOLS_ERROR', error.message || t('webview.errors.getMcpToolsFailed'));
  }
};

export const setToolAutoExec: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { toolName, autoExec } = data;
    await ctx.settingsManager.setToolAutoExec(toolName, autoExec);
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendError(requestId, 'SET_TOOL_AUTO_EXEC_ERROR', error.message || t('webview.errors.setToolAutoExecFailed'));
  }
};

export const getMaxToolIterations: MessageHandler = async (data, requestId, ctx) => {
  try {
    const maxIterations = ctx.settingsManager.getMaxToolIterations();
    ctx.sendResponse(requestId, { maxIterations });
  } catch (error: any) {
    ctx.sendError(requestId, 'GET_MAX_TOOL_ITERATIONS_ERROR', error.message || t('webview.errors.getMaxToolIterationsFailed'));
  }
};

export const updateMaxToolIterations: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { maxIterations } = data;
    await ctx.settingsManager.setMaxToolIterations(maxIterations);
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendError(requestId, 'UPDATE_MAX_TOOL_ITERATIONS_ERROR', error.message || t('webview.errors.updateMaxToolIterationsFailed'));
  }
};

// ========== 工具特定配置 ==========

export const updateListFilesConfig: MessageHandler = async (data, requestId, ctx) => {
  const result = await ctx.settingsHandler.updateListFilesConfig({ config: data.config });
  if (result.success) {
    ctx.sendResponse(requestId, { success: true });
  } else {
    const errorResult = result as { success: false; error: { code: string; message: string } };
    ctx.sendError(requestId, 'UPDATE_LIST_FILES_CONFIG_ERROR', errorResult.error?.message || t('webview.errors.updateListFilesConfigFailed'));
  }
};

export const getFindFilesConfig: MessageHandler = async (data, requestId, ctx) => {
  try {
    const config = ctx.settingsManager.getFindFilesConfig();
    ctx.sendResponse(requestId, { config });
  } catch (error: any) {
    ctx.sendError(requestId, 'GET_FIND_FILES_CONFIG_ERROR', error.message || t('webview.errors.getFindFilesConfigFailed'));
  }
};

export const updateFindFilesConfig: MessageHandler = async (data, requestId, ctx) => {
  try {
    await ctx.settingsManager.updateFindFilesConfig(data.config);
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendError(requestId, 'UPDATE_FIND_FILES_CONFIG_ERROR', error.message || t('webview.errors.updateFindFilesConfigFailed'));
  }
};

export const getSearchInFilesConfig: MessageHandler = async (data, requestId, ctx) => {
  try {
    const config = ctx.settingsManager.getSearchInFilesConfig();
    ctx.sendResponse(requestId, { config });
  } catch (error: any) {
    ctx.sendError(requestId, 'GET_SEARCH_IN_FILES_CONFIG_ERROR', error.message || t('webview.errors.getSearchInFilesConfigFailed'));
  }
};

export const updateSearchInFilesConfig: MessageHandler = async (data, requestId, ctx) => {
  try {
    await ctx.settingsManager.updateSearchInFilesConfig(data.config);
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendError(requestId, 'UPDATE_SEARCH_IN_FILES_CONFIG_ERROR', error.message || t('webview.errors.updateSearchInFilesConfigFailed'));
  }
};

export const updateApplyDiffConfig: MessageHandler = async (data, requestId, ctx) => {
  const result = await ctx.settingsHandler.updateApplyDiffConfig({ config: data.config });
  if (result.success) {
    ctx.sendResponse(requestId, { success: true });
  } else {
    const errorResult = result as { success: false; error: { code: string; message: string } };
    ctx.sendError(requestId, 'UPDATE_APPLY_DIFF_CONFIG_ERROR', errorResult.error?.message || t('webview.errors.updateApplyDiffConfigFailed'));
  }
};

export const getExecuteCommandConfig: MessageHandler = async (data, requestId, ctx) => {
  const config = ctx.settingsManager.getExecuteCommandConfig();
  
  const availabilityMap = await checkAllShellsAvailability(
    config.shells.map(s => ({ type: s.type, path: s.path }))
  );
  
  const configWithAvailability = {
    ...config,
    shells: config.shells.map(shell => ({
      ...shell,
      available: availabilityMap.get(shell.type)?.available ?? false,
      unavailableReason: availabilityMap.get(shell.type)?.reason
    }))
  };
  
  ctx.sendResponse(requestId, { config: configWithAvailability });
};

export const updateExecuteCommandConfig: MessageHandler = async (data, requestId, ctx) => {
  try {
    const configToSave = {
      ...data.config,
      shells: data.config.shells.map((shell: any) => ({
        type: shell.type,
        enabled: shell.enabled,
        path: shell.path,
        displayName: shell.displayName
      }))
    };
    await ctx.settingsManager.updateExecuteCommandConfig(configToSave);
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendError(requestId, 'UPDATE_EXECUTE_COMMAND_CONFIG_ERROR', error.message || t('webview.errors.updateExecuteCommandConfigFailed'));
  }
};

export const checkShellAvailability: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { shellType, path } = data;
    const { checkShellAvailability } = require('../../backend/tools/terminal');
    const result = await checkShellAvailability(shellType, path);
    ctx.sendResponse(requestId, result);
  } catch (error: any) {
    ctx.sendError(requestId, 'CHECK_SHELL_ERROR', error.message || t('webview.errors.checkShellFailed'));
  }
};

export const getHistorySearchConfig: MessageHandler = async (data, requestId, ctx) => {
  try {
    const config = ctx.settingsManager.getHistorySearchConfig();
    ctx.sendResponse(requestId, { config });
  } catch (error: any) {
    ctx.sendError(requestId, 'GET_HISTORY_SEARCH_CONFIG_ERROR', error.message || 'Failed to get history_search config');
  }
};

export const updateHistorySearchConfig: MessageHandler = async (data, requestId, ctx) => {
  try {
    await ctx.settingsManager.updateHistorySearchConfig(data.config);
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendError(requestId, 'UPDATE_HISTORY_SEARCH_CONFIG_ERROR', error.message || 'Failed to update history_search config');
  }
};


// ========== 终端管理 ==========

export const terminalKill: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { terminalId } = data;
    const result = killTerminalProcess(terminalId);
    ctx.sendResponse(requestId, result);
  } catch (error: any) {
    ctx.sendError(requestId, 'KILL_TERMINAL_ERROR', error.message || t('webview.errors.killTerminalFailed'));
  }
};

export const terminalGetOutput: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { terminalId } = data;
    const result = getTerminalOutput(terminalId);
    ctx.sendResponse(requestId, result);
  } catch (error: any) {
    ctx.sendError(requestId, 'GET_OUTPUT_ERROR', error.message || t('webview.errors.getTerminalOutputFailed'));
  }
};

// ========== 图像生成 ==========

export const imageGenerationCancel: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { toolId } = data;
    const result = cancelImageGeneration(toolId);
    ctx.sendResponse(requestId, result);
  } catch (error: any) {
    ctx.sendError(requestId, 'CANCEL_IMAGE_GEN_ERROR', error.message || t('webview.errors.cancelImageGenFailed'));
  }
};

// ========== 任务管理 ==========

export const taskCancel: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { taskId } = data;
    const result = TaskManager.cancelTask(taskId);
    ctx.sendResponse(requestId, result);
  } catch (error: any) {
    ctx.sendError(requestId, 'CANCEL_TASK_ERROR', error.message || t('webview.errors.cancelTaskFailed'));
  }
};

export const taskCancelByType: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { taskType } = data;
    const count = TaskManager.cancelTasksByType(taskType);
    ctx.sendResponse(requestId, { success: true, cancelledCount: count });
  } catch (error: any) {
    ctx.sendError(requestId, 'CANCEL_TASKS_BY_TYPE_ERROR', error.message || t('webview.errors.cancelTaskFailed'));
  }
};

export const taskGetAll: MessageHandler = async (data, requestId, ctx) => {
  try {
    const tasks = TaskManager.getAllTasks().map(task => ({
      id: task.id,
      type: task.type,
      startTime: task.startTime,
      metadata: task.metadata
    }));
    ctx.sendResponse(requestId, { tasks });
  } catch (error: any) {
    ctx.sendError(requestId, 'GET_ALL_TASKS_ERROR', error.message || t('webview.errors.getTasksFailed'));
  }
};

export const taskGetByType: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { taskType } = data;
    const tasks = TaskManager.getTasksByType(taskType).map(task => ({
      id: task.id,
      type: task.type,
      startTime: task.startTime,
      metadata: task.metadata
    }));
    ctx.sendResponse(requestId, { tasks });
  } catch (error: any) {
    ctx.sendError(requestId, 'GET_TASKS_BY_TYPE_ERROR', error.message || t('webview.errors.getTasksFailed'));
  }
};

/**
 * 注册工具管理处理器
 */
export function registerToolHandlers(registry: Map<string, MessageHandler>): void {
  // 工具列表和配置
  registry.set('tools.getTools', getTools);
  registry.set('tools.setToolEnabled', setToolEnabled);
  registry.set('tools.getToolConfig', getToolConfig);
  registry.set('tools.updateToolConfig', updateToolConfig);
  registry.set('tools.getAutoExecConfig', getAutoExecConfig);
  registry.set('tools.getMcpTools', getMcpTools);
  registry.set('tools.setToolAutoExec', setToolAutoExec);
  registry.set('tools.getMaxToolIterations', getMaxToolIterations);
  registry.set('tools.updateMaxToolIterations', updateMaxToolIterations);
  
  // 工具特定配置
  registry.set('tools.updateListFilesConfig', updateListFilesConfig);
  registry.set('tools.getFindFilesConfig', getFindFilesConfig);
  registry.set('tools.updateFindFilesConfig', updateFindFilesConfig);
  registry.set('tools.getSearchInFilesConfig', getSearchInFilesConfig);
  registry.set('tools.updateSearchInFilesConfig', updateSearchInFilesConfig);
  registry.set('tools.updateApplyDiffConfig', updateApplyDiffConfig);
  registry.set('tools.getExecuteCommandConfig', getExecuteCommandConfig);
  registry.set('tools.updateExecuteCommandConfig', updateExecuteCommandConfig);
  registry.set('tools.checkShellAvailability', checkShellAvailability);
  registry.set('tools.getHistorySearchConfig', getHistorySearchConfig);
  registry.set('tools.updateHistorySearchConfig', updateHistorySearchConfig);
  
  // 终端管理
  registry.set('terminal.kill', terminalKill);
  registry.set('terminal.getOutput', terminalGetOutput);
  
  // 图像生成
  registry.set('imageGeneration.cancel', imageGenerationCancel);
  
  // 任务管理
  registry.set('task.cancel', taskCancel);
  registry.set('task.cancelByType', taskCancelByType);
  registry.set('task.getAll', taskGetAll);
  registry.set('task.getByType', taskGetByType);
}
