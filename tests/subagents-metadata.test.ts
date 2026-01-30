import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { createSubAgentsTool } from '../backend/tools/subagents/subagents';
import { subAgentRegistry } from '../backend/tools/subagents/registry';

describe('subagents tool metadata', () => {
    const tool = createSubAgentsTool();

    beforeEach(() => {
        subAgentRegistry.clear();
    });

    afterEach(() => {
        subAgentRegistry.clear();
    });

    it('should include runtime channel/model metadata on success', async () => {
        subAgentRegistry.register(
            {
                type: 'test_subagent_meta_success',
                name: 'TestAgentMetaSuccess',
                description: 'test agent',
                systemPrompt: 'system',
                channel: { channelId: 'channel_test', modelId: 'model_test' },
                tools: { mode: 'builtin' }
            } as any,
            async () => ({
                success: true,
                response: 'OK',
                steps: 3,
                toolCalls: [
                    {
                        tool: 'read_file',
                        args: { path: 'README.md' },
                        result: { success: true },
                        success: true,
                        duration: 12
                    }
                ],
                // 期望：后续实现会把子代理真实模型版本透出
                modelVersion: 'model_version_actual'
            } as any)
        );

        const res = await tool.handler(
            { agentName: 'TestAgentMetaSuccess', prompt: 'do something' },
            {}
        );

        expect(res.success).toBe(true);
        expect(res.data).toBeTruthy();
        expect(res.data).toMatchObject({
            agentName: 'TestAgentMetaSuccess',
            response: 'OK',
            channelId: 'channel_test',
            modelId: 'model_test',
            modelVersion: 'model_version_actual',
            steps: 3
        });
        expect(Array.isArray((res.data as any).toolCalls)).toBe(true);
    });

    it('should include runtime channel/model metadata on failure (with partialResponse)', async () => {
        subAgentRegistry.register(
            {
                type: 'test_subagent_meta_fail',
                name: 'TestAgentMetaFail',
                description: 'test agent',
                systemPrompt: 'system',
                channel: { channelId: 'channel_fail', modelId: 'model_fail' },
                tools: { mode: 'builtin' }
            } as any,
            async () => ({
                success: false,
                response: 'PARTIAL',
                steps: 2,
                toolCalls: [],
                error: 'boom',
                modelVersion: 'model_version_actual_fail'
            } as any)
        );

        const res = await tool.handler(
            { agentName: 'TestAgentMetaFail', prompt: 'do something' },
            {}
        );

        expect(res.success).toBe(false);
        expect(res.error).toBeTruthy();
        expect(res.data).toBeTruthy();
        expect(res.data).toMatchObject({
            agentName: 'TestAgentMetaFail',
            partialResponse: 'PARTIAL',
            channelId: 'channel_fail',
            modelId: 'model_fail',
            modelVersion: 'model_version_actual_fail',
            steps: 2
        });
        expect(Array.isArray((res.data as any).toolCalls)).toBe(true);
    });
});

