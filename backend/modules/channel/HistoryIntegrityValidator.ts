import type { Content } from '../conversation/types';

export type HistoryIntegrityIssueKind =
    | 'orphan_function_response'
    | 'duplicate_function_call_id'
    | 'duplicate_function_response_id';

export interface HistoryIntegrityIssue {
    kind: HistoryIntegrityIssueKind;
    callId: string;
    messageIndex: number;
    partIndex: number;
    functionName?: string;
}

export interface HistoryIntegrityValidationResult {
    valid: boolean;
    issues: HistoryIntegrityIssue[];
}

function normalizeCallId(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

export function validateHistoryIntegrity(history: Content[]): HistoryIntegrityValidationResult {
    const issues: HistoryIntegrityIssue[] = [];
    const seenFunctionCallIds = new Set<string>();
    const seenFunctionResponseIds = new Set<string>();

    for (let messageIndex = 0; messageIndex < history.length; messageIndex++) {
        const message = history[messageIndex];
        const parts = Array.isArray(message?.parts) ? message.parts : [];

        for (let partIndex = 0; partIndex < parts.length; partIndex++) {
            const part = parts[partIndex];
            const functionCallId = normalizeCallId(part.functionCall?.id);
            if (functionCallId) {
                if (seenFunctionCallIds.has(functionCallId)) {
                    issues.push({
                        kind: 'duplicate_function_call_id',
                        callId: functionCallId,
                        messageIndex,
                        partIndex,
                        functionName: part.functionCall?.name
                    });
                } else {
                    seenFunctionCallIds.add(functionCallId);
                }
            }

            const functionResponseId = normalizeCallId(part.functionResponse?.id);
            if (!functionResponseId) {
                continue;
            }

            if (seenFunctionResponseIds.has(functionResponseId)) {
                issues.push({
                    kind: 'duplicate_function_response_id',
                    callId: functionResponseId,
                    messageIndex,
                    partIndex,
                    functionName: part.functionResponse?.name
                });
            } else {
                seenFunctionResponseIds.add(functionResponseId);
            }

            if (!seenFunctionCallIds.has(functionResponseId)) {
                issues.push({
                    kind: 'orphan_function_response',
                    callId: functionResponseId,
                    messageIndex,
                    partIndex,
                    functionName: part.functionResponse?.name
                });
            }
        }
    }

    return {
        valid: issues.length === 0,
        issues
    };
}
