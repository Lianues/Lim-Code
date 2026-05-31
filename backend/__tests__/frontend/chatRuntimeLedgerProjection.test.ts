import {
  applyRuntimeLedgerAwaitingConfirmationProjection,
  applyRuntimeLedgerChunkProjection,
  applyRuntimeLedgerMutationProjection,
  applyRuntimeLedgerCancelledProjection,
  applyRuntimeLedgerCompleteProjection,
  applyRuntimeLedgerErrorProjection,
  applyRuntimeLedgerToolStatusBatchProjection,
  applyRuntimeLedgerToolIterationProjection,
  applyRuntimeLedgerToolStatusProjection,
  applyRuntimeLedgerToolsExecutingProjection
} from '../../../frontend/src/stores/chat/runtimeLedgerProjection';
import type { Message, StreamChunk } from '../../../frontend/src/types';

function createState(message: Message, extras: Record<string, any> = {}) {
  return {
    allMessages: { value: [message] },
    streamingMessageId: { value: message.id },
    messageIndexById: { value: new Map([[message.id, 0]]) },
    windowStartIndex: { value: 0 },
    totalMessages: { value: 1 },
    checkpoints: { value: [] },
    historyFolded: { value: false },
    foldedMessageCount: { value: 0 },
    isLoadingMoreMessages: { value: false },
    toolResponseCache: { value: new Map() },
    activeBuild: { value: null },
    isStreaming: { value: true },
    activeStreamId: { value: 'stream-1' },
    isWaitingForResponse: { value: true },
    pendingModelOverride: { value: null },
    autoSummaryStatus: { value: null },
    _lastApprovalGatedStreamId: { value: null },
    _lastCancelledStreamId: { value: null },
    error: { value: null },
    ...extras
  } as any;
}

function createAssistantMessage(): Message {
  return {
    id: 'message-under-test',
    role: 'assistant',
    content: '',
    timestamp: 0,
    parts: []
  };
}

describe('main chat Runtime Ledger projection reducer', () => {
  it('applies text and functionCall live deltas from Runtime Ledger projection', () => {
    const message = createAssistantMessage();
    const state = createState(message);
    const args = { path: 'README.md' };
    const chunk = {
      type: 'chunk',
      conversationId: 'conversation-1',
      streamId: 'stream-1',
      runtimeLedger: {
        status: 'ok',
        ledger: {
          liveDelta: {
            type: 'chunk',
            messageId: 'msg:stream:stream-1',
            contentId: 'cnt:stream:stream-1',
            source: 'runtime-ledger',
            payload: {
              delta: [
                { text: 'hello ' },
                {
                  functionCall: {
                    id: 'call-1',
                    name: 'read_file',
                    partialArgs: JSON.stringify(args),
                    finalArgs: true
                  }
                }
              ]
            }
          }
        }
      }
    } as StreamChunk;

    // 修改原因：主聊天 chunk 热路径必须消费 Runtime Ledger projection，不能在前端本地拼接事实。
    // 修改方式：直接驱动新 projection reducer，锁定文本和 functionCall 都可从 backend projection 进入 Message。
    // 修改目的：为后续删除旧 chunk reducer 运行路径建立可回归的行为覆盖。
    expect(applyRuntimeLedgerChunkProjection(chunk, state)).toBe(true);
    expect(state.allMessages.value[0].content).toBe('hello ');
    expect(state.allMessages.value[0].tools).toEqual([expect.objectContaining({
      id: 'call-1',
      name: 'read_file',
      args,
      status: 'queued'
    })]);
  });

  it('hydrates tool status from Runtime Ledger projection instead of raw transport toolStatus fields', () => {
    const message = createAssistantMessage();
    message.tools = [{
      id: 'call-1',
      name: 'read_file',
      args: {},
      partialArgs: '{"path"',
      status: 'streaming'
    }];
    const state = createState(message);
    const chunk = {
      type: 'toolStatus',
      conversationId: 'conversation-1',
      streamId: 'stream-1',
      toolStatus: true,
      tool: { id: 'call-1', name: 'ignored_transport', status: 'error' },
      runtimeLedger: {
        status: 'ok',
        ledger: {
          toolStatesByInvocationId: {
            'tool:chat:call-1': 'executing'
          },
          toolSnapshotsByInvocationId: {
            'tool:chat:call-1': {
              id: 'call-1',
              name: 'read_file',
              status: 'executing',
              args: { path: 'README.md' }
            }
          }
        }
      }
    } as StreamChunk;

    expect(applyRuntimeLedgerToolStatusProjection(chunk, state)).toBe(true);
    expect(state.allMessages.value[0].tools?.[0]).toMatchObject({
      id: 'call-1',
      name: 'read_file',
      status: 'executing',
      args: { path: 'README.md' },
      partialArgs: undefined
    });
  });

  it('applies batched Runtime Ledger tool status projections', () => {
    const message = createAssistantMessage();
    message.tools = [
      { id: 'call-1', name: 'read_file', args: {}, status: 'queued' },
      { id: 'call-2', name: 'write_file', args: {}, status: 'queued' }
    ];
    const state = createState(message);
    const chunks = ['call-1', 'call-2'].map(id => ({
      type: 'toolStatus',
      conversationId: 'conversation-1',
      streamId: 'stream-1',
      toolStatus: true,
      tool: { id, name: id, status: 'queued' },
      runtimeLedger: {
        status: 'ok',
        ledger: {
          toolStatesByInvocationId: { [`tool:chat:${id}`]: 'success' },
          toolSnapshotsByInvocationId: {
            [`tool:chat:${id}`]: {
              id,
              name: id,
              status: 'success',
              result: { success: true }
            }
          }
        }
      }
    } as StreamChunk));

    expect(applyRuntimeLedgerToolStatusBatchProjection(chunks, state)).toEqual([]);
    expect(state.allMessages.value[0].tools?.map(tool => tool.status)).toEqual(['success', 'success']);
  });

  it('rejects degraded Runtime Ledger projections', () => {
    const message = createAssistantMessage();
    message.tools = [{ id: 'call-1', name: 'read_file', args: {}, status: 'queued' }];
    const state = createState(message);
    const degradedChunk = {
      type: 'toolStatus',
      conversationId: 'conversation-1',
      streamId: 'stream-1',
      toolStatus: true,
      tool: { id: 'call-1', name: 'read_file', status: 'queued' },
      runtimeLedger: {
        status: 'degraded',
        ledger: {
          toolStatesByInvocationId: { 'tool:chat:call-1': 'success' },
          toolSnapshotsByInvocationId: {
            'tool:chat:call-1': {
              id: 'call-1',
              name: 'read_file',
              status: 'success',
              result: { success: true }
            }
          }
        }
      }
    } as StreamChunk;

    expect(applyRuntimeLedgerToolStatusProjection(degradedChunk, state)).toBe(false);
    expect(state.allMessages.value[0].tools?.[0].status).toBe('queued');
  });

  it('matches unsafe tool ids through the collision-resistant Runtime Ledger invocation id', () => {
    const message = createAssistantMessage();
    message.tools = [{ id: 'call:unsafe?id', name: 'read_file', args: {}, status: 'queued' }];
    const state = createState(message);
    const chunk = {
      type: 'toolStatus',
      conversationId: 'conversation-1',
      streamId: 'stream-1',
      toolStatus: true,
      tool: { id: 'call:unsafe?id', name: 'read_file', status: 'queued' },
      runtimeLedger: {
        status: 'ok',
        ledger: {
          toolStatesByInvocationId: {
            'tool:chat:call_unsafe_id_1t1i7up': 'success'
          },
          toolSnapshotsByInvocationId: {
            'tool:chat:call_unsafe_id_1t1i7up': {
              id: 'call:unsafe?id',
              name: 'read_file',
              status: 'success',
              result: { success: true }
            }
          }
        }
      }
    } as StreamChunk;

    expect(applyRuntimeLedgerToolStatusProjection(chunk, state)).toBe(true);
    expect(state.allMessages.value[0].tools?.[0].status).toBe('success');
  });

  it('applies toolsExecuting terminal content and queue state from Runtime Ledger projection', () => {
    const message = createAssistantMessage();
    message.localOnly = true;
    message.streaming = true;
    message.tools = [
      { id: 'call-1', name: 'read_file', args: {}, partialArgs: '{"path"', status: 'streaming' },
      { id: 'call-2', name: 'write_file', args: {}, status: 'streaming' }
    ];
    const state = createState(message);
    const chunk = {
      type: 'toolsExecuting',
      conversationId: 'conversation-1',
      streamId: 'stream-1',
      runtimeLedger: {
        status: 'ok',
        ledger: {
          terminalContent: {
            type: 'toolsExecuting',
            messageId: 'msg:stream:stream-1',
            contentId: 'cnt:stream:stream-1',
            source: 'runtime-ledger',
            content: {
              role: 'model',
              parts: [
                { functionCall: { id: 'call-1', name: 'read_file', args: { path: 'a.txt' } } },
                { functionCall: { id: 'call-2', name: 'write_file', args: { path: 'b.txt' } } }
              ]
            },
            pendingToolCalls: [
              { id: 'call-1', name: 'read_file', args: { path: 'a.txt' } },
              { id: 'call-2', name: 'write_file', args: { path: 'b.txt' } }
            ]
          }
        }
      }
    } as StreamChunk;

    expect(applyRuntimeLedgerToolsExecutingProjection(chunk, state)).toBe(true);
    expect(state.isStreaming.value).toBe(true);
    expect(state.allMessages.value[0]).toMatchObject({
      localOnly: false,
      streaming: false
    });
    expect(state.allMessages.value[0].tools).toEqual([
      expect.objectContaining({ id: 'call-1', args: { path: 'a.txt' }, status: 'executing' }),
      expect.objectContaining({ id: 'call-2', args: { path: 'b.txt' }, status: 'queued' })
    ]);
  });

  it('applies awaitingConfirmation results and hidden functionResponse from Runtime Ledger projection', () => {
    const message = createAssistantMessage();
    message.tools = [
      { id: 'call-done', name: 'read_file', args: {}, status: 'executing' },
      { id: 'call-pending', name: 'write_file', args: {}, status: 'queued' }
    ];
    const state = createState(message);
    const addCheckpoint = jest.fn();
    const chunk = {
      type: 'awaitingConfirmation',
      conversationId: 'conversation-1',
      streamId: 'stream-1',
      toolResults: [{ id: 'source-wrong', name: 'read_file', result: { success: false } }],
      checkpoints: [{ id: 'cp-1', conversationId: 'conversation-1', messageIndex: 1, timestamp: 1 } as any],
      runtimeLedger: {
        status: 'ok',
        ledger: {
          terminalContent: {
            type: 'awaitingConfirmation',
            messageId: 'msg:stream:stream-1',
            contentId: 'cnt:stream:stream-1',
            source: 'runtime-ledger',
            content: {
              role: 'model',
              parts: [
                { functionCall: { id: 'call-done', name: 'read_file', args: { path: 'a.txt' } } },
                { functionCall: { id: 'call-pending', name: 'write_file', args: { path: 'b.txt' } } }
              ]
            },
            pendingToolCalls: [{ id: 'call-pending', name: 'write_file', args: { path: 'b.txt' } }],
            toolResults: [{ id: 'call-done', name: 'read_file', result: { success: true, data: 'ok' } }]
          }
        }
      }
    } as StreamChunk;

    expect(applyRuntimeLedgerAwaitingConfirmationProjection(chunk, state, addCheckpoint)).toBe(true);
    expect(state.allMessages.value[0].tools).toEqual([
      expect.objectContaining({ id: 'call-done', status: 'success', result: { success: true, data: 'ok' } }),
      expect.objectContaining({ id: 'call-pending', status: 'awaiting_approval' })
    ]);
    expect(state.allMessages.value[1]).toMatchObject({
      role: 'user',
      isFunctionResponse: true,
      parts: [{ functionResponse: { id: 'call-done', name: 'read_file', response: { success: true, data: 'ok' } } }]
    });
    expect(state.toolResponseCache.value.get('call-done')).toEqual({ success: true, data: 'ok' });
    expect(addCheckpoint).toHaveBeenCalledWith(expect.objectContaining({ id: 'cp-1' }));
    expect(state.activeStreamId.value).toBeNull();
    expect(state.isStreaming.value).toBe(false);
  });

  it('applies toolIteration results from Runtime Ledger projection and creates the next assistant placeholder', () => {
    const message = createAssistantMessage();
    message.tools = [{ id: 'call-1', name: 'read_file', args: {}, status: 'executing' }];
    const state = createState(message);
    const chunk = {
      type: 'toolIteration',
      conversationId: 'conversation-1',
      streamId: 'stream-1',
      toolResults: [{ id: 'source-wrong', name: 'read_file', result: { success: false } }],
      runtimeLedger: {
        status: 'ok',
        ledger: {
          terminalContent: {
            type: 'toolIteration',
            messageId: 'msg:stream:stream-1',
            contentId: 'cnt:stream:stream-1',
            source: 'runtime-ledger',
            content: {
              role: 'model',
              parts: [{ functionCall: { id: 'call-1', name: 'read_file', args: { path: 'a.txt' } } }]
            },
            toolResults: [{ id: 'call-1', name: 'read_file', result: { success: true, data: 'ok' } }]
          }
        }
      }
    } as StreamChunk;

    expect(applyRuntimeLedgerToolIterationProjection(chunk, state, () => 'model-under-test', jest.fn())).toBe(true);
    expect(state.allMessages.value[0].tools?.[0]).toMatchObject({
      id: 'call-1',
      status: 'success',
      result: { success: true, data: 'ok' }
    });
    expect(state.allMessages.value[1]).toMatchObject({ isFunctionResponse: true });
    expect(state.allMessages.value[2]).toMatchObject({
      role: 'assistant',
      content: '',
      streaming: true,
      localOnly: true,
      metadata: { modelVersion: 'model-under-test' }
    });
    expect(state.streamingMessageId.value).toBe(state.allMessages.value[2].id);
  });

  it('finalizes complete chunks from Runtime Ledger terminal content', () => {
    const message = createAssistantMessage();
    message.streaming = true;
    message.localOnly = true;
    const state = createState(message);
    const addCheckpoint = jest.fn();
    const updateConversationAfterMessage = jest.fn().mockResolvedValue(undefined);
    const chunk = {
      type: 'complete',
      conversationId: 'conversation-1',
      streamId: 'stream-1',
      content: { role: 'model', parts: [{ text: 'source transport ignored' }] },
      checkpoints: [{ id: 'cp-complete', conversationId: 'conversation-1', messageIndex: 1, timestamp: 1 } as any],
      runtimeLedger: {
        status: 'ok',
        ledger: {
          terminalState: {
            type: 'complete',
            messageId: 'msg:stream:stream-1',
            contentId: 'cnt:stream:stream-1',
            source: 'runtime-ledger'
          },
          terminalContent: {
            type: 'complete',
            messageId: 'msg:stream:stream-1',
            contentId: 'cnt:stream:stream-1',
            source: 'runtime-ledger',
            content: { role: 'model', parts: [{ text: 'ledger final' }] }
          }
        }
      }
    } as StreamChunk;

    expect(applyRuntimeLedgerCompleteProjection(chunk, state, addCheckpoint, updateConversationAfterMessage)).toBe(true);
    expect(state.allMessages.value[0]).toMatchObject({
      content: 'ledger final',
      streaming: false,
      localOnly: false
    });
    expect(state.streamingMessageId.value).toBeNull();
    expect(state.activeStreamId.value).toBeNull();
    expect(state.isWaitingForResponse.value).toBe(false);
    expect(addCheckpoint).toHaveBeenCalledWith(expect.objectContaining({ id: 'cp-complete' }));
    expect(updateConversationAfterMessage).toHaveBeenCalled();
  });

  it('applies cancelled and error terminal states from Runtime Ledger projection', () => {
    const message = createAssistantMessage();
    message.content = 'partial';
    message.tools = [{ id: 'call-1', name: 'read_file', args: {}, status: 'executing' }];
    const state = createState(message);
    const cancelled = {
      type: 'cancelled',
      conversationId: 'conversation-1',
      streamId: 'stream-1',
      runtimeLedger: {
        status: 'ok',
        ledger: {
          terminalState: { type: 'cancelled', messageId: 'msg', contentId: 'cnt', source: 'runtime-ledger' },
          terminalContent: {
            type: 'cancelled',
            messageId: 'msg',
            contentId: 'cnt',
            source: 'runtime-ledger',
            content: { role: 'model', parts: [{ text: 'partial' }], streamDuration: 12 }
          }
        }
      }
    } as StreamChunk;

    expect(applyRuntimeLedgerCancelledProjection(cancelled, state)).toBe(true);
    expect(state.allMessages.value[0]).toMatchObject({
      streaming: false,
      localOnly: false,
      metadata: { streamDuration: 12 },
      tools: [expect.objectContaining({ id: 'call-1', status: 'error' })]
    });

    const empty = createAssistantMessage();
    const errorState = createState(empty);
    const errored = {
      type: 'error',
      conversationId: 'conversation-1',
      streamId: 'stream-1',
      error: { code: 'SOURCE_ERROR', message: 'source transport' },
      runtimeLedger: {
        status: 'ok',
        ledger: {
          terminalState: {
            type: 'error',
            messageId: 'msg',
            contentId: 'cnt',
            source: 'runtime-ledger',
            error: { code: 'LEDGER_ERROR', message: 'ledger' }
          }
        }
      }
    } as StreamChunk;

    expect(applyRuntimeLedgerErrorProjection(errored, errorState)).toBe(true);
    expect(errorState.allMessages.value).toHaveLength(0);
    expect(errorState.error.value).toEqual({ code: 'LEDGER_ERROR', message: 'ledger' });
  });

  it('applies transcript mutation windows from Runtime Ledger projection', () => {
    const message = createAssistantMessage();
    const state = createState(message, {
      checkpoints: { value: [{ id: 'old-cp', conversationId: 'conversation-1', messageIndex: 3, timestamp: 1 }] },
      activeBuild: { value: { id: 'old-build' } },
      isLoadingMoreMessages: { value: true },
      historyFolded: { value: true },
      foldedMessageCount: { value: 8 }
    });
    const runtimeLedger = {
      status: 'ok',
      ledger: {
        mutation: {
          type: 'delete_range',
          conversationId: 'conv:chat:conversation-1',
          runId: 'run:mutation:delete_range:1',
          source: 'runtime-ledger',
          messageWindow: {
            total: 2,
            startIndex: 0,
            messages: [
              { role: 'user', parts: [{ text: 'hello' }], timestamp: 10, index: 0 },
              {
                role: 'user',
                isFunctionResponse: true,
                timestamp: 11,
                index: 1,
                parts: [{ functionResponse: { id: 'call-1', name: 'read_file', response: { success: true } } }]
              }
            ]
          },
          checkpoints: [{ id: 'cp-1', conversationId: 'conversation-1', messageIndex: 1, timestamp: 12 }],
          activeBuild: null
        }
      }
    } as any;

    expect(applyRuntimeLedgerMutationProjection(runtimeLedger, state)).toBe(true);
    expect(state.totalMessages.value).toBe(2);
    expect(state.windowStartIndex.value).toBe(0);
    expect(state.allMessages.value).toHaveLength(2);
    expect(state.allMessages.value[0]).toMatchObject({ role: 'user', content: 'hello', backendIndex: 0 });
    expect(state.allMessages.value[1]).toMatchObject({ isFunctionResponse: true, backendIndex: 1 });
    expect(state.checkpoints.value).toEqual([{ id: 'cp-1', conversationId: 'conversation-1', messageIndex: 1, timestamp: 12 }]);
    expect(state.activeBuild.value).toBeNull();
    expect(state.isLoadingMoreMessages.value).toBe(false);
    expect(state.historyFolded.value).toBe(false);
    expect(state.foldedMessageCount.value).toBe(0);
    expect(state.toolResponseCache.value.get('call-1')).toEqual({ success: true });
  });

  it('rejects degraded transcript mutation projections', () => {
    const message = createAssistantMessage();
    const state = createState(message);

    expect(applyRuntimeLedgerMutationProjection({
      status: 'degraded',
      ledger: {
        mutation: {
          type: 'delete_range',
          conversationId: 'conv',
          runId: 'run',
          messageWindow: {
            total: 0,
            startIndex: 0,
            messages: []
          }
        }
      }
    } as any, state)).toBe(false);
    expect(state.allMessages.value).toEqual([message]);
  });
});
