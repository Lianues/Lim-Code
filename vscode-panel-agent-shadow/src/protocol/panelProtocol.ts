// 为什么要改：sendMessage、snapshot 和 delta 是 Webview 与 Extension Host 的边界契约，不能散落成任意对象字面量。
// 怎么改：把 Webview -> Host 的命令和 Host -> Webview 的事件集中定义为 discriminated union 类型。
// 目的是什么：后续每个 tracer bullet 都必须复用这条协议主干，避免 AI 再新增平行 message shape。

export type WebviewCommand = WebviewReadyCommand | ThreadSendMessageCommand | RunStopCommand;

export type WebviewReadyCommand = {
  // 为什么要改：Host 需要知道 Webview 脚本已经加载并开始监听 HostEvent 后，再发送初始 snapshot。
  // 怎么改：用一个生命周期握手命令表达“Webview 已准备好”，不让它承担业务含义。
  // 目的是什么：避免初始 snapshot 早于 Webview message listener 而丢失，同时不新增业务平行路径。
  type: "webview.ready";
};

export type ThreadSendMessageCommand = {
  // 为什么要改：发送消息不是发送裸字符串，真实 composer 以后会包含附件、选区和上下文引用。
  // 怎么改：命令携带 threadId 和 draft，Stage 1 只实现 draft.text，attachments 暂时为空数组。
  // 目的是什么：保持第一步足够小，同时避免留下未来必然推翻的 text-only 协议。
  type: "thread.sendMessage";
  threadId: string;
  draft: ComposerDraft;
};

export type RunStopCommand = {
  // 为什么要改：用户需要从 Webview 显式表达“停止当前生成”，不能让 Webview 直接操作 Host timer 或消息状态。
  // 怎么改：新增 run.stop 命令，并携带 threadId 与 runId，让 Host 精确停止对应运行。
  // 目的是什么：建立 cancel/stop 的第一条主干协议，为后续真实 runtime abort/cancel seam 留位置。
  type: "run.stop";
  threadId: string;
  runId: string;
};

export type ComposerDraft = {
  text: string;
  attachments: ComposerAttachment[];
};

export type ComposerAttachment =
  | {
      type: "file";
      id: string;
      name: string;
      uri: string;
    }
  | {
      type: "selection";
      id: string;
      name: string;
      text: string;
    }
  | ComposerImageAttachment;

export type ComposerImageAttachment = {
  // 为什么要改：用户发送图片不应该新增 sendImage 平行命令，图片应作为 composer draft 的附件进入 sendMessage 主干。
  // 怎么改：新增 image attachment，Stage 1 使用 dataUrl 承载小图片，后续可替换为 Host 管理的 URI/resource handle。
  // 目的是什么：先验证 Webview -> Host 的图片传输和 Host -> Webview 的图片渲染，同时保持消息 owner 在 Host。
  type: "image";
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
};

export type HostEvent = AgentPanelSnapshotEvent | MessageDeltaEvent;

export type AgentPanelSnapshotEvent = {
  // 为什么要改：Webview 初始化、恢复和纠偏需要一个完整状态锚点，而不是依赖零散 UI 回调。
  // 怎么改：Host 发送 agentPanel.snapshot，payload 是当前可渲染的 AgentPanelState。
  // 目的是什么：让 Extension Host 保持 domain state owner，Webview 只渲染 Host 给出的状态投影。
  type: "agentPanel.snapshot";
  state: AgentPanelState;
};

export type MessageDeltaEvent = {
  // 为什么要改：高频打字机和未来 SSE streaming 不能每个 chunk 都发送完整 snapshot，否则会重现卡顿问题。
  // 怎么改：delta 指向 thread/run/message/contentBlock，并带 seq 让 Webview 可以识别顺序。
  // 目的是什么：把高频文本追加从完整状态同步里拆出来，同时仍然保持 Host 是真实消息状态 owner。
  type: "message.delta";
  threadId: string;
  runId: string;
  messageId: string;
  contentBlockId: string;
  seq: number;
  delta: {
    type: "text";
    text: string;
  };
};

export type AgentPanelState = {
  activeThreadId: string;
  // 为什么要改：Webview 发送 run.stop 时必须知道当前可停止的 runId，但这个 runId 的 source of truth 在 Host。
  // 怎么改：snapshot 暴露一个最小 activeRun view model，当前没有运行时为 null。
  // 目的是什么：让 Stop 按钮只依赖 Host 状态，不让 Webview 自己猜测或保存 domain truth。
  activeRun: ActiveRunViewModel | null;
  threads: ThreadViewModel[];
};

export type ActiveRunViewModel = {
  threadId: string;
  runId: string;
  status: RunStatus;
};

export type RunStatus = "streaming";

export type ThreadViewModel = {
  id: string;
  title: string;
  messages: MessageViewModel[];
};

export type MessageViewModel = {
  id: string;
  role: "user" | "assistant";
  content: MessageContentBlock[];
};

export type MessageContentBlock = TextContentBlock | ImageContentBlock;

export type TextContentBlock = {
  id: string;
  type: "text";
  text: string;
};

export type ImageContentBlock = {
  // 为什么要改：Host 接收图片后需要把它作为 message 内容发回 Webview，而不是让 Webview 自己保留附件真相。
  // 怎么改：在 message content block 中新增 image 类型，当前 source 只支持 dataUrl。
  // 目的是什么：建立 Host -> Webview 的图片接收协议，后续可扩展为 webviewUri 或资源 ID，而不改变 message 主干。
  id: string;
  type: "image";
  altText: string;
  source: ImageSource;
};

export type ImageSource = {
  type: "dataUrl";
  mimeType: string;
  dataUrl: string;
};
