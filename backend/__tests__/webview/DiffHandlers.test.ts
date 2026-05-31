import * as vscode from 'vscode';
import type { HandlerContext } from '../../../webview/types';

const getDiffsByToolId = jest.fn();

jest.mock('../../../backend/tools/file/diffManager', () => ({
  getDiffManager: () => ({
    getDiffsByToolId
  })
}));

import { openDiffPreview } from '../../../webview/handlers/DiffHandlers';

function createContext(): HandlerContext {
  return {
    configManager: {} as any,
    channelManager: {} as any,
    conversationManager: {} as any,
    settingsManager: {} as any,
    settingsHandler: {} as any,
    mcpManager: {} as any,
    dependencyManager: {} as any,
    storagePathManager: {} as any,
    diffStorageManager: {
      loadGlobalDiff: jest.fn().mockResolvedValue(null)
    } as any,
    streamAbortControllers: new Map(),
    diffPreviewProvider: {
      setContent: jest.fn(),
      provideTextDocumentContent: jest.fn(),
      dispose: jest.fn()
    },
    sendResponse: jest.fn(),
    sendError: jest.fn()
  };
}

describe('DiffHandlers openDiffPreview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: 'C:/workspace' }, name: 'workspace' }];
    (vscode.Uri as any).parse = jest.fn((value: string) => ({ toString: () => value, path: value }));
  });

  it('prefers stored full-file apply_diff content over hunk reconstruction when result refs were truncated', async () => {
    getDiffsByToolId.mockReturnValue([{
      id: 'diff-full-file-1',
      toolId: 'call-apply-1',
      filePath: 'src/example.ts',
      absolutePath: 'C:/workspace/src/example.ts',
      originalContent: 'line 1\nfull original\nline 3',
      newContent: 'line 1\nfull updated\nline 3',
      timestamp: 2,
      status: 'accepted'
    }]);
    const ctx = createContext();

    await openDiffPreview({
      toolId: 'call-apply-1',
      toolName: 'apply_diff',
      filePaths: ['src/example.ts'],
      args: {
        path: 'src/example.ts',
        hunks: [{
          oldContent: 'full original',
          newContent: 'full updated',
          startLine: 2
        }]
      },
      result: {
        success: true,
        data: {
          file: 'src/example.ts',
          status: 'accepted',
          results: [{ index: 0, success: true, startLine: 2, endLine: 2 }]
        }
      }
    }, 'request-1', ctx);

    expect(ctx.sendResponse).toHaveBeenCalledWith('request-1', { success: true });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.diff',
      expect.anything(),
      expect.anything(),
      expect.stringContaining('src/example.ts'),
      { preview: false }
    );
    expect(ctx.diffPreviewProvider.setContent).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('diff-full-file-1'),
      'line 1\nfull original\nline 3'
    );
    expect(ctx.diffPreviewProvider.setContent).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('diff-full-file-1'),
      'line 1\nfull updated\nline 3'
    );
  });
});
