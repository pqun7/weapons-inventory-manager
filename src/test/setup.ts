import "@testing-library/jest-dom/vitest"
import { afterEach, beforeEach, vi } from "vitest"

let cleanup: (() => void) | null = null

afterEach(async () => {
  if (typeof document !== "undefined") {
    if (!cleanup) {
      const mod = await import("@testing-library/react")
      cleanup = mod.cleanup
    }
    cleanup()
  }
})

beforeEach(() => {
  vi.restoreAllMocks()
  if (typeof localStorage !== "undefined") {
    localStorage.clear()
  }
})
