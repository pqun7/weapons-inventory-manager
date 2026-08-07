import { useStore, type SaleInput, type BulkIntakeInput, type PaymentInput, type DueDateExtensionInput, type BulkShipmentCreateInput } from "../store"
import type { ServiceResult, SaleResult, DebtResult, Weapon } from "../types"
import { ammoTotalRounds } from "../types"

// ============ SaleService ============

export const SaleService = {
  validateSale(input: SaleInput): ServiceResult {
    const store = useStore.getState()
    if (input.weaponIds.length === 0 && input.lineItems.length === 0) {
      return { success: false, error: "Select at least one weapon or item" }
    }
    for (const weaponId of input.weaponIds) {
      const weapon = store.weapons.find((w) => w.id === weaponId)
      if (!weapon) return { success: false, error: `Weapon ${weaponId} not found` }
      if (weapon.status === "Sold") return { success: false, error: `Weapon ${weapon.serialNumber} is already sold` }
      if (weapon.status === "Reserved") return { success: false, error: `Weapon ${weapon.serialNumber} is reserved` }
    }
    if (!input.customerId) return { success: false, error: "Customer is required" }
    if (!input.invoiceNumber.trim()) return { success: false, error: "Invoice number is required" }
    if (input.totalNegotiated <= 0) return { success: false, error: "Negotiated total must be greater than 0" }

    const existingInvoice = store.invoices.find((i) => i.invoiceNumber === input.invoiceNumber)
    if (existingInvoice) return { success: false, error: "Invoice number already exists" }

    return { success: true }
  },

  validateProfitMargin(input: SaleInput): { valid: boolean; needsApproval: boolean; netProfit: number; marginPercent: number } {
    const store = useStore.getState()
    const weapons = input.weaponIds
      .map((id) => store.weapons.find((w) => w.id === id))
      .filter((w): w is Weapon => w !== undefined)
    const totalCost = weapons.reduce((sum, w) => sum + w.purchasePrice, 0)
    const netProfit = input.totalNegotiated - totalCost
    const marginPercent = totalCost > 0 ? (netProfit / totalCost) * 100 : 100
    const minMargin = store.settings.minProfitMarginPercent
    return {
      valid: marginPercent >= minMargin,
      needsApproval: marginPercent < minMargin,
      netProfit,
      marginPercent,
    }
  },

  async execute(input: SaleInput): Promise<SaleResult> {
    const validation = this.validateSale(input)
    if (!validation.success) return { success: false, error: validation.error }
    return useStore.getState().completeSale(input)
  },
}

// ============ InventoryService ============

export const InventoryService = {
  validateBulkIntake(input: BulkIntakeInput): ServiceResult {
    if (!input.brandId) return { success: false, error: "Brand is required" }
    if (!input.modelId) return { success: false, error: "Model is required" }
    if (!input.weaponTypeId) return { success: false, error: "Weapon type is required" }
    if (!input.weaponSubtypeId) return { success: false, error: "Sub-type is required" }
    if (!input.caliberId) return { success: false, error: "Caliber is required" }
    if (!input.supplierId) return { success: false, error: "Supplier is required" }
    if (input.purchasePrice <= 0) return { success: false, error: "Purchase price must be > 0" }
    if (input.retailPrice <= 0) return { success: false, error: "Retail price must be > 0" }
    if (input.wholesalePrice <= 0) return { success: false, error: "Wholesale price must be > 0" }

    const filledSerials = input.serialNumbers.filter(s => s.trim().length > 0)
    if (filledSerials.length !== input.serialNumbers.length) {
      return { success: false, error: "Serial count mismatch" }
    }
    if (filledSerials.length === 0) return { success: false, error: "At least one serial required" }

    const store = useStore.getState()
    const existingSerials = new Set(store.weapons.map(w => w.serialNumber.toLowerCase()))
    const duplicates = filledSerials.filter(s => existingSerials.has(s.trim().toLowerCase()))
    if (duplicates.length === filledSerials.length) return { success: false, error: "All serials are duplicates" }

    return { success: true }
  },

  async executeBulkIntake(input: BulkIntakeInput) {
    const validation = this.validateBulkIntake(input)
    if (!validation.success) {
      return { success: false, added: 0, duplicates: [], error: validation.error }
    }
    return useStore.getState().addBulkWeapons(input)
  },

  getLowStockAccessories() {
    return useStore.getState().accessories.filter((a) => a.quantity < a.safetyThreshold)
  },

  getLowStockAmmunition() {
    return useStore.getState().ammunition.filter((a) => ammoTotalRounds(a) < a.safetyThreshold)
  },
}

// ============ ShipmentService ============

export const ShipmentService = {
  validateShipment(input: { shipmentNumber: string; supplierId: string; totalExpectedItems: number; expectedArrivalDate: string }): ServiceResult {
    if (!input.shipmentNumber.trim()) return { success: false, error: "Shipment number is required" }
    if (!input.supplierId) return { success: false, error: "Supplier is required" }
    if (input.totalExpectedItems <= 0) return { success: false, error: "Expected items must be greater than 0" }
    if (!input.expectedArrivalDate) return { success: false, error: "Expected arrival date is required" }
    return { success: true }
  },

  getReconciliation(shipmentId: string) {
    const store = useStore.getState()
    const shipment = store.shipments.find((s) => s.id === shipmentId)
    if (!shipment) return null
    const registered = store.weapons.filter((w) => w.shipmentId === shipmentId).length
    const remaining = shipment.totalExpectedItems - registered
    const completionPercent = shipment.totalExpectedItems > 0
      ? Math.round((registered / shipment.totalExpectedItems) * 100)
      : 0
    return { expected: shipment.totalExpectedItems, registered, remaining, completionPercent, status: shipment.status }
  },

  getIncompleteShipments() {
    return useStore.getState().shipments.filter((s) => s.status !== "Arrived" && s.status !== "Cancelled")
  },

  validateBulkShipment(input: BulkShipmentCreateInput): ServiceResult {
    const s = input.shipment
    if (!s.shipmentNumber.trim()) return { success: false, error: "Shipment number is required" }
    if (!s.supplierId) return { success: false, error: "Supplier is required" }
    if (!s.expectedArrivalDate) return { success: false, error: "Expected arrival date is required" }
    if (input.lineItems.length === 0) return { success: false, error: "At least one line item is required" }
    for (const item of input.lineItems) {
      // Use label for display if available, otherwise fall back to ID
      const brandDisplay = item.brandLabel?.trim() || item.brandId
      const modelDisplay = item.modelLabel?.trim() || item.modelId
      if (item.quantity <= 0) return { success: false, error: `Line item quantity must be greater than 0 (${brandDisplay} ${modelDisplay})` }
      if (!item.brandId.trim()) return { success: false, error: "Brand is required for all line items" }
      if (item.productType === "weapon" && item.serialNumbers.length !== item.quantity)
        return { success: false, error: `Serial count (${item.serialNumbers.length}) does not match quantity (${item.quantity}) for ${brandDisplay} ${modelDisplay}` }
    }
    return { success: true }
  },

  checkSerialsExist(serials: string[]): { duplicates: string[]; unique: string[] } {
    const store = useStore.getState()
    const existing = new Set(store.weapons.map((w) => w.serialNumber.toLowerCase()))
    const duplicates: string[] = []
    const unique: string[] = []
    for (const s of serials) {
      if (existing.has(s.toLowerCase())) duplicates.push(s)
      else unique.push(s)
    }
    return { duplicates, unique }
  },

  async execute(input: BulkShipmentCreateInput): Promise<{ success: boolean; shipmentId?: string; error?: string }> {
    const validation = this.validateBulkShipment(input)
    if (!validation.success) return { success: false, error: validation.error }
    return useStore.getState().bulkCreateShipmentWithItems(input)
  },
}

// ============ DebtService ============

export const DebtService = {
  validatePayment(input: PaymentInput): ServiceResult {
    const store = useStore.getState()
    const invoice = store.invoices.find((i) => i.id === input.invoiceId)
    if (!invoice) return { success: false, error: "Invoice not found" }
    if (invoice.voided) return { success: false, error: "Cannot pay a voided invoice" }
    if (invoice.balance <= 0) return { success: false, error: "Invoice is already fully paid" }
    if (input.amount <= 0) return { success: false, error: "Payment amount must be greater than 0" }
    if (input.amount > invoice.balance) return { success: false, error: "Amount paid cannot exceed the remaining balance" }
    return { success: true }
  },

  async registerPayment(input: PaymentInput): Promise<DebtResult> {
    const validation = this.validatePayment(input)
    if (!validation.success) return { success: false, error: validation.error }
    return useStore.getState().registerPayment(input)
  },

  async extendDueDate(input: DueDateExtensionInput): Promise<ServiceResult> {
    return useStore.getState().extendDueDate(input)
  },

  async voidInvoice(invoiceId: string): Promise<ServiceResult> {
    const store = useStore.getState()
    const invoice = store.invoices.find((i) => i.id === invoiceId)
    if (!invoice) return { success: false, error: "Invoice not found" }
    return useStore.getState().voidInvoice(invoiceId)
  },

  getDebtAging(invoiceId: string): "Pending" | "Overdue" | "Paid" {
    const store = useStore.getState()
    const invoice = store.invoices.find((i) => i.id === invoiceId)
    if (!invoice || invoice.voided) return "Pending"
    if (invoice.balance <= 0) return "Paid"
    if (new Date(invoice.dueDate) < new Date()) return "Overdue"
    return "Pending"
  },

  getCustomerDebtSummary(customerId: string) {
    const store = useStore.getState()
    const invoices = store.invoices.filter((i) => i.customerId === customerId && !i.voided)
    const openInvoices = invoices.filter((i) => i.balance > 0)
    const overdueInvoices = invoices.filter((i) => i.status === "Overdue")
    const grandTotal = openInvoices.reduce((sum, i) => sum + i.balance, 0)
    const overdueTotal = overdueInvoices.reduce((sum, i) => sum + i.balance, 0)
    const lastPayment = store.payments
      .filter((p) => invoices.some((i) => i.id === p.invoiceId))
      .sort((a, b) => b.date.localeCompare(a.date))[0]
    const daysSinceLastPayment = lastPayment
      ? Math.floor((Date.now() - new Date(lastPayment.date).getTime()) / (1000 * 60 * 60 * 24))
      : null
    return {
      totalInvoices: invoices.length,
      openInvoices: openInvoices.length,
      grandTotalOutstanding: grandTotal,
      totalOverdueBalance: overdueTotal,
      daysSinceLastPayment,
    }
  },

  getSupplierDebtSummary(supplierId: string) {
    const store = useStore.getState()
    const invoices = store.invoices.filter((i) => i.supplierId === supplierId && i.type === "Purchase" && !i.voided)
    const openInvoices = invoices.filter((i) => i.balance > 0)
    const overdueInvoices = invoices.filter((i) => i.status === "Overdue")
    const grandTotal = openInvoices.reduce((sum, i) => sum + i.balance, 0)
    const overdueTotal = overdueInvoices.reduce((sum, i) => sum + i.balance, 0)
    const lastPayment = store.payments
      .filter((p) => invoices.some((i) => i.id === p.invoiceId))
      .sort((a, b) => b.date.localeCompare(a.date))[0]
    const daysSinceLastPayment = lastPayment
      ? Math.floor((Date.now() - new Date(lastPayment.date).getTime()) / (1000 * 60 * 60 * 24))
      : null
    return {
      totalInvoices: invoices.length,
      openInvoices: openInvoices.length,
      grandTotalOutstanding: grandTotal,
      totalOverdueBalance: overdueTotal,
      daysSinceLastPayment,
    }
  },
}