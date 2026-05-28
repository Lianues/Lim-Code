import { ContextTrimService } from '../../../../modules/api/chat/services/ContextTrimService';
import type { Content } from '../../../../modules/conversation/types';

function createService(overrides: {
    history?: Content[];
    apiHistory?: Content[];
    metadata?: unknown;
    promptTokens?: number[];
} = {}) {
    const history = overrides.history ?? [];
    const apiHistory = overrides.apiHistory ?? history;
    const conversationManager = {
        getHistoryRef: jest.fn(async () => history),
        getHistoryForAPI: jest.fn(async () => apiHistory),
        getCustomMetadata: jest.fn(async () => overrides.metadata),
        setCustomMetadata: jest.fn(async () => undefined),
        updateMessagesBatch: jest.fn(async () => undefined)
    };
    const promptManager = {
        getSystemPrompt: jest.fn(() => ''),
        getDynamicContextText: jest.fn(() => '')
    };
    const tokenEstimationService = {
        countTextTokensBatch: jest.fn(async () => overrides.promptTokens ?? [0, 0]),
        countMessageTokensBatch: jest.fn(async (messages: Content[]) => messages.map(() => 1))
    };
    const messageBuilderService = {};

    return {
        service: new ContextTrimService(
            conversationManager as any,
            promptManager as any,
            tokenEstimationService as any,
            messageBuilderService as any
        ),
        conversationManager,
        promptManager,
        tokenEstimationService
    };
}

describe('ContextTrimService context management policy', () => {
    it('explicitly disabled context management returns full API history without summary boundary, trimState, or token counting', async () => {
        const history: Content[] = [
            { role: 'user', parts: [{ text: 'old user' }], tokenCountByChannel: { custom: 10 } },
            { role: 'model', parts: [{ text: 'old model' }] },
            { role: 'user', parts: [{ text: 'summary' }], isSummary: true, tokenCountByChannel: { custom: 10 } },
            { role: 'user', parts: [{ text: 'new user' }], tokenCountByChannel: { custom: 10 } }
        ];
        const { service, conversationManager, promptManager, tokenEstimationService } = createService({ history });

        const result = await service.getHistoryWithContextTrimInfo(
            'conv-disabled',
            {
                type: 'custom',
                contextManagementEnabled: false,
                contextManagementMode: 'trim',
                contextThresholdEnabled: true,
                autoSummarizeEnabled: true,
                contextThreshold: 1
            } as any,
            { includeThoughts: true } as any
        );

        expect(result.history).toBe(history);
        expect(result.trimStartIndex).toBe(0);
        expect(result.needsAutoSummarize).toBeUndefined();
        expect(result.contextManagementDecision).toEqual({
            enabled: false,
            mode: 'off',
            source: 'explicit',
            action: 'disabled'
        });
        expect(conversationManager.getHistoryForAPI).toHaveBeenCalledWith('conv-disabled', {
            includeThoughts: true,
            startIndex: 0
        });
        expect(conversationManager.getCustomMetadata).not.toHaveBeenCalled();
        expect(conversationManager.setCustomMetadata).not.toHaveBeenCalled();
        expect(promptManager.getSystemPrompt).not.toHaveBeenCalled();
        expect(tokenEstimationService.countTextTokensBatch).not.toHaveBeenCalled();
    });

    it('legacy autoSummarizeEnabled still enables summarize mode for old provider configs', async () => {
        const history: Content[] = [
            { role: 'user', parts: [{ text: 'large request' }], tokenCountByChannel: { custom: 200 } }
        ];
        const { service } = createService({ history, promptTokens: [0, 0] });

        const result = await service.getHistoryWithContextTrimInfo(
            'conv-legacy-summarize',
            {
                type: 'custom',
                autoSummarizeEnabled: true,
                contextThreshold: 10
            } as any,
            {} as any
        );

        expect(result.needsAutoSummarize).toBe(true);
        expect(result.contextManagementDecision).toEqual({
            enabled: true,
            mode: 'summarize',
            source: 'legacy',
            action: 'auto_summarize_needed'
        });
    });
});
