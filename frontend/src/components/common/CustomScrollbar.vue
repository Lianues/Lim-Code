<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick, computed } from 'vue'

/**
 * 自定义滚动条组件 - 方角、始终可见、悬浮式
 * 参考 gemini-go-sandbox 实现
 */

const props = defineProps({
  /** 滚动条宽度（px） */
  width: {
    type: Number,
    default: 6
  },
  /** 导轨颜色（留空使用透明） */
  trackColor: {
    type: String,
    default: ''
  },
  /** 可选：强制指定滑块颜色 */
  thumbColor: {
    type: String,
    default: ''
  },
  /** 可选：滑块 hover 颜色 */
  thumbHoverColor: {
    type: String,
    default: ''
  },
  /** 滚动条与边缘的距离（px） */
  offset: {
    type: Number,
    default: 2
  },
  /** 最小滑块高度/宽度（px） */
  minThumbHeight: {
    type: Number,
    default: 24
  },
  /** 粘性底部 - 当位于底部时自动跟随新内容 */
  stickyBottom: {
    type: Boolean,
    default: false
  },
  /** 粘性底部判定阈值（px） */
  stickyThreshold: {
    type: Number,
    default: 50
  },
  /** 是否启用横向滚动 */
  horizontal: {
    type: Boolean,
    default: false
  },
  /**
   * 最大高度（px 或 CSS 值）
   * 设置后组件将以内容自适应高度模式工作
   * 不再需要父容器有固定高度
   */
  maxHeight: {
    type: [Number, String],
    default: ''
  }
})

const scrollContainer = ref<HTMLElement | null>(null)
const scrollTrack = ref<HTMLElement | null>(null)
const hScrollTrack = ref<HTMLElement | null>(null)

// 垂直滚动条状态
const thumbHeight = ref(0)
const thumbTop = ref(0)
const showScrollbar = ref(false)

// 横向滚动条状态
const thumbWidth = ref(0)
const thumbLeft = ref(0)
const showHScrollbar = ref(false)

let isDragging = false
let isHDragging = false
let startY = 0
let startX = 0
let startScrollTop = 0
let startScrollLeft = 0
let resizeObserver: ResizeObserver | null = null
let mutationObserver: MutationObserver | null = null

// 检查是否在底部（用于粘性底部）
function isAtBottom(): boolean {
  if (!scrollContainer.value) return false
  const container = scrollContainer.value
  const { scrollTop, scrollHeight, clientHeight } = container
  return scrollHeight - scrollTop - clientHeight <= props.stickyThreshold
}

// 记录是否在底部（内容变化前检查）
let wasAtBottom = true

// 计算并更新滚动条状态
function updateScrollbar() {
  if (!scrollContainer.value) return

  const container = scrollContainer.value
  const scrollHeight = container.scrollHeight
  const clientHeight = container.clientHeight
  const scrollTop = container.scrollTop

  // 判断是否需要显示垂直滚动条
  showScrollbar.value = scrollHeight > clientHeight
  
  if (showScrollbar.value) {
    // 计算滑块高度（最小 minThumbHeight）
    const ratio = clientHeight / Math.max(1, scrollHeight)
    thumbHeight.value = Math.max(props.minThumbHeight, clientHeight * ratio)

    // 计算滑块位置
    const maxScrollTop = Math.max(1, scrollHeight - clientHeight)
    const maxThumbTop = Math.max(1, clientHeight - thumbHeight.value)
    thumbTop.value = (scrollTop / maxScrollTop) * maxThumbTop
  }
  
  // 更新横向滚动条
  if (props.horizontal) {
    const scrollWidth = container.scrollWidth
    const clientWidth = container.clientWidth
    const scrollLeft = container.scrollLeft
    
    // 判断是否需要显示横向滚动条
    showHScrollbar.value = scrollWidth > clientWidth
    
    if (showHScrollbar.value) {
      // 计算滑块宽度（最小 minThumbHeight）
      const hRatio = clientWidth / Math.max(1, scrollWidth)
      thumbWidth.value = Math.max(props.minThumbHeight, clientWidth * hRatio)
      
      // 计算滑块位置
      const maxScrollLeft = Math.max(1, scrollWidth - clientWidth)
      const maxThumbLeft = Math.max(1, clientWidth - thumbWidth.value)
      thumbLeft.value = (scrollLeft / maxScrollLeft) * maxThumbLeft
    }
  }
}

// 滚动事件处理
function handleScroll() {
  updateScrollbar()
  // 更新底部状态
  wasAtBottom = isAtBottom()
}

// 垂直滚动 - 鼠标按下滑块
function handleThumbMouseDown(e: MouseEvent) {
  if (!scrollContainer.value) return
  
  isDragging = true
  startY = e.clientY
  startScrollTop = scrollContainer.value.scrollTop
  
  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
  
  e.preventDefault()
}

// 垂直滚动 - 鼠标移动
function handleMouseMove(e: MouseEvent) {
  if (!isDragging || !scrollContainer.value) return
  
  const container = scrollContainer.value
  const deltaY = e.clientY - startY
  const scrollHeight = container.scrollHeight
  const clientHeight = container.clientHeight
  const maxScrollTop = scrollHeight - clientHeight
  const maxThumbTop = clientHeight - thumbHeight.value
  
  // 计算新的滚动位置
  const scrollDelta = (deltaY / maxThumbTop) * maxScrollTop
  container.scrollTop = startScrollTop + scrollDelta
}

// 垂直滚动 - 鼠标释放
function handleMouseUp() {
  isDragging = false
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
}

// 垂直滚动 - 点击轨道跳转
function handleTrackClick(e: MouseEvent) {
  if (!scrollTrack.value || !scrollContainer.value) return
  if (e.target !== scrollTrack.value) return
  
  const container = scrollContainer.value
  const trackRect = scrollTrack.value.getBoundingClientRect()
  const clickY = e.clientY - trackRect.top
  
  const scrollHeight = container.scrollHeight
  const clientHeight = container.clientHeight
  const maxScrollTop = scrollHeight - clientHeight
  
  // 计算目标滚动位置（点击位置居中）
  const targetThumbTop = clickY - thumbHeight.value / 2
  const maxThumbTop = clientHeight - thumbHeight.value
  const ratio = Math.max(0, Math.min(1, targetThumbTop / maxThumbTop))
  
  container.scrollTop = ratio * maxScrollTop
}

// 横向滚动 - 鼠标按下滑块
function handleHThumbMouseDown(e: MouseEvent) {
  if (!scrollContainer.value) return
  
  isHDragging = true
  startX = e.clientX
  startScrollLeft = scrollContainer.value.scrollLeft
  
  document.addEventListener('mousemove', handleHMouseMove)
  document.addEventListener('mouseup', handleHMouseUp)
  
  e.preventDefault()
}

// 横向滚动 - 鼠标移动
function handleHMouseMove(e: MouseEvent) {
  if (!isHDragging || !scrollContainer.value) return
  
  const container = scrollContainer.value
  const deltaX = e.clientX - startX
  const scrollWidth = container.scrollWidth
  const clientWidth = container.clientWidth
  const maxScrollLeft = scrollWidth - clientWidth
  const maxThumbLeft = clientWidth - thumbWidth.value
  
  // 计算新的滚动位置
  const scrollDelta = (deltaX / maxThumbLeft) * maxScrollLeft
  container.scrollLeft = startScrollLeft + scrollDelta
}

// 横向滚动 - 鼠标释放
function handleHMouseUp() {
  isHDragging = false
  document.removeEventListener('mousemove', handleHMouseMove)
  document.removeEventListener('mouseup', handleHMouseUp)
}

// 横向滚动 - 点击轨道跳转
function handleHTrackClick(e: MouseEvent) {
  if (!hScrollTrack.value || !scrollContainer.value) return
  if (e.target !== hScrollTrack.value) return
  
  const container = scrollContainer.value
  const trackRect = hScrollTrack.value.getBoundingClientRect()
  const clickX = e.clientX - trackRect.left
  
  const scrollWidth = container.scrollWidth
  const clientWidth = container.clientWidth
  const maxScrollLeft = scrollWidth - clientWidth
  
  // 计算目标滚动位置（点击位置居中）
  const targetThumbLeft = clickX - thumbWidth.value / 2
  const maxThumbLeft = clientWidth - thumbWidth.value
  const ratio = Math.max(0, Math.min(1, targetThumbLeft / maxThumbLeft))
  
  container.scrollLeft = ratio * maxScrollLeft
}

const trackStyle = computed(() => {
  const style: Record<string, string> = {
    width: `${props.width}px`,
    right: `${props.offset}px`,
  }
  if (props.trackColor) {
    style.background = props.trackColor
  }
  return style
})

const thumbStyle = computed(() => {
  const style: Record<string, string> = {
    height: `${thumbHeight.value}px`,
    transform: `translateY(${thumbTop.value}px)`,
  }
  if (props.thumbColor) {
    style.background = props.thumbColor
  }
  return style
})

const hTrackStyle = computed(() => {
  const style: Record<string, string> = {
    height: `${props.width}px`,
    bottom: `${props.offset}px`,
  }
  if (props.trackColor) {
    style.background = props.trackColor
  }
  return style
})

const hThumbStyle = computed(() => {
  const style: Record<string, string> = {
    width: `${thumbWidth.value}px`,
    transform: `translateX(${thumbLeft.value}px)`,
  }
  if (props.thumbColor) {
    style.background = props.thumbColor
  }
  return style
})

// 容器样式（支持 maxHeight 模式）
const wrapperStyle = computed(() => {
  if (!props.maxHeight) return {}
  
  const maxH = typeof props.maxHeight === 'number'
    ? `${props.maxHeight}px`
    : props.maxHeight
  
  return {
    maxHeight: maxH,
    height: 'auto'
  }
})

// 组件挂载
onMounted(() => {
  nextTick(() => {
    setTimeout(() => {
      updateScrollbar()
    }, 100)
    
    if (scrollContainer.value) {
      scrollContainer.value.addEventListener('scroll', handleScroll, { passive: true })
    }
    
    window.addEventListener('resize', updateScrollbar)

    // 使用 ResizeObserver 监听容器尺寸变化
    if (window.ResizeObserver && scrollContainer.value) {
      resizeObserver = new ResizeObserver(() => {
        updateScrollbar()
      })
      resizeObserver.observe(scrollContainer.value)
    }
    
    // 使用 MutationObserver 监听内容变化
    if (scrollContainer.value) {
      mutationObserver = new MutationObserver(() => {
        if (!scrollContainer.value) return
        
        // 粘性底部：只有之前在底部时才保持在底部
        if (props.stickyBottom && wasAtBottom) {
          scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight
        }
        
        updateScrollbar()
        // 更新底部状态，用于下次检测
        wasAtBottom = isAtBottom()
      })
      mutationObserver.observe(scrollContainer.value, {
        childList: true,
        subtree: true,
        characterData: true
      })
    }
    
    // 初始化底部状态
    wasAtBottom = isAtBottom()
  })
})

// 组件卸载
onBeforeUnmount(() => {
  if (scrollContainer.value) {
    scrollContainer.value.removeEventListener('scroll', handleScroll)
  }
  window.removeEventListener('resize', updateScrollbar)
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (mutationObserver) {
    mutationObserver.disconnect()
    mutationObserver = null
  }
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
  document.removeEventListener('mousemove', handleHMouseMove)
  document.removeEventListener('mouseup', handleHMouseUp)
})

// 暴露方法供外部调用
defineExpose({
  update: updateScrollbar,
  scrollToTop: () => {
    if (scrollContainer.value) {
      scrollContainer.value.scrollTop = 0
      nextTick(() => updateScrollbar())
    }
  },
  scrollToBottom: () => {
    if (scrollContainer.value) {
      // 强制更新一次，确保获取最新的 scrollHeight
      nextTick(() => {
        if (scrollContainer.value) {
          scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight
          updateScrollbar()
        }
      })
    }
  },
  getContainer: () => scrollContainer.value
})
</script>

<template>
  <div
    class="custom-scrollbar-wrapper"
    :class="{ 'has-h-scroll': horizontal, 'auto-height': !!maxHeight }"
    :style="wrapperStyle"
  >
    <div
      ref="scrollContainer"
      class="scroll-container"
      :class="{ 'enable-h-scroll': horizontal, 'auto-height': !!maxHeight }"
    >
      <slot />
    </div>
    
    <!-- 垂直滚动条 -->
    <div
      v-show="showScrollbar"
      ref="scrollTrack"
      class="scroll-track scroll-track-v"
      :style="trackStyle"
      @click="handleTrackClick"
    >
      <div
        class="scroll-thumb scroll-thumb-v"
        :style="thumbStyle"
        @mousedown="handleThumbMouseDown"
      />
    </div>
    
    <!-- 横向滚动条 -->
    <div
      v-show="showHScrollbar"
      ref="hScrollTrack"
      class="scroll-track scroll-track-h"
      :style="hTrackStyle"
      @click="handleHTrackClick"
    >
      <div
        class="scroll-thumb scroll-thumb-h"
        :style="hThumbStyle"
        @mousedown="handleHThumbMouseDown"
      />
    </div>
  </div>
</template>

<style scoped>
.custom-scrollbar-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* 自适应高度模式 */
.custom-scrollbar-wrapper.auto-height {
  height: auto;
}

.scroll-container {
  width: 100%;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

/* 自适应高度模式下的滚动容器 */
.scroll-container.auto-height {
  height: auto;
  max-height: inherit;
}

.scroll-container.enable-h-scroll {
  overflow-x: auto;
}

.scroll-container::-webkit-scrollbar {
  display: none;
}

/* 垂直滚动条轨道 */
.scroll-track-v {
  position: absolute;
  top: 0;
  height: 100%;
  border-radius: 0;
  cursor: pointer;
  background: transparent;
  z-index: 10;
  opacity: 1;
}

/* 横向滚动条轨道 */
.scroll-track-h {
  position: absolute;
  left: 0;
  width: 100%;
  border-radius: 0;
  cursor: pointer;
  background: transparent;
  z-index: 10;
  opacity: 1;
}

/* 垂直滚动滑块 */
.scroll-thumb-v {
  position: absolute;
  left: 0;
  width: 100%;
  border-radius: 0;
  cursor: grab;
  transition: background 0.18s ease, transform 0.06s linear;
  will-change: transform;
  background: var(--vscode-scrollbarSlider-background, rgba(100, 100, 100, 0.4));
}

/* 横向滚动滑块 */
.scroll-thumb-h {
  position: absolute;
  top: 0;
  height: 100%;
  border-radius: 0;
  cursor: grab;
  transition: background 0.18s ease, transform 0.06s linear;
  will-change: transform;
  background: var(--vscode-scrollbarSlider-background, rgba(100, 100, 100, 0.4));
}

.scroll-thumb-v:hover,
.scroll-thumb-h:hover {
  background: var(--vscode-scrollbarSlider-hoverBackground, rgba(100, 100, 100, 0.55));
}

.scroll-thumb-v:active,
.scroll-thumb-h:active {
  cursor: grabbing;
  background: var(--vscode-scrollbarSlider-activeBackground, rgba(100, 100, 100, 0.7));
}

@media (prefers-reduced-motion: reduce) {
  .scroll-track-v,
  .scroll-track-h,
  .scroll-thumb-v,
  .scroll-thumb-h {
    transition: none !important;
  }
}
</style>