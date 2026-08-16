import { afterEach, describe, expect, it, vi } from "vitest"
import * as db from "@/lib/db"
import { useStore, type ShipmentInput } from "@/lib/store"

const input: ShipmentInput = {
  shipmentNumber: "SHIP-LOADING",
  supplierId: "SUP-1",
  shipmentDate: "2026-08-12",
  expectedArrivalDate: "2026-08-20",
  totalExpectedItems: 1,
  attachments: [],
  notes: "",
}

describe("optimistic shipment registration", () => {
  const initialShipments = useStore.getState().shipments
  const initialRefresh = useStore.getState().refreshFromDb

  afterEach(() => {
    useStore.setState({ shipments: initialShipments, refreshFromDb: initialRefresh })
  })

  it("inserts a loading row before the backend responds", async () => {
    let finish!: (id: string) => void
    vi.spyOn(db, "dbCreateShipmentRpc").mockReturnValue(new Promise((resolve) => { finish = resolve }))
    useStore.setState({ shipments: [], refreshFromDb: vi.fn(async () => undefined) })

    const request = useStore.getState().createShipment(input)
    expect(useStore.getState().shipments[0]).toMatchObject({
      shipmentNumber: "SHIP-LOADING",
      isSaving: true,
      workflowStatus: "processing",
    })

    finish("SHIP-1")
    await expect(request).resolves.toMatchObject({ success: true, shipmentId: "SHIP-1" })
  })

  it("removes the loading row when registration fails", async () => {
    vi.spyOn(db, "dbCreateShipmentRpc").mockRejectedValue(new Error("network failed"))
    useStore.setState({ shipments: [] })
    await expect(useStore.getState().createShipment(input)).resolves.toMatchObject({ success: false })
    expect(useStore.getState().shipments).toEqual([])
  })
})
