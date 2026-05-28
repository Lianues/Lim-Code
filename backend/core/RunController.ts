/**
 * RunController 是 backend 拥有的最小运行生命周期共享契约。
 * webview 只依赖这里的纯类型，避免 backend 反向依赖 webview/frontend；完整 TurnSession 状态机仍不在此承诺。
 */

/** conversation run 的最小控制键，避免调用点用隐式字符串或 view/source 特判表达运行域。 */
export interface ConversationRunScope {
  type: 'conversation';
  conversationId: string;
}

/** subagent run 的最小控制键，并保留父会话与 agent 元数据投影。 */
export interface SubAgentRunScope {
  type: 'subagent';
  runId: string;
  parentConversationId?: string;
  agentName?: string;
}

/** 最小通用运行域联合类型；调用方先看 scope 数据，再投影到 UI/storage。 */
export type RunScope = ConversationRunScope | SubAgentRunScope;

/** 可覆盖 conversation 与 subagent controller 的最小共同状态面；完整 TurnSession 状态机仍暂缓。 */
export type RunControllerStatus =
  | 'inactive'
  | 'running'
  | 'paused'
  | 'awaiting_monitor_action'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

/** 显式能力位，让共享 UI/runtime 不靠运行来源特判判断可用控制动作。 */
export interface RunControllerCapabilities {
  pause: boolean;
  resume: boolean;
  exit: boolean;
}

/** 统一控制快照，只暴露当前已共享的最小活跃态与能力位。 */
export interface RunControllerSnapshot<TScope extends RunScope = RunScope> {
  scope: TScope;
  active: boolean;
  status: RunControllerStatus;
  abortSignal?: AbortSignal;
  exitReason?: string;
  capabilities: RunControllerCapabilities;
}

/**
 * 最小统一控制器接口，覆盖 StreamAbortManager 与 SubAgentRunController 的共同语言。
 * pause/resume/exit 保持可选，避免把 subagent 能力强加给 conversation run。
 */
export interface IRunController<TScope extends RunScope = RunScope> {
  readonly scopeType: TScope['type'];
  getScopeType(): TScope['type'];
  getScope(targetId: string): TScope;
  listActiveIds(): string[];
  isActive(targetId: string): boolean;
  getAbortSignal(targetId: string): AbortSignal | undefined;
  getSnapshot(targetId: string): RunControllerSnapshot<TScope> | undefined;
  cancel(targetId: string, reason?: string): boolean;
  pause?(targetId: string): boolean;
  resume?(targetId: string): boolean;
  exit?(targetId: string, reason?: string): boolean;
}
