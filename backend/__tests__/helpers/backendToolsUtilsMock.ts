const path = require('path');

/**
 * WP13b 修改原因：多个 tool 单测在 jest.mock('../../../backend/tools/utils') 中复制
 * ensureParentDir / escapeRegExp 实现，导致共享 helper 去重被测试 mock 重新分叉。
 * 修改方式：测试 mock 只声明本文件的统一 mock factory，并通过 jest.requireActual 复用真实
 * escapeRegExp；ensureParentDir 保留可注入 createDirectory spy 的统一测试替身。
 * 修改目的：消除测试层同语义副本，同时保持各单测对 VS Code fs 调用的断言能力。
 */
export interface BackendToolsUtilsMockOptions {
  getAllWorkspaces?: (...args: any[]) => any;
  resolveUriWithInfo?: (...args: any[]) => any;
  normalizeLineEndingsToLF?: (input: string) => string;
  createDirectory?: (uri: { fsPath: string }) => Promise<unknown> | unknown;
}

export function createBackendToolsUtilsMock(options: BackendToolsUtilsMockOptions) {
  const actual = jest.requireActual('../../tools/utils');

  return {
    ...actual,
    ...(options.getAllWorkspaces
      ? { getAllWorkspaces: (...args: any[]) => options.getAllWorkspaces!(...args) }
      : {}),
    ...(options.resolveUriWithInfo
      ? { resolveUriWithInfo: (...args: any[]) => options.resolveUriWithInfo!(...args) }
      : {}),
    ...(options.normalizeLineEndingsToLF
      ? { normalizeLineEndingsToLF: (input: string) => options.normalizeLineEndingsToLF!(input) }
      : {}),
    ...(options.createDirectory
      ? {
          ensureParentDir: async (uriFsPath: string) => {
            await options.createDirectory!({ fsPath: path.dirname(uriFsPath) });
          }
        }
      : {})
  };
}
