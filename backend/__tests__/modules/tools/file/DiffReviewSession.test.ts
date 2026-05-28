import { DiffReviewSession, type DiffReviewSessionSnapshot } from '../../../../tools/file/DiffReviewSession';
import type { PendingDiff } from '../../../../tools/file/diffManager';

function createSession(options?: {
    now?: () => number;
    timeoutMs?: number;
    onFinalize?: (snapshot: DiffReviewSessionSnapshot) => void;
}) {
    return DiffReviewSession.create({
        id: 'diff-1',
        messageId: 'message-1',
        toolCallId: 'tool-1',
        filePath: 'src/file.ts',
        absolutePath: 'C:/tmp/file.ts',
        originalContent: 'original',
        newContent: 'new'
    }, options);
}

describe('DiffReviewSession', () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    it('creates a pending session with associated messageId and toolCallId', () => {
        const session = createSession({ now: () => 1000 });

        expect(session.id).toBe('diff-1');
        expect(session.messageId).toBe('message-1');
        expect(session.toolCallId).toBe('tool-1');
        expect(session.outcome).toBe('pending');
        expect(session.status).toBe('pending');
        expect(session.phase).toBe('created');
        expect(session.createdAt).toBe(1000);
        expect(session.pendingDiff.status).toBe('pending');
        expect(session.pendingDiff.toolId).toBe('tool-1');
    });

    it('transitions to accepted and exposes the accepted outcome', () => {
        const finalized: DiffReviewSessionSnapshot[] = [];
        const session = createSession({
            now: () => 2000,
            onFinalize: snapshot => finalized.push(snapshot)
        });

        expect(session.accept()).toBe(true);

        expect(session.outcome).toBe('accepted');
        expect(session.phase).toBe('finalized');
        expect(session.finalizedAt).toBe(2000);
        expect(session.pendingDiff.status).toBe('accepted');
        expect(session.toSnapshot().outcome).toBe('accepted');
        expect(finalized).toHaveLength(1);
        expect(finalized[0].outcome).toBe('accepted');
    });

    it('transitions to rejected and does not finalize twice', () => {
        const finalized = jest.fn();
        const session = createSession({ onFinalize: finalized });

        expect(session.reject()).toBe(true);
        expect(session.reject()).toBe(false);
        expect(session.accept()).toBe(false);

        expect(session.outcome).toBe('rejected');
        expect(session.phase).toBe('finalized');
        expect(session.pendingDiff.status).toBe('rejected');
        expect(finalized).toHaveBeenCalledTimes(1);
    });

    it('automatically transitions to timeout when configured timeout elapses', () => {
        jest.useFakeTimers();
        const finalized = jest.fn();
        const session = createSession({ timeoutMs: 50, onFinalize: finalized });

        expect(session.outcome).toBe('pending');

        jest.advanceTimersByTime(49);
        expect(session.outcome).toBe('pending');

        jest.advanceTimersByTime(1);
        expect(session.outcome).toBe('timeout');
        expect(session.phase).toBe('finalized');
        expect(session.pendingDiff.status).toBe('rejected');
        expect(finalized).toHaveBeenCalledTimes(1);
        expect(finalized.mock.calls[0][0].outcome).toBe('timeout');
    });

    it('transitions to cancelled and notifies the finalize callback', () => {
        const finalized = jest.fn();
        const session = createSession({ now: () => 3000, onFinalize: finalized });

        expect(session.cancel()).toBe(true);

        expect(session.outcome).toBe('cancelled');
        expect(session.phase).toBe('finalized');
        expect(session.finalizedAt).toBe(3000);
        expect(session.pendingDiff.status).toBe('rejected');
        expect(finalized).toHaveBeenCalledTimes(1);
        expect(finalized.mock.calls[0][0]).toMatchObject({
            id: 'diff-1',
            messageId: 'message-1',
            toolCallId: 'tool-1',
            outcome: 'cancelled'
        });
    });

    it('tracks partial accept as an internal outcome while preserving public PendingDiff accepted status', () => {
        const session = createSession();

        expect(session.accept({ partial: true, userEditedContent: '~ | 1 | edited' })).toBe(true);

        expect(session.outcome).toBe('partial');
        expect(session.pendingDiff.status).toBe('accepted');
        expect(session.pendingDiff.userEditedContent).toBe('~ | 1 | edited');
    });

    it('wraps an existing PendingDiff without changing the public object identity', () => {
        const pendingDiff: PendingDiff = {
            id: 'diff-existing',
            filePath: 'src/existing.ts',
            absolutePath: 'C:/tmp/existing.ts',
            originalContent: 'a',
            newContent: 'b',
            timestamp: 123,
            status: 'pending',
            toolId: 'tool-existing'
        };

        const session = DiffReviewSession.fromPendingDiff(pendingDiff, { messageId: 'message-existing' });
        session.markPresented();
        session.accept();

        expect(session.pendingDiff).toBe(pendingDiff);
        expect(session.messageId).toBe('message-existing');
        expect(session.toolCallId).toBe('tool-existing');
        expect(session.phase).toBe('finalized');
        expect(pendingDiff.status).toBe('accepted');
    });
});
