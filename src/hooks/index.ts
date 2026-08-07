import { useState, useEffect, useRef, useCallback, useMemo } from "react"
export { useDynamicMasterData } from "./use-dynamic-master-data"
export type { DynamicMasterData, MasterWeaponType, MasterWeaponSubtype, MasterCaliber, MasterBrand, MasterModel, MasterWarehouse, MasterStorageLocation } from "./use-dynamic-master-data"

export function useDebounce<T>(value: T, delay: number = 150): T {
  const [debounced, setDebounced] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(handler)
  }, [value, delay])

  return debounced
}

export function useVirtualList<T>(
  items: T[],
  itemHeight: number,
  containerHeight: number,
  overscan: number = 5
): {
  virtualItems: { index: number; offsetTop: number; data: T }[]
  totalHeight: number
  scrollTop: number
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void
} {
  const [scrollTop, setScrollTop] = useState(0)

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop((e.currentTarget as HTMLDivElement).scrollTop)
  }, [])

  const { virtualItems, totalHeight } = useMemo(() => {
    const total = items.length * itemHeight
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan)
    const endIndex = Math.min(
      items.length,
      Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
    )

    const virtual = []
    for (let i = startIndex; i < endIndex; i++) {
      virtual.push({
        index: i,
        offsetTop: i * itemHeight,
        data: items[i],
      })
    }

    return { virtualItems: virtual, totalHeight: total }
  }, [items, itemHeight, containerHeight, scrollTop, overscan])

  return { virtualItems, totalHeight, scrollTop, onScroll }
}

export function useLocalStorage<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored ? JSON.parse(stored) : initial
    } catch {
      return initial
    }
  })

  const update = useCallback((newValue: T) => {
    setValue(newValue)
    try {
      localStorage.setItem(key, JSON.stringify(newValue))
    } catch {
      // ignore
    }
  }, [key])

  return [value, update]
}

export function useKeyboardShortcut(
  key: string,
  callback: () => void,
  modifiers: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {}
) {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (modifiers.ctrl && !e.ctrlKey) return
      if (modifiers.meta && !e.metaKey) return
      if (modifiers.shift && !e.shiftKey) return
      if (e.key.toLowerCase() === key.toLowerCase()) {
        e.preventDefault()
        callbackRef.current()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [key, modifiers.ctrl, modifiers.meta, modifiers.shift])
}
