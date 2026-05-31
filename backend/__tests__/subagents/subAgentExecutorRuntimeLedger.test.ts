import { createDefaultExecutor } from '../../tools/subagents/executor';
import { subAgentRunEventBus } from '../../tools/subagents/runEventBus';
import { subAgentRuntimeLedgerBridge } from '../../tools/subagents/runtimeLedgerBridge';
import type { SubAgentConfig, SubAgentExecutorContext } from '../../tools/subagents/types';

function config(overrides: Partial<SubAgentConfig> = {}): SubAgentConfig {
    return {
        type: 'ledger-agent',
        name: 'Ledger Agent',
        description: 'test',
        systemPrompt: 'system',
        channel: { channelId: 'test-channel' },
        tools: { mode: 'builtin' },
        maxIterations: 2,
        maxRuntime: -1,
        enabled: true,
        ...overrides
    };
}

function createContext(toolExecutionResult: Record<string, unknown>): SubAgentExecutorContext {
    return {
        channelManager: {
            generate: jest.fn(async () => ({
                content: {
                    role: 'model',
                    parts: [{
                        functionCall: {
                            id: 'tool-call-1',
                            name: 'read_file',
                            args: { path: 'README.md' }
                        }
                    }],
                    modelVersion: 'test-model'
                }
            }))
        },
        toolRegistry: {
            getAllDeclarations: jest.fn(() => [{
                name: 'read_file',
                description: 'Read a file',
                parameters: {
                    type: 'object',
                    properties: {
                        path: { type: 'string' }
                    },
                    required: ['path']
                }
            }])
        },
        configManager: {
            getConfig: jest.fn(async () => ({
                id: 'test-channel',
                type: 'gemini',
                toolMode: 'function_call',
                multimodalToolsEnabled: false
            }))
        },
        toolExecutionService: {
            executeFunctionCallsWithResults: jest.fn(async () => toolExecutionResult)
        }
    } as unknown as SubAgentExecutorContext;
}

describe('SubAgent default executor Runtime Ledger contracts', () => {
    const runIds: string[] = [];

    afterEach(() => {
        const snapshots = (subAgentRunEventBus as any).snapshots as Map<string, unknown> | undefined;
        const stores = (subAgentRunEventBus as any).stores as Map<string, unknown> | undefined;
        for (const runId of runIds.splice(0)) {
            snapshots?.delete(runId);
            stores?.delete(runId);
        }
        subAgentRuntimeLedgerBridge.resetForTests();
    });

    it('fails closed instead of synthesizing functionResponse parts when ToolExecutionService omits them', async () => {
        const runId = 'executor-missing-response-parts';
        runIds.push(runId);
        const context = createContext({
            responseParts: [],
            toolResults: [{
                id: 'tool-call-1',
                name: 'read_file',
                result: { success: true, content: 'tool result' }
            }],
            checkpoints: []
        });
        const executor = createDefaultExecutor(config(), context);

        const result = await executor({
            agentType: 'ledger-agent',
            prompt: 'Call the tool',
            runId
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('did not produce canonical functionResponse responseParts');
        expect((context.toolExecutionService as any).executeFunctionCallsWithResults).toHaveBeenCalledWith(
            [expect.objectContaining({
                id: 'tool-call-1',
                name: 'read_file',
                args: { path: 'README.md' }
            })],
            undefined,
            undefined,
            expect.objectContaining({ id: 'test-channel' }),
            expect.any(AbortSignal),
            undefined,
            expect.any(Function)
        );

        const snapshot = subAgentRunEventBus.getSnapshot(runId);
        expect(snapshot?.status).toBe('failed');
        expect(snapshot?.events.some(event =>
            event.type === 'tool_failed'
            && (event.payload as any)?.protocolError === 'missing_function_response_parts'
        )).toBe(true);

        const contentWindow = subAgentRunEventBus.getContentWindow(runId, {
            limit: 20,
            fromTail: false
        });
        const serializedContents = JSON.stringify(contentWindow?.contents || []);
        expect(serializedContents).toContain('functionCall');
        expect(serializedContents).not.toContain('functionResponse');
    });
});
