import * as vscode from 'vscode';
import { registerReadFile } from '../../tools/file/read_file';

const pngBytes = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47,
    0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x01
]);

function setupWorkspace(): void {
    (vscode.workspace as any).workspaceFolders = [
        {
            name: 'workspace',
            uri: { fsPath: 'C:/repo', path: 'C:/repo', scheme: 'file' }
        }
    ];

    (vscode.Uri.joinPath as jest.Mock).mockImplementation((base: any, ...segments: string[]) => {
        const joined = [base.fsPath, ...segments].join('/');
        return { fsPath: joined, path: joined, scheme: 'file' };
    });
}

describe('read_file multimodal line range handling', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setupWorkspace();
        (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(pngBytes);
    });

    it('忽略模型为图片补出的 L0-0 占位行范围', async () => {
        const tool = registerReadFile();

        const result = await tool.handler(
            {
                path: 'image.png',
                startLine: 0,
                endLine: 0
            },
            {
                capability: {
                    supportsImages: true,
                    supportsDocuments: false,
                    supportsHistoryMultimodal: true
                }
            }
        );

        expect(result.success).toBe(true);
        expect(result.data.results[0]).toMatchObject({
            path: 'image.png',
            success: true,
            type: 'multimodal',
            mimeType: 'image/png'
        });
        expect(result.data.results[0].error).toBeUndefined();
        expect(result.multimodal).toHaveLength(1);
    });

    it('图片显式使用有效行范围时也会忽略行范围并继续读取', async () => {
        const tool = registerReadFile();

        const result = await tool.handler(
            {
                path: 'image.png',
                startLine: 1,
                endLine: 1
            },
            {
                capability: {
                    supportsImages: true,
                    supportsDocuments: false,
                    supportsHistoryMultimodal: true
                }
            }
        );

        expect(result.success).toBe(true);
        expect(result.data.results[0]).toMatchObject({
            path: 'image.png',
            success: true,
            type: 'multimodal',
            mimeType: 'image/png'
        });
        expect(result.data.results[0].error).toBeUndefined();
        expect(result.multimodal).toHaveLength(1);
    });

    it('多模态工具未启用时返回准确错误，而不是误报渠道不支持', async () => {
        const tool = registerReadFile();

        const result = await tool.handler(
            {
                path: 'image.jpg'
            },
            {
                multimodalEnabled: false,
                capability: {
                    supportsImages: false,
                    supportsDocuments: false,
                    supportsHistoryMultimodal: false
                }
            }
        );

        expect(result.success).toBe(false);
        expect(result.data.results[0]).toMatchObject({
            path: 'image.jpg',
            success: false
        });
        expect(result.data.results[0].error).toContain('多模态工具未启用');
        expect(result.data.results[0].error).not.toContain('当前渠道类型不支持图片读取');
    });
});
