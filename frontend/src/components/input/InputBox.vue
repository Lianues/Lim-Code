<script setup lang="ts">
/**
 * InputBox - 文本输入框
 * 支持文本和上下文徽章穿插的混合输入
 * 使用 contenteditable div 实现
 */

import { ref, watch, nextTick, onMounted, onBeforeUnmount, computed } from 'vue'
import { sendToExtension } from '../../utils/vscode'
import { useI18n } from '../../i18n'
import type { PromptContextItem } from '../../types/promptContext'
import type { EditorNode } from '../../types/editorNode'
import { createTextNode, createContextNode, normalizeNodes, getPlainText } from '../../types/editorNode'
import { getFileIcon } from '../../utils/fileIcons'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  /** 编辑器节点数组（文本和上下文徽章混合） */
  nodes: EditorNode[]
  disabled?: boolean
  placeholder?: string
  maxLength?: number
  minRows?: number
  maxRows?: number
  /** Enter 键行为：true=Enter 发送（Shift+Enter 换行）；false=Enter 换行 */
  submitOnEnter?: boolean
}>(), {
  submitOnEnter: true
})

const emit = defineEmits<{
  /** 节点数组更新 */
  'update:nodes': [nodes: EditorNode[]]
  /** 删除一个上下文徽章 */
  'remove-context': [id: string]
  send: []
  'composition-start': []
  'composition-end': []
  paste: [files: File[]]
  'add-file-contexts': [files: { path: string; isDirectory: boolean }[]]  // 拖拽文件添加为徽章
  'trigger-at-picker': [query: string, triggerPosition: number]
  'close-at-picker': []
  'at-query-change': [query: string]
  'at-picker-keydown': [key: string]  // 专门用于文件选择器的键盘事件
}>()

const editorRef = ref<HTMLDivElement>()
const currentRows = ref(props.minRows || 2)

// 调整高度时的检测状态
const cachedLineHeight = ref(0)
const lastScrollHeight = ref(0)

// 拖拽状态
const isDragOver = ref(false)

// 滚动条状态
const thumbHeight = ref(0)
const thumbTop = ref(0)
const showScrollbar = ref(false)
let isDragging = false
let startY = 0
let startScrollTop = 0

// 调整高度
function adjustHeight() {
  if (!editorRef.value) return
  
  const editor = editorRef.value
  const minRows = props.minRows || 2  // 默认最少两行
  const maxRows = props.maxRows || 6
  
  // 获取并缓存行高，避免频繁读取 DOM
  if (!cachedLineHeight.value) {
    cachedLineHeight.value = parseInt(getComputedStyle(editor).lineHeight) || 20
  }
  
  const lineHeight = cachedLineHeight.value
  const minHeight = minRows * lineHeight
  
  // 核心优化：增加高度变化检测
  if (editor.scrollHeight === lastScrollHeight.value && lastScrollHeight.value !== 0) {
    return
  }

  // 重置高度以获取正确的 scrollHeight
  const oldHeight = editor.style.height
  editor.style.height = 'auto'
  
  // 获取实际内容高度
  const contentHeight = editor.scrollHeight
  
  // 计算目标高度，确保不低于最小高度
  const targetHeight = Math.max(contentHeight, minHeight)
  
  // 计算实际行数
  const rows = Math.min(
    Math.max(
      Math.ceil(targetHeight / lineHeight),
      minRows
    ),
    maxRows
  )
  
  const finalHeight = `${rows * lineHeight}px`
  
  // 只有当高度真正改变时才更新 DOM
  if (oldHeight !== finalHeight) {
    editor.style.height = finalHeight
    currentRows.value = rows
  } else {
    // 如果没变，恢复原状
    editor.style.height = oldHeight
  }
  
  // 记录本次的内容高度，用于下次对比
  lastScrollHeight.value = contentHeight
  
  // 更新滚动条
  nextTick(() => updateScrollbar())
}

// 更新滚动条状态
function updateScrollbar() {
  if (!editorRef.value) return
  
  const editor = editorRef.value
  const scrollHeight = editor.scrollHeight
  const clientHeight = editor.clientHeight
  const scrollTop = editor.scrollTop
  
  // 判断是否需要显示滚动条
  showScrollbar.value = scrollHeight > clientHeight
  
  if (!showScrollbar.value) return
  
  // 计算滑块高度（最小24px）
  const ratio = clientHeight / Math.max(1, scrollHeight)
  thumbHeight.value = Math.max(24, clientHeight * ratio)
  
  // 计算滑块位置
  const maxScrollTop = Math.max(1, scrollHeight - clientHeight)
  const maxThumbTop = Math.max(1, clientHeight - thumbHeight.value)
  thumbTop.value = (scrollTop / maxScrollTop) * maxThumbTop
}

// 滚动事件处理
function handleScroll() {
  updateScrollbar()
}

// 鼠标按下滑块
function handleThumbMouseDown(e: MouseEvent) {
  if (!editorRef.value) return
  
  isDragging = true
  startY = e.clientY
  startScrollTop = editorRef.value.scrollTop
  
  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
  
  e.preventDefault()
}

// 鼠标移动
function handleMouseMove(e: MouseEvent) {
  if (!isDragging || !editorRef.value) return
  
  const editor = editorRef.value
  const deltaY = e.clientY - startY
  const scrollHeight = editor.scrollHeight
  const clientHeight = editor.clientHeight
  const maxScrollTop = scrollHeight - clientHeight
  const maxThumbTop = clientHeight - thumbHeight.value
  
  // 计算新的滚动位置
  const scrollDelta = (deltaY / maxThumbTop) * maxScrollTop
  editor.scrollTop = startScrollTop + scrollDelta
}

// 鼠标释放
function handleMouseUp() {
  isDragging = false
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
}

// @ 触发状态
const atTriggerPosition = ref<number | null>(null)
// @ 查询结束位置（纯文本偏移），用于在选择面板里点选文件后也能正确清理 @query
const atQueryEndPosition = ref<number | null>(null)

// Some contexts may be inserted imperatively (e.g. after async file read).
// During that brief window, the chip exists in DOM but not yet in props.nodes.
const transientContexts = new Map<string, PromptContextItem>()

// 从编辑器中提取内容，生成新的节点数组
function extractNodesFromEditor(): EditorNode[] {
  if (!editorRef.value) return []
  
  const nodes: EditorNode[] = []
  
  function traverse(element: Node) {
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        // 文本节点（去掉用于光标定位的零宽字符）
        const raw = child.textContent || ''
        const text = raw.replace(/\u200B/g, '')
        if (text) {
          nodes.push(createTextNode(text))
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement
        if (el.classList.contains('context-chip')) {
          // 徽章节点
          const contextId = el.dataset.contextId
          let context = props.nodes
            .filter((n): n is { type: 'context'; context: PromptContextItem } => n.type === 'context')
            .find(n => n.context.id === contextId)?.context

          if (!context && contextId) {
            context = transientContexts.get(contextId)
          }

          if (context) {
            nodes.push(createContextNode(context))
          }
        } else if (el.tagName === 'BR') {
          // 换行（只识别我们自己插入/渲染的 <br data-lim-break="1">，避免浏览器空内容占位 <br> 产生伪换行）
          if (el.dataset.limBreak === '1') {
            nodes.push(createTextNode('\n'))
          }
        } else if (el.tagName === 'DIV' || el.tagName === 'P') {
          // 段落元素：递归处理，并在段落之间插入换行
          traverse(el)
          if (child.nextSibling) {
            nodes.push(createTextNode('\n'))
          }
        } else {
          // 其他元素，递归处理
          traverse(el)
        }
      }
    }
  }
  
  traverse(editorRef.value)
  return normalizeNodes(nodes)
}

// 获取当前光标位置的文本偏移
function getCaretTextOffset(): number {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !editorRef.value) return 0
  
  const range = selection.getRangeAt(0)
  const preRange = range.cloneRange()
  preRange.selectNodeContents(editorRef.value)
  preRange.setEnd(range.startContainer, range.startOffset)
  
  // 计算光标前的纯文本长度（不计入徽章）
  let offset = 0
  const fragment = preRange.cloneContents()
  
  function countText(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.textContent || ''
      offset += raw.replace(/\u200B/g, '').length
      return
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return

    const el = node as HTMLElement

    // <br> 代表换行
    if (el.tagName === 'BR') {
      if (el.dataset.limBreak === '1') {
        offset += 1
      }
      return
    }

    // 徽章不计入纯文本 offset
    if (el.classList.contains('context-chip')) {
      return
    }

    for (const child of Array.from(node.childNodes)) {
      countText(child)
    }
  }
  
  for (const child of Array.from(fragment.childNodes)) {
    countText(child)
  }
  
  return offset
}

function getRangeInEditor(): Range | null {
  if (!editorRef.value) return null

  const editor = editorRef.value
  const selection = window.getSelection()
  if (!selection) return null

  editor.focus()

  // 若没有 range 或选区不在 editor 内，则把光标放到末尾
  if (selection.rangeCount === 0) {
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  } else {
    const range = selection.getRangeAt(0)
    if (!editor.contains(range.startContainer)) {
      const newRange = document.createRange()
      newRange.selectNodeContents(editor)
      newRange.collapse(false)
      selection.removeAllRanges()
      selection.addRange(newRange)
    }
  }

  return selection.getRangeAt(0)
}

function insertTextAtCaret(text: string): boolean {
  const range = getRangeInEditor()
  const selection = window.getSelection()
  if (!range || !selection) return false

  range.deleteContents()

  const textNode = document.createTextNode(text)
  range.insertNode(textNode)

  // 光标移动到插入内容之后
  range.setStartAfter(textNode)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)

  return true
}

function insertLineBreakAtCaret(): boolean {
  const range = getRangeInEditor()
  const selection = window.getSelection()
  if (!range || !selection) return false

  range.deleteContents()

  const br = document.createElement('br')
  br.dataset.limBreak = '1'
  range.insertNode(br)

  // 在 <br> 后插入零宽字符，保证光标可落点
  const zwsp = document.createTextNode('\u200B')
  range.setStartAfter(br)
  range.collapse(true)
  range.insertNode(zwsp)

  // 光标放到 zwsp 后
  range.setStart(zwsp, 1)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)

  return true
}

function insertPlainTextWithLineBreaksAtCaret(text: string): boolean {
  const normalized = text.replace(/\r\n/g, '\n')
  const parts = normalized.split('\n')

  for (let i = 0; i < parts.length; i++) {
    if (parts[i]) {
      insertTextAtCaret(parts[i])
    }
    if (i < parts.length - 1) {
      insertLineBreakAtCaret()
    }
  }

  return true
}

function removeLineBreakBackward(): boolean {
  if (!editorRef.value) return false

  const editor = editorRef.value
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return false

  const range = selection.getRangeAt(0)
  if (!range.collapsed) return false
  if (range.startContainer !== editor && !editor.contains(range.startContainer)) return false

  // Case 1: caret is after our ZWSP and right after a <br data-lim-break="1">
  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    const t = range.startContainer as Text
    if (t.data === '\u200B' && range.startOffset === 1) {
      const prev = t.previousSibling
      if (prev && prev.nodeType === Node.ELEMENT_NODE) {
        const el = prev as HTMLElement
        if (el.tagName === 'BR' && el.dataset.limBreak === '1') {
          const before = el.previousSibling

          range.setStartBefore(el)
          range.collapse(true)
          // Remove both nodes
          t.remove()
          el.remove()

          // Move caret to a reasonable position
          const newRange = document.createRange()
          if (before) {
            if (before.nodeType === Node.TEXT_NODE) {
              const bt = before as Text
              newRange.setStart(bt, bt.data.length)
            } else {
              newRange.setStartAfter(before)
            }
          } else {
            newRange.setStart(editor, 0)
          }
          newRange.collapse(true)
          selection.removeAllRanges()
          selection.addRange(newRange)
          return true
        }
      }
    }

    // Case 1b: caret is BEFORE our ZWSP (offset 0) and previous sibling is our <br>
    // This happens a lot when clicking at the start of a line that begins with a chip.
    if (t.data === '\u200B' && range.startOffset === 0) {
      const prev = t.previousSibling
      if (prev && prev.nodeType === Node.ELEMENT_NODE) {
        const el = prev as HTMLElement
        if (el.tagName === 'BR' && el.dataset.limBreak === '1') {
          const before = el.previousSibling
          el.remove()
          // Keep the ZWSP as a caret anchor (it will be ignored by parsing)
          setCaretAfterNode(selection, editor, before)
          return true
        }
      }
    }

    // Case 2: caret at start of a text node, previous sibling is our <br>
    if (range.startOffset === 0) {
      const prev = t.previousSibling
      if (prev && prev.nodeType === Node.ELEMENT_NODE) {
        const el = prev as HTMLElement
        if (el.tagName === 'BR' && el.dataset.limBreak === '1') {
          el.remove()
          const newRange = document.createRange()
          newRange.setStart(t, 0)
          newRange.collapse(true)
          selection.removeAllRanges()
          selection.addRange(newRange)
          return true
        }
      }
    }
  }

  // Case 3: caret is between children of editor
  if (range.startContainer === editor) {
    const offset = range.startOffset
    if (offset > 0) {
      const prev = editor.childNodes[offset - 1]

      // If caret is at the start of a line before a chip, the DOM is often: <br data-lim-break> + \u200B + | + <chip>
      // Backspace should remove the line break and merge the chip back to the previous line.
      if (prev && prev.nodeType === Node.TEXT_NODE && (prev as Text).data === '\u200B' && offset > 1) {
        const maybeBr = editor.childNodes[offset - 2]
        if (maybeBr && maybeBr.nodeType === Node.ELEMENT_NODE) {
          const brEl = maybeBr as HTMLElement
          if (brEl.tagName === 'BR' && brEl.dataset.limBreak === '1') {
            brEl.remove()
            prev.remove()
            const newRange = document.createRange()
            newRange.setStart(editor, Math.min(offset - 2, editor.childNodes.length))
            newRange.collapse(true)
            selection.removeAllRanges()
            selection.addRange(newRange)
            return true
          }
        }
      }

      if (prev && prev.nodeType === Node.ELEMENT_NODE) {
        const el = prev as HTMLElement
        if (el.tagName === 'BR' && el.dataset.limBreak === '1') {
          el.remove()
          // Also remove trailing ZWSP if present
          const maybeZwsp = editor.childNodes[offset - 1]
          if (maybeZwsp && maybeZwsp.nodeType === Node.TEXT_NODE && (maybeZwsp as Text).data === '\u200B') {
            maybeZwsp.remove()
          }
          const newRange = document.createRange()
          newRange.setStart(editor, Math.min(offset - 1, editor.childNodes.length))
          newRange.collapse(true)
          selection.removeAllRanges()
          selection.addRange(newRange)
          return true
        }
      }
    }
  }

  return false
}

function removeLineBreakForward(): boolean {
  if (!editorRef.value) return false

  const editor = editorRef.value
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return false

  const range = selection.getRangeAt(0)
  if (!range.collapsed) return false
  if (range.startContainer !== editor && !editor.contains(range.startContainer)) return false

  // Delete when caret is right before a <br>
  if (range.startContainer === editor) {
    const offset = range.startOffset
    const next = editor.childNodes[offset]
    if (next && next.nodeType === Node.ELEMENT_NODE) {
      const el = next as HTMLElement
      if (el.tagName === 'BR' && el.dataset.limBreak === '1') {
        el.remove()
        // Remove following ZWSP if present
        const maybeZwsp = editor.childNodes[offset]
        if (maybeZwsp && maybeZwsp.nodeType === Node.TEXT_NODE && (maybeZwsp as Text).data === '\u200B') {
          maybeZwsp.remove()
        }
        return true
      }
    }
  }

  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    const t = range.startContainer as Text
    if (t.data === '\u200B' && range.startOffset === 0) {
      const next = t.nextSibling
      if (next && next.nodeType === Node.ELEMENT_NODE) {
        const el = next as HTMLElement
        if (el.tagName === 'BR' && el.dataset.limBreak === '1') {
          t.remove()
          el.remove()
          return true
        }
      }
    }
  }

  return false
}

function isContextChipNode(n: Node | null | undefined): n is HTMLElement {
  return !!n && n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).classList.contains('context-chip')
}

function isZwspTextNode(n: Node | null | undefined): n is Text {
  return !!n && n.nodeType === Node.TEXT_NODE && (n as Text).data === '\u200B'
}

function setCaretAfterNode(selection: Selection, editor: HTMLElement, before: Node | null) {
  const newRange = document.createRange()
  if (!before) {
    newRange.setStart(editor, 0)
  } else if (before.nodeType === Node.TEXT_NODE) {
    const t = before as Text
    newRange.setStart(t, t.data.length)
  } else {
    newRange.setStartAfter(before)
  }
  newRange.collapse(true)
  selection.removeAllRanges()
  selection.addRange(newRange)
}

function removeContextBackward(): boolean {
  if (!editorRef.value) return false

  const editor = editorRef.value
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return false

  const range = selection.getRangeAt(0)
  if (!range.collapsed) return false
  if (range.startContainer !== editor && !editor.contains(range.startContainer)) return false

  // Caret between editor children
  if (range.startContainer === editor) {
    let idx = range.startOffset - 1
    if (idx < 0) return false

    let prev: Node | null = editor.childNodes[idx] || null
    if (isZwspTextNode(prev)) {
      idx -= 1
      prev = idx >= 0 ? (editor.childNodes[idx] || null) : null
    }

    if (!prev) {
      // Don't let the browser delete our leading ZWSP anchor.
      return true
    }

    if (isContextChipNode(prev)) {
      const removedId = prev.dataset.contextId
      const before = prev.previousSibling
      prev.remove()
      setCaretAfterNode(selection, editor, before)

      if (removedId) {
        if (previewContext.value?.id === removedId) previewContext.value = null
        if (hoveredContextId.value === removedId) hoveredContextId.value = null
      }

      return true
    }

    return false
  }

  // Caret in a text node
  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    const t = range.startContainer as Text

    // If caret sits on our invisible ZWSP anchor, treat it as "between" nodes.
    if (t.data === '\u200B') {
      if (range.startOffset === 0 || range.startOffset === 1) {
        let prev: Node | null = t.previousSibling
        if (isZwspTextNode(prev)) prev = prev.previousSibling

        // If we're right after a line break, let removeLineBreakBackward handle it.
        if (prev && prev.nodeType === Node.ELEMENT_NODE) {
          const el = prev as HTMLElement
          if (el.tagName === 'BR' && el.dataset.limBreak === '1') return false
        }

        // If nothing to delete, keep the anchor.
        if (!prev) return true

        if (isContextChipNode(prev)) {
          const before = prev.previousSibling
          prev.remove()
          setCaretAfterNode(selection, editor, before)
          return true
        }
      }
      return false
    }

    if (range.startOffset !== 0) return false

    let prev: Node | null = t.previousSibling
    if (isZwspTextNode(prev)) prev = prev.previousSibling

    if (isContextChipNode(prev)) {
      const removedId = prev.dataset.contextId
      const before = prev.previousSibling
      prev.remove()
      setCaretAfterNode(selection, editor, before)

      if (removedId) {
        if (previewContext.value?.id === removedId) previewContext.value = null
        if (hoveredContextId.value === removedId) hoveredContextId.value = null
      }

      return true
    }
  }

  return false
}

function removeContextForward(): boolean {
  if (!editorRef.value) return false

  const editor = editorRef.value
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return false

  const range = selection.getRangeAt(0)
  if (!range.collapsed) return false
  if (range.startContainer !== editor && !editor.contains(range.startContainer)) return false

  // Caret between editor children
  if (range.startContainer === editor) {
    let idx = range.startOffset
    if (idx < 0) return false

    let next: Node | null = editor.childNodes[idx] || null
    const skippedZwsp = isZwspTextNode(next)
    if (skippedZwsp) {
      idx += 1
      next = editor.childNodes[idx] || null
    }

    if (!next && skippedZwsp) {
      // Don't let the browser delete our trailing ZWSP anchor.
      return true
    }

    if (isContextChipNode(next)) {
      const removedId = next.dataset.contextId
      next.remove()

      if (removedId) {
        if (previewContext.value?.id === removedId) previewContext.value = null
        if (hoveredContextId.value === removedId) hoveredContextId.value = null
      }

      return true
    }

    return false
  }

  // Caret in a text node
  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    const t = range.startContainer as Text

    // If caret sits on our invisible ZWSP anchor, treat it as "between" nodes.
    if (t.data === '\u200B') {
      if (range.startOffset === 0 || range.startOffset === 1) {
        let next: Node | null = t.nextSibling
        if (isZwspTextNode(next)) next = next.nextSibling

        // If the next thing is a line break, let removeLineBreakForward handle it.
        if (next && next.nodeType === Node.ELEMENT_NODE) {
          const el = next as HTMLElement
          if (el.tagName === 'BR' && el.dataset.limBreak === '1') return false
        }

        if (!next) return true

        if (isContextChipNode(next)) {
          next.remove()
          return true
        }
      }
      return false
    }

    if (range.startOffset !== t.data.length) return false

    let next: Node | null = t.nextSibling
    if (isZwspTextNode(next)) next = next.nextSibling

    if (isContextChipNode(next)) {
      const removedId = next.dataset.contextId
      next.remove()

      if (removedId) {
        if (previewContext.value?.id === removedId) previewContext.value = null
        if (hoveredContextId.value === removedId) hoveredContextId.value = null
      }

      return true
    }
  }

  return false
}

// 处理输入
function handleInput() {
  isInputting = true
  
  let newNodes = extractNodesFromEditor()

  const textContent = getPlainText(newNodes)
  const cursorPos = getCaretTextOffset()
  
  // 检测 @ 触发
  if (atTriggerPosition.value !== null) {
    // 已经在 @ 模式中，更新查询
    const query = textContent.substring(atTriggerPosition.value + 1, cursorPos)
    
    // 检查是否应该关闭（遇到空格或删除了 @）
    if (cursorPos <= atTriggerPosition.value || query.includes(' ') || query.includes('\n')) {
      atTriggerPosition.value = null
      atQueryEndPosition.value = null
      emit('close-at-picker')
    } else {
      // 保存当前 query 结束位置（即使焦点切走，也能用于 replaceAtTriggerWithText）
      atQueryEndPosition.value = cursorPos
      emit('at-query-change', query)
    }
  } else {
    // 检测是否刚输入了 @
    const charBefore = textContent[cursorPos - 2] || ''
    const currentChar = textContent[cursorPos - 1]
    
    if (currentChar === '@' && (charBefore === '' || charBefore === ' ' || charBefore === '\n')) {
      atTriggerPosition.value = cursorPos - 1
      atQueryEndPosition.value = cursorPos
      emit('trigger-at-picker', '', cursorPos - 1)
    }
  }
  
  emit('update:nodes', newNodes)
  
  nextTick(() => {
    isInputting = false

    // 当内容被清空时，浏览器可能残留 <br>/<div>，强制清空 DOM 以触发 :empty 占位符
    if (newNodes.length === 0) {
      renderNodesToDOM()
    }

    adjustHeight()
  })
}

// 处理按键
function handleKeydown(e: KeyboardEvent) {
  // 如果在 @ 模式中，某些按键需要传递给父组件处理
  if (atTriggerPosition.value !== null) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      emit('at-picker-keydown', e.key)
      return
    }
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault()
      emit('at-picker-keydown', 'Enter')
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      atTriggerPosition.value = null
      atQueryEndPosition.value = null
      emit('close-at-picker')
      return
    }
  }
  
  // Backspace / Delete: make our <br data-lim-break="1"> act like a single character
  if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.altKey && !e.metaKey) {
    const handled = e.key === 'Backspace'
      ? (removeContextBackward() || removeLineBreakBackward())
      : (removeContextForward() || removeLineBreakForward())

    if (handled) {
      e.preventDefault()
      handleInput()
      return
    }
  }

  // Shift+Enter 插入换行符
  if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault()
    if (insertLineBreakAtCaret()) {
      handleInput()
    }
    return
  }

  // Enter / Ctrl+Enter
  if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
    if (props.submitOnEnter) {
      e.preventDefault()
      emit('send')
      return
    }

    // In non-submit mode, Enter behaves like a line break.
    e.preventDefault()
    if (insertLineBreakAtCaret()) {
      handleInput()
    }
    return
  }
}

// 处理输入法
function handleCompositionStart() {
  emit('composition-start')
}

function handleCompositionEnd() {
  emit('composition-end')
}

// 处理粘贴事件
function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  
  const files: File[] = []
  
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    // 处理文件类型（图片、文件等）
    if (item.kind === 'file') {
      const file = item.getAsFile()
      if (file) {
        files.push(file)
      }
    }
  }
  
  // 如果有文件，触发 paste 事件
  if (files.length > 0) {
    e.preventDefault()  // 阻止默认粘贴行为
    emit('paste', files)
    return
  }

  // 处理纯文本粘贴：统一按 text/plain 插入，避免粘贴出 HTML 结构影响换行解析
  const text = e.clipboardData?.getData('text/plain')
  if (text && editorRef.value) {
    e.preventDefault()
    insertPlainTextWithLineBreaksAtCaret(text)
    handleInput()
  }
  // 其他情况让浏览器默认处理
}

// 处理拖拽进入
function handleDragEnter(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  isDragOver.value = true
}

// 处理拖拽离开
function handleDragLeave(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  // 检查是否真的离开了元素
  const rect = editorRef.value?.getBoundingClientRect()
  if (rect) {
    const x = e.clientX
    const y = e.clientY
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      isDragOver.value = false
    }
  }
}

// 处理拖拽悬停
function handleDragOver(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  // 设置 dropEffect 告诉浏览器这是一个复制操作
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'copy'
  }
  isDragOver.value = true
}

// 处理拖拽放置
async function handleDrop(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  isDragOver.value = false
  
  // 检查是否有文件或 URI 列表
  const dt = e.dataTransfer
  if (!dt) return

  // Ctrl+Shift 拖拽：按“字符模式”插入路径，而不是创建徽章
  const insertAsTextPath = e.ctrlKey && e.shiftKey
  
  // VSCode 使用自定义的数据类型
  // 1. application/vnd.code.uri-list - VSCode 的 URI 列表
  // 2. resourceurls - JSON 数组格式的文件 URI
  // 3. text/uri-list - 标准 URI 列表（可能为空）
  
  // 优先使用 VSCode 的 application/vnd.code.uri-list
  const vscodeUriList = dt.getData('application/vnd.code.uri-list')
  
  if (vscodeUriList) {
    const uris = vscodeUriList.split('\n').filter(uri => uri.trim() && !uri.startsWith('#'))
    if (uris.length > 0) {
      const files = await insertFilePathsFromUris(uris)
      if (files.length > 0) {
        if (insertAsTextPath) {
          insertPathsAsAtText(files)
        } else {
          emit('add-file-contexts', files)
        }
      }
      return
    }
  }
  
  // 尝试 resourceurls（JSON 数组格式）
  const resourceUrls = dt.getData('resourceurls')
  
  if (resourceUrls) {
    try {
      const urls = JSON.parse(resourceUrls) as string[]
      if (urls.length > 0) {
        const files = await insertFilePathsFromUris(urls)
        if (files.length > 0) {
          if (insertAsTextPath) {
            insertPathsAsAtText(files)
          } else {
            emit('add-file-contexts', files)
          }
        }
        return
      }
    } catch {
      // 忽略解析错误
    }
  }
  
  // 尝试标准的 text/uri-list
  const uriList = dt.getData('text/uri-list')
  
  if (uriList) {
    const uris = uriList.split('\n').filter(uri => uri.trim() && !uri.startsWith('#'))
    if (uris.length > 0) {
      const files = await insertFilePathsFromUris(uris)
      if (files.length > 0) {
        if (insertAsTextPath) {
          insertPathsAsAtText(files)
        } else {
          emit('add-file-contexts', files)
        }
      }
      return
    }
  }
  
  // 尝试 text/plain
  const plainText = dt.getData('text/plain')
  
  if (plainText) {
    const lines = plainText.split('\n').filter(line => line.trim())
    const fileUris = lines.filter(line =>
      line.startsWith('file://') ||
      line.match(/^[a-zA-Z]:[\/\\]/) ||
      line.startsWith('/')
    )
    
    if (fileUris.length > 0) {
      const files = await insertFilePathsFromUris(fileUris)
      if (files.length > 0) {
        if (insertAsTextPath) {
          insertPathsAsAtText(files)
        } else {
          emit('add-file-contexts', files)
        }
      }
      return
    }
  }
  
  // 如果没有 URI 列表，尝试从 Files 获取
  if (dt.files && dt.files.length > 0) {
    const paths: string[] = []
    for (let i = 0; i < dt.files.length; i++) {
      const file = dt.files[i]
      const filePath = (file as any).path || file.name
      if (filePath) {
        paths.push(filePath)
      }
    }
    
    if (paths.length > 0) {
      const files = await insertFilePathsFromPaths(paths)
      if (files.length > 0) {
        if (insertAsTextPath) {
          insertPathsAsAtText(files)
        } else {
          emit('add-file-contexts', files)
        }
      }
      return
    }
  }
}

function insertPathsAsAtText(files: { path: string; isDirectory: boolean }[]) {
  if (!files || files.length === 0) return

  const ensureTrailingSlash = (p: string) => (p.endsWith('/') ? p : `${p}/`)
  const text = files
    .map(f => {
      const p = f.isDirectory ? ensureTrailingSlash(f.path) : f.path
      return ` @${p} `
    })
    .join('')

  if (text && editorRef.value) {
    insertTextAtCaret(text)
    handleInput()
  }
}

// 从 URI 列表解析文件路径（用于拖拽）
async function insertFilePathsFromUris(uris: string[]): Promise<{ path: string; isDirectory: boolean }[]> {
  const files: { path: string; isDirectory: boolean }[] = []
  
  for (const uri of uris) {
    try {
      // 调用后端 API 将 URI 转换为相对路径
      const result = await sendToExtension<{ relativePath: string; isDirectory?: boolean }>('getRelativePath', {
        absolutePath: uri.trim()
      })
      if (result.relativePath) {
        files.push({
          path: result.relativePath,
          isDirectory: result.isDirectory || false
        })
      }
    } catch (err) {
      console.error('获取相对路径失败:', err)
      // 如果获取失败，尝试直接使用 URI 中的文件名
      try {
        const url = new URL(uri)
        const pathName = decodeURIComponent(url.pathname)
        const fileName = pathName.split('/').pop()
        if (fileName) {
          files.push({ path: fileName, isDirectory: false })
        }
      } catch {
        // 忽略无效 URI
      }
    }
  }

  return files
}

// 从本地路径解析文件路径（用于拖拽）
async function insertFilePathsFromPaths(paths: string[]): Promise<{ path: string; isDirectory: boolean }[]> {
  const files: { path: string; isDirectory: boolean }[] = []
  
  for (const absolutePath of paths) {
    try {
      // 调用后端 API 将绝对路径转换为相对路径
      const result = await sendToExtension<{ relativePath: string; isDirectory?: boolean }>('getRelativePath', {
        absolutePath
      })
      if (result.relativePath) {
        files.push({
          path: result.relativePath,
          isDirectory: result.isDirectory || false
        })
      }
    } catch (err) {
      console.error('获取相对路径失败:', err)
      // 如果获取失败，使用文件名
      const fileName = absolutePath.split(/[/\\]/).pop()
      if (fileName) {
        files.push({ path: fileName, isDirectory: false })
      }
    }
  }

  return files
}

// 聚焦
function focus() {
  editorRef.value?.focus()
}

// 滑块样式
const thumbStyle = computed(() => ({
  height: `${thumbHeight.value}px`,
  top: `${thumbTop.value}px`
}))

// 渲染节点到 DOM
function renderNodesToDOM() {
  if (!editorRef.value) return
  
  const editor = editorRef.value
  
  // 保存当前选区
  const selection = window.getSelection()
  let savedRange: Range | null = null
  if (selection && selection.rangeCount > 0) {
    savedRange = selection.getRangeAt(0).cloneRange()
  }
  
  // 清空并重建
  editor.innerHTML = ''

  const appendZwsp = () => {
    const last = editor.lastChild
    if (last && last.nodeType === Node.TEXT_NODE && (last as Text).data === '\u200B') return
    editor.appendChild(document.createTextNode('\u200B'))
  }

  for (const node of props.nodes) {
    if (node.type === 'text') {
      // 文本节点：把 \n 渲染成 <br>
      const parts = node.text.split('\n')
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) {
          editor.appendChild(document.createTextNode(parts[i]))
        }
        if (i < parts.length - 1) {
          const br = document.createElement('br')
          br.dataset.limBreak = '1'
          editor.appendChild(br)
          // Always keep a caret anchor after a line break.
          appendZwsp()
        }
      }
    } else {
      // Ensure there is a caret position before a chip at line start / between chips.
      const last = editor.lastChild
      if (!last || last.nodeType === Node.ELEMENT_NODE) {
        appendZwsp()
      }

      // 上下文徽章节点
      const chip = document.createElement('span')
      chip.className = 'context-chip'
      chip.contentEditable = 'false'
      chip.dataset.contextId = node.context.id
      
      // 图标
      const icon = document.createElement('i')
      icon.className = getContextIcon(node.context).class
      chip.appendChild(icon)
      
      // 标题
      const title = document.createElement('span')
      title.className = 'context-chip__text'
      title.textContent = node.context.title
      chip.appendChild(title)
      
      // 删除按钮
      const removeBtn = document.createElement('button')
      removeBtn.className = 'context-chip__remove'
      removeBtn.type = 'button'
      removeBtn.innerHTML = '<i class="codicon codicon-close"></i>'
      removeBtn.onclick = (e) => {
        e.stopPropagation()
        handleRemoveContext(node.context.id)
      }
      chip.appendChild(removeBtn)
      
      // 悬停事件
      chip.onmouseenter = () => handleContextMouseEnter(node.context)
      chip.onmouseleave = () => handleContextMouseLeave()
      chip.onclick = (e) => {
        e.stopPropagation()
        handleContextClick(node.context)
      }
      
      editor.appendChild(chip)
    }
  }

  // Ensure there is a caret position after a trailing chip.
  if (editor.lastChild && editor.lastChild.nodeType === Node.ELEMENT_NODE) {
    appendZwsp()
  }
  
  // 如果没有内容，不强行插入 <br>，否则会导致 :empty 占位符失效
  // 尝试恢复光标位置
  nextTick(() => {
    if (savedRange && editorRef.value) {
      try {
        const newSelection = window.getSelection()
        if (newSelection) {
          // 将光标放到末尾
          const range = document.createRange()
          range.selectNodeContents(editorRef.value)
          range.collapse(false)
          newSelection.removeAllRanges()
          newSelection.addRange(range)
        }
      } catch {
        // 忽略错误
      }
    }
  })
}

// 输入状态标记
let isInputting = false

// 监听 nodes 变化并渲染
watch(() => props.nodes, () => {
  // If the previewed/hovered context no longer exists, close the preview.
  if (previewContext.value) {
    const stillExists = props.nodes.some(n => n.type === 'context' && n.context.id === previewContext.value!.id)
    if (!stillExists) {
      previewContext.value = null
    }
  }
  if (hoveredContextId.value) {
    const stillHoveredExists = props.nodes.some(n => n.type === 'context' && n.context.id === hoveredContextId.value)
    if (!stillHoveredExists) {
      hoveredContextId.value = null
    }
  }

  // Drop transient fallback entries once the parent state includes them.
  for (const id of Array.from(transientContexts.keys())) {
    if (props.nodes.some(n => n.type === 'context' && n.context.id === id)) {
      transientContexts.delete(id)
    }
  }

  // 只在非输入状态时渲染（避免循环）；但如果节点被清空，需要强制渲染清理 DOM
  if (!isInputting || props.nodes.length === 0) {
    renderNodesToDOM()
  }
  nextTick(() => adjustHeight())
}, { deep: true })

// 挂载
onMounted(() => {
  nextTick(() => {
    renderNodesToDOM()
    adjustHeight()
  })
})

// 卸载
onBeforeUnmount(() => {
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
})

// 关闭 @ 面板
function closeAtPicker() {
  atTriggerPosition.value = null
  atQueryEndPosition.value = null
}

// 插入选中的文件路径（替换 @ 和查询文本）
// 现在改为删除 @ 文本，由父组件添加徽章
function insertFilePath(_path: string) {
  // 在 contenteditable 中，需要删除 @ 和查询文本
  replaceAtTriggerWithText('')
}

// 用 replacement 替换从 @ 到当前光标的内容
function replaceAtTriggerWithText(replacement: string = '') {
  if (!editorRef.value || atTriggerPosition.value === null) return

  const editor = editorRef.value
  const triggerPos = atTriggerPosition.value
  const cursorPos = atQueryEndPosition.value ?? getCaretTextOffset()
  const endPos = Math.max(cursorPos, triggerPos + 1)

  editor.focus()

  const getDomPointFromTextOffset = (targetOffset: number): { container: Node; offset: number } => {
    let textCount = 0
    const children = Array.from(editor.childNodes)

    for (let i = 0; i < children.length; i++) {
      const child = children[i]

      // Boundary before this child
      if (targetOffset === textCount) {
        return { container: editor, offset: i }
      }

      if (child.nodeType === Node.TEXT_NODE) {
        const t = child as Text
        const raw = t.data
        const logicalLen = raw.replace(/\u200B/g, '').length

        if (targetOffset <= textCount + logicalLen) {
          // Map logical offset (excluding ZWSP) -> actual text node offset
          const need = targetOffset - textCount
          let seen = 0
          for (let j = 0; j <= raw.length; j++) {
            if (seen === need) {
              return { container: t, offset: j }
            }
            const ch = raw[j]
            if (ch && ch !== '\u200B') {
              seen += 1
            }
          }
          return { container: t, offset: raw.length }
        }

        textCount += logicalLen
        continue
      }

      if (child.nodeType !== Node.ELEMENT_NODE) continue

      const el = child as HTMLElement

      // <br data-lim-break="1"> counts as one character ("\n")
      if (el.tagName === 'BR' && el.dataset.limBreak === '1') {
        if (targetOffset === textCount + 1) {
          return { container: editor, offset: i + 1 }
        }
        textCount += 1
        continue
      }

      // Chips do not contribute to text offset
      if (el.classList.contains('context-chip')) {
        continue
      }
    }

    return { container: editor, offset: editor.childNodes.length }
  }

  const start = getDomPointFromTextOffset(triggerPos)
  const end = getDomPointFromTextOffset(endPos)

  const range = document.createRange()
  range.setStart(start.container, start.offset)
  range.setEnd(end.container, end.offset)
  range.deleteContents()

  if (replacement) {
    const textNode = document.createTextNode(replacement)
    range.insertNode(textNode)
    range.setStartAfter(textNode)
  }

  range.collapse(true)
  const selection = window.getSelection()
  if (selection) {
    selection.removeAllRanges()
    selection.addRange(range)
  }

  // Close panel state
  atTriggerPosition.value = null
  atQueryEndPosition.value = null
  emit('close-at-picker')

  handleInput()
}

// 获取当前触发位置
function getAtTriggerPosition(): number | null {
  return atTriggerPosition.value
}

// 输入框占位符：有内容时不显示 placeholder
const placeholderText = computed(() => {
  const hasContent = props.nodes.length > 0 && (
    props.nodes.some(n => n.type === 'context') ||
    props.nodes.some(n => n.type === 'text' && n.text.trim())
  )
  if (hasContent) return ''
  return props.placeholder || t('components.input.placeholderHint')
})

// 获取上下文徽章图标配置
function getContextIcon(ctx: PromptContextItem): { class: string; isFileIcon: boolean } {
  // 文件类型：根据文件路径获取对应图标
  if (ctx.type === 'file' && ctx.filePath) {
    return { class: getFileIcon(ctx.filePath), isFileIcon: true }
  }
  // 其他类型使用 codicon
  switch (ctx.type) {
    case 'snippet':
      return { class: 'codicon codicon-code', isFileIcon: false }
    case 'text':
    default:
      return { class: 'codicon codicon-note', isFileIcon: false }
  }
}

function handleRemoveContext(id: string) {
  // If the removed chip is being previewed/hovered, close the preview immediately.
  if (previewContext.value?.id === id) {
    previewContext.value = null
  }
  if (hoveredContextId.value === id) {
    hoveredContextId.value = null
  }
  if (hoverTimer) {
    clearTimeout(hoverTimer)
    hoverTimer = null
  }

  emit('remove-context', id)
}

// 悬浮预览状态
const hoveredContextId = ref<string | null>(null)
const previewContext = ref<PromptContextItem | null>(null)
let hoverTimer: ReturnType<typeof setTimeout> | null = null

function handleContextMouseEnter(ctx: PromptContextItem) {
  hoveredContextId.value = ctx.id
  if (hoverTimer) clearTimeout(hoverTimer)
  hoverTimer = setTimeout(() => {
    previewContext.value = ctx
  }, 300)
}

function handleContextMouseLeave() {
  hoveredContextId.value = null
  if (hoverTimer) {
    clearTimeout(hoverTimer)
    hoverTimer = null
  }
  setTimeout(() => {
    if (!hoveredContextId.value) {
      previewContext.value = null
    }
  }, 100)
}

function truncatePreview(content: string, maxLines = 10, maxChars = 500): string {
  const lines = content.split('\n').slice(0, maxLines)
  let result = lines.join('\n')
  if (result.length > maxChars) {
    result = result.slice(0, maxChars) + '...'
  } else if (content.split('\n').length > maxLines) {
    result += '\n...'
  }
  return result
}

// 从文件路径推断语言
function getLanguageFromPath(path?: string): string {
  if (!path) return 'plaintext'
  
  const ext = path.split('.').pop()?.toLowerCase()
  const langMap: Record<string, string> = {
    'ts': 'typescript',
    'tsx': 'typescriptreact',
    'js': 'javascript',
    'jsx': 'javascriptreact',
    'vue': 'vue',
    'py': 'python',
    'rs': 'rust',
    'go': 'go',
    'java': 'java',
    'kt': 'kotlin',
    'swift': 'swift',
    'c': 'c',
    'cpp': 'cpp',
    'h': 'c',
    'hpp': 'cpp',
    'cs': 'csharp',
    'rb': 'ruby',
    'php': 'php',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'less': 'less',
    'json': 'json',
    'yaml': 'yaml',
    'yml': 'yaml',
    'xml': 'xml',
    'md': 'markdown',
    'sql': 'sql',
    'sh': 'shellscript',
    'bash': 'shellscript',
    'zsh': 'shellscript',
    'ps1': 'powershell'
  }
  
  return langMap[ext || ''] || 'plaintext'
}

// 点击徽章打开预览页签
async function handleContextClick(ctx: PromptContextItem) {
  try {
    await sendToExtension('showContextContent', {
      title: ctx.title,
      content: ctx.content,
      language: ctx.language || getLanguageFromPath(ctx.filePath)
    })
  } catch (error) {
    console.error('Failed to show context content:', error)
  }
}

function insertContextAtCaret(context: PromptContextItem): boolean {
  if (!editorRef.value) return false

  transientContexts.set(context.id, context)

  const range = getRangeInEditor()
  const selection = window.getSelection()
  if (!range || !selection) return false

  range.deleteContents()

  // Build a chip element consistent with renderNodesToDOM().
  const chip = document.createElement('span')
  chip.className = 'context-chip'
  chip.contentEditable = 'false'
  chip.dataset.contextId = context.id

  const icon = document.createElement('i')
  icon.className = getContextIcon(context).class
  chip.appendChild(icon)

  const title = document.createElement('span')
  title.className = 'context-chip__text'
  title.textContent = context.title
  chip.appendChild(title)

  const removeBtn = document.createElement('button')
  removeBtn.className = 'context-chip__remove'
  removeBtn.type = 'button'
  removeBtn.innerHTML = '<i class="codicon codicon-close"></i>'
  removeBtn.onclick = (e) => {
    e.stopPropagation()
    handleRemoveContext(context.id)
  }
  chip.appendChild(removeBtn)

  chip.onmouseenter = () => handleContextMouseEnter(context)
  chip.onmouseleave = () => handleContextMouseLeave()
  chip.onclick = (e) => {
    e.stopPropagation()
    handleContextClick(context)
  }

  range.insertNode(chip)

  // Ensure caret anchors around the chip.
  const after = document.createTextNode('\u200B')
  chip.after(after)

  const prev = chip.previousSibling
  if (!prev || prev.nodeType === Node.ELEMENT_NODE) {
    chip.before(document.createTextNode('\u200B'))
  }

  const newRange = document.createRange()
  newRange.setStart(after, 1)
  newRange.collapse(true)
  selection.removeAllRanges()
  selection.addRange(newRange)

  handleInput()
  return true
}

// 暴露方法
defineExpose({
  focus,
  closeAtPicker,
  insertFilePath,
  replaceAtTriggerWithText,
  insertContextAtCaret,
  getAtTriggerPosition
})
</script>

<template>
  <div class="input-box" :class="{ 'drag-over': isDragOver }">
    <!-- 编辑器区域（contenteditable） -->
    <div
      ref="editorRef"
      class="input-editor"
      :class="{ disabled: !!disabled, 'is-empty': props.nodes.length === 0 }"
      contenteditable="true"
      :data-placeholder="placeholderText"
      @input="handleInput"
      @keydown="handleKeydown"
      @scroll="handleScroll"
      @compositionstart="handleCompositionStart"
      @compositionend="handleCompositionEnd"
      @paste="handlePaste"
      @dragenter="handleDragEnter"
      @dragleave="handleDragLeave"
      @dragover="handleDragOver"
      @drop="handleDrop"
    ></div>

    <!-- 悬浮预览弹窗 -->
    <Transition name="fade">
      <div
        v-if="previewContext"
        class="context-preview"
        @mouseenter="hoveredContextId = previewContext.id"
        @mouseleave="handleContextMouseLeave"
      >
        <div class="preview-header">
          <i :class="getContextIcon(previewContext).class"></i>
          <span class="preview-title">{{ previewContext.title }}</span>
        </div>
        <pre class="preview-content">{{ truncatePreview(previewContext.content) }}</pre>
      </div>
    </Transition>

    <!-- 自定义滚动条 -->
    <div v-show="showScrollbar" class="scroll-track">
      <div
        class="scroll-thumb"
        :style="thumbStyle"
        @mousedown="handleThumbMouseDown"
      />
    </div>

    <!-- 字符计数 -->
    <div v-if="maxLength" class="char-count">
      {{ getPlainText(props.nodes).length }} / {{ maxLength }}
    </div>
  </div>
</template>

<style scoped>
.input-box {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
}

/* contenteditable 编辑器 */
.input-editor {
  width: 100%;
  min-height: 56px; /* 至少两行视觉高度 */
  max-height: 160px;
  padding: var(--spacing-sm, 8px);
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  border-radius: var(--radius-sm, 2px);
  font-family: var(--vscode-font-family);
  font-size: 13px;
  line-height: 1.5;
  transition: border-color var(--transition-fast, 0.1s);
  outline: none;
  overflow-y: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
  cursor: text;

  /* 隐藏原生滚动条 */
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.input-editor::-webkit-scrollbar {
  display: none;
}

.input-editor:focus {
  border-color: var(--vscode-focusBorder);
}

.input-editor.disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}

/* 占位符 */
.input-editor.is-empty::before {
  content: attr(data-placeholder);
  color: var(--vscode-input-placeholderForeground);
  pointer-events: none;
}

/* 拖拽悬停状态 */
.input-box.drag-over .input-editor {
  border-color: var(--vscode-focusBorder);
  background: var(--vscode-list-hoverBackground);
}

/* 内联徽章样式：浅蓝色背景（使用 :deep 以应用到动态创建的元素） */
.input-editor :deep(.context-chip) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 240px;
  vertical-align: middle;

  padding: 2px 8px;
  margin: 0 2px;
  border-radius: 4px;

  background: rgba(0, 122, 204, 0.16);
  border: 1px solid rgba(0, 122, 204, 0.28);
  color: var(--vscode-foreground);

  user-select: none;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.input-editor :deep(.context-chip:hover) {
  background: rgba(0, 122, 204, 0.24);
  border-color: rgba(0, 122, 204, 0.4);
}

.input-editor :deep(.context-chip .codicon),
.input-editor :deep(.context-chip .icon) {
  font-size: 12px;
  color: var(--vscode-textLink-foreground);
  flex-shrink: 0;
}

.input-editor :deep(.context-chip__text) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.input-editor :deep(.context-chip__remove) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-left: 2px;
  padding: 0;

  border: none;
  background: transparent;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;

  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
}

.input-editor :deep(.context-chip:hover .context-chip__remove),
.input-editor :deep(.context-chip.hovered .context-chip__remove) {
  opacity: 1;
  pointer-events: auto;
}

.input-editor :deep(.context-chip__remove:hover) {
  color: var(--vscode-errorForeground);
}

/* 自定义滚动条 - 悬浮设计，不占用布局 */
.scroll-track {
  position: absolute;
  top: 1px;
  right: 3px;
  width: 6px;
  height: calc(100% - 2px);
  border-radius: 0;
  cursor: pointer;
  background: transparent;
  z-index: 10;
  opacity: 1;
}

.scroll-thumb {
  position: absolute;
  left: 0;
  width: 100%;
  border-radius: 0;
  cursor: grab;
  transition: background 0.18s ease, top 0.06s linear;
  will-change: top;
  background: var(--vscode-scrollbarSlider-background, rgba(100, 100, 100, 0.4));
}

.scroll-thumb:hover {
  background: var(--vscode-scrollbarSlider-hoverBackground, rgba(100, 100, 100, 0.55));
}

.scroll-thumb:active {
  cursor: grabbing;
  background: var(--vscode-scrollbarSlider-activeBackground, rgba(100, 100, 100, 0.7));
}

.char-count {
  position: absolute;
  right: var(--spacing-sm, 8px);
  bottom: var(--spacing-xs, 4px);
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .scroll-track,
  .scroll-thumb {
    transition: none !important;
  }
}

/* 悬浮预览弹窗 */
.context-preview {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  margin-bottom: 8px;
  background: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-editorWidget-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  z-index: 100;
  max-height: 240px;
  overflow: hidden;
}

.preview-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editor-background);
}

.preview-header .codicon {
  font-size: 14px;
  color: var(--vscode-textLink-foreground);
}

.preview-title {
  flex: 1;
  font-weight: 500;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-content {
  margin: 0;
  padding: 10px 12px;
  font-size: 11px;
  font-family: var(--vscode-editor-font-family);
  line-height: 1.5;
  overflow-y: auto;
  max-height: 180px;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--vscode-foreground);
  background: var(--vscode-textBlockQuote-background);
}

/* 淡入淡出动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>