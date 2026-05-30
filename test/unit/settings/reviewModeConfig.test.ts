import { SettingsManager, type SettingsStorage } from '../../../backend/modules/settings/SettingsManager'
import {
  DEFAULT_SYSTEM_PROMPT_CONFIG,
  REVIEW_MODE_ID,
  REVIEW_MODE_TEMPLATE,
  REVIEW_MODE_TOOL_POLICY,
  REVIEW_PROMPT_MODE
} from '../../../backend/modules/settings/types'

class MemorySettingsStorage implements SettingsStorage {
  constructor(private readonly loaded: any = null) {}

  async load() {
    return this.loaded
  }

  async save() {
    return undefined
  }
}

describe('review mode config', () => {
  it('adds review mode to the default system prompt config', () => {
    expect(DEFAULT_SYSTEM_PROMPT_CONFIG.modes[REVIEW_MODE_ID]).toEqual(REVIEW_PROMPT_MODE)
    expect(REVIEW_PROMPT_MODE.toolPolicy).toEqual([
      'read_file',
      'list_files',
      'find_files',
      'search_in_files',
      'goto_definition',
      'find_references',
      'get_symbols',
      'history_search',
      'subagents',
      'create_review',
      'validate_review_document',
      'create_progress',
      'update_progress',
      'record_progress_milestone',
      'validate_progress_document',
      'record_review_milestone',
      'finalize_review',
      'reopen_review'
    ])
    expect(REVIEW_PROMPT_MODE.toolPolicy).toEqual(REVIEW_MODE_TOOL_POLICY)
    expect(REVIEW_MODE_TEMPLATE).toContain('do the work incrementally instead of reading everything first and writing the review only at the end')
    expect(REVIEW_MODE_TEMPLATE).toContain('Do not postpone review writing until after you have read the entire target area or the entire workspace.')
    expect(REVIEW_MODE_TEMPLATE).toContain('Work step by step: after you finish reviewing one meaningful module-level or system-level review unit')
    expect(REVIEW_MODE_TEMPLATE).toContain('Do not batch many completed modules into one delayed update.')
    expect(REVIEW_PROMPT_MODE.template).toContain('do the work incrementally instead of reading everything first and writing the review only at the end')
    expect(REVIEW_PROMPT_MODE.template).toContain('Do not postpone review writing until after you have read the entire target area or the entire workspace.')
    expect(REVIEW_PROMPT_MODE.template).toContain('Work step by step: after you finish reviewing one meaningful module-level or system-level review unit')
    expect(REVIEW_PROMPT_MODE.template).toContain('Do not batch many completed modules into one delayed update.')
  })

  it('SettingsManager preserves an existing review toolPolicy while still keeping the mode available', async () => {
    const storage = new MemorySettingsStorage({
      toolsConfig: {
        system_prompt: {
          currentModeId: 'code',
          modes: {
            code: DEFAULT_SYSTEM_PROMPT_CONFIG.modes.code,
            design: DEFAULT_SYSTEM_PROMPT_CONFIG.modes.design,
            plan: DEFAULT_SYSTEM_PROMPT_CONFIG.modes.plan,
            ask: DEFAULT_SYSTEM_PROMPT_CONFIG.modes.ask,
            review: {
              ...REVIEW_PROMPT_MODE,
              toolPolicy: ['read_file']
            }
          }
        }
      }
    })

    const manager = new SettingsManager(storage)
    await manager.initialize()

    const config = manager.getSystemPromptConfig()
    // 修改原因：SettingsManager 读取现有配置时不再强制同步 toolPolicy，否则会覆盖用户主动收窄的审查模式工具面。
    // 修改方式：保留“review mode 必须存在”的断言，但将已有 toolPolicy 的期望改为保持用户配置。
    // 目的：把“补齐缺失内置模式”和“覆盖已有用户策略”这两个行为分开测试。
    expect(config.modes.review).toBeDefined()
    expect(config.modes.review.toolPolicy).toEqual(['read_file'])
  })

  it('SettingsManager migrates old configs by adding review mode', async () => {
    const storage = new MemorySettingsStorage({
      toolsConfig: {
        system_prompt: {
          template: 'legacy'
        }
      }
    })

    const manager = new SettingsManager(storage)
    await manager.initialize()

    const config = manager.getSystemPromptConfig()
    expect(config.modes.review).toEqual(REVIEW_PROMPT_MODE)
  })
})
