import { computed, ref, watch, type Ref } from 'vue'
import { useDropdown, type UseDropdownOptions } from './useDropdown'

export interface UseSearchableDropdownParams<T> {
  items: Ref<T[]> | (() => T[])
  getKey: (item: T) => string
  disabled?: UseDropdownOptions['disabled']
  selectedKey?: Ref<string | undefined> | (() => string | undefined)
  filter?: (item: T, query: string) => boolean
}

function resolveValue<T>(v: Ref<T> | (() => T) | undefined, fallback: T): T {
  if (!v) return fallback
  return typeof v === 'function' ? (v as any)() : v.value
}

/**
 * Shared behavior for searchable dropdowns (channel/model/mode...)
 * - open/close/toggle + click-outside
 * - searchQuery + filteredItems
 * - highlightedIndex + keyboard navigation
 */
export function useSearchableDropdown<T>(containerRef: Ref<HTMLElement | undefined>, params: UseSearchableDropdownParams<T>) {
  const searchQuery = ref('')
  const highlightedIndex = ref(-1)
  const inputRef = ref<HTMLInputElement>()

  const { isOpen, open, close, toggle } = useDropdown(containerRef, {
    disabled: params.disabled,
    onOpen: () => {
      searchQuery.value = ''

      const items = resolveValue(params.items, [] as unknown as T[])
      const selected = resolveValue(params.selectedKey as any, undefined)
      const idx = selected ? items.findIndex(it => params.getKey(it) === selected) : -1
      highlightedIndex.value = idx >= 0 ? idx : (items.length > 0 ? 0 : -1)

      setTimeout(() => inputRef.value?.focus(), 10)
    },
    onClose: () => {
      searchQuery.value = ''
      highlightedIndex.value = -1
    }
  })

  const filteredItems = computed(() => {
    const items = resolveValue(params.items, [] as unknown as T[])
    const q = (searchQuery.value || '').trim().toLowerCase()
    if (!q) return items

    if (params.filter) {
      return items.filter(it => params.filter!(it, q))
    }

    return items.filter(it => params.getKey(it).toLowerCase().includes(q))
  })

  watch(searchQuery, () => {
    highlightedIndex.value = filteredItems.value.length > 0 ? 0 : -1
  })

  function selectHighlighted(): T | null {
    if (highlightedIndex.value < 0 || highlightedIndex.value >= filteredItems.value.length) return null
    return filteredItems.value[highlightedIndex.value]
  }

  function handleKeydown(event: KeyboardEvent, onSelect: (item: T) => void) {
    if (!isOpen.value) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
        event.preventDefault()
        open()
      }
      return
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        highlightedIndex.value = Math.min(highlightedIndex.value + 1, filteredItems.value.length - 1)
        break
      case 'ArrowUp':
        event.preventDefault()
        highlightedIndex.value = Math.max(highlightedIndex.value - 1, 0)
        break
      case 'Enter': {
        event.preventDefault()
        const item = selectHighlighted()
        if (item) onSelect(item)
        break
      }
      case 'Escape':
        event.preventDefault()
        close()
        break
    }
  }

  return {
    isOpen,
    open,
    close,
    toggle,

    inputRef,
    searchQuery,
    filteredItems,

    highlightedIndex,
    handleKeydown
  }
}
