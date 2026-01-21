import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

export interface UseDropdownOptions {
  disabled?: Ref<boolean> | (() => boolean)
  onOpen?: () => void
  onClose?: () => void
}

function isDisabled(disabled?: UseDropdownOptions['disabled']): boolean {
  if (!disabled) return false
  return typeof disabled === 'function' ? disabled() : !!disabled.value
}

/**
 * Shared dropdown open/close state with click-outside handling.
 * Keeps selectors (channel/model/mode...) small and consistent.
 */
export function useDropdown(containerRef: Ref<HTMLElement | undefined>, opts: UseDropdownOptions = {}) {
  const isOpen = ref(false)

  function open() {
    if (isDisabled(opts.disabled)) return
    isOpen.value = true
    opts.onOpen?.()
  }

  function close() {
    if (!isOpen.value) return
    isOpen.value = false
    opts.onClose?.()
  }

  function toggle() {
    if (isOpen.value) close()
    else open()
  }

  function handleClickOutside(event: MouseEvent) {
    const el = containerRef.value
    if (!el) return
    if (!el.contains(event.target as Node)) close()
  }

  onMounted(() => {
    document.addEventListener('click', handleClickOutside)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('click', handleClickOutside)
  })

  return { isOpen, open, close, toggle }
}
