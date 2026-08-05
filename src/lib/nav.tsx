import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react"

export type PageKey =
  | "dashboard"
  | "inventory"
  | "sales"
  | "shipments"
  | "financials"
  | "customers"
  | "suppliers"
  | "audit"
  | "settings"

interface NavContextValue {
  currentPage: PageKey
  navigate: (page: PageKey) => void
  commandBarOpen: boolean
  setCommandBarOpen: (open: boolean) => void
  financialFilter: "all" | "overdue"
  setFinancialFilter: (filter: "all" | "overdue") => void
  selectedWeaponId: string | null
  setSelectedWeaponId: (id: string | null) => void
}

const NavContext = createContext<NavContextValue | undefined>(undefined)

export function NavProvider({ children }: { children: ReactNode }) {
  performance.mark("boot:provider:nav:render:start")
  const [currentPage, setCurrentPage] = useState<PageKey>("dashboard")
  const [commandBarOpen, setCommandBarOpen] = useState(false)
  const [financialFilter, setFinancialFilter] = useState<"all" | "overdue">("all")
  const [selectedWeaponId, setSelectedWeaponId] = useState<string | null>(null)

  const navigate = useCallback((page: PageKey) => {
    setCurrentPage(page)
  }, [])

  useEffect(() => {
    performance.mark("boot:provider:nav:mounted")
    performance.measure("boot:provider:nav:mount", "boot:provider:nav:render:start", "boot:provider:nav:mounted")
  }, [])

  return (
    <NavContext.Provider value={{
      currentPage, navigate, commandBarOpen, setCommandBarOpen,
      financialFilter, setFinancialFilter, selectedWeaponId, setSelectedWeaponId,
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
