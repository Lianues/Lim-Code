/**
 * 上下文感知和诊断信息消息处理器
 */

import * as vscode from 'vscode';
import { t } from '../../backend/i18n';
import type { HandlerContext, MessageHandler } from '../types';
import { shouldIgnorePath } from '../utils/WorkspaceUtils';

function normalizeConversationId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 获取上下文状态快照。
 */
export const getContextStatus: MessageHandler = async (data, requestId, ctx) => {
  try {
    // 修改原因：context status 现在是前端诊断窗口的数据源，不能再通过 chatStream 伪装成一次对话。
    // 修改方式：新增普通 request/response handler，直接调用 ChatHandler 的只读 getContextStatus。
    // 修改目的：返回 projection、ledger 和 degraded 等状态，同时不写聊天历史、不触发模型、不影响上下文。
    const conversationId = normalizeConversationId(data?.conversationId);
    if (!conversationId) {
      ctx.sendError(requestId, 'CONTEXT_STATUS_CONVERSATION_REQUIRED', 'conversationId is required');
      return;
    }
    if (!ctx.chatHandler?.getContextStatus) {
      ctx.sendError(requestId, 'CONTEXT_STATUS_UNAVAILABLE', 'Context status service is not available');
      return;
    }
    const status = await ctx.chatHandler.getContextStatus(conversationId);
    ctx.sendResponse(requestId, { status });
  } catch (error: any) {
    ctx.sendError(requestId, 'GET_CONTEXT_STATUS_ERROR', error.message || 'Failed to get context status');
  }
};

export const compactContext: MessageHandler = async (data, requestId, ctx) => {
  const conversationId = normalizeConversationId(data?.conversationId);
  const configId = typeof data?.configId === 'string' ? data.configId.trim() : '';
  if (!conversationId) {
    ctx.sendError(requestId, 'CONTEXT_COMPACT_CONVERSATION_REQUIRED', 'conversationId is required');
    return;
  }
  if (!configId) {
    ctx.sendError(requestId, 'CONTEXT_COMPACT_CONFIG_REQUIRED', 'configId is required');
    return;
  }
  if (!ctx.chatHandler?.handleCompactContext) {
    ctx.sendError(requestId, 'CONTEXT_COMPACT_UNAVAILABLE', 'Context compact service is not available');
    return;
  }

  const abortManager = ctx.streamAbortControllers as any;
  const controller = abortManager?.createSummary
    ? abortManager.createSummary(conversationId)
    : new AbortController();
  try {
    // 修改原因：主界面“压缩上下文”需要普通 request/response，不应走 chatStream 或 SummarizeService 直连。
    // 修改方式：webview handler 调用 ChatHandler.handleCompactContext，由 ContextOperationService 按 provider 策略执行 trim 或 summarize。
    // 修改目的：让按钮和 slash /compact 共享 ledger/projection 语义，并在返回 payload 后刷新 UI 状态。
    const result = await ctx.chatHandler.handleCompactContext({
      conversationId,
      configId,
      abortSignal: controller.signal
    });
    ctx.sendResponse(requestId, result);
  } catch (error: any) {
    const aborted = controller.signal.aborted || error?.name === 'AbortError';
    if (aborted) {
      ctx.sendResponse(requestId, {
        schemaVersion: 1,
        kind: 'error',
        title: 'Context compact cancelled',
        description: 'Context compact was cancelled.',
        iconName: 'error',
        nextActions: ['/context-status']
      });
      return;
    }
    ctx.sendError(requestId, 'CONTEXT_COMPACT_ERROR', error.message || 'Failed to compact context');
  } finally {
    if (abortManager?.deleteSummary) {
      abortManager.deleteSummary(conversationId);
    }
  }
};

/**
 * 获取上下文感知配置
 */
export const getContextAwarenessConfig: MessageHandler = async (data, requestId, ctx) => {
  try {
    const config = ctx.settingsManager.getContextAwarenessConfig();
    ctx.sendResponse(requestId, config);
  } catch (error: any) {
    ctx.sendError(requestId, 'GET_CONTEXT_AWARENESS_CONFIG_ERROR', error.message || t('webview.errors.getContextAwarenessConfigFailed'));
  }
};

/**
 * 更新上下文感知配置
 */
export const updateContextAwarenessConfig: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { config } = data;
    await ctx.settingsManager.updateContextAwarenessConfig(config);
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendError(requestId, 'UPDATE_CONTEXT_AWARENESS_CONFIG_ERROR', error.message || t('webview.errors.updateContextAwarenessConfigFailed'));
  }
};

/**
 * 获取打开的标签页
 */
export const getOpenTabs: MessageHandler = async (data, requestId, ctx) => {
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      ctx.sendResponse(requestId, { tabs: [] });
      return;
    }
    
    const tabs: string[] = [];
    const ignorePatterns = ctx.settingsManager.getContextIgnorePatterns();
    
    for (const tabGroup of vscode.window.tabGroups.all) {
      for (const tab of tabGroup.tabs) {
        if (tab.input instanceof vscode.TabInputText) {
          const uri = tab.input.uri;
          const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
          if (workspaceFolder) {
            const relativePath = vscode.workspace.asRelativePath(uri, false);
            if (!shouldIgnorePath(relativePath, ignorePatterns)) {
              tabs.push(relativePath);
            }
          }
        }
      }
    }
    
    ctx.sendResponse(requestId, { tabs: [...new Set(tabs)] });
  } catch (error: any) {
    ctx.sendError(requestId, 'GET_OPEN_TABS_ERROR', error.message || t('webview.errors.getOpenTabsFailed'));
  }
};

/**
 * 获取活动编辑器
 */
export const getActiveEditor: MessageHandler = async (data, requestId, ctx) => {
  try {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      ctx.sendResponse(requestId, { path: null });
      return;
    }
    
    const uri = activeEditor.document.uri;
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    
    if (!workspaceFolder) {
      ctx.sendResponse(requestId, { path: null });
      return;
    }
    
    const relativePath = vscode.workspace.asRelativePath(uri, false);
    const ignorePatterns = ctx.settingsManager.getContextIgnorePatterns();
    
    if (shouldIgnorePath(relativePath, ignorePatterns)) {
      ctx.sendResponse(requestId, { path: null });
      return;
    }
    
    ctx.sendResponse(requestId, { path: relativePath });
  } catch (error: any) {
    ctx.sendError(requestId, 'GET_ACTIVE_EDITOR_ERROR', error.message || t('webview.errors.getActiveEditorFailed'));
  }
};

/**
 * 获取诊断配置
 */
export const getDiagnosticsConfig: MessageHandler = async (data, requestId, ctx) => {
  try {
    const config = ctx.settingsManager.getDiagnosticsConfig();
    ctx.sendResponse(requestId, config);
  } catch (error: any) {
    ctx.sendError(requestId, 'GET_DIAGNOSTICS_CONFIG_ERROR', error.message || t('webview.errors.getDiagnosticsConfigFailed'));
  }
};

/**
 * 更新诊断配置
 */
export const updateDiagnosticsConfig: MessageHandler = async (data, requestId, ctx) => {
  try {
    const { config } = data;
    await ctx.settingsManager.updateDiagnosticsConfig(config);
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendError(requestId, 'UPDATE_DIAGNOSTICS_CONFIG_ERROR', error.message || t('webview.errors.updateDiagnosticsConfigFailed'));
  }
};

/**
 * 获取工作区诊断信息
 */
export const getWorkspaceDiagnostics: MessageHandler = async (data, requestId, ctx) => {
  try {
    const config = ctx.settingsManager.getDiagnosticsConfig();
    
    if (!config.enabled) {
      ctx.sendResponse(requestId, { diagnostics: [] });
      return;
    }
    
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      ctx.sendResponse(requestId, { diagnostics: [] });
      return;
    }
    
    const allDiagnostics = vscode.languages.getDiagnostics();
    
    const severityMap: Record<vscode.DiagnosticSeverity, 'error' | 'warning' | 'information' | 'hint'> = {
      [vscode.DiagnosticSeverity.Error]: 'error',
      [vscode.DiagnosticSeverity.Warning]: 'warning',
      [vscode.DiagnosticSeverity.Information]: 'information',
      [vscode.DiagnosticSeverity.Hint]: 'hint'
    };
    
    const openFileUris = new Set<string>();
    if (config.openFilesOnly) {
      for (const tabGroup of vscode.window.tabGroups.all) {
        for (const tab of tabGroup.tabs) {
          if (tab.input instanceof vscode.TabInputText) {
            openFileUris.add(tab.input.uri.toString());
          }
        }
      }
    }
    
    const result: Array<{
      file: string;
      diagnostics: Array<{
        line: number;
        column: number;
        severity: 'error' | 'warning' | 'information' | 'hint';
        message: string;
        source?: string;
        code?: string | number;
      }>;
    }> = [];
    
    let fileCount = 0;
    
    for (const [uri, diagnostics] of allDiagnostics) {
      if (config.maxFiles !== -1 && fileCount >= config.maxFiles) {
        break;
      }
      
      if (config.workspaceOnly) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder) {
          continue;
        }
      }
      
      if (config.openFilesOnly && !openFileUris.has(uri.toString())) {
        continue;
      }
      
      const filteredDiagnostics = diagnostics
        .filter(d => {
          const severity = severityMap[d.severity];
          return config.includeSeverities.includes(severity);
        })
        .slice(0, config.maxDiagnosticsPerFile === -1 ? undefined : config.maxDiagnosticsPerFile)
        .map(d => ({
          line: d.range.start.line + 1,
          column: d.range.start.character + 1,
          severity: severityMap[d.severity],
          message: d.message,
          source: d.source,
          code: typeof d.code === 'object' ? d.code.value : d.code
        }));
      
      if (filteredDiagnostics.length > 0) {
        const relativePath = vscode.workspace.asRelativePath(uri, false);
        result.push({
          file: relativePath,
          diagnostics: filteredDiagnostics
        });
        fileCount++;
      }
    }
    
    ctx.sendResponse(requestId, { diagnostics: result });
  } catch (error: any) {
    ctx.sendError(requestId, 'GET_WORKSPACE_DIAGNOSTICS_ERROR', error.message || t('webview.errors.getWorkspaceDiagnosticsFailed'));
  }
};

/**
 * 注册上下文处理器
 */
export function registerContextHandlers(registry: Map<string, MessageHandler>): void {
  registry.set('context.getStatus', getContextStatus);
  registry.set('context.compact', compactContext);
  registry.set('getContextAwarenessConfig', getContextAwarenessConfig);
  registry.set('updateContextAwarenessConfig', updateContextAwarenessConfig);
  registry.set('getOpenTabs', getOpenTabs);
  registry.set('getActiveEditor', getActiveEditor);
  registry.set('getDiagnosticsConfig', getDiagnosticsConfig);
  registry.set('updateDiagnosticsConfig', updateDiagnosticsConfig);
  registry.set('getWorkspaceDiagnostics', getWorkspaceDiagnostics);
}
