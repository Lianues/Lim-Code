import * as vscode from "vscode";
import type {
  AgentPanelState,
  ComposerAttachment,
  ComposerImageAttachment,
  HostEvent,
  ImageContentBlock,
  MessageContentBlock,
  MessageViewModel,
  RunStopCommand,
  TextContentBlock,
  ThreadSendMessageCommand,
  ThreadViewModel,
  WebviewCommand
} from "../protocol/panelProtocol";

const OPEN_VIEW_COMMAND = "vscode-panel-agent-shadow.openView";
const SHADOW_VIEW_ID = "vscode-panel-agent-shadow.view";
const DEFAULT_THREAD_ID = "default-thread";
const TYPEWRITER_INTERVAL_MS = 20;

export function activate(context: vscode.ExtensionContext): void {
  const viewProvider = new PanelAgentShadowViewProvider();

  // 为什么要改：影子实现需要从静态 Webview View 前进到可通信的 Agent Panel 主干。
  // 怎么改：继续注册唯一的 WebviewViewProvider，但 Provider 内部现在负责接收 WebviewCommand 并发送 HostEvent。
  // 目的是什么：让 sendMessage 和 delta 打字机都复用当前 Webview View 入口，避免新增 WebviewPanel 或第二套通信路径。
  const viewProviderDisposable = vscode.window.registerWebviewViewProvider(
    SHADOW_VIEW_ID,
    viewProvider,
    {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    }
  );

  // 为什么要改：命令入口应该聚焦 canonical Webview View，而不是重新创建一个独立 Panel。
  // 怎么改：执行 VS Code 自动生成的 view focus 命令。
  // 目的是什么：保留命令面板入口，同时确保用户始终进入同一条 Webview View 主干。
  const openViewDisposable = vscode.commands.registerCommand(OPEN_VIEW_COMMAND, async () => {
    await vscode.commands.executeCommand(`${SHADOW_VIEW_ID}.focus`);
  });

  context.subscriptions.push(viewProviderDisposable, openViewDisposable, viewProvider);
}

export function deactivate(): void {
  // 为什么要改：VSCode 扩展入口需要显式导出 deactivate，即使当前最小实现主要依靠 subscriptions 清理资源。
  // 怎么改：保留空实现，不在这里添加新的状态清理分支。
  // 目的是什么：让扩展生命周期完整，同时把定时器清理集中到 PanelAgentShadowViewProvider.dispose。
}

class PanelAgentShadowViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private webviewMessageDisposable?: vscode.Disposable;
  private viewDisposeDisposable?: vscode.Disposable;
  private nextId = 1;
  private readonly typewriterTimers = new Map<string, ReturnType<typeof setInterval>>();

  // 为什么要改：messages 是 Agent Panel 的 domain state，不能由 Webview input/render 直接当作真实来源。
  // 怎么改：Provider 内部先维护一个最小 AgentPanelState，Stage 1 只有一个默认 thread。
  // 目的是什么：让 Webview 只发送 command 和渲染 HostEvent，为后续 AgentSessionStore 抽取留下清晰 seam。
  private readonly state: AgentPanelState = {
    activeThreadId: DEFAULT_THREAD_ID,
    activeRun: null,
    threads: [
      {
        id: DEFAULT_THREAD_ID,
        title: "Shadow Thread",
        messages: []
      }
    ]
  };

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.webviewMessageDisposable?.dispose();
    this.viewDisposeDisposable?.dispose();

    // 为什么要改：Webview 现在需要调用 acquireVsCodeApi 并 postMessage，静态显示阶段的 enableScripts=false 已不够用。
    // 怎么改：只为当前 canonical Webview View 启用脚本，并继续不加载任何外部脚本资源。
    // 目的是什么：允许 Webview 发送 thread.sendMessage，同时把脚本能力限制在这个最小通信闭环内。
    webviewView.webview.options = {
      enableScripts: true
    };

    // 为什么要改：当前 slice 需要 input bar、Send 按钮和 HostEvent 渲染，不再只是静态 Helloween。
    // 怎么改：由 Extension Host 生成带 nonce 的最小 HTML，内联脚本只处理协议消息和渲染投影。
    // 目的是什么：先跑通 WebviewCommand -> Host -> HostEvent 主干，暂不引入 React/Vite 或前端状态库。
    webviewView.webview.html = getAgentPanelHtml(webviewView.webview);

    // 为什么要改：Webview 的生命周期可能多次 resolve，旧 listener 不清理会造成重复处理 command。
    // 怎么改：每次 resolve 前先 dispose 旧 listener，再注册当前 webview 的 onDidReceiveMessage。
    // 目的是什么：保持 sendMessage 只有一个 canonical Host handler，避免重复回复或状态分叉。
    this.webviewMessageDisposable = webviewView.webview.onDidReceiveMessage((rawCommand: unknown) => {
      this.handleWebviewCommand(rawCommand);
    });

    // 为什么要改：Webview View 被销毁后继续保存 view 引用或定时器会造成无效 postMessage。
    // 怎么改：监听 dispose，清空当前 view 引用并释放 Webview message listener。
    // 目的是什么：让这个临时 Provider 在开发 reload 和视图销毁时不会留下隐藏副作用。
    this.viewDisposeDisposable = webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = undefined;
      }
      this.webviewMessageDisposable?.dispose();
      this.webviewMessageDisposable = undefined;
    });
  }

  public dispose(): void {
    // 为什么要改：Host 打字机使用 setInterval，扩展停用时必须主动清理，不能依赖进程退出。
    // 怎么改：释放 Webview listener、view dispose listener，并清除所有 run 对应的定时器。
    // 目的是什么：避免开发期间反复 reload 后残留 timer 继续发送 delta。
    this.webviewMessageDisposable?.dispose();
    this.viewDisposeDisposable?.dispose();
    for (const timer of this.typewriterTimers.values()) {
      clearInterval(timer);
    }
    this.typewriterTimers.clear();
  }

  private handleWebviewCommand(rawCommand: unknown): void {
    const command = parseWebviewCommand(rawCommand);

    if (!command) {
      return;
    }

    if (command.type === "webview.ready") {
      this.postHostEvent({
        type: "agentPanel.snapshot",
        state: this.state
      });
      return;
    }

    if (command.type === "thread.sendMessage") {
      this.handleThreadSendMessage(command);
      return;
    }

    if (command.type === "run.stop") {
      this.handleRunStop(command);
    }
  }

  private handleThreadSendMessage(command: ThreadSendMessageCommand): void {
    const text = command.draft.text.trim();
    const imageAttachments = command.draft.attachments.filter(isComposerImageAttachment);

    if (!text && imageAttachments.length === 0) {
      return;
    }

    const thread = this.getOrCreateThread(command.threadId);
    const userMessage = this.createUserMessage(text, imageAttachments);
    const assistantMessage = this.createTextMessage("assistant", "");
    const assistantTextBlock = assistantMessage.content[0] as TextContentBlock;
    const runId = this.createId("run");

    thread.messages.push(userMessage, assistantMessage);
    this.state.activeThreadId = thread.id;
    this.state.activeRun = {
      threadId: thread.id,
      runId,
      status: "streaming"
    };

    if (thread.title === "Shadow Thread") {
      thread.title = text ? text.slice(0, 32) : `Image: ${imageAttachments[0]?.name ?? "attachment"}`;
    }

    // 为什么要改：Webview 需要先知道 assistant message 和 contentBlock 的稳定 ID，后续 delta 才能定位追加位置。
    // 怎么改：收到 sendMessage 后先发送一次完整 snapshot，包含 user message 和空 assistant placeholder。
    // 目的是什么：让高频 message.delta 只做追加，不承担创建 message 结构的责任。
    this.postHostEvent({
      type: "agentPanel.snapshot",
      state: this.state
    });

    this.startTypewriterReply({
      thread,
      runId,
      message: assistantMessage,
      contentBlock: assistantTextBlock,
      replyText: createTypewriterReplyText(text, imageAttachments.length)
    });
  }

  private handleRunStop(command: RunStopCommand): void {
    const timer = this.typewriterTimers.get(command.runId);

    if (timer) {
      clearInterval(timer);
      this.typewriterTimers.delete(command.runId);
    }

    if (this.state.activeRun?.threadId === command.threadId && this.state.activeRun.runId === command.runId) {
      this.state.activeRun = null;
    }

    // 为什么要改：Stop 是用户发给 Host 的运行控制命令，停止后 Webview 需要立刻知道当前没有可停止的 activeRun。
    // 怎么改：Host 清除 run 对应的打字机 timer，并发送一次低频 snapshot 做状态收敛。
    // 目的是什么：让 Webview 的 Stop 按钮状态来自 Host snapshot，而不是自己假设 timer 已停止。
    this.postHostEvent({
      type: "agentPanel.snapshot",
      state: this.state
    });
  }

  private startTypewriterReply(input: {
    thread: ThreadViewModel;
    runId: string;
    message: MessageViewModel;
    contentBlock: TextContentBlock;
    replyText: string;
  }): void {
    const characters = Array.from(input.replyText);
    let cursor = 0;
    let seq = 0;

    // 为什么要改：用户要求 Host 用 delta 打字机回复，并固定 20ms 间隔。
    // 怎么改：Host 维护真实 contentBlock.text，每 20ms 追加一个字符，并发送 schema 化 message.delta 给 Webview。
    // 目的是什么：模拟未来 SSE streaming 的高频增量路径，同时避免每个字符都发送完整 snapshot。
    const timer = setInterval(() => {
      const nextText = characters[cursor];

      if (!nextText) {
        clearInterval(timer);
        this.typewriterTimers.delete(input.runId);

        if (this.state.activeRun?.runId === input.runId) {
          this.state.activeRun = null;
          this.postHostEvent({
            type: "agentPanel.snapshot",
            state: this.state
          });
        }

        return;
      }

      cursor += 1;
      seq += 1;
      input.contentBlock.text += nextText;

      this.postHostEvent({
        type: "message.delta",
        threadId: input.thread.id,
        runId: input.runId,
        messageId: input.message.id,
        contentBlockId: input.contentBlock.id,
        seq,
        delta: {
          type: "text",
          text: nextText
        }
      });
    }, TYPEWRITER_INTERVAL_MS);

    this.typewriterTimers.set(input.runId, timer);
  }

  private getOrCreateThread(threadId: string): ThreadViewModel {
    const existingThread = this.state.threads.find((thread) => thread.id === threadId);

    if (existingThread) {
      return existingThread;
    }

    // 为什么要改：协议从第一版就带 threadId，Host 不能假设永远只有默认 thread。
    // 怎么改：当 Webview 传入未知 threadId 时创建一个最小 thread，而不是拒绝或落回隐式全局状态。
    // 目的是什么：保持协议面向多线程演进，同时 Stage 1 仍然只由 UI 使用默认 thread。
    const newThread: ThreadViewModel = {
      id: threadId,
      title: "Shadow Thread",
      messages: []
    };
    this.state.threads.push(newThread);
    return newThread;
  }

  private createUserMessage(text: string, imageAttachments: ComposerImageAttachment[]): MessageViewModel {
    const content: MessageContentBlock[] = [];

    if (text) {
      content.push(this.createTextBlock(text));
    }

    for (const imageAttachment of imageAttachments) {
      content.push(this.createImageBlock(imageAttachment));
    }

    return {
      id: this.createId("msg"),
      role: "user",
      content
    };
  }

  private createTextMessage(role: MessageViewModel["role"], text: string): MessageViewModel {
    return {
      id: this.createId("msg"),
      role,
      content: [this.createTextBlock(text)]
    };
  }

  private createTextBlock(text: string): TextContentBlock {
    return {
      id: this.createId("block"),
      type: "text",
      text
    };
  }

  private createImageBlock(imageAttachment: ComposerImageAttachment): ImageContentBlock {
    // 为什么要改：图片一旦离开发送草稿，就应该进入 Host 管理的 message content，而不是继续由 Webview 附件预览持有。
    // 怎么改：把 image attachment 转成 image content block，当前保留 dataUrl 作为 shadow 实现的临时图片 source。
    // 目的是什么：验证 Host -> Webview 接收图片的协议形状，同时为未来替换成资源 ID 或 webviewUri 留出 source seam。
    return {
      id: this.createId("block"),
      type: "image",
      altText: imageAttachment.name,
      source: {
        type: "dataUrl",
        mimeType: imageAttachment.mimeType,
        dataUrl: imageAttachment.dataUrl
      }
    };
  }

  private createId(prefix: string): string {
    const id = `${prefix}-${this.nextId}`;
    this.nextId += 1;
    return id;
  }

  private postHostEvent(event: HostEvent): void {
    void this.view?.webview.postMessage(event);
  }
}

function parseWebviewCommand(rawCommand: unknown): WebviewCommand | undefined {
  // 为什么要改：Webview postMessage 进入 Extension Host 时是 unknown，不能直接信任其 shape。
  // 怎么改：用轻量运行时检查筛出当前支持的 webview.ready、thread.sendMessage 和 run.stop。
  // 目的是什么：让协议类型不只停留在 TypeScript 编译期，也防止错误消息进入 Host 状态主干。
  if (!isRecord(rawCommand) || typeof rawCommand.type !== "string") {
    return undefined;
  }

  if (rawCommand.type === "webview.ready") {
    return {
      type: "webview.ready"
    };
  }

  if (rawCommand.type === "thread.sendMessage") {
    const draft = rawCommand.draft;

    if (
      typeof rawCommand.threadId === "string" &&
      isRecord(draft) &&
      typeof draft.text === "string" &&
      Array.isArray(draft.attachments)
    ) {
      return {
        type: "thread.sendMessage",
        threadId: rawCommand.threadId,
        draft: {
          text: draft.text,
          attachments: draft.attachments.flatMap(parseComposerAttachment)
        }
      };
    }
  }

  if (rawCommand.type === "run.stop") {
    if (typeof rawCommand.threadId === "string" && typeof rawCommand.runId === "string") {
      return {
        type: "run.stop",
        threadId: rawCommand.threadId,
        runId: rawCommand.runId
      };
    }
  }

  return undefined;
}

function parseComposerAttachment(rawAttachment: unknown): ComposerAttachment[] {
  // 为什么要改：Webview 发来的 attachments 是 unknown，Host 不能直接把任意 dataUrl 或对象写进 message state。
  // 怎么改：当前只接受 image attachment，并要求 dataUrl 必须是 data:image/ 开头的字符串。
  // 目的是什么：让图片协议有最小运行时边界，避免错误 attachment shape 污染 canonical message content。
  if (!isRecord(rawAttachment) || rawAttachment.type !== "image") {
    return [];
  }

  if (
    typeof rawAttachment.id === "string" &&
    typeof rawAttachment.name === "string" &&
    typeof rawAttachment.mimeType === "string" &&
    rawAttachment.mimeType.startsWith("image/") &&
    typeof rawAttachment.dataUrl === "string" &&
    rawAttachment.dataUrl.startsWith("data:image/")
  ) {
    return [
      {
        type: "image",
        id: rawAttachment.id,
        name: rawAttachment.name,
        mimeType: rawAttachment.mimeType,
        dataUrl: rawAttachment.dataUrl
      }
    ];
  }

  return [];
}

function isComposerImageAttachment(attachment: ComposerAttachment): attachment is ComposerImageAttachment {
  return attachment.type === "image";
}

function createTypewriterReplyText(text: string, imageCount: number): string {
  // 为什么要改：图片发送后，用户需要看到 Host 已经接收图片，而不是只回显文本。
  // 怎么改：根据文本和图片数量生成当前 fake assistant 的打字机回复。
  // 目的是什么：在不接真实 runtime 的前提下验证“发送图片 -> Host 接收 -> UI 可见反馈”的端到端路径。
  if (text && imageCount > 0) {
    return `你输入的是：${text}\n我还收到了 ${imageCount} 张图片。`;
  }

  if (imageCount > 0) {
    return `我收到了 ${imageCount} 张图片。`;
  }

  return `你输入的是：${text}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getAgentPanelHtml(webview: vscode.Webview): string {
  const nonce = createNonce();

  // 为什么要改：Webview 现在执行内联脚本，必须使用 nonce 和 CSP 收窄脚本执行范围。
  // 怎么改：只允许当前 nonce 的 style/script，并让页面通过 acquireVsCodeApi 发送 WebviewCommand。
  // 目的是什么：在实现最小通信闭环的同时，不把 Webview 放成任意脚本都能执行的页面。
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <title>Helloween</title>
  <style nonce="${nonce}">
    :root {
      color-scheme: light dark;
    }

    body {
      margin: 0;
      padding: 16px;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    main {
      display: flex;
      min-height: calc(100vh - 32px);
      flex-direction: column;
      gap: 12px;
    }

    h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 700;
    }

    .messages {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 8px;
      min-height: 160px;
      overflow: auto;
      padding: 8px 0;
    }

    .empty-state {
      color: var(--vscode-descriptionForeground);
      line-height: 1.5;
    }

    .message {
      border: 1px solid var(--vscode-sideBarSectionHeader-border, transparent);
      border-radius: 8px;
      padding: 8px 10px;
      background: var(--vscode-editor-background);
      line-height: 1.5;
      white-space: pre-wrap;
    }

    .message-role {
      margin-bottom: 4px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      text-transform: uppercase;
    }

    .composer {
      display: flex;
      flex-direction: column;
      gap: 8px;
      border-top: 1px solid var(--vscode-sideBarSectionHeader-border, transparent);
      padding-top: 12px;
    }

    .inputbar {
      box-sizing: border-box;
      width: 100%;
      min-height: 72px;
      resize: vertical;
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 6px;
      padding: 8px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      font-family: var(--vscode-font-family);
    }

    .image-picker {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .image-input {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }

    .attachment-preview-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .attachment-preview {
      display: flex;
      max-width: 120px;
      flex-direction: column;
      gap: 4px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }

    .attachment-preview img,
    .message-image {
      max-width: 100%;
      border: 1px solid var(--vscode-sideBarSectionHeader-border, transparent);
      border-radius: 6px;
      background: var(--vscode-editor-background);
    }

    .message-image {
      display: block;
      max-height: 240px;
      margin-top: 4px;
      object-fit: contain;
    }

    .composer-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .hint {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }

    button {
      border: 0;
      border-radius: 4px;
      padding: 6px 12px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      cursor: pointer;
    }

    button:hover {
      background: var(--vscode-button-hoverBackground);
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .secondary-button {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }

    .secondary-button:hover:not(:disabled) {
      background: var(--vscode-button-secondaryHoverBackground);
    }
  </style>
</head>
<body>
  <main>
    <h1>Helloween</h1>
    <section id="messages" class="messages" aria-live="polite"></section>
    <section class="composer" aria-label="Message composer">
      <textarea id="inputbar" class="inputbar" placeholder="输入一段文字，或者选择图片，然后点击 Send"></textarea>
      <div class="image-picker">
        <input id="imageInput" class="image-input" type="file" accept="image/*" multiple />
        <div id="attachmentPreviewList" class="attachment-preview-list" aria-label="Selected image attachments"></div>
      </div>
      <div class="composer-actions">
        <span class="hint">Ctrl/Cmd + Enter 发送，Stop 停止当前 run</span>
        <div>
          <button id="stopButton" class="secondary-button" type="button" disabled>Stop</button>
          <button id="sendButton" type="button">Send</button>
        </div>
      </div>
    </section>
  </main>

  <script nonce="${nonce}">
    // 为什么要改：Webview 只负责发送用户意图和渲染 HostEvent，不能直接成为 messages/run 的真实 owner。
    // 怎么改：维护一份来自 snapshot/delta 的 render projection，并通过 postMessage 发 thread.sendMessage 或 run.stop。
    // 目的是什么：跑通 WebviewCommand -> Host -> HostEvent 的最小闭环，为后续替换成真实前端构建留下协议主干。
    const vscode = acquireVsCodeApi();
    const messagesElement = document.getElementById('messages');
    const inputbar = document.getElementById('inputbar');
    const imageInput = document.getElementById('imageInput');
    const attachmentPreviewList = document.getElementById('attachmentPreviewList');
    const stopButton = document.getElementById('stopButton');
    const sendButton = document.getElementById('sendButton');

    let nextAttachmentId = 1;
    let pendingImageAttachments = [];
    let panelState = {
      activeThreadId: '${DEFAULT_THREAD_ID}',
      activeRun: null,
      threads: []
    };

    window.addEventListener('message', (event) => {
      handleHostEvent(event.data);
    });

    sendButton.addEventListener('click', () => {
      sendCurrentDraft();
    });

    stopButton.addEventListener('click', () => {
      stopCurrentRun();
    });

    imageInput.addEventListener('change', async () => {
      // 为什么要改：发送图片仍然要走 thread.sendMessage 的 draft.attachments，不能绕过 Host 状态主干。
      // 怎么改：Webview 只把用户选择的图片读成临时 image attachment，发送前作为 composer local state。
      // 目的是什么：让图片选择属于 UI local draft，真正的图片 message content 仍由 Host snapshot 发回后渲染。
      pendingImageAttachments = await readSelectedImages(imageInput.files);
      renderAttachmentPreview();
      renderComposerState();
    });

    inputbar.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        sendCurrentDraft();
      }
    });

    vscode.postMessage({ type: 'webview.ready' });
    renderMessages();
    renderComposerState();

    function sendCurrentDraft() {
      const text = inputbar.value.trim();
      const attachments = pendingImageAttachments.map((attachment) => ({ ...attachment }));

      if ((!text && attachments.length === 0) || panelState.activeRun) {
        return;
      }

      vscode.postMessage({
        type: 'thread.sendMessage',
        threadId: panelState.activeThreadId || '${DEFAULT_THREAD_ID}',
        draft: {
          text,
          attachments
        }
      });

      inputbar.value = '';
      imageInput.value = '';
      pendingImageAttachments = [];
      renderAttachmentPreview();
      inputbar.focus();
      sendButton.disabled = true;
    }

    function stopCurrentRun() {
      const activeRun = panelState.activeRun;

      if (!activeRun) {
        return;
      }

      // 为什么要改：Stop 是 Webview 发给 Host 的用户意图，不能由 Webview 自己清 timer 或改 domain state。
      // 怎么改：发送 run.stop，并携带 Host snapshot 提供的 threadId/runId。
      // 目的是什么：让停止动作也穿过统一 WebviewCommand -> Host handler 主干。
      vscode.postMessage({
        type: 'run.stop',
        threadId: activeRun.threadId,
        runId: activeRun.runId
      });

      stopButton.disabled = true;
    }

    function handleHostEvent(hostEvent) {
      if (!hostEvent || typeof hostEvent.type !== 'string') {
        return;
      }

      if (hostEvent.type === 'agentPanel.snapshot') {
        panelState = hostEvent.state;
        renderMessages();
        renderComposerState();
        return;
      }

      if (hostEvent.type === 'message.delta') {
        applyMessageDelta(hostEvent);
      }
    }

    function applyMessageDelta(deltaEvent) {
      const block = findContentBlock(deltaEvent.threadId, deltaEvent.messageId, deltaEvent.contentBlockId);

      if (!block || block.type !== 'text' || !deltaEvent.delta || deltaEvent.delta.type !== 'text') {
        return;
      }

      block.text += deltaEvent.delta.text;

      const blockElement = document.querySelector('[data-content-block-id="' + deltaEvent.contentBlockId + '"]');

      if (blockElement) {
        blockElement.textContent = block.text;
        messagesElement.scrollTop = messagesElement.scrollHeight;
        return;
      }

      renderMessages();
    }

    function findContentBlock(threadId, messageId, contentBlockId) {
      const thread = panelState.threads.find((candidate) => candidate.id === threadId);
      const message = thread?.messages.find((candidate) => candidate.id === messageId);
      return message?.content.find((candidate) => candidate.id === contentBlockId);
    }

    function renderComposerState() {
      const hasActiveRun = Boolean(panelState.activeRun);
      const hasDraft = Boolean(inputbar.value.trim()) || pendingImageAttachments.length > 0;
      sendButton.disabled = hasActiveRun || !hasDraft;
      stopButton.disabled = !hasActiveRun;
    }

    inputbar.addEventListener('input', () => {
      renderComposerState();
    });

    function renderAttachmentPreview() {
      attachmentPreviewList.replaceChildren();

      for (const attachment of pendingImageAttachments) {
        const item = document.createElement('div');
        item.className = 'attachment-preview';

        const image = document.createElement('img');
        image.src = attachment.dataUrl;
        image.alt = attachment.name;

        const label = document.createElement('span');
        label.textContent = attachment.name;

        item.appendChild(image);
        item.appendChild(label);
        attachmentPreviewList.appendChild(item);
      }
    }

    async function readSelectedImages(fileList) {
      const files = Array.from(fileList || []).filter((file) => file.type.startsWith('image/'));
      const attachments = [];

      for (const file of files) {
        const dataUrl = await readFileAsDataUrl(file);
        attachments.push({
          type: 'image',
          id: 'image-' + nextAttachmentId++,
          name: file.name || 'image',
          mimeType: file.type || 'image/*',
          dataUrl
        });
      }

      return attachments;
    }

    function readFileAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener('load', () => resolve(String(reader.result || '')));
        reader.addEventListener('error', () => reject(reader.error));
        reader.readAsDataURL(file);
      });
    }

    function renderMessages() {
      messagesElement.replaceChildren();

      const activeThread = panelState.threads.find((thread) => thread.id === panelState.activeThreadId);
      const messages = activeThread?.messages || [];

      if (messages.length === 0) {
        const emptyState = document.createElement('p');
        emptyState.className = 'empty-state';
        emptyState.textContent = '输入文字或选择图片，Host 会保存为 message content，并用 message.delta 每 20ms 打字回复。';
        messagesElement.appendChild(emptyState);
        return;
      }

      for (const message of messages) {
        const article = document.createElement('article');
        article.className = 'message message-' + message.role;

        const role = document.createElement('div');
        role.className = 'message-role';
        role.textContent = message.role;
        article.appendChild(role);

        for (const block of message.content) {
          if (block.type === 'text') {
            const blockElement = document.createElement('div');
            blockElement.dataset.contentBlockId = block.id;
            blockElement.textContent = block.text;
            article.appendChild(blockElement);
            continue;
          }

          if (block.type === 'image' && block.source?.type === 'dataUrl') {
            const image = document.createElement('img');
            image.className = 'message-image';
            image.dataset.contentBlockId = block.id;
            image.src = block.source.dataUrl;
            image.alt = block.altText || 'image attachment';
            article.appendChild(image);
          }
        }

        messagesElement.appendChild(article);
      }

      messagesElement.scrollTop = messagesElement.scrollHeight;
    }
  </script>
</body>
</html>`;
}

function createNonce(): string {
  const possibleCharacters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";

  // 为什么要改：CSP nonce 需要每次 HTML 生成时不同，不能使用固定字符串。
  // 怎么改：用 VS Code Extension Host 侧生成的随机字符组成 nonce，并注入 style/script 标签。
  // 目的是什么：允许当前页面执行自己的最小脚本，同时阻止未带 nonce 的脚本运行。
  for (let index = 0; index < 32; index += 1) {
    nonce += possibleCharacters.charAt(Math.floor(Math.random() * possibleCharacters.length));
  }

  return nonce;
}
