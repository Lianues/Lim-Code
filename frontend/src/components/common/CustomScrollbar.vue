<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick, computed } from 'vue'
import { t } from '../../i18n'

/**
 * 自定义滚动条组件 - 方角、始终可见、悬浮式
 * 支持在轨道上渲染 marker 节点（如用户消息标记），点击可快速跳转
 */

// ==================== Marker 类型定义 ====================
interface MarkerItem {
  /** marker 在轨道上的垂直像素偏移 */
  top: number
  /** marker 对应的内容预览文本（从 data-preview 读取） */
  contentPreview: string
  /** 对应的 DOM 元素（用于点击跳转） */
  element: HTMLElement
  /** marker 的索引序号（用于 tooltip 显示） */
  index: number
}

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
  /** 是否显示置顶/置底跳转按钮 */
  showJumpButtons: {
    type: Boolean,
    default: false
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
  },
  // ==================== Marker 相关 Props ====================
  /**
   * CSS 选择器，用于在滚动内容中查找需要标记的元素
   * 例如 '.user-message' 会匹配所有用户消息
   * 留空则不渲染任何 marker
   */
  markerSelector: {
    type: String,
    default: ''
  },
  /** marker 节点颜色 */
  markerColor: {
    type: String,
    default: 'rgba(100, 160, 255, 0.55)'
  },
  /** marker 节点高度（px） */
  markerHeight: {
    type: Number,
    default: 6
  },
  /** marker 节点默认透明度 (0-1) */
  markerOpacity: {
    type: Number,
    default: 0.55
  },
  /** marker hover 透明度 (0-1) */
  markerHoverOpacity: {
    type: Number,
    default: 1
  },
  /** marker tooltip 前缀文案（与序号拼接显示，如 "User #3"） */
  markerTooltipPrefix: {
    type: String,
    default: 'User'
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

// ==================== Marker 状态 ====================
const markerPositions = ref<MarkerItem[]>([])
let markerUpdateTimer: ReturnType<typeof setTimeout> | null = null

// ==================== Tooltip 状态 ====================
const tooltipVisible = ref(false)
const tooltipContent = ref('')
const tooltipIndex = ref(0)
const tooltipTop = ref(0)
let tooltipHideTimer: ReturnType<typeof setTimeout> | null = null
const tooltipRef = ref<HTMLElement | null>(null)
let tooltipRafId: number | null = null

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
    // 垂直轨道实际高度（排除跳转按钮）
    const trackHeight = scrollTrack.value?.clientHeight || clientHeight
    
    // 计算滑块高度：滑块在轨道中的占比应等于可见内容在总内容中的占比
    // 公式：thumbHeight / trackHeight = clientHeight / scrollHeight
    const ratio = clientHeight / Math.max(1, scrollHeight)
    thumbHeight.value = Math.max(props.minThumbHeight, trackHeight * ratio)

    // 计算滑块位置
    const maxScrollTop = Math.max(1, scrollHeight - clientHeight)
    const maxThumbTop = Math.max(0, trackHeight - thumbHeight.value)
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

// ==================== Marker 逻辑 ====================

/**
 * 计算元素相对于滚动容器内容顶部的绝对偏移
 * 使用 getBoundingClientRect + scrollTop 换算，不依赖 offsetParent 链
 */
function getContentOffset(element: HTMLElement, container: HTMLElement): number {
  const elRect = element.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  return elRect.top - containerRect.top + container.scrollTop
}

/**
 * 扫描 markerSelector 匹配的元素，计算它们在轨道上的映射位置
 * 仅在内容/尺寸变化时调用（不在每次 scroll 事件中调用——位置是内容相关的，不是视口相关的）
 */
function updateMarkers() {
  if (!scrollContainer.value || !props.markerSelector || !scrollTrack.value) {
    markerPositions.value = []
    return
  }

  const container = scrollContainer.value
  const scrollHeight = container.scrollHeight
  const clientHeight = container.clientHeight
  const trackHeight = scrollTrack.value.clientHeight

  // 内容不足以滚动时无需显示 marker
  if (scrollHeight <= clientHeight || trackHeight <= 0) {
    markerPositions.value = []
    return
  }

  const elements = container.querySelectorAll(props.markerSelector)
  const newPositions: MarkerItem[] = []

  elements.forEach((el, idx) => {
    const htmlEl = el as HTMLElement
    const contentOffset = getContentOffset(htmlEl, container)
    const preview = htmlEl.getAttribute('data-preview') || ''
    // 映射到轨道位置：(元素在内容中的偏移 / 总内容高度) * 轨道高度
    const trackPos = (contentOffset / scrollHeight) * trackHeight
    newPositions.push({ top: trackPos, element: htmlEl, index: idx + 1, contentPreview: preview })
  })

  markerPositions.value = newPositions
}

/**
 * 防抖版 updateMarkers
 * MutationObserver 在流式输出期间会高频触发，
 * 这里用 80ms 防抖避免频繁 DOM 查询 + 布局计算
 */
function debouncedUpdateMarkers() {
  if (markerUpdateTimer) {
    clearTimeout(markerUpdateTimer)
  }
  markerUpdateTimer = setTimeout(() => {
    updateMarkers()
    markerUpdateTimer = null
  }, 80)
}

/**
 * 点击 marker 跳转到对应元素
 */
function handleMarkerClick(marker: MarkerItem, e: MouseEvent) {
  e.stopPropagation()
  if (!scrollContainer.value) return
  marker.element.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/**
 * 鼠标进入 marker 时显示 tooltip
 */
function handleMarkerMouseEnter(marker: MarkerItem, _e: MouseEvent) {
  if (tooltipHideTimer) {
    clearTimeout(tooltipHideTimer)
    tooltipHideTimer = null
  }
  tooltipContent.value = marker.contentPreview
  tooltipIndex.value = marker.index
  tooltipVisible.value = true

  // 需要在 DOM 渲染后再计算位置，保证 tooltipRef 已挂载并获取到真实高度
  if (tooltipRafId) cancelAnimationFrame(tooltipRafId)
  tooltipRafId = requestAnimationFrame(() => {
    tooltipRafId = null
    clampTooltipPosition(marker)
  })
}

/**
 * 根据 marker 位置和 tooltip 实际高度，将 tooltip 钳制在可视区域内
 */
function clampTooltipPosition(marker: MarkerItem) {
  if (!scrollTrack.value || !scrollContainer.value) return

  const trackRect = scrollTrack.value.getBoundingClientRect()
  // marker 在屏幕上的绝对 Y 坐标
  const markerScreenY = trackRect.top + marker.top

  // tooltip 实际高度（如果还没渲染则取估算值）
  const tipEl = tooltipRef.value
  const tipHeight = tipEl ? tipEl.offsetHeight : 60

  // 理想位置：tooltip 垂直居中于 marker
  let idealTop = markerScreenY - tipHeight / 2

  // 上下边界：以滚动容器的可视区域为准（而非整个 viewport），
  // 避免被顶部标签栏等 UI 遮挡
  const containerRect = scrollContainer.value.getBoundingClientRect()
  const viewportTop = containerRect.top
  const viewportBottom = containerRect.bottom
  if (idealTop < viewportTop + 4) {
    idealTop = viewportTop + 4
  }
  if (idealTop + tipHeight > viewportBottom - 4) {
    idealTop = viewportBottom - 4 - tipHeight
  }

  // 转回轨道坐标系（tooltip 的 CSS top 是相对于 scroll-track 的）
  tooltipTop.value = idealTop - trackRect.top
}

/**
 * 鼠标离开 marker 时延迟隐藏 tooltip
 */
function handleMarkerMouseLeave() {
  tooltipHideTimer = setTimeout(() => {
    tooltipVisible.value = false
    tooltipHideTimer = null
  }, 150)
}

/**
 * 鼠标进入 tooltip 气泡本身时，取消隐藏
 */
function handleTooltipMouseEnter() {
  if (tooltipHideTimer) {
    clearTimeout(tooltipHideTimer)
    tooltipHideTimer = null
  }
}

/**
 * tooltip 上的 wheel 事件转发给滚动容器，保持滚动体验
 */
function handleTooltipWheel(e: WheelEvent) {
  if (!scrollContainer.value) return
  // 阻止默认行为（避免整个页面滚动），转发给内容容器
  e.preventDefault()
  scrollContainer.value.scrollBy({
    top: e.deltaY,
    behavior: 'auto'
  })
}

/**
 * 计算 marker 的 CSS 样式
 */
const markerBaseColor = computed(() => {
  return props.markerColor || 'rgba(100, 160, 255, 0.55)'
})

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
  const trackHeight = scrollTrack.value?.clientHeight || clientHeight
  const maxScrollTop = scrollHeight - clientHeight
  const maxThumbTop = trackHeight - thumbHeight.value
  
  // 计算新的滚动位置
  const scrollDelta = (deltaY / Math.max(1, maxThumbTop)) * maxScrollTop
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
  const trackHeight = scrollTrack.value.clientHeight
  const maxScrollTop = scrollHeight - clientHeight
  
  //计算目标滚动位置（点击位置居中）
  const targetThumbTop = clickY - thumbHeight.value / 2
  const maxThumbTop = trackHeight - thumbHeight.value
  const ratio = Math.max(0, Math.min(1, targetThumbTop / Math.max(1, maxThumbTop)))
  
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
      // 初始化 marker
      if (props.markerSelector) {
        updateMarkers()
      }
    }, 100)
    
    if (scrollContainer.value) {
      scrollContainer.value.addEventListener('scroll', handleScroll, { passive: true })
    }
    
    window.addEventListener('resize', updateScrollbar)

    // 使用 ResizeObserver 监听容器尺寸变化
    if (window.ResizeObserver && scrollContainer.value) {
      resizeObserver = new ResizeObserver(() => {
        updateScrollbar()
        // 尺寸变化时重新计算 marker 位置
        if (props.markerSelector) {
          debouncedUpdateMarkers()
        }
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
        // 内容变化时重新计算 marker 位置（防抖）
        if (props.markerSelector) {
          debouncedUpdateMarkers()
        }
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
  if (markerUpdateTimer) {
    clearTimeout(markerUpdateTimer)
    markerUpdateTimer = null
  }
  if (tooltipHideTimer) {
    clearTimeout(tooltipHideTimer)
    tooltipHideTimer = null
  }
  if (tooltipRafId) {
    cancelAnimationFrame(tooltipRafId)
    tooltipRafId = null
  }
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
  document.removeEventListener('mousemove', handleHMouseMove)
  document.removeEventListener('mouseup', handleHMouseUp)
})

// 内部滚动方法
function scrollToTop() {
  if (scrollContainer.value) {
    scrollContainer.value.scrollTo({
      top: 0,
      behavior: 'smooth'
    })
  }
}

function scrollToBottom(options?: { instant?: boolean }) {
  if (scrollContainer.value) {
    const behavior = options?.instant ? 'instant' as ScrollBehavior : 'smooth'
    // 强制更新一次，确保获取最新的 scrollHeight
    nextTick(() => {
      if (scrollContainer.value) {
        scrollContainer.value.scrollTo({
          top: scrollContainer.value.scrollHeight,
          behavior
        })
      }
    })
  }
}

// 暴露方法供外部调用
defineExpose({
  update: updateScrollbar,
  updateMarkers,
  scrollToTop,
  scrollToBottom,
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
      class="scroll-track-container-v"
      :style="{ right: `${offset}px`, width: `${width}px` }"
    >
      <button 
        v-if="showJumpButtons" 
        class="jump-btn jump-btn-top" 
        :title="t ? t('components.common.scrollToTop') : 'Scroll to top'"
        @click.stop="scrollToTop"
      >
        <i class="codicon codicon-chevron-up"></i>
      </button>

      <div
        ref="scrollTrack"
        class="scroll-track scroll-track-v"
        :style="trackStyle"
        @click="handleTrackClick"
      >
        <!-- Marker 节点：渲染在轨道内，位于 thumb 之上 -->
        <div
          v-for="(marker, idx) in markerPositions"
          :key="idx"
          class="scroll-marker"
          :style="{
            top: `${marker.top}px`,
            height: `${markerHeight}px`,
            background: markerBaseColor,
            opacity: markerOpacity,
          }"
          @click.stop="handleMarkerClick(marker, $event)"
          @mouseenter="handleMarkerMouseEnter(marker, $event)"
          @mouseleave="handleMarkerMouseLeave"
        />

        <div
          class="scroll-thumb scroll-thumb-v"
          :style="thumbStyle"
          @mousedown="handleThumbMouseDown"
        />

        <!-- Marker 悬浮预览气泡 -->
        <Transition name="marker-tooltip">
          <div
            v-if="tooltipVisible && tooltipContent"
            ref="tooltipRef"
            class="marker-tooltip"
            :style="{ top: `${tooltipTop}px` }"
            @mouseenter="handleTooltipMouseEnter"
            @mouseleave="handleMarkerMouseLeave"
            @wheel="handleTooltipWheel"
          >
            <div class="marker-tooltip-header">
              {{ markerTooltipPrefix }} #{{ tooltipIndex }}
            </div>
            <div class="marker-tooltip-body">
              {{ tooltipContent }}
            </div>
          </div>
        </Transition>
      </div>

      <button 
        v-if="showJumpButtons" 
        class="jump-btn jump-btn-bottom" 
        :title="t ? t('components.common.scrollToBottom') : 'Scroll to bottom'"
        @click.stop="() => scrollToBottom()"
      >
        <i class="codicon codicon-chevron-down"></i>
      </button>
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
.scroll-track-container-v {
  position: absolute;
  top: 0;
  height: 100%;
  z-index: 10;
  display: flex;
  flex-direction: column;
  overflow: visible;
}

.scroll-track-v {
  position: relative;
  flex: 1;
  width: 100%;
  border-radius: 0;
  cursor: pointer;
  background: transparent;
  opacity: 1;
  overflow: visible;
}

/* 跳转按钮 */
.jump-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 14px;
  min-height: 14px;
  padding: 0;
  background: var(--vscode-scrollbarSlider-background, rgba(100, 100, 100, 0.2));
  border: none;
  color: var(--vscode-foreground);
  cursor: pointer;
  opacity: 0.3;
  transition: opacity 0.1s, background 0.1s;
  flex-shrink: 0;
}

.jump-btn:hover {
  opacity: 0.8;
  background: var(--vscode-scrollbarSlider-hoverBackground, rgba(100, 100, 100, 0.4));
}

.jump-btn:active {
  opacity: 1;
  background: var(--vscode-scrollbarSlider-activeBackground, rgba(100, 100, 100, 0.6));
}

.jump-btn .codicon {
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 当宽度太小时（如 6px），加大缩放力度，确保图标核心部分可见且不被截断 */
.custom-scrollbar-wrapper :deep(.jump-btn) .codicon {
  transform: scale(0.65);
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
  /* thumb 位于 marker 之下 */
  z-index: 2;
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

/* ==================== Marker 样式 ==================== */
.scroll-marker {
  position: absolute;
  left: 0;
  width: 100%;
  border-radius: 0;
  cursor: pointer;
  z-index: 3;
  transition: opacity 0.18s ease, box-shadow 0.18s ease;
  /* 允许指针事件穿透到轨道（除了 marker 自身） */
  pointer-events: auto;
}

.scroll-marker:hover {
  opacity: 1 !important;
  box-shadow: 0 0 3px rgba(100, 160, 255, 0.6);
}

/* ==================== Marker Tooltip 样式 ==================== */
.marker-tooltip {
  position: absolute;
  right: calc(100% + 6px);
  max-width: 300px;
  min-width: 120px;
  padding: 0;
  background: var(--vscode-editorHoverWidget-background, #2d2d30);
  border: 1px solid var(--vscode-editorHoverWidget-border, #454545);
  border-radius: 3px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.36);
  z-index: 100;
  pointer-events: auto;
  overflow: hidden;
}

.marker-tooltip-header {
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--vscode-editorHoverWidget-foreground, #cccccc);
  background: var(--vscode-editorHoverWidget-statusBarBackground, rgba(255, 255, 255, 0.04));
  border-bottom: 1px solid var(--vscode-editorHoverWidget-border, #454545);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: none;
}

.marker-tooltip-body {
  padding: 6px 10px;
  font-size: 12px;
  /* 使用固定行高，避免小数行高导致底部出现“半行被截断”视觉问题 */
  line-height: 18px;
  color: var(--vscode-editorHoverWidget-foreground, #cccccc);
  white-space: normal;
  word-break: break-word;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
  line-clamp: 4;
  /* +4px 容错，避免某些字体在第4行基线下沿被裁切 */
  max-height: calc(18px * 4 + 4px);
}

/* Tooltip 进出动画 */
.marker-tooltip-enter-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.marker-tooltip-leave-active {
  transition: opacity 0.1s ease, transform 0.1s ease;
}

.marker-tooltip-enter-from {
  opacity: 0;
  transform: translateX(4px);
}

.marker-tooltip-enter-to {
  opacity: 1;
  transform: translateX(0);
}

.marker-tooltip-leave-from {
  opacity: 1;
  transform: translateX(0);
}

.marker-tooltip-leave-to {
  opacity: 0;
  transform: translateX(4px);
}

@media (prefers-reduced-motion: reduce) {
  .scroll-track-v,
  .scroll-track-h,
  .scroll-thumb-v,
  .scroll-thumb-h,
  .scroll-marker,
  .marker-tooltip,
  .marker-tooltip-enter-active,
  .marker-tooltip-leave-active {
    transition: none !important;
  }
}
</style>
