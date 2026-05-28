const mockCreateDirectory = jest.fn().mockResolvedValue(undefined)
const mockWriteFile = jest.fn().mockResolvedValue(undefined)
const mockGetAllWorkspaces = jest.fn()
const mockResolveUriWithInfo = jest.fn()
const mockNormalizeLineEndingsToLF = jest.fn((input: string) => input.replace(/\r\n?/g, '\n'))
const mockSyncProgressFromDesignArtifact = jest.fn().mockResolvedValue([])

jest.mock('vscode', () => ({
  workspace: {
    fs: {
      createDirectory: mockCreateDirectory,
      writeFile: mockWriteFile
    }
  },
  Uri: {
    file: (fsPath: string) => ({ fsPath })
  }
}))

jest.mock('../../../backend/tools/utils', () => {
  // WP13b：集中构造 tools/utils mock，避免每个测试复制 ensureParentDir 实现。
  const { createBackendToolsUtilsMock } = require('../../../backend/__tests__/helpers/backendToolsUtilsMock')
  return createBackendToolsUtilsMock({
    getAllWorkspaces: (...args: any[]) => mockGetAllWorkspaces(...args),
    resolveUriWithInfo: (...args: any[]) => mockResolveUriWithInfo(...args),
    normalizeLineEndingsToLF: (input: string) => mockNormalizeLineEndingsToLF(input),
    createDirectory: mockCreateDirectory
  })
})

jest.mock('../../../backend/tools/progress/autoSync', () => ({
  syncProgressFromDesignArtifact: (...args: any[]) => mockSyncProgressFromDesignArtifact(...args)
}))

import { createCreateDesignTool } from '../../../backend/tools/design/create_design'

describe('create_design tool', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAllWorkspaces.mockReturnValue([{ name: 'workspace' }])
    mockResolveUriWithInfo.mockReturnValue({
      uri: { fsPath: 'D:/workspace/.limcode/design/api-design.md' },
      error: undefined
    })
  })

  it('writes design markdown under .limcode/design and returns requiresUserConfirmation', async () => {
    const tool = createCreateDesignTool()
    const result = await tool.handler({
      title: 'API Design',
      design: '# API Design\r\n\r\n- scope'
    })

    expect(result.success).toBe(true)
    expect(result.requiresUserConfirmation).toBe(true)
    expect(result.data).toEqual({
      path: '.limcode/design/api-design.md',
      content: '# API Design\n\n- scope'
    })

    expect(mockCreateDirectory).toHaveBeenCalledWith({
      fsPath: 'D:/workspace/.limcode/design'
    })
    expect(mockWriteFile).toHaveBeenCalledTimes(1)
    expect(mockResolveUriWithInfo).toHaveBeenCalledWith('.limcode/design/api-design.md')
    expect(mockSyncProgressFromDesignArtifact).toHaveBeenCalledWith({
      designPath: '.limcode/design/api-design.md',
      title: 'API Design'
    })

    const writtenBytes = mockWriteFile.mock.calls[0][1] as Uint8Array
    expect(new TextDecoder().decode(writtenBytes)).toBe('# API Design\n\n- scope')
  })

  it('rejects paths outside .limcode/design', async () => {
    const tool = createCreateDesignTool()
    const result = await tool.handler({
      design: '# Invalid',
      path: '.limcode/plans/not-allowed.md'
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('.limcode/design/**.md')
    expect(mockResolveUriWithInfo).not.toHaveBeenCalled()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })
})
