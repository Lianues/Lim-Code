import * as vscode from 'vscode';
import * as path from 'path';
import { subAgentRunController, subAgentRunEventBus, type SubAgentRunEvent, type SubAgentRunSnapshot } from '../backend/tools/subagents';

/**
 * SubAgent Monitor 编辑器面板。
 *
 * 修改原因：SubAgent 内部过程不应该进入主聊天时间线，但用户需要在编辑器区域实时观察 LLM 输出和内部工具调用。
 * 修改方式：创建独立 WebviewPanel，复用前端 Vue 入口，通过 window.__LIMCODE_VIEW_MODE 切换到 Monitor UI。
 * 修改目的：保持 UI 风格与主窗口统一，同时不改 conversation 保存逻辑。
 */
export class SubAgentMonitorPanel {
    private panel?: vscode.WebviewPanel;
    private focusRunId?: string;
    private focusConversationId?: string;
    private readonly unsubscribe: () => void;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly devServerUrl?: string,
        private readonly routeMessage?: (message: any, webview: vscode.Webview) => Promise<boolean>
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
            this.postSnapshot();
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

        this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);
        this.panel.webview.onDidReceiveMessage(message => {
            this.handleMessage(message).catch(error => {
                console.error('[SubAgentMonitorPanel] Failed to handle webview message:', error);
            });
        }, undefined, this.context.subscriptions);

        this.panel.onDidDispose(() => {
            this.panel = undefined;
        }, undefined, this.context.subscriptions);
    }

    dispose(): void {
        this.unsubscribe();
        this.panel?.dispose();
        this.panel = undefined;
    }

    private async handleMessage(message: any): Promise<void> {
        if (!message || typeof message !== 'object') return;

        if (message.type === 'subagents.monitorReady') {
            this.panel?.webview.postMessage({
                type: 'response',
                requestId: message.requestId,
                success: true,
                data: {
                    snapshots: subAgentRunEventBus.getSnapshots(),
                    focusRunId: this.focusRunId,
                    focusConversationId: this.focusConversationId,
                    // 修改原因：Monitor 顶部控制按钮只能作用于仍有主工具 Promise 等待的活跃 run。
                    // 修改方式：把活跃 runId 列表随 ready 响应发给前端。
                    // 修改目的：历史 run 只允许查看，避免用户误以为能复活已结束或扩展重载前的执行。
                    activeRunIds: subAgentRunController.getActiveRunIds()
                }
            });
            return;
        }

        if (this.routeMessage && this.panel) {
            // 修改原因：Monitor 复用 MessageItem/ToolMessage 后会发送 subagents、diff、tools 和 notification 请求，不能只处理 monitorReady。
            // 修改方式：把非 lifecycle 消息委托给 ChatViewProvider 的统一 MessageRouter，并让响应发回当前 WebviewPanel。
            // 修改目的：避免 Monitor 按钮 promise pending、diff 操作无响应，以及与主聊天 handler 形成两套孤岛实现。
            const handled = await this.routeMessage(message, this.panel.webview);
            if (!handled && message.requestId) {
                this.panel.webview.postMessage({
                    type: 'error',
                    requestId: message.requestId,
                    success: false,
                    error: {
                        code: 'UNKNOWN_TYPE',
                        message: `Unknown message type: ${message.type}`
                    }
                });
            }
        }
    }

    private postEvent(event: SubAgentRunEvent, snapshot: SubAgentRunSnapshot): void {
        const isLiveDelta = event.type === 'llm_delta';
        this.panel?.webview.postMessage({
            type: 'subagentMonitor.event',
            data: {
                event,
                // 修改原因：llm_delta 是高频热路径，附带完整 snapshot 会随 contents/events 增长造成 O(n²) postMessage。
                // 修改方式：实时 delta 只发送 event；状态、最终内容和控制事件仍带 snapshot 作为低频校准。
                // 修改目的：SubAgent Monitor 实时流式显示，同时避免大输出或大工具参数把 webview 卡死。
                snapshot: isLiveDelta ? undefined : snapshot,
                focusRunId: this.focusRunId,
                focusConversationId: this.focusConversationId,
                // 修改原因：pause/resume/exit 会改变 run 是否仍活跃，前端需要实时刷新控制按钮可见性。
                // 修改方式：每个 Monitor 事件都附带当前 activeRunIds 快照。
                // 修改目的：不让前端猜测状态，保持控制权以后端活跃运行控制器为准。
                activeRunIds: subAgentRunController.getActiveRunIds()
            }
        });
    }

    private postSnapshot(): void {
        this.panel?.webview.postMessage({
            type: 'subagentMonitor.snapshot',
            data: {
                snapshots: subAgentRunEventBus.getSnapshots(),
                focusRunId: this.focusRunId,
                focusConversationId: this.focusConversationId,
                activeRunIds: subAgentRunController.getActiveRunIds()
            }
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
        const bootstrap = `<script>window.__LIMCODE_VIEW_MODE = 'subagentMonitor'; window.__LIMCODE_INITIAL_RUN_ID = ${JSON.stringify(this.focusRunId || null)};</script>`;

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
