export interface ComputeVirtualRowsOptions {
  threshold: number
  estimatedRowHeight: number
  overscan: number
  viewportHeight: number
  scrollTop: number
}

export interface ComputeVirtualRowsResult<T> {
  rows: T[]
  topPadding: number
  bottomPadding: number
  startIndex: number
  endIndex: number
  virtualized: boolean
  fallback: boolean
  reason?: 'below_threshold' | 'invalid_estimate' | 'invalid_viewport' | 'empty_slice' | 'clamped'
}

export function resolveLoadedVisibleMessages<T>(messages: T[], _visibleCount: number): T[] {
  return Array.isArray(messages) ? messages : []
}

export function computeVirtualRows<T>(rows: T[], options: ComputeVirtualRowsOptions): ComputeVirtualRowsResult<T> {
  const totalRows = Array.isArray(rows) ? rows.length : 0
  if (totalRows === 0) {
    return {
      rows: [],
      topPadding: 0,
      bottomPadding: 0,
      startIndex: 0,
      endIndex: 0,
      virtualized: false,
      fallback: false,
      reason: 'below_threshold'
    }
  }

  if (totalRows <= options.threshold) {
    return {
      rows,
      topPadding: 0,
      bottomPadding: 0,
      startIndex: 0,
      endIndex: totalRows,
      virtualized: false,
      fallback: false,
      reason: 'below_threshold'
    }
  }

  if (!Number.isFinite(options.estimatedRowHeight) || options.estimatedRowHeight <= 0) {
    return {
      rows,
      topPadding: 0,
      bottomPadding: 0,
      startIndex: 0,
      endIndex: totalRows,
      virtualized: false,
      fallback: true,
      reason: 'invalid_estimate'
    }
  }

  if (!Number.isFinite(options.viewportHeight) || options.viewportHeight <= 0) {
    return {
      rows,
      topPadding: 0,
      bottomPadding: 0,
      startIndex: 0,
      endIndex: totalRows,
      virtualized: false,
      fallback: true,
      reason: 'invalid_viewport'
    }
  }

  const overscan = Math.max(0, Math.floor(options.overscan))
  const visibleRows = Math.max(1, Math.ceil(options.viewportHeight / options.estimatedRowHeight))
  const sliceLength = visibleRows + overscan * 2
  const rawStartIndex = Math.max(0, Math.floor((Number.isFinite(options.scrollTop) ? options.scrollTop : 0) / options.estimatedRowHeight) - overscan)
  const maxStartIndex = Math.max(0, totalRows - sliceLength)
  const startIndex = Math.min(rawStartIndex, maxStartIndex)
  const endIndex = Math.min(totalRows, startIndex + sliceLength)
  const visibleSlice = rows.slice(startIndex, endIndex)

  if (visibleSlice.length === 0) {
    return {
      rows,
      topPadding: 0,
      bottomPadding: 0,
      startIndex: 0,
      endIndex: totalRows,
      virtualized: false,
      fallback: true,
      reason: 'empty_slice'
    }
  }

  return {
    rows: visibleSlice,
    topPadding: Math.max(0, startIndex * options.estimatedRowHeight),
    bottomPadding: Math.max(0, (totalRows - endIndex) * options.estimatedRowHeight),
    startIndex,
    endIndex,
    virtualized: true,
    fallback: false,
    reason: rawStartIndex !== startIndex ? 'clamped' : undefined
  }
}
