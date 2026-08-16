import * as domMatchers from "@testing-library/jest-dom/matchers"
import { afterEach, beforeEach, vi } from "vitest"

expect.extend(domMatchers)

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
