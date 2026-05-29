import * as vscode from 'vscode';
import * as path from 'path';
import { subAgentRunController, subAgentRunEventBus, type SubAgentRunEvent, type SubAgentRunSnapshot } from '../backend/tools/subagents';
import type { SubAgentRunConversationStore } from '../backend/tools/subagents/runEventBus';
import { WEBVIEW_CLIENT_IDS } from './runtime/WebviewClientRegistry';
import type { RunScope } from '../backend/core/RunController';

/**
 * Monitor 事件 payload 瘦身字段配置。
 *
 * 修改原因：事件流是跨进程传输热路径，未来新增事件时容易无意带上长正文或工具大结果。
 * 修改方式：safe keys 使用小白名单，大字段使用显式黑名单提前剥离；真正正文继续走 getRunWindow。
 * 修改目的：让状态事件保持轻量，并把大对象防护集中在一个 helper 周围。
 */
const MONITOR_EVENT_PAYLOAD_SAFE_KEYS = new Set([
    'attempt',
    'maxAttempts',
    'error',
    'nextRetryIn',
    'status',
    'steps',
    'modelVersion',
    'duration',
    'contentCount',
    'deltaCount',
    'done',
    'toolName',
    'toolId',
    'name',
    'id',
    // 修改原因：Monitor 事件与窗口响应已经异步解耦，payload 白名单必须允许协议版本字段透传给前端。
    // 修改方式：把 contentRevision/eventSequence 纳入小字段白名单，仍然禁止 contents/response/result 等大对象。
    // 修改目的：前端可用单调字段拒绝 stale delta 和旧窗口响应，而不回退到 full snapshot。
    'contentRevision',
    'eventSequence'
]);

const MONITOR_EVENT_PAYLOAD_BIG_KEYS = new Set([
    'response',
    'content',
    'contents',
    'parts',
    'text',
    'data',
    'result'
]);

function sanitizeMonitorPayloadValue(value: unknown): unknown {
    // 修改原因：未来新增事件可能在嵌套字段里夹带 response/content/data/result 等大正文，不能只处理已知事件名。
    // 修改方式：递归白名单复制对象字段，遇到已知大字段直接丢弃，数组仅保留长度摘要。
    // 修改目的：事件通道只承载状态和计数，正文统一由 getRunWindow 拉取，避免新增事件悄悄破坏优化边界。
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return value.length > 240 ? `${value.slice(0, 240)}…` : value;
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) return { count: value.length };
    if (typeof value !== 'object') return undefined;

    const sanitized: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
        if (MONITOR_EVENT_PAYLOAD_BIG_KEYS.has(key)) {
            if (Array.isArray(nestedValue)) {
                sanitized[`${key}Count`] = nestedValue.length;
            }
            continue;
        }
        if (!MONITOR_EVENT_PAYLOAD_SAFE_KEYS.has(key)) {
            continue;
        }
        const next = sanitizeMonitorPayloadValue(nestedValue);
        if (next !== undefined) {
            sanitized[key] = next;
        }
    }
    return sanitized;
}

function cloneJsonSafeValue(value: unknown): unknown {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return undefined;
    }
}

function sanitizeLlmDeltaPart(part: unknown): Record<string, unknown> | undefined {
    if (!part || typeof part !== 'object') return undefined;
    const source = part as Record<string, any>;

    if (typeof source.text === 'string') {
        const textPart: Record<string, unknown> = { text: source.text };
        if (source.thought === true) textPart.thought = true;
        return textPart;
    }

    if (source.functionCall && typeof source.functionCall === 'object') {
        const fc = source.functionCall as Record<string, unknown>;
        const safeFunctionCall: Record<string, unknown> = {};
        for (const key of ['id', 'name', 'args', 'partialArgs', 'index', 'itemId', 'finalArgs', 'rejected']) {
            if (!(key in fc)) continue;
            const cloned = cloneJsonSafeValue(fc[key]);
            if (cloned !== undefined) safeFunctionCall[key] = cloned;
        }
        return Object.keys(safeFunctionCall).length > 0
            ? { functionCall: safeFunctionCall }
            : undefined;
    }

    return undefined;
}

function createLlmDeltaPayload(event: SubAgentRunEvent, snapshot: SubAgentRunSnapshot): Record<string, unknown> {
    const rawPayload = (event.payload || {}) as Record<string, any>;
    const rawDelta = Array.isArray(rawPayload.delta) ? rawPayload.delta : [];
    const delta = rawDelta
        .map(sanitizeLlmDeltaPart)
        .filter((part): part is Record<string, unknown> => !!part);

    const payload: Record<string, unknown> = {
        deltaCount: rawDelta.length,
        contentCount: rawPayload.contentSnapshot ? 1 : undefined,
        done: rawPayload.done === true,
        modelVersion: rawPayload.modelVersion,
        thinkingStartTime: rawPayload.thinkingStartTime,
        usage: cloneJsonSafeValue(rawPayload.usage),
        // 修改原因：llm_delta 需要轻量正文 delta 才能满足 Monitor 实时显示，但不能重新携带完整 snapshot.contents 或工具大结果。
        // 修改方式：只白名单 text/thought/functionCall 增量字段；contentSnapshot 继续只以计数提示窗口校准。
        // 修改目的：保持“实时正文走轻量 delta，大对象走 getRunWindow”的统一协议边界。
        delta: delta.length > 0 ? delta : undefined,
        contentRevision: snapshot.contentRevision,
        eventSequence: snapshot.eventSequence
    };

    for (const key of Object.keys(payload)) {
        if (payload[key] === undefined) {
            delete payload[key];
        }
    }
    return payload;
}

export function createMonitorEventPayload(event: SubAgentRunEvent, snapshot: SubAgentRunSnapshot): SubAgentRunEvent {
    // 修改原因：Monitor 的 postMessage 事件流是热路径，不能传输完整 transcript、模型长回答或工具大结果。
    // 修改方式：所有事件统一经过白名单/瘦身 helper；content_snapshot 只发 contentCount，run_completed 不发 response，未知事件也剥离大字段。
    // 修改目的：把“事件只承载状态，正文走 window”固化为单一入口，防止未来新增事件再次夹带大 payload。
    const payload = sanitizeMonitorPayloadValue(event.payload) as Record<string, unknown> | undefined;
    const nextPayload: Record<string, unknown> | undefined = payload && typeof payload === 'object'
        ? { ...payload }
        : undefined;

    if (event.type === 'content_snapshot') {
        return {
            ...event,
            payload: {
                contentCount: snapshot.contents?.length || 0,
                // 修改原因：content_snapshot 是前端强制校准窗口的边界事件，必须携带当前 transcript 修订号。
                // 修改方式：从 snapshot 下发 contentRevision/eventSequence，不携带完整 contents。
                // 修改目的：让前端能判断本地 window 是否过期，并避免把下一轮 delta 追加到旧 model 楼层。
                contentRevision: snapshot.contentRevision,
                eventSequence: snapshot.eventSequence
            }
        };
    }

    if (event.type === 'llm_delta') {
        return {
            ...event,
            payload: createLlmDeltaPayload(event, snapshot)
        };
    }

    return {
        ...event,
        payload: nextPayload
    };
}

/**
 * SubAgent Monitor 编辑器面板。
 * 内部过程进入独立 WebviewPanel，不污染主聊天时间线；前端通过 view mode 切换到 Monitor UI。
 */
export class SubAgentMonitorPanel {
    private panel?: vscode.WebviewPanel;
    private focusRunId?: string;
    private focusConversationId?: string;
    private readonly unsubscribe: () => void;
    private clientRegistration?: vscode.Disposable;
    private heartbeatTimer?: ReturnType<typeof setInterval>;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly devServerUrl?: string,
        private readonly routeMessage?: (message: any, webview: vscode.Webview) => Promise<boolean>,
        private readonly registerClient?: (clientId: string, webview: vscode.Webview, runScope?: RunScope) => vscode.Disposable,
        private readonly conversationStore?: SubAgentRunConversationStore
    ) {
        this.unsubscribe = subAgentRunEventBus.subscribe((event, snapshot) => {
            this.postEvent(event, snapshot);
        });
    }

    open(runId?: string, conversationId?: string): void {
        this.focusRunId = runId;
        this.focusConversationId = conversationId;

        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Beside);
            this.clientRegistration?.dispose();
            this.clientRegistration = this.registerClient?.(
                WEBVIEW_CLIENT_IDS.subagentMonitor,
                this.panel.webview,
                runId ? { type: 'subagent', runId, parentConversationId: conversationId } : undefined
            );
            // 修改原因：已有面板被再次 reveal 时，旧实现会重新推送完整 snapshots，导致大 transcript 二次卡顿。
            // 修改方式：只推送轻量 manifest，同步焦点后由前端按需请求当前 run window。
            // 修改目的：Monitor 任何首包/重聚焦包都不再携带所有 contents。
            this.postManifest();
            this.startHeartbeat();
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'limcode.subAgentMonitor',
            'SubAgent Monitor',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(this.context.extensionPath, 'frontend', 'dist')),
                    vscode.Uri.file(path.join(this.context.extensionPath, 'node_modules', '@vscode', 'codicons', 'dist'))
                ]
            }
        );

        this.clientRegistration?.dispose();
        this.clientRegistration = this.registerClient?.(
            WEBVIEW_CLIENT_IDS.subagentMonitor,
            this.panel.webview,
            runId ? { type: 'subagent', runId, parentConversationId: conversationId } : undefined
        );

        this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);
        this.panel.webview.onDidReceiveMessage(message => {
            this.handleMessage(message).catch(error => {
                console.error('[SubAgentMonitorPanel] Failed to handle webview message:', error);
            });
        }, undefined, this.context.subscriptions);

        this.panel.onDidDispose(() => {
            this.stopHeartbeat();
            this.clientRegistration?.dispose();
            this.clientRegistration = undefined;
            this.panel = undefined;
        }, undefined, this.context.subscriptions);
        this.startHeartbeat();
    }

    dispose(): void {
        this.unsubscribe();
        this.stopHeartbeat();
        this.clientRegistration?.dispose();
        this.clientRegistration = undefined;
        this.panel?.dispose();
        this.panel = undefined;
    }

    private startHeartbeat(): void {
        if (this.heartbeatTimer || !this.panel) return;
        /**
         * 修改原因：Monitor 卡死时前端过去只能停留在旧数据上，用户不知道连接是否还活着。
         * 修改方式：面板生命周期内定期发送轻量 heartbeat，包含 serverTime、activeRunIds 和 manifest 汇总。
         * 修改目的：前端可据此显示 live/stale/disconnected，并提供原地重置，而不是要求用户关闭重开。
         */
        this.postHeartbeat();
        this.heartbeatTimer = setInterval(() => this.postHeartbeat(), 5000);
        // 修改原因：Jest 和部分 Node 宿主会因为 heartbeat interval 保持 open handle，即使面板测试已经完成也不退出。
        // 修改方式：在支持 unref 的运行时释放定时器对事件循环存活的引用；VS Code 扩展运行时仍会按面板生命周期正常清理。
        // 修改目的：heartbeat 不能影响测试与扩展进程退出语义。
        (this.heartbeatTimer as any).unref?.();
    }

    private stopHeartbeat(): void {
        if (!this.heartbeatTimer) return;
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = undefined;
    }

    private postHeartbeat(): void {
        const getManifests = (subAgentRunEventBus as any).getManifests;
        const manifests = typeof getManifests === 'function' ? getManifests.call(subAgentRunEventBus) : [];
        this.postRoutedMessage({
            type: 'subagentMonitor.heartbeat',
            data: {
                serverTime: Date.now(),
                activeRunIds: subAgentRunController.getActiveRunIds(),
                // 修改原因：部分单元测试使用轻量 runEventBus mock，没有实现 getManifests；heartbeat 不能因此让面板打开失败。
                // 修改方式：运行时检测 getManifests，缺失时降级为空列表；真实产品路径仍发送 manifest freshness 摘要。
                // 修改目的：heartbeat 是恢复辅助信号，不应成为 Monitor 生命周期的硬依赖。
                manifests: manifests.map((manifest: any) => ({
                    runId: manifest.runId,
                    status: manifest.status,
                    contentRevision: manifest.contentRevision,
                    eventSequence: manifest.eventSequence,
                    updatedAt: manifest.updatedAt
                }))
            }
        });
    }

    private async handleMessage(message: any): Promise<void> {
        if (!message || typeof message !== 'object') return;
        const clientId = typeof message.clientId === 'string' && message.clientId.trim()
            ? message.clientId.trim()
            : WEBVIEW_CLIENT_IDS.subagentMonitor;

        if (message.type === 'subagents.monitorReady') {
            // 修改原因：monitorReady 是打开 Monitor 的首包，不能继续返回包含完整 contents 的 snapshots。
            // 修改方式：返回由事件总线从 snapshot 派生的 manifests；Content[] 仅通过 getRunWindow 按 run 拉取。
            // 修改目的：大输出不会在首屏阶段进入 stringify/postMessage/deserialize/Vue state/Markdown 渲染链路。
            await this.loadConversationSnapshotsIfPossible(this.focusConversationId);
            this.postRoutedMessage({
                type: 'response',
                requestId: message.requestId,
                success: true,
                data: this.createManifestPayload()
            }, clientId);
            this.postHeartbeat();
            return;
        }

        if (message.type === 'subagents.monitor.getRunWindow') {
            const runId = typeof message.data?.runId === 'string' ? message.data.runId.trim() : '';
            if (!runId) {
                this.postRoutedMessage({
                    type: 'error',
                    requestId: message.requestId,
                    success: false,
                    error: { code: 'SUBAGENT_MONITOR_WINDOW_INVALID_INPUT', message: 'runId is required' }
                }, clientId);
                return;
            }

            // 修改原因：历史 run 可能来自 conversation metadata，打开窗口前需先恢复到事件总线，但不能把恢复后的完整 snapshot 推给前端。
            // 修改方式：若请求带 conversationId 或当前面板有 focusConversationId，先加载 metadata，再只返回指定 run 的窗口。
            // 修改目的：兼容历史 Monitor 查看，同时保持按需加载边界。
            await this.loadConversationSnapshotsIfPossible(
                typeof message.data?.conversationId === 'string' ? message.data.conversationId : this.focusConversationId
            );
            const contentWindow = subAgentRunEventBus.getContentWindow(runId, message.data?.options || {});
            if (!contentWindow) {
                this.postRoutedMessage({
                    type: 'error',
                    requestId: message.requestId,
                    success: false,
                    error: { code: 'SUBAGENT_RUN_NOT_FOUND', message: `SubAgent run not found: ${runId}` }
                }, clientId);
                return;
            }
            this.postRoutedMessage({
                type: 'response',
                requestId: message.requestId,
                success: true,
                data: {
                    window: contentWindow,
                    manifest: subAgentRunEventBus.getManifest(runId),
                    activeRunIds: subAgentRunController.getActiveRunIds()
                }
            }, clientId);
            return;
        }

        if (this.routeMessage && this.panel) {
            // 非 lifecycle 消息委托给主聊天统一 MessageRouter，避免 Monitor 复制 handler 或让 diff/tool 操作 pending。
            const handled = await this.routeMessage(message, this.panel.webview);
            if (!handled && message.requestId) {
                this.postRoutedMessage({
                    type: 'error',
                    requestId: message.requestId,
                    success: false,
                    error: {
                        code: 'UNKNOWN_TYPE',
                        message: `Unknown message type: ${message.type}`
                    }
                }, clientId);
            }
        }
    }

    private postRoutedMessage(message: Record<string, any>, clientId = WEBVIEW_CLIENT_IDS.subagentMonitor): void {
        this.panel?.webview.postMessage({
            ...message,
            clientId
        });
    }

    private postEvent(event: SubAgentRunEvent, snapshot: SubAgentRunSnapshot): void {
        this.postRoutedMessage({
            type: 'subagentMonitor.event',
            data: {
                event: createMonitorEventPayload(event, snapshot),
                // 修改原因：无论高频 llm_delta 还是低频 content_snapshot/run_completed，都不能再附完整 snapshot.contents。
                // 修改方式：事件推送只携带轻量 manifest；当前聚焦 run 需要校准内容时由前端 getRunWindow 拉窗口。
                // 修改目的：避免 Monitor 打开后任一低频事件再次把大 transcript 全量送入前端。
                manifest: subAgentRunEventBus.getManifest(snapshot.runId),
                focusRunId: this.focusRunId,
                focusConversationId: this.focusConversationId,
                // 控制按钮可见性以后端活跃运行控制器为准，不让前端猜测 run 是否仍活跃。
                activeRunIds: subAgentRunController.getActiveRunIds()
            }
        });
    }

    private async loadConversationSnapshotsIfPossible(conversationId?: string): Promise<void> {
        if (!conversationId || !this.conversationStore) {
            return;
        }
        // 修改原因：Monitor 面板自身不拥有 ConversationManager，但历史子 run 需要从父 conversation metadata 恢复。
        // 修改方式：ChatViewProvider 构造时注入 conversationStore seam；这里仅按 conversationId 恢复到事件总线。
        // 修改目的：不在 MessageRouter 写 endpoint 特判，也不新增 Monitor 独立状态真源。
        await subAgentRunEventBus.loadConversationSnapshots(conversationId, this.conversationStore);
    }

    private createManifestPayload(): Record<string, any> {
        return {
            manifests: subAgentRunEventBus.getManifests(),
            focusRunId: this.focusRunId,
            focusConversationId: this.focusConversationId,
            // 历史 run 只允许查看；控制按钮以仍有主工具 Promise 等待的 activeRunIds 为准。
            activeRunIds: subAgentRunController.getActiveRunIds()
        };
    }

    private postManifest(): void {
        this.postRoutedMessage({
            type: 'subagentMonitor.manifest',
            data: this.createManifestPayload()
        });
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.file(path.join(this.context.extensionPath, 'frontend', 'dist', 'index.js'))
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.file(path.join(this.context.extensionPath, 'frontend', 'dist', 'index.css'))
        );
        const codiconsUri = webview.asWebviewUri(
            vscode.Uri.file(path.join(this.context.extensionPath, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css'))
        );

        const devServerUrl = this.devServerUrl;
        const devServerOrigin = devServerUrl ? new URL(devServerUrl).origin : undefined;
        const csp = [
            "default-src 'none'",
            `img-src ${webview.cspSource} https: data:`,
            `font-src ${webview.cspSource}`,
            `style-src ${webview.cspSource} 'unsafe-inline' ${devServerOrigin || ''}`,
            `script-src ${webview.cspSource} 'unsafe-inline' ${devServerOrigin || ''}`,
            `connect-src ${devServerOrigin || ''}`
        ].join('; ');
        const bootstrap = `<script>window.__LIMCODE_VIEW_MODE = 'subagentMonitor'; window.__LIMCODE_WEBVIEW_CLIENT_ID = ${JSON.stringify(WEBVIEW_CLIENT_IDS.subagentMonitor)}; window.__LIMCODE_INITIAL_RUN_ID = ${JSON.stringify(this.focusRunId || null)};</script>`;

        if (devServerUrl) {
            return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <link href="${codiconsUri}" rel="stylesheet">
  ${bootstrap}
  <title>SubAgent Monitor</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="${devServerUrl}/@vite/client"></script>
  <script type="module" src="${devServerUrl}/src/main.ts"></script>
</body>
</html>`;
        }

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <link href="${codiconsUri}" rel="stylesheet">
  <link href="${styleUri}" rel="stylesheet">
  ${bootstrap}
  <title>SubAgent Monitor</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="${scriptUri}"></script>
</body>
</html>`;
    }
}
