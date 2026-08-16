import { afterEach, describe, expect, it } from "vitest"
import { renderHook } from "@testing-library/react"
import { useStore } from "@/lib/store"

describe("current user snapshot stability", () => {
  const initialUsers = useStore.getState().users
  const initialCurrentUserId = useStore.getState().currentUserId

  afterEach(() => {
    useStore.setState({ users: initialUsers, currentUserId: initialCurrentUserId })
  })

  it("returns the same fallback object before bootstrap loads users", () => {
    useStore.setState({ users: [], currentUserId: "U001" })

    const first = useStore.getState().getCurrentUser()
    const second = useStore.getState().getCurrentUser()

    expect(second).toBe(first)
    expect(first.role).toBe("Employee")
  })

  it("keeps the React store selector snapshot stable before bootstrap", () => {
    useStore.setState({ users: [], currentUserId: "U001" })

    const { result } = renderHook(() => useStore((state) => state.getCurrentUser()))

    expect(result.current.id).toBe("UNLINKED")
    expect(result.current.role).toBe("Employee")
  })
})
