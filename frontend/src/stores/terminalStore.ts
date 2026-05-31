/**
 * Terminal Store - 终端状态管理
 * 
 * 管理活动终端的实时输出：
 * - 存储每个终端的输出缓冲区
 * - 处理终端输出事件
 * - 支持杀死终端
 */

import { defineStore } from 'pinia'
import { ref, computed, triggerRef } from 'vue'
import { sendToExtension, onExtensionMessageType } from '../utils/vscode'
import { useI18n } from '../composables/useI18n'
import {
  estimateMapJsonBytes,
  frontendCacheLifecycleGovernor
} from '../utils/cacheLifecycleGovernor'

const TERMINAL_CACHE_LIMITS = {
  maxTerminals: 24,
  maxBytes: 512 * 1024
}

/**
 * 终端输出事件类型（与后端对应）
 */
export interface TerminalOutputEvent {
  terminalId: string
  type: 'start' | 'output' | 'error' | 'exit'
  data?: string
  dataRef?: {
    refId: string
    terminalId: string
    byteLength: number
    previewBytes: number
    truncated: boolean
    createdAt: number
  }
  dataTruncated?: boolean
  command?: string  // start 事件时包含命令
  cwd?: string      // start 事件时包含工作目录
  shell?: string    // start 事件时包含 shell 类型
  exitCode?: number
  killed?: boolean
  duration?: number
}

/**
 * 终端状态
 */
export interface TerminalState {
  id: string
  /** 累积的输出内容 */
  output: string
  /** 被 preview 截断的输出片段 ref，用于显式按 range 拉取完整内容 */
  outputRefs?: string[]
  /** ref -> preview 文本，用于显式拉取完整输出后在 UI 中替换预览片段 */
  outputRefPreviews?: Record<string, string>
  /** 是否正在运行 */
  running: boolean
  /** 退出码（运行结束后设置） */
  exitCode?: number
  /** 是否被杀死 */
  killed?: boolean
  /** 执行时长（毫秒） */
  duration?: number
  /** 开始时间 */
  startTime: number
  /** 最后更新时间 */
  lastUpdate: number
  /** 命令（用于匹配） */
  command?: string
  /** 工作目录 */
  cwd?: string
  /** Shell 类型 */
  shell?: string
}

export const useTerminalStore = defineStore('terminal', () => {
  // ============ 状态 ============
  
  /** 活动终端状态（按终端ID索引） */
  const terminals = ref<Map<string, TerminalState>>(new Map())
  
  /** 是否已初始化监听 */
  const initialized = ref(false)
  let disposeTerminalOutputListener: (() => void) | undefined
  let disposeCacheRegistration: (() => void) | undefined
  
  // ============ 计算属性 ============
  
  /** 运行中的终端数量 */
  const runningCount = computed(() => {
    let count = 0
    terminals.value.forEach(t => {
      if (t.running) count++
    })
    return count
  })
  
  /** 是否有运行中的终端 */
  const hasRunning = computed(() => runningCount.value > 0)
  
  /** 命令到终端ID的映射（用于通过命令匹配终端） */
  const commandToTerminalId = ref<Map<string, string>>(new Map())
  
  // ============ 方法 ============
  
  /**
   * 注册终端（在工具调用开始时）
   * 不覆盖已有的终端状态
   */
  function registerTerminal(terminalId: string): void {
    // 如果终端已存在，不覆盖
    if (terminals.value.has(terminalId)) {
      return
    }
    
    const now = Date.now()
    terminals.value.set(terminalId, {
      id: terminalId,
      output: '',
      running: true,
      startTime: now,
      lastUpdate: now
    })
  }

  function removeTerminalState(terminalId: string): void {
    const terminal = terminals.value.get(terminalId)
    if (terminal?.command) {
      commandToTerminalId.value.delete(terminal.command)
    }
    terminals.value.delete(terminalId)
  }

  function estimateTerminalCacheBytes(): number {
    return estimateMapJsonBytes(terminals.value) + estimateMapJsonBytes(commandToTerminalId.value)
  }

  function pruneTerminalCache(maxEntries = TERMINAL_CACHE_LIMITS.maxTerminals, maxBytes = TERMINAL_CACHE_LIMITS.maxBytes): number {
    let removed = 0
    const sorted = Array.from(terminals.value.values()).sort((a, b) => {
      if (a.running !== b.running) return a.running ? 1 : -1
      return a.lastUpdate - b.lastUpdate
    })

    while (
      terminals.value.size > maxEntries ||
      (estimateTerminalCacheBytes() > maxBytes && terminals.value.size > 0)
    ) {
      const next = sorted.shift()
      if (!next) break
      removeTerminalState(next.id)
      removed += 1
    }

    if (removed > 0) {
      triggerRef(terminals)
      triggerRef(commandToTerminalId)
    }
    return removed
  }
  
  /**
   * 获取终端状态
   */
  function getTerminal(terminalId: string): TerminalState | undefined {
    return terminals.value.get(terminalId)
  }
  
  /**
   * 通过命令查找终端ID
   * 用于在 result 还没有返回时，通过命令参数匹配终端
   */
  function findTerminalByCommand(command: string, cwd?: string): string | undefined {
    // 精确匹配命令和工作目录
    for (const [terminalId, terminal] of terminals.value) {
      if (terminal.command === command && terminal.running) {
        if (cwd === undefined || terminal.cwd === cwd) {
          return terminalId
        }
      }
    }
    // 只匹配命令
    for (const [terminalId, terminal] of terminals.value) {
      if (terminal.command === command && terminal.running) {
        return terminalId
      }
    }
    return undefined
  }
  
  /**
   * 处理终端输出事件
   */
  function handleTerminalOutput(event: TerminalOutputEvent): void {
    const { terminalId, type, data, dataRef, command, cwd, shell, exitCode, killed, duration } = event
    
    let terminal = terminals.value.get(terminalId)
    
    const now = Date.now()
    
    switch (type) {
      case 'start':
        // 终端启动事件
        terminal = {
          id: terminalId,
          output: '',
          running: true,
          startTime: now,
          lastUpdate: now,
          command,
          cwd,
          shell
        }
        terminals.value.set(terminalId, terminal)
        
        // 建立命令到终端ID的映射
        if (command) {
          commandToTerminalId.value.set(command, terminalId)
        }
        break
        
      case 'output':
      case 'error':
        // 如果终端不存在，创建它
        if (!terminal) {
          terminal = {
            id: terminalId,
            output: '',
            running: true,
            startTime: now,
            lastUpdate: now
          }
          terminals.value.set(terminalId, terminal)
        }
        
        terminal.lastUpdate = now
        // 追加输出
        if (data) {
          terminal.output += data
        }
        if (dataRef?.refId) {
          terminal.outputRefs = [...(terminal.outputRefs || []), dataRef.refId]
          if (data) {
            terminal.outputRefPreviews = {
              ...(terminal.outputRefPreviews || {}),
              [dataRef.refId]: data
            }
          }
        }
        break
        
      case 'exit':
        // 如果终端不存在，创建它
        if (!terminal) {
          terminal = {
            id: terminalId,
            output: '',
            running: false,
            startTime: now,
            lastUpdate: now
          }
          terminals.value.set(terminalId, terminal)
        }
        
        terminal.lastUpdate = now
        // 终端结束
        terminal.running = false
        terminal.exitCode = exitCode
        terminal.killed = killed
        terminal.duration = duration
        
        // 清理命令映射
        if (terminal.command) {
          commandToTerminalId.value.delete(terminal.command)
        }
        break
    }
  }
  
  /**
   * 杀死终端
   */
  async function killTerminal(terminalId: string): Promise<{ success: boolean; output?: string; error?: string }> {
    const { t } = useI18n()
    try {
      const result = await sendToExtension<{ success: boolean; output?: string; error?: string }>('terminal.kill', {
        terminalId
      })
      
      // 更新本地状态
      const terminal = terminals.value.get(terminalId)
      if (terminal && result.success) {
        terminal.running = false
        terminal.killed = true
        if (result.output) {
          terminal.output = result.output
        }
      }
      
      return result
    } catch (error: any) {
      return {
        success: false,
        error: error.message || t('stores.terminalStore.errors.killTerminalFailed')
      }
    }
  }
  
  /**
   * 获取终端输出（用于手动刷新）
   */
  async function refreshOutput(terminalId: string): Promise<void> {
    const { t } = useI18n()
    try {
      const result = await sendToExtension<{ success: boolean; output?: string; running?: boolean; error?: string }>('terminal.getOutput', {
        terminalId
      })
      
      if (result.success) {
        const terminal = terminals.value.get(terminalId)
        if (terminal && result.output) {
          terminal.output = result.output
          terminal.running = result.running ?? terminal.running
        }
      }
    } catch (error) {
      console.error(t('stores.terminalStore.errors.refreshOutputFailed'), error)
    }
  }
  
  /**
   * 清理已完成的终端（超过指定时间）
   */
  function cleanup(maxAge: number = 5 * 60 * 1000): void {
    const now = Date.now()
    const toDelete: string[] = []
    
    terminals.value.forEach((terminal, id) => {
      if (!terminal.running && (now - terminal.lastUpdate) > maxAge) {
        toDelete.push(id)
      }
    })
    
    toDelete.forEach(id => removeTerminalState(id))
  }
  
  /**
   * 清除指定终端
   */
  function removeTerminal(terminalId: string): void {
    removeTerminalState(terminalId)
  }
  
  /**
   * 清除所有终端
   */
  function clearAll(): void {
    terminals.value.clear()
    commandToTerminalId.value.clear()
  }
  
  // ============ 初始化 ============
  
  /**
   * 初始化 store，监听终端输出事件
   */
  function initialize(): void {
    if (initialized.value) return

    disposeTerminalOutputListener = onExtensionMessageType('terminalOutput', message => {
      handleTerminalOutput(message.data as TerminalOutputEvent)
      frontendCacheLifecycleGovernor.enforceBudgets('terminal-output')
    }, 'terminalStore.output')

    disposeCacheRegistration = frontendCacheLifecycleGovernor.register({
      id: 'terminal.outputs',
      owner: 'terminalStore',
      scope: 'terminal-output',
      maxEntries: TERMINAL_CACHE_LIMITS.maxTerminals,
      maxBytes: TERMINAL_CACHE_LIMITS.maxBytes,
      getEntryCount: () => terminals.value.size,
      estimateBytes: () => estimateTerminalCacheBytes(),
      prune: context => {
        return pruneTerminalCache(
          context.maxEntries ?? TERMINAL_CACHE_LIMITS.maxTerminals,
          context.maxBytes ?? TERMINAL_CACHE_LIMITS.maxBytes
        )
      }
    })
    
    initialized.value = true
  }

  function dispose(): void {
    disposeTerminalOutputListener?.()
    disposeTerminalOutputListener = undefined
    disposeCacheRegistration?.()
    disposeCacheRegistration = undefined
    initialized.value = false
  }
  
  return {
    // 状态
    terminals,
    
    // 计算属性
    runningCount,
    hasRunning,
    
    // 方法
    registerTerminal,
    getTerminal,
    findTerminalByCommand,
    handleTerminalOutput,
    killTerminal,
    refreshOutput,
    cleanup,
    removeTerminal,
    clearAll,
    initialize,
    dispose
  }
})
