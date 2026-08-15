import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react"
import type { DialogEntityTarget } from "@/lib/audit-entity"
import type { PageKey } from "./nav-types.js"

export type { PageKey } from "./nav-types.js"

interface NavContextValue {
  currentPage: PageKey
  navigate: (page: PageKey) => void
  commandBarOpen: boolean
  setCommandBarOpen: (open: boolean) => void
  financialFilter: "all" | "overdue"
  setFinancialFilter: (filter: "all" | "overdue") => void
  selectedWeaponId: string | null
  setSelectedWeaponId: (id: string | null) => void
  selectedInvoiceId: string | null
  setSelectedInvoiceId: (id: string | null) => void
  selectedShipmentId: string | null
  setSelectedShipmentId: (id: string | null) => void
  selectedCustomerId: string | null
  setSelectedCustomerId: (id: string | null) => void
  selectedSupplierId: string | null
  setSelectedSupplierId: (id: string | null) => void
  navigateToEntity: (target: DialogEntityTarget) => void
}

const NavContext = createContext<NavContextValue | undefined>(undefined)

export function NavProvider({ children }: { children: ReactNode }) {
  performance.mark("boot:provider:nav:render:start")
  const [currentPage, setCurrentPage] = useState<PageKey>("dashboard")
  const [commandBarOpen, setCommandBarOpen] = useState(false)
  const [financialFilter, setFinancialFilter] = useState<"all" | "overdue">("all")
  const [selectedWeaponId, setSelectedWeaponId] = useState<string | null>(null)
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null)
  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null)
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null)

  const navigate = useCallback((page: PageKey) => {
    setCurrentPage(page)
  }, [])

  const navigateToEntity = useCallback((target: DialogEntityTarget) => {
    if (target.kind === "invoice") {
      setSelectedInvoiceId(target.id)
      setCurrentPage("financials")
    } else if (target.kind === "shipment") {
      setSelectedShipmentId(target.id)
      setCurrentPage("shipments")
    } else if (target.kind === "weapon") {
      setSelectedWeaponId(target.id)
      setCurrentPage("inventory")
    } else if (target.kind === "customer") {
      setSelectedCustomerId(target.id)
      setCurrentPage("customers")
    } else {
      setSelectedSupplierId(target.id)
      setCurrentPage("suppliers")
    }
  }, [])

  useEffect(() => {
    performance.mark("boot:provider:nav:mounted")
    performance.measure("boot:provider:nav:mount", "boot:provider:nav:render:start", "boot:provider:nav:mounted")
  }, [])

  return (
    <NavContext.Provider value={{
      currentPage, navigate, commandBarOpen, setCommandBarOpen,
      financialFilter, setFinancialFilter, selectedWeaponId, setSelectedWeaponId,
      selectedInvoiceId, setSelectedInvoiceId, selectedShipmentId, setSelectedShipmentId,
      selectedCustomerId, setSelectedCustomerId, selectedSupplierId, setSelectedSupplierId,
      navigateToEntity,
    }}>
      {children}
    </NavContext.Provider>
  )
}

export function useNav() {
  const ctx = useContext(NavContext)
  if (!ctx) throw new Error("useNav must be used within NavProvider")
  return ctx
}
