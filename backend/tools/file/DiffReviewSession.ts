/**
 * 单个 diff review 的生命周期协作者。
 * DiffManager 保持公开 API 与 UI 行为不变，DiffReviewSession 负责集中维护 outcome、关联 message/tool id 与定时器清理。
 */

import type { PendingDiff } from './diffManager';

export type DiffReviewSessionOutcome = 'pending' | 'accepted' | 'rejected' | 'partial' | 'timeout' | 'cancelled';

export type DiffReviewSessionPhase = 'created' | 'presented' | 'finalized';

export interface DiffReviewSessionPayload {
    id: string;
    filePath: string;
    absolutePath: string;
    originalContent: string;
    newContent: string;
    timestamp?: number;
    blocks?: PendingDiff['blocks'];
    rawDiffs?: PendingDiff['rawDiffs'];
    toolCallId?: string;
    messageId?: string;
    diffGuardWarning?: string;
    diffGuardDeletePercent?: number;
}

export interface DiffReviewSessionSnapshot {
    id: string;
    messageId?: string;
    toolCallId?: string;
    outcome: DiffReviewSessionOutcome;
    phase: DiffReviewSessionPhase;
    pendingDiff: PendingDiff;
    createdAt: number;
    presentedAt?: number;
    finalizedAt?: number;
}

export interface DiffReviewSessionOptions {
    now?: () => number;
    timeoutMs?: number;
    onFinalize?: (snapshot: DiffReviewSessionSnapshot) => void;
}

export interface DiffReviewAcceptOptions {
    partial?: boolean;
    userEditedContent?: string;
    autoSaveError?: string;
}

export interface DiffReviewRejectOptions {
    autoSaveError?: string;
}

type AutoSaveTimerCallback = (session: DiffReviewSession) => Promise<void> | void;

export class DiffReviewSession {
    private readonly clock: () => number;
    private readonly finalizeListener?: (snapshot: DiffReviewSessionSnapshot) => void;
    private outcomeValue: DiffReviewSessionOutcome;
    private phaseValue: DiffReviewSessionPhase = 'created';
    private presentedAtValue: number | undefined;
    private finalizedAtValue: number | undefined;
    private timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    private autoSaveTimer: ReturnType<typeof setTimeout> | undefined;

    private constructor(
        private readonly diff: PendingDiff,
        private readonly associatedMessageId: string | undefined,
        private readonly associatedToolCallId: string | undefined,
        options?: DiffReviewSessionOptions
    ) {
        this.clock = options?.now ?? Date.now;
        this.finalizeListener = options?.onFinalize;
        this.outcomeValue = this.outcomeFromPendingDiff(diff);

        if (options?.timeoutMs !== undefined && this.outcomeValue === 'pending') {
            this.scheduleTimeout(options.timeoutMs);
        }
    }

    public static create(payload: DiffReviewSessionPayload, options?: DiffReviewSessionOptions): DiffReviewSession {
        const timestamp = payload.timestamp ?? (options?.now ?? Date.now)();
        const pendingDiff: PendingDiff = {
            id: payload.id,
            filePath: payload.filePath,
            absolutePath: payload.absolutePath,
            originalContent: payload.originalContent,
            newContent: payload.newContent,
            timestamp,
            status: 'pending',
            blocks: payload.blocks,
            rawDiffs: payload.rawDiffs,
            toolId: payload.toolCallId,
            diffGuardWarning: payload.diffGuardWarning,
            diffGuardDeletePercent: payload.diffGuardDeletePercent
        };

        return new DiffReviewSession(pendingDiff, payload.messageId, payload.toolCallId, options);
    }

    public static fromPendingDiff(
        pendingDiff: PendingDiff,
        metadata?: { messageId?: string; toolCallId?: string },
        options?: DiffReviewSessionOptions
    ): DiffReviewSession {
        return new DiffReviewSession(
            pendingDiff,
            metadata?.messageId,
            metadata?.toolCallId ?? pendingDiff.toolId,
            options
        );
    }

    public get id(): string {
        return this.diff.id;
    }

    public get messageId(): string | undefined {
        return this.associatedMessageId;
    }

    public get toolCallId(): string | undefined {
        return this.associatedToolCallId;
    }

    public get pendingDiff(): PendingDiff {
        return this.diff;
    }

    public get outcome(): DiffReviewSessionOutcome {
        return this.outcomeValue;
    }

    public get phase(): DiffReviewSessionPhase {
        return this.phaseValue;
    }

    public get createdAt(): number {
        return this.diff.timestamp;
    }

    public get presentedAt(): number | undefined {
        return this.presentedAtValue;
    }

    public get finalizedAt(): number | undefined {
        return this.finalizedAtValue;
    }

    public get status(): DiffReviewSessionOutcome {
        return this.outcomeValue;
    }

    public markPresented(): boolean {
        if (this.outcomeValue !== 'pending' || this.phaseValue === 'finalized') {
            return false;
        }

        if (this.phaseValue !== 'presented') {
            this.phaseValue = 'presented';
            this.presentedAtValue = this.clock();
        }

        return true;
    }

    public accept(options?: DiffReviewAcceptOptions): boolean {
        if (options?.userEditedContent !== undefined) {
            this.diff.userEditedContent = options.userEditedContent;
        }
        if (options?.autoSaveError !== undefined) {
            this.diff.autoSaveError = options.autoSaveError;
        }

        return this.finalize(options?.partial ? 'partial' : 'accepted');
    }

    public reject(options?: DiffReviewRejectOptions): boolean {
        if (options?.autoSaveError !== undefined) {
            this.diff.autoSaveError = options.autoSaveError;
        }

        return this.finalize('rejected');
    }

    public cancel(): boolean {
        return this.finalize('cancelled');
    }

    public timeout(): boolean {
        return this.finalize('timeout');
    }

    public scheduleTimeout(timeoutMs: number): void {
        this.assertNonNegativeDelay(timeoutMs);
        this.clearTimeoutTimer();

        this.timeoutTimer = setTimeout(() => {
            this.timeoutTimer = undefined;
            this.timeout();
        }, timeoutMs);
    }

    public scheduleAutoSave(delayMs: number, callback: AutoSaveTimerCallback): ReturnType<typeof setTimeout> {
        this.assertNonNegativeDelay(delayMs);
        this.clearAutoSave();

        this.autoSaveTimer = setTimeout(() => {
            this.autoSaveTimer = undefined;
            if (this.outcomeValue !== 'pending') {
                return;
            }
            void callback(this);
        }, delayMs);

        return this.autoSaveTimer;
    }

    public clearAutoSave(): void {
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer);
            this.autoSaveTimer = undefined;
        }
    }

    public hasAutoSaveTimer(): boolean {
        return this.autoSaveTimer !== undefined;
    }

    public dispose(): void {
        this.clearTimeoutTimer();
        this.clearAutoSave();
    }

    public toSnapshot(): DiffReviewSessionSnapshot {
        return {
            id: this.id,
            messageId: this.messageId,
            toolCallId: this.toolCallId,
            outcome: this.outcomeValue,
            phase: this.phaseValue,
            pendingDiff: this.diff,
            createdAt: this.createdAt,
            presentedAt: this.presentedAtValue,
            finalizedAt: this.finalizedAtValue
        };
    }

    private finalize(outcome: Exclude<DiffReviewSessionOutcome, 'pending'>): boolean {
        if (this.outcomeValue !== 'pending') {
            return false;
        }

        this.outcomeValue = outcome;
        this.phaseValue = 'finalized';
        this.finalizedAtValue = this.clock();
        this.diff.status = this.toPublicPendingDiffStatus(outcome);
        this.dispose();
        this.finalizeListener?.(this.toSnapshot());
        return true;
    }

    private clearTimeoutTimer(): void {
        if (this.timeoutTimer) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = undefined;
        }
    }

    private assertNonNegativeDelay(delayMs: number): void {
        if (!Number.isFinite(delayMs) || delayMs < 0) {
            throw new Error(`DiffReviewSession timer delay must be a non-negative finite number, got ${delayMs}`);
        }
    }

    private outcomeFromPendingDiff(diff: PendingDiff): DiffReviewSessionOutcome {
        if (diff.status === 'accepted') {
            return 'accepted';
        }
        if (diff.status === 'rejected') {
            return 'rejected';
        }
        return 'pending';
    }

    private toPublicPendingDiffStatus(outcome: Exclude<DiffReviewSessionOutcome, 'pending'>): PendingDiff['status'] {
        return outcome === 'accepted' || outcome === 'partial' ? 'accepted' : 'rejected';
    }
}
