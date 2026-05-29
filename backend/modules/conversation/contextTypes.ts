/**
 * LimCode - 上下文管理中央事实源类型
 *
 * 修改原因：P1 方案要求 context projection、ledger、SubAgent run、artifact、Monitor window state 共享同一个中央事实源，
 * 不能继续把 schema 散落到 chat service、Monitor UI 或 SubAgent executor 里。
 * 修改方式：在 conversation 域新增共享类型、metadata key 白名单和运行时类型守卫，并由 conversation/index.ts 统一导出。
 * 修改目的：让后续 ContextOperationService、Monitor 状态机和 SubAgent 治理都消费同一套 schema，避免 monkey patch 和同义字段漂移。
 */

import type { Content } from './types';

export const CONVERSATION_METADATA_SCHEMA_VERSION = 1;

export const CONVERSATION_CONTEXT_PROJECTION_KEY = 'contextProjection';
export const CONVERSATION_CONTEXT_LEDGER_KEY = 'contextLedger';
export const CONVERSATION_ARTIFACT_REFS_KEY = 'artifactRefs';
export const CONVERSATION_MONITOR_WINDOW_STATE_KEY = 'monitorWindowState';
export const CONVERSATION_SUBAGENT_RUNS_KEY = 'subAgentRuns';

export const CONVERSATION_CUSTOM_METADATA_KEYS = [
    'trimState',
    CONVERSATION_CONTEXT_PROJECTION_KEY,
    CONVERSATION_CONTEXT_LEDGER_KEY,
    'contextFacts',
    'contextArchive',
    CONVERSATION_ARTIFACT_REFS_KEY,
    CONVERSATION_SUBAGENT_RUNS_KEY,
    CONVERSATION_MONITOR_WINDOW_STATE_KEY,
    'todoList',
    'inputPinnedFiles',
    'inputSkills',
    'promptModeConfig',
    'checkpoints',
    'pendingApprovalGate',
    'activeBuild'
] as const;

export type ConversationCustomMetadataKey = typeof CONVERSATION_CUSTOM_METADATA_KEYS[number];

export type ContextOperationKind =
    | 'status'
    | 'auto_trim'
    | 'auto_summarize'
    | 'manual_compact'
    | 'manual_summarize'
    | 'undo'
    | 'restore'
    | 'reset'
    | 'degraded'
    | 'migration';

export type ContextOperationStatus = 'pending' | 'success' | 'failed';
export type ContextProjectionMode = 'full' | 'trimmed' | 'summarized' | 'mixed' | 'readonly_legacy' | 'degraded';
export type ContextActor = 'system' | 'user' | 'slash_command' | 'migration';

export interface ContextRestoreBoundary {
    /**
     * 修改原因：有损摘要不能伪装成完整恢复，必须把能恢复到哪里写进 projection。
     * 修改方式：用 explicit boundary 记录恢复能力，而不是由 UI 根据 mode 猜测。
     * 修改目的：/context-restore 可以诚实说明是否只能恢复 projection，而不能恢复摘要前逐字细节。
     */
    kind: 'full_history' | 'projection_only' | 'lossy_summary' | 'legacy_unknown';
    message: string;
    restorableProjectionId?: string;
}

export interface VerbatimMapEntry {
    sourceIndex: number;
    targetIndex?: number;
    contentId?: string;
    note?: string;
}

export interface VerbatimMap {
    entries: VerbatimMapEntry[];
}

export interface ContextProjection {
    projectionId: string;
    predecessorId?: string;
    conversationId: string;
    createdAt: number;
    mode: ContextProjectionMode;
    startIndex: number;
    summaryMessageIndex?: number;
    summaryMessageId?: string;
    reversible: boolean;
    lossy: boolean;
    tokenEstimate?: {
        before?: number;
        after?: number;
        channelType?: string;
    };
    cause: ContextOperationKind;
    sourceLedgerEntryId?: string;
    restoreBoundary?: ContextRestoreBoundary;
    verbatimMap?: VerbatimMap;
}

export interface ContextProjectionDocument {
    schemaVersion: number;
    currentProjectionId?: string;
    projections: Record<string, ContextProjection>;
    legacyTrimStateMigratedAt?: number;
    degradedReason?: string;
}

export interface ContextLedgerEntry {
    ledgerEntryId: string;
    conversationId: string;
    operation: ContextOperationKind;
    status: ContextOperationStatus;
    createdAt: number;
    completedAt?: number;
    actor: ContextActor;
    reason: string;
    beforeProjectionId?: string;
    afterProjectionId?: string;
    range?: { startIndex: number; endIndexExclusive: number };
    reversible: boolean;
    lossy: boolean;
    tokenBefore?: number;
    tokenAfter?: number;
    error?: { code: string; message: string };
    recoveryHint?: string;
}

export interface ContextLedgerDocument {
    schemaVersion: number;
    entries: ContextLedgerEntry[];
}

export interface ContextStatusSnapshot {
    conversationId: string;
    schemaVersion: number;
    projection?: ContextProjection;
    ledgerEntryCount: number;
    lastOperation?: ContextLedgerEntry;
    historyLength?: number;
    readonlyLegacy: boolean;
    degradedReason?: string;
    nextActions: string[];
}

export interface UiStatusPayload {
    schemaVersion: number;
    kind: 'status' | 'confirmation' | 'success' | 'warning' | 'error';
    title: string;
    description: string;
    iconName: string;
    status?: ContextStatusSnapshot;
    command?: string;
    confirmationToken?: string;
    lossy?: boolean;
    reversible?: boolean;
    projectionId?: string;
    ledgerEntryId?: string;
    tokenBefore?: number;
    tokenAfter?: number;
    nextActions?: string[];
}

export interface CommandConfirmPayload extends UiStatusPayload {
    kind: 'confirmation';
    command: string;
    confirmationToken: string;
}

export interface ArtifactRef {
    artifactId: string;
    kind: 'file' | 'report' | 'transcript' | 'export' | 'other';
    uri?: string;
    path?: string;
    title?: string;
    createdAt: number;
    provenance?: Record<string, unknown>;
}

export interface ArtifactRefDocument {
    schemaVersion: number;
    refs: Record<string, ArtifactRef>;
}

export type SubAgentOutcome = 'completed' | 'failed' | 'cancelled' | 'timeout' | 'interrupted' | 'partial';

export interface SubAgentStructuredSummary {
    outcome: SubAgentOutcome;
    summary: string;
    keyFindings: string[];
    artifacts: ArtifactRef[];
    errors: Array<{ code: string; message: string }>;
    tokenStats?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        budget?: number;
    };
    provenance: {
        runId: string;
        agentName?: string;
        parentConversationId?: string;
        parentToolCallId?: string;
    };
}

export interface SubAgentRunRecord {
    runId: string;
    schemaVersion: number;
    summary?: SubAgentStructuredSummary;
    artifactRefIds?: string[];
    policySnapshot?: Record<string, unknown>;
    terminalReason?: string;
    updatedAt: number;
}

export interface MonitorWindowState {
    schemaVersion: number;
    runId?: string;
    connectionState?: 'live' | 'syncing' | 'stale' | 'gap' | 'degraded' | 'disconnected' | 'fatal';
    lastSeenAt?: number;
    lastEventSequence?: number;
    lastContentRevision?: number;
    degradedReason?: string;
}

export interface MonitorWindowStateDocument {
    schemaVersion: number;
    windows: Record<string, MonitorWindowState>;
}

export function isConversationCustomMetadataKey(key: string): key is ConversationCustomMetadataKey {
    return (CONVERSATION_CUSTOM_METADATA_KEYS as readonly string[]).includes(key);
}

export function createEmptyContextProjectionDocument(): ContextProjectionDocument {
    return { schemaVersion: CONVERSATION_METADATA_SCHEMA_VERSION, projections: {} };
}

export function createEmptyContextLedgerDocument(): ContextLedgerDocument {
    return { schemaVersion: CONVERSATION_METADATA_SCHEMA_VERSION, entries: [] };
}

export function createEmptyArtifactRefDocument(): ArtifactRefDocument {
    return { schemaVersion: CONVERSATION_METADATA_SCHEMA_VERSION, refs: {} };
}

export function createEmptyMonitorWindowStateDocument(): MonitorWindowStateDocument {
    return { schemaVersion: CONVERSATION_METADATA_SCHEMA_VERSION, windows: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

export function isContextProjection(value: unknown): value is ContextProjection {
    if (!isRecord(value)) return false;
    return typeof value.projectionId === 'string'
        && typeof value.conversationId === 'string'
        && isFiniteNumber(value.createdAt)
        && typeof value.mode === 'string'
        && isFiniteNumber(value.startIndex)
        && typeof value.reversible === 'boolean'
        && typeof value.lossy === 'boolean'
        && typeof value.cause === 'string';
}

export function isContextProjectionDocument(value: unknown): value is ContextProjectionDocument {
    if (!isRecord(value) || !isFiniteNumber(value.schemaVersion) || !isRecord(value.projections)) return false;
    return Object.values(value.projections).every(isContextProjection);
}

export function isContextLedgerEntry(value: unknown): value is ContextLedgerEntry {
    if (!isRecord(value)) return false;
    return typeof value.ledgerEntryId === 'string'
        && typeof value.conversationId === 'string'
        && typeof value.operation === 'string'
        && typeof value.status === 'string'
        && isFiniteNumber(value.createdAt)
        && typeof value.actor === 'string'
        && typeof value.reason === 'string'
        && typeof value.reversible === 'boolean'
        && typeof value.lossy === 'boolean';
}

export function isContextLedgerDocument(value: unknown): value is ContextLedgerDocument {
    if (!isRecord(value) || !isFiniteNumber(value.schemaVersion) || !Array.isArray(value.entries)) return false;
    return value.entries.every(isContextLedgerEntry);
}

export function isArtifactRefDocument(value: unknown): value is ArtifactRefDocument {
    if (!isRecord(value) || !isFiniteNumber(value.schemaVersion) || !isRecord(value.refs)) return false;
    return Object.values(value.refs).every(ref => isRecord(ref) && typeof ref.artifactId === 'string' && typeof ref.kind === 'string');
}

export function isMonitorWindowStateDocument(value: unknown): value is MonitorWindowStateDocument {
    if (!isRecord(value) || !isFiniteNumber(value.schemaVersion) || !isRecord(value.windows)) return false;
    return Object.values(value.windows).every(item => isRecord(item) && isFiniteNumber(item.schemaVersion));
}

export function getContentStableId(content: Content, index: number): string {
    /**
     * 修改原因：P1 只需要 VerbatimMap 的稳定定位，不需要提前做 P2 级 content hash chain。
     * 修改方式：优先使用已有 index/timestamp 组合，缺失时回退到数组位置。
     * 修改目的：给 projection 恢复边界提供可解释锚点，同时避免引入长期归档系统。
     */
    const sourceIndex = typeof content.index === 'number' ? content.index : index;
    const timestamp = typeof content.timestamp === 'number' ? content.timestamp : 0;
    return `content-${sourceIndex}-${timestamp}`;
}
