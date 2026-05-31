/**
 * SubAgents 子代理管理消息处理器
 */

import { t } from '../../backend/i18n';
import { subAgentRegistry, refreshSubAgentsTool, subAgentRunController, subAgentRunEventBus } from '../../backend/tools/subagents';
import { deleteLogicalMessage, truncateFrom } from '../../backend/modules/conversation';
import type { SubAgentConfigItem } from '../../backend/modules/settings/types';
import type { HandlerContext, MessageHandler } from '../types';

const MUTATION_RESPONSE_WINDOW_LIMIT = 20;

async function createRunMutationResponse(runId: string, anchorIndex?: number) {
  // 修改原因：删除/重试后只需要让 Monitor 校准当前 run 的轻量元数据和一个窗口，不能再返回完整 snapshot.contents。
  // 修改方式：从事件总线唯一真源派生 manifest，并请求 Runtime Ledger 围绕变更位置产出窗口投影。
  // 修改目的：用户操作大 run 时响应体大小保持 O(window)，同时不引入 Monitor 专用第二业务模型。
  const manifest = subAgentRunEventBus.getManifest(runId);
  if (!manifest) return undefined;

  const options = typeof anchorIndex === 'number'
    ? {
      startIndex: Math.max(0, Math.floor(anchorIndex) - Math.floor(MUTATION_RESPONSE_WINDOW_LIMIT / 2)),
      limit: MUTATION_RESPONSE_WINDOW_LIMIT,
      fromTail: false
    }
    : { limit: MUTATION_RESPONSE_WINDOW_LIMIT, fromTail: true };
  const runtimeLedger = await subAgentRunEventBus.getRuntimeLedgerMonitorProjection(runId, options);

  return {
    success: true,
    manifest,
    runtimeLedger,
    activeRunIds: subAgentRunController.getActiveRunIds()
  };
}

/**
 * 获取所有子代理列表和全局配置
 */
export const listSubAgents: MessageHandler = async (data, requestId, ctx) => {
  try {
    // 从 SettingsManager 获取持久化的配置
    const config = ctx.settingsManager.getSubAgentsConfig();
    const agents = config.agents || [];
    const maxConcurrentAgents = config.maxConcurrentAgents ?? 3;
    const failureModeAfterRetries = config.failureModeAfterRetries || 'fail_parent_tool';
    
    // 修改原因：前端设置页需要显示全局自动重试耗尽策略，同时旧配置不能被读取操作主动写回。
    // 修改方式：返回 SettingsManager 运行时补齐后的全局默认值，agents 仍保持各自原始覆盖字段。
    // 修改目的：让 UI 可以区分全局默认和单个 SubAgent 覆盖，且不污染 VS Code Settings Sync。
    ctx.sendResponse(requestId, { agents, maxConcurrentAgents, failureModeAfterRetries });
  } catch (error: any) {
    ctx.sendError(requestId, 'LIST_SUBAGENTS_ERROR', error.message || 'Failed to list subagents');
  }
};

/**
 * 获取单个子代理配置
 */
export const getSubAgent: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { type } = data;
    const agent = ctx.settingsManager.getSubAgent(type);
    
    if (!agent) {
      ctx.sendError(requestId, 'SUBAGENT_NOT_FOUND', `SubAgent "${type}" not found`);
      return;
    }
    
    ctx.sendResponse(requestId, { agent });
  } catch (error: any) {
    ctx.sendError(requestId, 'GET_SUBAGENT_ERROR', error.message || 'Failed to get subagent');
  }
};

/**
 * 创建子代理
 */
export const createSubAgent: MessageHandler = async (data, requestId, ctx) => {
  try {
    const config: SubAgentConfigItem = {
      type: data.type,
      name: data.name,
      description: data.description || '',
      systemPrompt: data.systemPrompt || '',
      channel: data.channel || { channelId: '' },
      tools: data.tools || { mode: 'all' },
      maxIterations: data.maxIterations,
      maxRuntime: data.maxRuntime,
      // 修改原因：新建 SubAgent 的默认策略必须是 Provider 自动重试耗尽后立即让主窗口工具失败。
      // 修改方式：如果前端未传入策略，后端创建时显式写入 fail_parent_tool。
      // 修改目的：保证“每个 SubAgent 默认立刻失败”的产品语义，不依赖前端是否及时升级。
      failureModeAfterRetries: data.failureModeAfterRetries || 'fail_parent_tool',
      enabled: data.enabled !== false
    };
    
    // 检查类型 ID 是否已存在
    if (ctx.settingsManager.getSubAgent(config.type)) {
      ctx.sendError(requestId, 'SUBAGENT_EXISTS', `SubAgent "${config.type}" already exists`);
      return;
    }
    
    // 检查名称是否重复
    const existingAgents = ctx.settingsManager.getSubAgents();
    const nameExists = existingAgents.some(a => a.name.toLowerCase() === config.name.toLowerCase());
    if (nameExists) {
      ctx.sendError(requestId, 'SUBAGENT_NAME_EXISTS', `A sub-agent with name "${config.name}" already exists`);
      return;
    }
    
    // 保存到 SettingsManager
    await ctx.settingsManager.addSubAgent(config);
    
    // 注册到内存 registry
    subAgentRegistry.registerFromConfig(config);
    
    // 通知工具定义刷新
    refreshSubAgentsTool();
    
    ctx.sendResponse(requestId, { success: true, type: config.type });
  } catch (error: any) {
    ctx.sendError(requestId, 'CREATE_SUBAGENT_ERROR', error.message || 'Failed to create subagent');
  }
};

/**
 * 更新子代理配置
 */
export const updateSubAgent: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { type, updates } = data;
    
    if (!ctx.settingsManager.getSubAgent(type)) {
      ctx.sendError(requestId, 'SUBAGENT_NOT_FOUND', `SubAgent "${type}" not found`);
      return;
    }
    
    // 如果更新名称，检查是否重复
    if (updates.name) {
      const existingAgents = ctx.settingsManager.getSubAgents();
      const nameExists = existingAgents.some(
        a => a.type !== type && a.name.toLowerCase() === updates.name.toLowerCase()
      );
      if (nameExists) {
        ctx.sendError(requestId, 'SUBAGENT_NAME_EXISTS', `A sub-agent with name "${updates.name}" already exists`);
        return;
      }
    }
    
    // 保存到 SettingsManager
    const success = await ctx.settingsManager.updateSubAgent(type, updates);
    
    if (!success) {
      ctx.sendError(requestId, 'UPDATE_SUBAGENT_FAILED', 'Failed to update subagent');
      return;
    }
    
    // 更新内存 registry
    subAgentRegistry.updateConfig(type, updates);
    
    // 通知工具定义刷新
    refreshSubAgentsTool();
    
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendError(requestId, 'UPDATE_SUBAGENT_ERROR', error.message || 'Failed to update subagent');
  }
};

/**
 * 删除子代理
 */
export const deleteSubAgent: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { type } = data;
    
    if (!ctx.settingsManager.getSubAgent(type)) {
      ctx.sendError(requestId, 'SUBAGENT_NOT_FOUND', `SubAgent "${type}" not found`);
      return;
    }
    
    // 从 SettingsManager 删除
    const success = await ctx.settingsManager.deleteSubAgent(type);
    
    if (!success) {
      ctx.sendError(requestId, 'DELETE_SUBAGENT_FAILED', 'Failed to delete subagent');
      return;
    }
    
    // 从内存 registry 删除
    subAgentRegistry.unregister(type);
    
    // 通知工具定义刷新
    refreshSubAgentsTool();
    
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendError(requestId, 'DELETE_SUBAGENT_ERROR', error.message || 'Failed to delete subagent');
  }
};

/**
 * 设置子代理启用状态
 */
export const setSubAgentEnabled: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { type, enabled } = data;
    
    if (!ctx.settingsManager.getSubAgent(type)) {
      ctx.sendError(requestId, 'SUBAGENT_NOT_FOUND', `SubAgent "${type}" not found`);
      return;
    }
    
    // 保存到 SettingsManager
    const success = await ctx.settingsManager.updateSubAgent(type, { enabled });
    
    if (!success) {
      ctx.sendError(requestId, 'SET_ENABLED_FAILED', 'Failed to set subagent enabled status');
      return;
    }
    
    // 更新内存 registry
    subAgentRegistry.setEnabled(type, enabled);
    
    // 启用状态变化会影响可用的子代理列表
    refreshSubAgentsTool();
    
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendError(requestId, 'SET_SUBAGENT_ENABLED_ERROR', error.message || 'Failed to set subagent enabled status');
  }
};

/**
 * 更新全局配置（maxConcurrentAgents 等）
 */
export const openSubAgentMonitor: MessageHandler = async (data, requestId, ctx) => {
  try {
    const runId = typeof data?.runId === 'string' ? data.runId : undefined;
    const conversationId = typeof data?.conversationId === 'string' ? data.conversationId : undefined;
    if (!ctx.openSubAgentMonitor) {
      ctx.sendError(requestId, 'SUBAGENT_MONITOR_UNAVAILABLE', 'SubAgent Monitor is not available in this context');
      return;
    }

    // 修改原因：历史消息里的 SubAgent 卡片可能在扩展重载后才打开 Monitor，此时内存事件总线没有对应 run。
    // 修改方式：若前端提供 conversationId，先从 conversation metadata 加载 subAgentRuns 子记录到内存。
    // 修改目的：Monitor 可以恢复已保存的内部子对话，同时仍不把内部记录插入主 messages 时间线。
    if (conversationId) {
      await subAgentRunEventBus.loadConversationSnapshots(conversationId, ctx.conversationManager);
    }

    // 修改原因：主聊天工具卡片只保存摘要和 runId，完整内部过程由独立 Monitor 展示。
    // 修改方式：通过 HandlerContext 调用 ChatViewProvider 提供的 openSubAgentMonitor。
    // 修改目的：避免主聊天时间线承载内部事件，同时让用户可从卡片定位到具体 run。
    await ctx.openSubAgentMonitor(runId, conversationId);
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendError(requestId, 'OPEN_SUBAGENT_MONITOR_ERROR', error.message || 'Failed to open SubAgent Monitor');
  }
};

export const pauseRun: MessageHandler = async (data, requestId, ctx) => {
  try {
    const runId = typeof data?.runId === 'string' ? data.runId.trim() : '';
    if (!runId) {
      ctx.sendError(requestId, 'SUBAGENT_PAUSE_RUN_INVALID_INPUT', 'runId is required');
      return;
    }

    // 修改原因：Monitor 的中止按钮只暂停 SubAgent 内部执行，不应直接让主窗口 subagents 工具失败。
    // 修改方式：调用活跃运行控制器的 pause，由控制器广播 run_paused 并 abort 当前 run signal。
    // 修改目的：控制语义集中在 runController，handler 不直接改快照状态。
    const success = subAgentRunController.pause(runId);
    ctx.sendResponse(requestId, { success });
  } catch (error: any) {
    ctx.sendError(requestId, 'SUBAGENT_PAUSE_RUN_ERROR', error.message || 'Failed to pause SubAgent run');
  }
};

export const resumeRun: MessageHandler = async (data, requestId, ctx) => {
  try {
    const runId = typeof data?.runId === 'string' ? data.runId.trim() : '';
    if (!runId) {
      ctx.sendError(requestId, 'SUBAGENT_RESUME_RUN_INVALID_INPUT', 'runId is required');
      return;
    }

    // 修改原因：暂停或等待 Monitor 操作的 run 需要从同一 runId 继续，而不是创建新的历史 run。
    // 修改方式：调用 runController.resume 重建控制信号并广播 run_resumed。
    // 修改目的：让 Monitor 顶部“重试/继续”按钮复用同一活跃控制入口。
    const success = subAgentRunController.resume(runId);
    ctx.sendResponse(requestId, { success });
  } catch (error: any) {
    ctx.sendError(requestId, 'SUBAGENT_RESUME_RUN_ERROR', error.message || 'Failed to resume SubAgent run');
  }
};

export const exitRun: MessageHandler = async (data, requestId, ctx) => {
  try {
    const runId = typeof data?.runId === 'string' ? data.runId.trim() : '';
    const reason = typeof data?.reason === 'string' && data.reason.trim()
      ? data.reason.trim()
      : '用户主动终止 SubAgent 执行';
    if (!runId) {
      ctx.sendError(requestId, 'SUBAGENT_EXIT_RUN_INVALID_INPUT', 'runId is required');
      return;
    }

    // 修改原因：退出 SubAgent 执行必须区别于 pause，会让主窗口工具调用以用户主动终止失败。
    // 修改方式：调用 runController.exit 记录原因、abort 当前 run，并广播 run_cancelled。
    // 修改目的：后续 executor 接入控制器后能用同一 reason 返回给主工具。
    const success = subAgentRunController.exit(runId, reason);
    ctx.sendResponse(requestId, { success });
  } catch (error: any) {
    ctx.sendError(requestId, 'SUBAGENT_EXIT_RUN_ERROR', error.message || 'Failed to exit SubAgent run');
  }
};

export const deleteRunMessage: MessageHandler = async (data, requestId, ctx) => {
  try {
    const runId = typeof data?.runId === 'string' ? data.runId : '';
    const contentIndex = Number(data?.contentIndex);
    const conversationId = typeof data?.conversationId === 'string' ? data.conversationId : undefined;

    if (!runId || !Number.isFinite(contentIndex)) {
      ctx.sendError(requestId, 'SUBAGENT_DELETE_MESSAGE_INVALID_INPUT', 'runId and contentIndex are required');
      return;
    }

    // 修改原因：Monitor 删除楼层只影响 SubAgent 子对话，但必须复用主对话同一套工具配对删除逻辑。
    // 修改方式：先按 conversationId 恢复持久化快照，再通过 runEventBus.mutateContents 调用 TranscriptMutation.deleteLogicalMessage。
    // 修改目的：删除带工具调用的模型消息时同步删除配对 functionResponse，避免后续重试历史不完整。
    if (conversationId) {
      await subAgentRunEventBus.loadConversationSnapshots(conversationId, ctx.conversationManager);
    }
    const snapshot = subAgentRunEventBus.mutateContents(runId, contents => {
      // 修改原因：Monitor 现在渲染的是 transcript window，前端传来的 contentIndex 必须继续被当作完整 Content[] 的真实索引。
      // 修改方式：handler 不做可见消息下标换算，直接把 contentIndex 交给 TranscriptMutation.deleteLogicalMessage。
      // 修改目的：锁定删除/重试不会因窗口偏移或隐藏 functionResponse 而误删相邻消息。
      return deleteLogicalMessage(contents, contentIndex);
    });
    if (!snapshot) {
      ctx.sendError(requestId, 'SUBAGENT_RUN_NOT_FOUND', `SubAgent run not found: ${runId}`);
      return;
    }

    const response = await createRunMutationResponse(runId, contentIndex);
    if (!response) {
      ctx.sendError(requestId, 'SUBAGENT_RUN_NOT_FOUND', `SubAgent run not found: ${runId}`);
      return;
    }
    ctx.sendResponse(requestId, response);
  } catch (error: any) {
    ctx.sendError(requestId, 'SUBAGENT_DELETE_MESSAGE_ERROR', error.message || 'Failed to delete SubAgent message');
  }
};

export const retryRunFromMessage: MessageHandler = async (data, requestId, ctx) => {
  try {
    const runId = typeof data?.runId === 'string' ? data.runId : '';
    const contentIndex = Number(data?.contentIndex);
    const conversationId = typeof data?.conversationId === 'string' ? data.conversationId : undefined;

    if (!runId || !Number.isFinite(contentIndex)) {
      ctx.sendError(requestId, 'SUBAGENT_RETRY_MESSAGE_INVALID_INPUT', 'runId and contentIndex are required');
      return;
    }

    // 修改原因：Monitor 的单楼重试语义是截断该楼及之后的子对话，再由后续运行控制继续同一个 run。
    // 修改方式：当前阶段先复用 TranscriptMutation.truncateFrom 更新子对话快照；运行恢复由 run 控制器后续接管。
    // 修改目的：先确保历史变更的单一来源正确，避免 UI 自己裁剪 Content[]。
    if (conversationId) {
      await subAgentRunEventBus.loadConversationSnapshots(conversationId, ctx.conversationManager);
    }
    const snapshot = subAgentRunEventBus.mutateContents(runId, contents => {
      // 修改原因：按需窗口加载后，重试按钮仍必须使用真实 contentIndex 截断完整子 transcript。
      // 修改方式：直接复用 TranscriptMutation.truncateFrom，不把窗口内 offset 当成全局索引。
      // 修改目的：避免只显示尾部窗口时重试从错误位置截断。
      return truncateFrom(contents, contentIndex);
    });
    if (!snapshot) {
      ctx.sendError(requestId, 'SUBAGENT_RUN_NOT_FOUND', `SubAgent run not found: ${runId}`);
      return;
    }

    const response = await createRunMutationResponse(runId, contentIndex);
    if (!response) {
      ctx.sendError(requestId, 'SUBAGENT_RUN_NOT_FOUND', `SubAgent run not found: ${runId}`);
      return;
    }
    ctx.sendResponse(requestId, response);
  } catch (error: any) {
    ctx.sendError(requestId, 'SUBAGENT_RETRY_MESSAGE_ERROR', error.message || 'Failed to retry SubAgent message');
  }
};

export const updateGlobalConfig: MessageHandler = async (data, requestId, ctx) => {
  try {
    const updates: Record<string, unknown> = {};
    
    // 支持的全局配置字段
    if (data.maxConcurrentAgents !== undefined) {
      updates.maxConcurrentAgents = data.maxConcurrentAgents;
    }

    // 修改原因：SubAgents 的自动重试耗尽策略需要作为可同步的全局默认设置保存。
    // 修改方式：只接受设计中确认的两个稳定枚举值，避免前端或旧扩展写入未知字符串。
    // 修改目的：让后续 executor 可以安全根据该字段决定主工具失败还是等待 Monitor 操作。
    if (data.failureModeAfterRetries === 'fail_parent_tool' || data.failureModeAfterRetries === 'wait_for_monitor_action') {
      updates.failureModeAfterRetries = data.failureModeAfterRetries;
    }
    
    if (Object.keys(updates).length > 0) {
      await ctx.settingsManager.updateSubAgentsConfig(updates);
      
      // 通知工具定义刷新（因为工具描述中包含限制信息）
      refreshSubAgentsTool();
    }
    
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendError(requestId, 'UPDATE_GLOBAL_CONFIG_ERROR', error.message || 'Failed to update global config');
  }
};

/**
 * 初始化子代理（从持久化存储加载到内存）
 */
export function initializeSubAgentsFromSettings(ctx: HandlerContext): void {
  try {
    const agents = ctx.settingsManager.getSubAgents();
    
    for (const agent of agents) {
      // 跳过已存在的
      if (!subAgentRegistry.has(agent.type)) {
        subAgentRegistry.registerFromConfig(agent);
      }
    }
    
    console.log(`[SubAgents] Initialized ${agents.length} sub-agents from settings`);
  } catch (error) {
    console.error('[SubAgents] Failed to initialize from settings:', error);
  }
}

/**
 * 注册 SubAgents 处理器
 */
export function registerSubAgentsHandlers(registry: Map<string, MessageHandler>): void {
  registry.set('subagents.list', listSubAgents);
  registry.set('subagents.get', getSubAgent);
  registry.set('subagents.create', createSubAgent);
  registry.set('subagents.update', updateSubAgent);
  registry.set('subagents.delete', deleteSubAgent);
  registry.set('subagents.setEnabled', setSubAgentEnabled);
  registry.set('subagents.updateGlobalConfig', updateGlobalConfig);
  registry.set('subagents.openMonitor', openSubAgentMonitor);
  registry.set('subagents.pauseRun', pauseRun);
  registry.set('subagents.resumeRun', resumeRun);
  registry.set('subagents.exitRun', exitRun);
  registry.set('subagents.deleteRunMessage', deleteRunMessage);
  registry.set('subagents.retryRunFromMessage', retryRunFromMessage);
}
