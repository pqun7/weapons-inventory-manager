import { useState, useMemo, useCallback, useRef, Fragment, useEffect } from "react"
import {
  Search, ShoppingCart, UserPlus, Check, Receipt, TrendingUp, Package,
  X, Shield, Plus, ChevronRight, ChevronLeft, ChevronDown, Trash2, AlertTriangle,
  Zap, CreditCard, Landmark, Clock, FileText,
  Info, Paperclip,
} from "lucide-react"
import { Banknote } from "@/lib/lucide-icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { SearchableCombobox } from "@/components/ui/searchable-combobox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SmartCurrencyInput } from "@/components/ui/smart-currency-input"
import { DatePicker } from "@/components/ui/date-picker"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useStore } from "@/lib/store"
import { generateInvoiceNumber, statusBadgeClass, statusDotClass } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ammoTotalRounds } from "@/lib/types"
import type { SaleMode, Weapon, Ammunition, Accessory, PaymentMethod } from "@/lib/types"
import { toast } from "sonner"
import { useI18n } from "@/lib/i18n"
import { Textarea } from "@/components/ui/textarea";
import { useCurrency } from "@/lib/currency-context"
import { convertValuationToCurrency, multiplyMoney, sumMoney } from "@/lib/money-ui"
import { CurrencyService } from "@/lib/currency-service"


type WizardStep = 1 | 2 | 3 | 4 | 5

interface AmmoLine {
  ammo: Ammunition
  quantity: string
  unitPrice: number
  sellMode: "package" | "round"
  packageInput: string
}
interface AccessoryLine { accessory: Accessory; quantity: string; unitPrice: number }

const STEP_LABELS: { id: WizardStep; labelKey: string; icon: React.ElementType }[] = [
  { id: 1, labelKey: "sales.customer", icon: UserPlus },
  { id: 2, labelKey: "inv.weapons", icon: Zap },
  { id: 3, labelKey: "inv.ammunition", icon: Package },
  { id: 4, labelKey: "inv.accessories", icon: Package },
  { id: 5, labelKey: "sales.step.review", icon: Receipt },
]

function todayDate(): string {
  return new Date().toISOString().split("T")[0]
}

export function SalesPage() {
  const { t } = useI18n()
  const weapons = useStore((s) => s.weapons)
  const customers = useStore((s) => s.customers)
  const ammunition = useStore((s) => s.ammunition)
  const accessories = useStore((s) => s.accessories)
  const invoices = useStore((s) => s.invoices)
  const settings = useStore((s) => s.settings)
  const getWeaponBySerial = useStore((s) => s.getWeaponBySerial)
  const completeSale = useStore((s) => s.completeSale)
  const { currencies, transactionCurrency, formatOriginal, formatInvoice, formatValuation } = useCurrency()

  // Wizard state
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<WizardStep>(1)
  const [mode, setMode] = useState<SaleMode>("Retail")
  const [saleCurrency, setSaleCurrency] = useState(transactionCurrency)

  // Customer
  const [buyerType, setBuyerType] = useState<"existing" | "new">("existing")
  const [selectedCustomerId, setSelectedCustomerId] = useState("")
  const [newName, setNewName] = useState("")
  const [newPhone, setNewPhone] = useState("")
  const [newEmail, setNewEmail] = useState("")

  // Weapons
  const [serialInput, setSerialInput] = useState("")
  const [weaponSearch, setWeaponSearch] = useState("")
  const [selectedWeapons, setSelectedWeapons] = useState<Weapon[]>([])
  const [customPrices, setCustomPrices] = useState<Record<string, string>>({})

  // Ammunition
  const [ammoLines, setAmmoLines] = useState<AmmoLine[]>([])
  const [ammoPicker, setAmmoPicker] = useState("")

  // Accessories
  const [accessoryLines, setAccessoryLines] = useState<AccessoryLine[]>([])
  const [accessoryPicker, setAccessoryPicker] = useState("")

  // Invoice settings
  const [invoiceDate, setInvoiceDate] = useState(todayDate())
  const [invoiceNumber, setInvoiceNumber] = useState("")
  const [invoiceNumberError, setInvoiceNumberError] = useState(false)
  const [notes, setNotes] = useState("")

  // Payment & debt
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash")
  const [isDebt, setIsDebt] = useState(false)
  const [paidAmount, setPaidAmount] = useState("")
  const [debtDueDate, setDebtDueDate] = useState(todayDate())

  // Documents
  const [documents, setDocuments] = useState<{ name: string; data: string }[]>([])
  const [newDocName, setNewDocName] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingFileName, setPendingFileName] = useState("")

  // Approval + confirm
  const [approved, setApproved] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const operationIdRef = useRef(crypto.randomUUID())

  // الخصم الإضافي (المكاسرة)
  const [bargainDiscount, setBargainDiscount] = useState("")

  // ---------- Derived ----------
  const buyerOptions = useMemo(
    () => (mode === "Wholesale" ? customers.filter((c) => c.isWholesaleBuyer) : customers.filter((c) => !c.isWholesaleBuyer)),
    [customers, mode]
  )
  const buyerDisplayValue = useMemo(() => {
    const b = buyerOptions.find((x) => x.id === selectedCustomerId)
    return b ? `${b.name} — ${b.phone}` : ""
  }, [buyerOptions, selectedCustomerId])
  const buyerComboboxOptions = useMemo(() => buyerOptions.map((b) => `${b.name} — ${b.phone}`), [buyerOptions])

  const availableWeapons = useMemo(() => {
    let data = weapons.filter((w) => w.status === "Available" && !selectedWeapons.some((sw) => sw.id === w.id))
    if (weaponSearch) {
      const q = weaponSearch.toLowerCase()
      data = data.filter((w) =>
        w.serialNumber.toLowerCase().includes(q) ||
        w.brand.toLowerCase().includes(q) ||
        w.model.toLowerCase().includes(q) ||
        w.weaponType.toLowerCase().includes(q) ||
        w.subType.toLowerCase().includes(q)
      )
    }
    return data
  }, [weapons, weaponSearch, selectedWeapons])

  const [expandedIds, setExpandedIds] = useState(new Set());

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // توسيع صفوف الذخيرة
  const [expandedAmmoIds, setExpandedAmmoIds] = useState(new Set());
  const toggleExpandAmmo = (id: string) => {
    setExpandedAmmoIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // توسيع صفوف الإكسسوارات
  const [expandedAccessoryIds, setExpandedAccessoryIds] = useState(new Set());
  const toggleExpandAccessory = (id: string) => {
    setExpandedAccessoryIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const serialOptions = useMemo(
    () => weapons.filter((w) => w.status === "Available" && !selectedWeapons.some((sw) => sw.id === w.id)).map((w) => w.serialNumber),
    [weapons, selectedWeapons]
  )

  const ammoOptions = useMemo(() => ammunition.map((a) => a.caliber), [ammunition])
  const accessoryOptions = useMemo(() => accessories.map((a) => `${a.name} — ${a.type}`), [accessories])

  const recentSales = useMemo(
    () => [...invoices].filter((i) => i.type === "Sale" && !i.voided).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6),
    [invoices]
  )

  const valuationPrice = useCallback((
    valuation: Weapon["retailPriceValuation"],
    legacyAccountingAmount?: number | null,
  ): number => {
    return convertValuationToCurrency(valuation, saleCurrency, legacyAccountingAmount) ?? Number.NaN
  }, [saleCurrency])

  const modePrice = useCallback((weapon: Weapon): number => {
    return mode === "Wholesale"
      ? valuationPrice(weapon.wholesalePriceValuation, weapon.wholesalePrice)
      : valuationPrice(weapon.retailPriceValuation, weapon.retailPrice)
  }, [mode, valuationPrice])

  const inventoryModePrice = useCallback((item: Ammunition | Accessory): number => {
    return mode === "Wholesale"
      ? valuationPrice(item.wholesalePriceValuation, item.wholesalePrice)
      : valuationPrice(item.retailPriceValuation, item.retailPrice)
  }, [mode, valuationPrice])

  const landedCostPrice = useCallback((weapon: Weapon): number => {
    if (weapon.costSnapshot) {
      return CurrencyService.convertFromAccounting(Number(weapon.costSnapshot.finalLandedBaseAmount), saleCurrency)
    }
    return valuationPrice(weapon.purchasePriceValuation, weapon.purchasePrice)
  }, [saleCurrency, valuationPrice])

  const formatTransaction = useCallback(
    (amount: number) => Number.isFinite(amount) ? formatOriginal(amount, saleCurrency) : "—",
    [formatOriginal, saleCurrency],
  )
  const formatTransactionMoney = useCallback(
    (amount: number, _legacySymbol?: string) => formatTransaction(amount),
    [formatTransaction],
  )

  useEffect(() => {
    setCustomPrices({})
    setBargainDiscount("")
    setPaidAmount("")
    setAmmoLines((lines) => lines.map((line) => ({
      ...line,
      unitPrice: inventoryModePrice(line.ammo),
    })))
    setAccessoryLines((lines) => lines.map((line) => ({
      ...line,
      unitPrice: inventoryModePrice(line.accessory),
    })))
  }, [inventoryModePrice, saleCurrency])

  // ---------- Pricing ----------
  const weaponsSubtotal = useMemo(
    () => sumMoney(selectedWeapons.map((w) => {
      const custom = customPrices[w.id]
      return custom ? Number(custom) : modePrice(w)
    })),
    [selectedWeapons, customPrices, modePrice]
  )
  const weaponsOriginal = useMemo(
    () => sumMoney(selectedWeapons.map((w) => modePrice(w))),
    [selectedWeapons, modePrice]
  )
  const ammoSubtotal = useMemo(
    () => sumMoney(ammoLines.map((line) => multiplyMoney(Number(line.unitPrice), Number(line.quantity)))),
    [ammoLines]
  )
  const accessorySubtotal = useMemo(
    () => sumMoney(accessoryLines.map((line) => multiplyMoney(Number(line.unitPrice), Number(line.quantity)))),
    [accessoryLines]
  )

  const ammoOriginal = useMemo(
    () => sumMoney(ammoLines.map((line) => multiplyMoney(inventoryModePrice(line.ammo), Number(line.quantity)))),
    [ammoLines, inventoryModePrice],
  )
  const accessoryOriginal = useMemo(
    () => sumMoney(accessoryLines.map((line) => multiplyMoney(inventoryModePrice(line.accessory), Number(line.quantity)))),
    [accessoryLines, inventoryModePrice],
  )
  const totalOriginal = sumMoney([weaponsOriginal, ammoOriginal, accessoryOriginal])
  const totalNegotiated = sumMoney([weaponsSubtotal, ammoSubtotal, accessorySubtotal])
  const discountAmount = sumMoney([totalOriginal, -totalNegotiated])

  // الخصم الإضافي
  const bargainDiscountAmount = bargainDiscount.trim() ? Number(bargainDiscount) || 0 : 0
  const bargainDiscountValid = bargainDiscountAmount >= 0 && bargainDiscountAmount <= totalNegotiated
  const finalSubtotal = bargainDiscountValid ? sumMoney([totalNegotiated, -bargainDiscountAmount]) : totalNegotiated
  const finalTax = multiplyMoney(finalSubtotal, settings.taxPercent / 100)
  const finalGrandTotal = sumMoney([finalSubtotal, finalTax])

  const totalCost = useMemo(
    () => sumMoney(selectedWeapons.map(landedCostPrice)),
    [selectedWeapons, landedCostPrice]
  )
  const netProfit = sumMoney([finalSubtotal, -totalCost])
  const marginPercent = totalCost > 0 ? (netProfit / totalCost) * 100 : 100
  const marginViolation = marginPercent < settings.minProfitMarginPercent

  const grandTotal = finalGrandTotal
  const taxAmount = finalTax

  const ammoStockIssues = ammoLines.filter((l) => (Number(l.quantity) || 0) > ammoTotalRounds(l.ammo))
  const accessoryStockIssues = accessoryLines.filter((l) => (Number(l.quantity) || 0) > l.accessory.quantity)
  const hasStockIssues = ammoStockIssues.length > 0 || accessoryStockIssues.length > 0
  const hasPricingIssues = selectedWeapons.some((weapon) => !Number.isFinite(modePrice(weapon)) || !Number.isFinite(landedCostPrice(weapon)))
    || ammoLines.some((line) => !Number.isFinite(line.unitPrice))
    || accessoryLines.some((line) => !Number.isFinite(line.unitPrice))

  const canProceedStep1 = buyerType === "new" ? newName.trim().length > 0 : buyerOptions.some((b) => b.id === selectedCustomerId)
  const hasSaleItems = selectedWeapons.length > 0 || ammoLines.some((l) => Number(l.quantity) > 0) || accessoryLines.some((l) => Number(l.quantity) > 0)
  const canProceedStep2 = true
  const canProceedStep3 = ammoStockIssues.length === 0 && ammoLines.every(l => Number(l.quantity) > 0)
  const canProceedStep4 = accessoryStockIssues.length === 0 && accessoryLines.every(l => Number(l.quantity) > 0)
  const canComplete = hasSaleItems && !hasStockIssues && !hasPricingIssues && (!marginViolation || approved)

  const previewInvoiceNumber = invoiceNumber.trim() || generateInvoiceNumber(invoices)
  const selectedBuyerName = buyerType === "new" ? newName.trim() : buyerOptions.find((b) => b.id === selectedCustomerId)?.name ?? ""

  const paid = paidAmount.trim() ? Number(paidAmount) || 0 : grandTotal
  const balanceDue = Math.max(0, sumMoney([grandTotal, -paid]))

  // ---------- Handlers ----------
  const handleAddWeapon = useCallback((weapon: Weapon) => {
    if (!Number.isFinite(modePrice(weapon)) || !Number.isFinite(landedCostPrice(weapon))) {
      toast.error(t("sales.missingCurrencyValuation"))
      return
    }
    setSelectedWeapons((prev) => (prev.find((w) => w.id === weapon.id) ? prev : [...prev, weapon]))
  }, [modePrice, landedCostPrice])

  const handleSerialAdd = useCallback(() => {
    const trimmed = serialInput.trim()
    if (!trimmed) return
    const weapon = getWeaponBySerial(trimmed)
    if (!weapon) { toast.error(t('sales.noWeaponFound', { serial: trimmed })); return }
    if (weapon.status === "Sold") { toast.error(t('sales.weaponAlreadySold', { serial: trimmed })); return }
    if (weapon.status === "Reserved") { toast.error(t('sales.weaponReserved', { serial: trimmed })); return }
    if (selectedWeapons.find((w) => w.id === weapon.id)) { toast.error(t('sales.weaponInCart', { serial: trimmed })); return }
    handleAddWeapon(weapon)
    setSerialInput("")
  }, [serialInput, getWeaponBySerial, selectedWeapons, handleAddWeapon, t])

  const handleRemoveWeapon = (weaponId: string) => {
    setSelectedWeapons((prev) => prev.filter((w) => w.id !== weaponId))
    setCustomPrices((prev) => { const n = { ...prev }; delete n[weaponId]; return n })
  }

  const handleAddAmmo = (caliber: string) => {
    if (!caliber) return
    const ammo = ammunition.find((a) => a.caliber === caliber)
    if (!ammo) return
    if (ammoLines.find((l) => l.ammo.id === ammo.id)) { toast.error(t('sales.caliberAlreadyAdded', { caliber })); return }
    const unitPrice = inventoryModePrice(ammo)
    if (!Number.isFinite(unitPrice)) { toast.error(t("sales.missingCurrencyValuation")); return }
    setAmmoLines((prev) => [...prev, { ammo, quantity: "1", unitPrice, sellMode: "round", packageInput: "" }])

    setAmmoPicker("")
  }

  const handleRemoveAmmo = (id: string) => setAmmoLines((prev) => prev.filter((l) => l.ammo.id !== id))

  const handleAddAccessory = (label: string) => {
    if (!label) return
    const accessory = accessories.find((a) => `${a.name} — ${a.type}` === label)
    if (!accessory) return
    if (accessoryLines.find((l) => l.accessory.id === accessory.id)) { toast.error(t('sales.accessoryAlreadyAdded', { name: accessory.name })); return }
    const unitPrice = inventoryModePrice(accessory)
    if (!Number.isFinite(unitPrice)) { toast.error(t("sales.missingCurrencyValuation")); return }
    setAccessoryLines((prev) => [...prev, { accessory, quantity: "1", unitPrice }])
    setAccessoryPicker("")
  }

  const handleRemoveAccessory = (id: string) => setAccessoryLines((prev) => prev.filter((l) => l.accessory.id !== id))

  const handleModeChange = (m: SaleMode) => { setMode(m); setSelectedCustomerId(""); setCustomPrices({}) }

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // استخراج الاسم بدون الامتداد
    const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "")
    setPendingFile(file)
    setPendingFileName(nameWithoutExt)
    setNewDocName(nameWithoutExt) // تعبئة حقل الاسم تلقائياً
    // إفراغ input الملف ليتمكن المستخدم من إعادة اختياره إن أراد
    if (fileInputRef.current) fileInputRef.current.value = ""
  }, [])

  const handleAddPendingDocument = useCallback(() => {
    if (!pendingFile) return toast.error(t("sales.noFileSelected"))
    const name = newDocName.trim() || pendingFileName.trim()
    if (!name) return toast.error(t("sales.documentNameRequired"))
    const reader = new FileReader()
    reader.onload = () => {
      setDocuments((prev) => [...prev, { name, data: reader.result as string }])
      setNewDocName("")
      setPendingFile(null)
      setPendingFileName("")
    }
    reader.readAsDataURL(pendingFile)
  }, [pendingFile, newDocName, pendingFileName])

  const resetForm = useCallback(() => {
    setStep(1)
    setMode("Retail")
    setSaleCurrency(transactionCurrency)
    setBuyerType("existing")
    setSelectedCustomerId("")
    setNewName(""); setNewPhone(""); setNewEmail("")
    setSerialInput(""); setWeaponSearch("")
    setSelectedWeapons([]); setCustomPrices({})
    setAmmoLines([]); setAmmoPicker("")
    setAccessoryLines([]); setAccessoryPicker("")
    setInvoiceDate(todayDate()); setInvoiceNumber(""); setInvoiceNumberError(false); setNotes("")
    setPaymentMethod("cash"); setIsDebt(false); setPaidAmount(""); setDebtDueDate(todayDate())
    setDocuments([]); setNewDocName("")
    setPendingFile(null);
    setPendingFileName("");
    setApproved(false); setConfirmOpen(false)
    setBargainDiscount("")
    setExpandedIds(new Set());
    setExpandedAmmoIds(new Set());
    setExpandedAccessoryIds(new Set());
    setIsSubmitting(false)
    operationIdRef.current = crypto.randomUUID()
  }, [transactionCurrency])

  const openWizard = () => { resetForm(); setOpen(true) }

  const requestSaleConfirmation = () => {
    if (!invoiceNumber.trim()) {
      setInvoiceNumberError(true)
      toast.error(t('sales.invoiceNum'))
      return
    }
    setInvoiceNumberError(false)
    setConfirmOpen(true)
  }

  const handleConfirmSale = async () => {
    if (isSubmitting) return
    if (!invoiceNumber.trim()) { setInvoiceNumberError(true); toast.error(t('sales.invoiceNum')); return }
    if (hasStockIssues) { toast.error(t('sales.stockExceedsAvailable')); return }
    if (hasPricingIssues) { toast.error(t("sales.itemsMissingCurrencyValuation")); return }
    if (marginViolation && !approved) { toast.error(t('sales.managerApprovalReq')); return }

    let customerId: string | undefined = selectedCustomerId || undefined
    let customerName = ""
    if (buyerType === "new") {
      if (!newName.trim()) { toast.error(t('sales.customerNameRequired')); return }
      customerId = undefined
      customerName = newName.trim()
    } else {
      const buyer = buyerOptions.find((b) => b.id === selectedCustomerId)
      if (!buyer) { toast.error(t('sales.selectBuyerError')); return }
      customerId = buyer.id
      customerName = buyer.name
    }

    const lineItems = [
      ...selectedWeapons.map((w) => {
        const unit = customPrices[w.id] ? Number(customPrices[w.id]) || 0 : modePrice(w)
        return { itemType: "weapon" as const, itemId: w.id, name: `${w.brand} ${w.model}`, quantity: 1, unitPrice: unit, total: unit }
      }),
      ...ammoLines.map((l) => {
        const qty = Number(l.quantity) || 0
        const unit = Number(l.unitPrice) || 0
        return { itemType: "ammunition" as const, itemId: l.ammo.id, name: l.ammo.caliber, quantity: qty, unitPrice: unit, total: multiplyMoney(unit, qty) }
      }),
      ...accessoryLines.map((l) => {
        const qty = Number(l.quantity) || 0
        const unit = Number(l.unitPrice) || 0
        return { itemType: "accessory" as const, itemId: l.accessory.id, name: l.accessory.name, quantity: qty, unitPrice: unit, total: multiplyMoney(unit, qty) }
      }),
    ]

    const attachments = documents.map(d => JSON.stringify(d))
    const dueDate = isDebt && balanceDue > 0 ? debtDueDate : invoiceDate

    setIsSubmitting(true)
    const result = await completeSale({
      operationId: operationIdRef.current,
      weaponIds: selectedWeapons.map((w) => w.id),
      lineItems,
      customerId,
      customerName,
      newCustomer: buyerType === "new" ? {
        name: newName.trim(), phone: newPhone.trim(), email: newEmail.trim(), address: "",
        isWholesaleBuyer: mode === "Wholesale", wholesaleDiscountPercent: 0,
      } : undefined,
      mode,
      invoiceNumber: invoiceNumber.trim(),
      totalNegotiated: finalSubtotal,
      totalOriginal,
      dueDate,
      attachments,
      notes: notes.trim() + (bargainDiscountAmount > 0 ? ` | ${t('sales.bargainDiscountApplied', { amount: formatTransaction(bargainDiscountAmount) })}` : ""),
      taxAmount: finalTax,
      date: invoiceDate,
      paidAmount: isDebt ? paid : grandTotal,
      balance: isDebt ? balanceDue : 0,
      paymentMethod,
      currency: saleCurrency,
    })

    if (result.success) {
      setConfirmOpen(false)
      toast.success(t('sales.saleCompletedInvoice', { invoice: result.invoiceNumber ?? "" }), {
        description: t('sales.saleCompletedDesc', { count: lineItems.length, buyer: customerName, amount: formatTransaction(grandTotal) }),
      })
      setOpen(false)
      resetForm()
    } else {
      toast.error(result.error || t('sales.saleFailedMsg'))
    }
    setIsSubmitting(false)
  }

  const goNext = () => {
    if (step === 3 && !canProceedStep3) {
      if (ammoLines.some(l => Number(l.quantity) <= 0)) {
        toast.error(t("sales.invalidQuantity") || "الرجاء إدخال كمية صحيحة")
      } else {
        toast.error(t("sales.stockExceedsAvailable"))
      }
      return
    }

    if (step === 4 && !canProceedStep4) {
      if (accessoryLines.some(l => Number(l.quantity) <= 0)) {
        toast.error(t("sales.invalidQuantity") || "الرجاء إدخال كمية صحيحة")
      } else {
        toast.error(t("sales.stockExceedsAvailable"))
      }
      return
    }

    setStep((s) => Math.min(5, s + 1) as WizardStep)
  }

  const goBack = () => setStep((s) => Math.max(1, s - 1) as WizardStep)

  // ---------- Dynamic Dialog Width based on step ----------
  // Consistent dialog width across all steps
  const dialogMaxWidthClass = "w-[95vw] max-w-5xl";

  // ---------- Render ----------
  return (
    <div className="flex flex-col gap-3 p-3 lg:p-4">
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: hsl(var(--muted) / 0.3); border-radius: 8px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: hsl(var(--muted-foreground) / 0.35); border-radius: 8px; border: 2px solid transparent; background-clip: padding-box; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: hsl(var(--muted-foreground) / 0.55); }
        .custom-scrollbar { scrollbar-width: thin; scrollbar-color: hsl(var(--muted-foreground) / 0.35) hsl(var(--muted) / 0.2); }
      `}</style>

      {/* Page header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShoppingCart className="size-4" /> {t('sales.title')}
              </CardTitle>
              <CardDescription className="text-xs">{t('sales.subtitle')}</CardDescription>
            </div>
            <Button onClick={openWizard} className="h-9"><Plus className="size-4" /> {t('sales.createSale')}</Button>
          </div>
        </CardHeader>
      </Card>

      {/* Recent sales */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-xs">{t('sales.recentSales')}</CardTitle></CardHeader>
        <CardContent>
          {recentSales.length === 0 ? (
            <div className="flex h-20 flex-col items-center justify-center gap-1 text-muted-foreground">
              <Package className="size-5 opacity-30" /><span className="text-[10px]">{t('sales.noSalesYet')}</span>
            </div>
          ) : (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-[10px] text-muted-foreground">
                    <th className="pb-1 pr-3 font-medium">{t('sales.invoice')}</th>
                    <th className="pb-1 pr-3 font-medium">{t('sales.customer')}</th>
                    <th className="pb-1 pr-3 font-medium">{t('common.date')}</th>
                    <th className="pb-1 pr-3 text-right font-medium">{t('common.total')}</th>
                    <th className="pb-1 text-right font-medium">{t('sales.balance')}</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSales.map((inv) => (
                    <tr key={inv.id} className="border-b last:border-0">
                      <td className="py-1.5 pr-3 font-mono text-[11px]">{inv.invoiceNumber}</td>
                      <td className="py-1.5 pr-3">{inv.customerName}</td>
                      <td className="py-1.5 pr-3 text-muted-foreground">{inv.date}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{formatValuation(inv.totalValuation, "display", sumMoney([inv.totalNegotiated, inv.taxAmount]), inv.currency)}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        <Badge variant={inv.balance > 0 ? "secondary" : "outline"} className="text-[9px]">{formatInvoice(inv, "balance", "display")}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Wizard modal */}
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm() }}>
        <DialogContent onPointerDownOutside={(e) => e.preventDefault()} className={cn(
          "max-h-[95vh] flex flex-col transition-all duration-300",
          dialogMaxWidthClass
        )}>
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <ShoppingCart className="size-4" /> {t('sales.createSale')}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {t('sales.stepOf', { step: step, label: t(STEP_LABELS[step - 1].labelKey) })}
            </DialogDescription>
          </DialogHeader>

          {/* Step indicator */}
          <div className="shrink-0 flex items-center gap-1.5 px-1">
            {STEP_LABELS.map((s, i) => {
              const Icon = s.icon
              const isCompleted = step > s.id
              const isCurrent = step === s.id
              return (
                <div key={s.id} className="flex flex-1 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => { if (isCompleted) setStep(s.id) }}
                    disabled={!isCompleted && !isCurrent}
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-medium transition-all duration-200",
                      isCompleted ? "bg-primary text-primary-foreground cursor-pointer hover:bg-primary/80" :
                        isCurrent ? "bg-primary text-primary-foreground ring-2 ring-primary/30 shadow-sm shadow-primary/20" :
                          "bg-muted text-muted-foreground"
                    )}
                    title={t(s.labelKey)}
                  >
                    {isCompleted ? <Check className="size-3" /> : <Icon className="size-3" />}
                  </button>
                  <span className={cn("hidden text-[10px] sm:inline", isCurrent ? "font-semibold" : "text-muted-foreground")}>{t(s.labelKey)}</span>
                  {i < STEP_LABELS.length - 1 && <div className={cn("h-px flex-1", isCompleted ? "bg-primary" : "bg-border")} />}
                </div>
              )
            })}
          </div>
          <Separator className="shrink-0" />

          {/* Scrollable content */}
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 custom-scrollbar" style={{ maxHeight: "calc(95vh - 13rem)" }}>
            {/* STEP 1: Customer */}
            {step === 1 && (
              <div className="space-y-6">
                {/* Sale Mode - Segmented Control style */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium">{t('sales.saleMode')}</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleModeChange("Retail")}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border border-slate-300 bg-background px-4 py-3 text-left shadow-sm transition-all duration-200 mb-4",
                        mode === "Retail"
                          ? "border-primary bg-primary/5 shadow-md ring-1 ring-primary/20"
                          : "hover:border-slate-400 hover:shadow-md"
                      )}
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/1 0">
                        <ShoppingCart className="size-4 text-primary" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold">{t('sales.retail')}</div>
                        <div className="text-[10px] text-muted-foreground">{t('sales.retailDesc') || 'Individual buyer'}</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleModeChange("Wholesale")}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border border-slate-300 bg-background px-4 py-3 text-left shadow-sm transition-all duration-200 mb-4",
                        mode === "Wholesale"
                          ? "border-primary bg-primary/5 shadow-md ring-1 ring-primary/20"
                          : "hover:border-slate-400 hover:shadow-md"
                      )}
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                        <TrendingUp className="size-4 text-primary" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold">{t('sales.wholesale')}</div>
                        <div className="text-[10px] text-muted-foreground">{t('sales.wholesaleDesc') || 'Business buyer'}</div>
                      </div>
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-medium">{t("ship.currency")}</Label>
                  <Select value={saleCurrency} onValueChange={setSaleCurrency}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {currencies.map((item) => (
                        <SelectItem key={item.isoCode} value={item.isoCode}>{item.isoCode} — {item.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">
                    {saleCurrency} · {t("report.accountingCurrency")}: {settings.accountingCurrencyCode}
                  </p>
                </div>

                {/* Customer Section */}
                <div className="space-y-3">
                  <Label className="text-xs font-medium">{t('sales.customer')}</Label>

                  {/* Toggle between Existing / New */}
                  <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5 w-fit">
                    <button
                      type="button"
                      onClick={() => setBuyerType("existing")}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                        buyerType === "existing"
                          ? "bg-background shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Search className="size-3" />
                      {t('sales.existing')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setBuyerType("new")}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                        buyerType === "new"
                          ? "bg-background shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <UserPlus className="size-3" />
                      {t('sales.quickAdd')}
                    </button>
                  </div>

                  {/* Existing Customer Combo */}
                  {buyerType === "existing" && (
                    <div className="pt-1">
                      {buyerOptions.length > 0 ? (
                        <SearchableCombobox
                          value={buyerDisplayValue}
                          onValueChange={(val) => {
                            const buyer = buyerOptions.find(
                              (b) => `${b.name} — ${b.phone}` === val
                            );
                            setSelectedCustomerId(buyer ? buyer.id : "");
                          }}
                          options={buyerComboboxOptions}
                          placeholder={t('sales.selectBuyer', {
                            mode:
                              mode === "Wholesale"
                                ? t('sales.wholesaleBuyer')
                                : t('sales.buyer'),
                          })}
                          searchPlaceholder={t('sales.searchCustomers')}
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-6 text-center">
                          <UserPlus className="size-5 text-muted-foreground/50" />
                          <p className="text-xs text-muted-foreground px-4">
                            {t('sales.noSavedBuyers', {
                              mode:
                                mode === "Wholesale"
                                  ? t('sales.wholesaleBuyer') + 's'
                                  : t('sales.buyer') + 's',
                            })}
                          </p>
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => setBuyerType("new")}
                          >
                            {t('sales.createFirst')}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* New Customer Quick Form */}
                  {buyerType === "new" && (
                    <div className="grid gap-3 sm:grid-cols-2 pt-1">
                      <div className="sm:col-span-2">
                        <Label className="text-[11px]">{t('sales.fullName')}</Label>
                        <Input
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          placeholder={t('sales.fullName')}
                          className="h-9 text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-[11px]">{t('sales.phone')}</Label>
                        <Input
                          value={newPhone}
                          onChange={(e) => setNewPhone(e.target.value)}
                          placeholder={t('sales.phone')}
                          className="h-9 text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-[11px]">{t('sales.emailOptional')}</Label>
                        <Input
                          value={newEmail}
                          onChange={(e) => setNewEmail(e.target.value)}
                          placeholder={t('sales.emailOptional')}
                          className="h-9 text-sm"
                        />
                      </div>
                      <div className="sm:col-span-2 flex items-start gap-2 rounded-md bg-primary/5 px-3 py-2.5 text-[10px] text-muted-foreground">
                        <Info className="size-3.5 mt-0.5 shrink-0 text-primary/70" />
                        <span>
                          {t('sales.willBeSavedAs', {
                            mode:
                              mode === "Wholesale"
                                ? t('sales.wholesaleBuyer')
                                : t('sales.buyer'),
                          })}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            {/* STEP 2: Weapons */}
            {step === 2 && (
              <div className="flex flex-col gap-3">
                {/* شريط البحث السريع بالرقم التسلسلي */}
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                    <Input
                      placeholder={t('sales.searchSerial')}
                      value={serialInput}
                      onChange={(e) => setSerialInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleSerialAdd())}
                      list="serial-list"
                      className="pl-8 h-8 text-xs"
                    />
                  </div>
                  <Button size="sm" onClick={handleSerialAdd} className="h-8 text-xs gap-1">
                    <Plus className="size-3.5" /> {t('common.add')}
                  </Button>
                  <datalist id="serial-list">
                    {serialOptions.map((s) => <option key={s} value={s} />)}
                  </datalist>
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  {/* القائمة اليسرى: الأسلحة المتاحة */}
                  <div className="border rounded-lg bg-card overflow-hidden flex flex-col">
                    <div className="px-4 py-2.5 border-b flex items-center justify-between">
                      <h3 className="text-xs font-semibold">{t('sales.availableWeapons')}</h3>
                      <span className="text-[10px] text-muted-foreground">
                        {availableWeapons.length} {t('sales.available')}
                      </span>
                    </div>
                    <div className="p-2">
                      <Input
                        placeholder={t('sales.searchSerial')}
                        value={weaponSearch}
                        onChange={(e) => setWeaponSearch(e.target.value)}
                        className="h-7 text-xs"
                      />
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar" style={{ maxHeight: "320px" }}>
                      <table className="w-full">
                        <thead className="sticky top-0 bg-muted/30">
                          <tr className="text-[10px] text-muted-foreground">
                            <th className="text-left font-medium px-3 py-1.5">{t('sales.weapon')}</th>
                            <th className="text-left font-medium px-3 py-1.5">{t('sales.serial')}</th>
                            <th className="text-left font-medium px-3 py-1.5">{t('sales.type')}</th>
                            <th className="text-right font-medium px-3 py-1.5">{t('sales.price')}</th>
                            <th className="px-3 py-1.5"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {availableWeapons.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="text-center py-8 text-[10px] text-muted-foreground">
                                <Package className="size-4 mx-auto mb-1 opacity-30" />
                                {weaponSearch ? t('sales.noWeaponsMatch') : t('sales.allInCart')}
                              </td>
                            </tr>
                          ) : (
                            availableWeapons.slice(0, 30).map((w) => (
                              <tr key={w.id} className="border-b border-border/30 hover:bg-muted/30 transition-colors text-xs">
                                <td className="px-3 py-2 font-medium truncate max-w-[110px]">
                                  {w.brand} {w.model}
                                </td>
                                <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">
                                  {w.serialNumber}
                                </td>
                                <td className="px-3 py-2 text-[10px] text-muted-foreground">
                                  {w.weaponType}
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums">
                                  {formatTransactionMoney(modePrice(w))}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleAddWeapon(w)}
                                    className="h-6 px-2 text-[10px]"
                                  >
                                    <Plus className="size-3" />
                                  </Button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* القائمة اليمنى: عربة التسوق */}
                  <div className="border rounded-lg bg-card overflow-hidden flex flex-col">
                    <div className="px-4 py-2.5 border-b flex items-center justify-between">
                      <h3 className="text-xs font-semibold">{t('sales.selectedWeapons')}</h3>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">
                          {selectedWeapons.length} {t('sales.items')}
                        </span>
                        {selectedWeapons.length > 0 && (
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => { setSelectedWeapons([]); setCustomPrices({}); }}
                            className="h-5 text-[10px] text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="size-3 mr-1" /> {t('sales.clear')}
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar" style={{ maxHeight: "320px" }}>
                      <table className="w-full">
                        <thead className="sticky top-0 bg-muted/30">
                          <tr className="text-[10px] text-muted-foreground">
                            <th className="text-left font-medium px-3 py-1.5">{t('sales.weapon')}</th>
                            <th className="text-left font-medium px-3 py-1.5">{t('sales.sellingPrice')}</th>
                            <th className="text-right font-medium px-3 py-1.5">{t('common.profit')}</th>
                            <th className="text-right font-medium px-3 py-1.5">{t('sales.total')}</th>
                            <th className="px-3 py-1.5"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedWeapons.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="text-center py-8 text-[10px] text-muted-foreground">
                                <ShoppingCart className="size-4 mx-auto mb-1 opacity-30" />
                                {t('sales.addWeaponsFromList')}
                              </td>
                            </tr>
                          ) : (
                            selectedWeapons.map((w) => {
                              const custom = customPrices[w.id];
                              const finalPrice = custom ? Number(custom) || 0 : modePrice(w);
                              const cost = landedCostPrice(w)
                              const profit = sumMoney([finalPrice, -cost]);
                              const isExpanded = expandedIds.has(w.id);

                              return (
                                <Fragment key={w.id}>
                                  {/* الصف الرئيسي */}
                                  <tr className="border-b border-border/30 hover:bg-muted/20 transition-colors text-xs">
                                    <td className="px-3 py-2">
                                      <div className="flex items-center gap-1">
                                        <button
                                          onClick={() => toggleExpand(w.id)}
                                          className="p-0.5 hover:bg-muted rounded-sm"
                                        >
                                          <ChevronDown
                                            className={cn(
                                              "size-3 text-muted-foreground transition-transform",
                                              isExpanded && "rotate-180"
                                            )}
                                          />
                                        </button>
                                        <div>
                                          <div className="font-medium truncate max-w-[90px]">
                                            {w.brand} {w.model}
                                          </div>
                                          <div className="font-mono text-[10px] text-muted-foreground">
                                            {w.serialNumber}
                                          </div>
                                        </div>
                                      </div>
                                    </td>
                                    <td className="px-3 py-2">
                                      <Input
                                        type="number"
                                        placeholder={formatTransactionMoney(modePrice(w))}
                                        value={custom ?? ""}
                                        onChange={(e) =>
                                          setCustomPrices((prev) => ({ ...prev, [w.id]: e.target.value }))
                                        }
                                        className="h-7 w-24 text-[10px] font-mono"
                                      />
                                    </td>
                                    <td className={cn(
                                      "px-3 py-2 text-right font-mono text-[11px] tabular-nums font-medium",
                                      profit >= 0 ? "text-emerald-600" : "text-red-500"
                                    )}>
                                      {formatTransactionMoney(profit)}
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono text-[11px] font-bold tabular-nums text-primary">
                                      {formatTransactionMoney(finalPrice)}
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        onClick={() => handleRemoveWeapon(w.id)}
                                        className="size-5 hover:bg-destructive/10 hover:text-destructive"
                                      >
                                        <X className="size-3" />
                                      </Button>
                                    </td>
                                  </tr>
                                  {/* صف التفاصيل القابل للطي */}
                                  {isExpanded && (
                                    <tr className="bg-muted/10 border-b border-border/20">
                                      <td colSpan={5} className="px-4 py-2">
                                        <div className="grid grid-cols-4 gap-2 text-[10px]">
                                          <div>
                                            <span className="text-muted-foreground">{t('sales.cost')}</span>
                                            <div className="font-medium tabular-nums">
                                              {formatTransactionMoney(cost)}
                                            </div>
                                          </div>
                                          <div>
                                            <span className="text-muted-foreground">{t('sales.retailPrice')}</span>
                                            <div className="font-medium tabular-nums">
                                              {formatTransactionMoney(valuationPrice(w.retailPriceValuation, w.retailPrice))}
                                            </div>
                                          </div>
                                          <div>
                                            <span className="text-muted-foreground">{t('sales.wholesalePrice')}</span>
                                            <div className="font-medium tabular-nums">
                                              {formatTransactionMoney(valuationPrice(w.wholesalePriceValuation, w.wholesalePrice))}
                                            </div>
                                          </div>
                                          <div>
                                            <span className="text-muted-foreground">{t('sales.profitMargin')}</span>
                                            <div className={cn("font-medium tabular-nums", profit >= 0 ? "text-emerald-600" : "text-red-500")}>
                                              {cost > 0 ? ((profit / cost) * 100).toFixed(1) : "—"}%
                                            </div>
                                          </div>
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                    {/* التذييل */}
                    {selectedWeapons.length > 0 && (
                      <div className="border-t px-4 py-2.5 flex items-center justify-between bg-muted/10">
                        <div className="text-xs text-muted-foreground">
                          {selectedWeapons.length} {t('sales.weapons')}
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] text-muted-foreground">{t('sales.subtotal')}</div>
                          <div className="text-sm font-bold tabular-nums">
                            {formatTransactionMoney(weaponsSubtotal)}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3: Ammunition */}
            {step === 3 && (
              <div className="flex flex-col gap-3">
                <SearchableCombobox
                  value={ammoPicker}
                  onValueChange={handleAddAmmo}
                  options={ammoOptions}
                  placeholder={t('sales.selectCaliber')}
                  searchPlaceholder={t('sales.searchCalibers')}
                />
                {ammoLines.length === 0 ? (
                  <div className="flex h-20 flex-col items-center justify-center gap-1 text-muted-foreground">
                    <Package className="size-5 opacity-30" />
                    <span className="text-[10px]">{t('sales.noAmmoAdded')}</span>
                  </div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full">
                      <thead className="sticky top-0 bg-muted/30 text-[10px] text-muted-foreground">
                        <tr>
                          <th className="text-left font-medium px-3 py-1.5">{t('sales.caliber')}</th>
                          <th className="text-left font-medium px-3 py-1.5">{t('sales.sellMode')}</th>
                          <th className="text-right font-medium px-3 py-1.5">{t('sales.quantity')}</th>
                          <th className="text-right font-medium px-3 py-1.5">{t('sales.unitPrice')}</th>
                          <th className="text-right font-medium px-3 py-1.5">{t('sales.total')}</th>
                          <th className="px-3 py-1.5"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {ammoLines.map((l) => {
                          const qty = Number(l.quantity) || 0
                          const totalRounds = ammoTotalRounds(l.ammo)
                          const over = qty > totalRounds
                          const lineTotal = qty * l.unitPrice
                          const isExpanded = expandedAmmoIds.has(l.ammo.id)

                          return (
                            <Fragment key={l.ammo.id}>
                              <tr className="border-b border-border/30 hover:bg-muted/20 transition-colors text-xs">
                                <td className="px-3 py-2 font-medium">
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => toggleExpandAmmo(l.ammo.id)}
                                      className="p-0.5 hover:bg-muted rounded-sm"
                                    >
                                      <ChevronDown
                                        className={cn(
                                          "size-3 text-muted-foreground transition-transform",
                                          isExpanded && "rotate-180"
                                        )}
                                      />
                                    </button>
                                    <span>{l.ammo.caliber}</span>
                                  </div>
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex items-center gap-0.5">
                                    <Button
                                      size="sm"
                                      variant={l.sellMode === "package" ? "default" : "outline"}
                                      className="h-5 px-1.5 text-[9px]"
                                      onClick={() => {
                                        if (l.sellMode === "package") return
                                        const currentRounds = Number(l.quantity) || 0
                                        const packages = Math.floor(
                                          currentRounds / l.ammo.unitsPerPackage
                                        )
                                        setAmmoLines((prev) =>
                                          prev.map((x) =>
                                            x.ammo.id === l.ammo.id
                                              ? {
                                                ...x,
                                                sellMode: "package",
                                                packageInput: String(packages),
                                                quantity: String(
                                                  packages * x.ammo.unitsPerPackage
                                                ),
                                              }
                                              : x
                                          )
                                        )
                                      }}
                                    >
                                      {t('sales.package')}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant={l.sellMode === "round" ? "default" : "outline"}
                                      className="h-5 px-1.5 text-[9px]"
                                      onClick={() => {
                                        if (l.sellMode === "round") return
                                        setAmmoLines((prev) =>
                                          prev.map((x) =>
                                            x.ammo.id === l.ammo.id
                                              ? { ...x, sellMode: "round" }
                                              : x
                                          )
                                        )
                                      }}
                                    >
                                      {t('sales.round')}
                                    </Button>
                                  </div>
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex justify-end">
                                    <Input
                                      type="text"
                                      inputMode="numeric"
                                      dir="ltr"
                                      aria-invalid={over}
                                      value={
                                        l.sellMode === "package"
                                          ? l.packageInput
                                          : l.quantity
                                      }
                                      onChange={(e) => {
                                        const val = e.target.value
                                        if (l.sellMode === "package") {
                                          const pkgs = Number(val) || 0
                                          setAmmoLines((prev) =>
                                            prev.map((x) =>
                                              x.ammo.id === l.ammo.id
                                                ? {
                                                  ...x,
                                                  packageInput: val,
                                                  quantity: String(
                                                    pkgs * x.ammo.unitsPerPackage
                                                  ),
                                                }
                                                : x
                                            )
                                          )
                                        } else {
                                          setAmmoLines((prev) =>
                                            prev.map((x) =>
                                              x.ammo.id === l.ammo.id
                                                ? { ...x, quantity: val }
                                                : x
                                            )
                                          )
                                        }
                                      }}
                                      className={cn(
                                        "h-7 w-16 text-[10px] text-left font-mono",
                                        over && "border-destructive text-destructive ring-1 ring-destructive/20 focus-visible:ring-destructive/30"
                                      )}
                                    />
                                  </div>
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex items-center justify-end gap-1">
                                    <span className="text-[10px] text-muted-foreground">
                                      {saleCurrency}
                                    </span>
                                    <Input
                                      type="number"
                                      step="any"
                                      inputMode="decimal"
                                      dir="ltr"
                                      value={l.unitPrice === 0 ? "" : l.unitPrice}
                                      onChange={(e) => {
                                        const val = parseFloat(e.target.value);
                                        setAmmoLines((prev) =>
                                          prev.map((x) =>
                                            x.ammo.id === l.ammo.id
                                              ? { ...x, unitPrice: isNaN(val) ? 0 : val }
                                              : x
                                          )
                                        )
                                      }}
                                      className="h-7 w-20 text-[10px] text-left font-mono"
                                    />
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-[11px] font-medium tabular-nums">
                                  {formatTransactionMoney(lineTotal)}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => handleRemoveAmmo(l.ammo.id)}
                                    className="size-5 hover:bg-destructive/10 hover:text-destructive"
                                  >
                                    <X className="size-3" />
                                  </Button>
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr className="bg-muted/10 border-b border-border/20">
                                  <td colSpan={6} className="px-4 py-2">
                                    <div className="grid grid-cols-3 gap-2 text-[10px]">
                                      <div>
                                        <span className="text-muted-foreground">
                                          {t('sales.available')}:
                                        </span>
                                        <span
                                          className={cn(
                                            "ml-1 font-medium",
                                            over && "text-red-500"
                                          )}
                                        >
                                          {totalRounds} {t('sales.rounds')}
                                        </span>
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">
                                          {t('sales.packages')}:
                                        </span>
                                        <span className="ml-1 font-medium">
                                          {l.ammo.fullPackages} {l.ammo.packageType}s +{' '}
                                          {l.ammo.looseRounds} {t('inv.loose')}
                                        </span>
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">
                                          {t('sales.pricePerRound')}:
                                        </span>
                                        <span className="ml-1 font-medium">
                                          {formatTransactionMoney(
                                            inventoryModePrice(l.ammo)
                                          )}
                                        </span>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                    {ammoLines.length > 0 && (
                      <div className="border-t px-4 py-2 flex justify-between bg-muted/10 text-xs">
                        <span className="text-muted-foreground">
                          {t('sales.ammoSubtotal')}
                        </span>
                        <span className="font-bold tabular-nums">
                          {formatTransactionMoney(ammoSubtotal)}
                        </span>
                      </div>
                    )}


                    {ammoStockIssues.length > 0 && (
                      <div
                        role="alert"
                        className="border-t border-destructive/20 bg-destructive/5 px-3 py-2.5"
                      >
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-destructive">
                              {t('sales.stockExceedsAvailable')}
                            </p>
                            <div className="mt-1 space-y-1">
                              {ammoStockIssues.map((l) => {
                                const requested = Number(l.quantity) || 0
                                const available = ammoTotalRounds(l.ammo)
                                return (
                                  <p key={l.ammo.id} className="text-[10px] text-muted-foreground">
                                    <span className="font-medium text-foreground">{l.ammo.caliber}</span>
                                    {" — "}
                                    {requested} {t('sales.rounds')}
                                    {" / "}
                                    {available} {t('sales.available')}
                                  </p>
                                )
                              })}
                            </div>
                            <p className="mt-1.5 text-[10px] text-muted-foreground">
                              {t('sales.fixStockIssues')}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* STEP 4: Accessories */}
            {step === 4 && (
              <div className="flex flex-col gap-3">
                <SearchableCombobox
                  value={accessoryPicker}
                  onValueChange={handleAddAccessory}
                  options={accessoryOptions}
                  placeholder={t('sales.selectAccessory')}
                  searchPlaceholder={t('sales.searchAccessories')}
                />
                {accessoryLines.length === 0 ? (
                  <div className="flex h-20 flex-col items-center justify-center gap-1 text-muted-foreground">
                    <Package className="size-5 opacity-30" />
                    <span className="text-[10px]">{t('sales.noAccessoriesAdded')}</span>
                  </div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full">
                      <thead className="sticky top-0 bg-muted/30 text-[10px] text-muted-foreground">
                        <tr>
                          <th className="text-left font-medium px-3 py-1.5">
                            {t('sales.accessory')}
                          </th>
                          <th className="text-right font-medium px-3 py-1.5">
                            {t('sales.quantity')}
                          </th>
                          <th className="text-right font-medium px-3 py-1.5">
                            {t('sales.unitPrice')}
                          </th>
                          <th className="text-right font-medium px-3 py-1.5">
                            {t('sales.total')}
                          </th>
                          <th className="px-3 py-1.5"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {accessoryLines.map((l) => {
                          const qty = Number(l.quantity) || 0
                          const over = qty > l.accessory.quantity
                          const lineTotal = qty * l.unitPrice
                          const isExpanded = expandedAccessoryIds.has(l.accessory.id)

                          return (
                            <Fragment key={l.accessory.id}>
                              <tr className="border-b border-border/30 hover:bg-muted/20 transition-colors text-xs">
                                <td className="px-3 py-2 font-medium">
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() =>
                                        toggleExpandAccessory(l.accessory.id)
                                      }
                                      className="p-0.5 hover:bg-muted rounded-sm"
                                    >
                                      <ChevronDown
                                        className={cn(
                                          "size-3 text-muted-foreground transition-transform",
                                          isExpanded && "rotate-180"
                                        )}
                                      />
                                    </button>
                                    <span>{l.accessory.name}</span>
                                    <span className="text-[10px] text-muted-foreground ml-1">
                                      ({l.accessory.type})
                                    </span>
                                  </div>
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex justify-end">
                                    <Input
                                      type="text"
                                      inputMode="numeric"
                                      dir="ltr"
                                      aria-invalid={over}
                                      value={l.quantity}
                                      onChange={(e) =>
                                        setAccessoryLines((prev) =>
                                          prev.map((x) =>
                                            x.accessory.id === l.accessory.id
                                              ? { ...x, quantity: e.target.value }
                                              : x
                                          )
                                        )
                                      }
                                      className={cn(
                                        "h-7 w-16 text-[10px] text-left font-mono",
                                        over && "border-destructive text-destructive ring-1 ring-destructive/20 focus-visible:ring-destructive/30"
                                      )}
                                    />
                                  </div>
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex items-center justify-end gap-1">
                                    <span className="text-[10px] text-muted-foreground">
                                      {saleCurrency}
                                    </span>
                                    <Input
                                      type="number"
                                      step="any"
                                      inputMode="decimal"
                                      dir="ltr"
                                      value={l.unitPrice === 0 ? "" : l.unitPrice}
                                      onChange={(e) => {
                                        const val = parseFloat(e.target.value);
                                        setAccessoryLines((prev) =>
                                          prev.map((x) =>
                                            x.accessory.id === l.accessory.id
                                              ? { ...x, unitPrice: isNaN(val) ? 0 : val }
                                              : x
                                          )
                                        )
                                      }}
                                      className="h-7 w-20 text-[10px] text-left font-mono"
                                    />
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-[11px] font-medium tabular-nums">
                                  {formatTransactionMoney(lineTotal)}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() =>
                                      handleRemoveAccessory(l.accessory.id)
                                    }
                                    className="size-5 hover:bg-destructive/10 hover:text-destructive"
                                  >
                                    <X className="size-3" />
                                  </Button>
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr className="bg-muted/10 border-b border-border/20">
                                  <td colSpan={5} className="px-4 py-2">
                                    <div className="flex gap-4 text-[10px]">
                                      <div>
                                        <span className="text-muted-foreground">
                                          {t('sales.stock')}:
                                        </span>
                                        <span
                                          className={cn(
                                            "ml-1 font-medium",
                                            over && "text-red-500"
                                          )}
                                        >
                                          {l.accessory.quantity}
                                        </span>
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">
                                          {t('sales.costPrice')}:
                                        </span>
                                        <span className="ml-1 font-medium">
                                          {formatTransactionMoney(
                                            inventoryModePrice(l.accessory)
                                          )}
                                        </span>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                    {accessoryLines.length > 0 && (
                      <div className="border-t px-4 py-2 flex justify-between bg-muted/10 text-xs">
                        <span className="text-muted-foreground">
                          {t('sales.accessorySubtotal')}
                        </span>
                        <span className="font-bold tabular-nums">
                          {formatTransactionMoney(accessorySubtotal)}
                        </span>
                      </div>
                    )}


                    {accessoryStockIssues.length > 0 && (
                      <div
                        role="alert"
                        className="border-t border-destructive/20 bg-destructive/5 px-3 py-2.5"
                      >
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-destructive">
                              {t('sales.stockExceedsAvailable')}
                            </p>
                            <div className="mt-1 space-y-1">
                              {accessoryStockIssues.map((l) => {
                                const requested = Number(l.quantity) || 0
                                const available = l.accessory.quantity
                                return (
                                  <p key={l.accessory.id} className="text-[10px] text-muted-foreground">
                                    <span className="font-medium text-foreground">{l.accessory.name}</span>
                                    {" — "}
                                    {requested} / {available} {t('sales.stock')}
                                  </p>
                                )
                              })}
                            </div>
                            <p className="mt-1.5 text-[10px] text-muted-foreground">
                              {t('sales.fixStockIssues')}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {/* STEP 5: Review with Bargain Discount */}
            {/* STEP 5: Review with Bargain Discount */}
            {step === 5 && (
              <div className="flex flex-col gap-3">
                {/* 1. Sale Summary */}
                <div className="rounded-lg border p-3">
                  <div className="flex items-center justify-between border-b pb-2">
                    <span className="flex items-center gap-1.5 text-xs font-semibold">
                      <Receipt className="size-4 text-primary" /> {t('sales.saleReview')}
                    </span>
                    <Badge className={statusBadgeClass("Sold")}>
                      <span className={`mr-1 size-1.5 rounded-full ${statusDotClass("Sold")}`} />
                      {t(mode === "Wholesale" ? 'sales.wholesale' : 'sales.retail')} {t('sales.sale')}
                    </Badge>
                  </div>
                  <div className="grid gap-2 py-2 text-xs sm:grid-cols-2">
                    <div><span className="text-muted-foreground">{t('sales.invoiceColon')}</span> <span className="font-mono font-medium">{previewInvoiceNumber}</span></div>
                    <div><span className="text-muted-foreground">{t('sales.buyerLabel')}</span> <span className="font-medium">{selectedBuyerName || "—"}</span></div>
                    <div><span className="text-muted-foreground">{t('common.date')}</span> <span className="font-medium">{invoiceDate}</span></div>
                    <div><span className="text-muted-foreground">{t('sales.weaponsColon')}</span> {selectedWeapons.length}</div>
                    <div><span className="text-muted-foreground">{t('sales.ammoLines')}</span> {ammoLines.length}</div>
                    <div><span className="text-muted-foreground">{t('sales.accessoryLines')}</span> {accessoryLines.length}</div>
                  </div>
                </div>

                {/* 2. Weapon Pricing Details (if any) */}
                {/* Weapon Pricing Details */}
                {selectedWeapons.length > 0 && (
                  <div className="rounded-lg border p-3">
                    <span className="text-xs font-semibold">{t('sales.weaponPricingDetails')}</span>
                    <div className="mt-2 overflow-x-auto custom-scrollbar">
                      <table className="w-full text-[10px]">
                        <thead>
                          <tr className="text-left text-muted-foreground">
                            <th className="pb-1 font-medium">{t('sales.weapon')}</th>
                            {/* أعمدة السعر المُخفاة */}
                            {/*
            <th className="pb-1 text-right font-medium">{t('sales.retailPrice')}</th>
            <th className="pb-1 text-right font-medium">{t('sales.wholesalePrice')}</th>
            */}
                            <th className="pb-1 text-right font-medium">{t('sales.cost')}</th>
                            <th className="pb-1 text-right font-medium">{t('sales.selling')}</th>
                            <th className="pb-1 text-right font-medium">{t('common.profit')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedWeapons.map((w) => {
                            const cost = landedCostPrice(w)
                            const selling = customPrices[w.id]
                              ? Number(customPrices[w.id]) || 0
                              : modePrice(w)
                            const profit = sumMoney([selling, -cost])

                            // const retail = w.retailPrice
                            // const wholesale = w.wholesalePrice

                            return (
                              <tr key={w.id} className="border-t">
                                <td className="py-1 pr-2">
                                  {w.brand} {w.model}{' '}
                                  <span className="text-muted-foreground">
                                    ({w.serialNumber})
                                  </span>
                                </td>
                                {/* أسعار البيع الأساسية مخفية */}
                                {/*
                <td className="py-1 text-right tabular-nums">
                  {formatTransactionMoney(retail)}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {formatTransactionMoney(wholesale)}
                </td>
                */}
                                <td className="py-1 text-right tabular-nums">
                                  {formatTransactionMoney(cost)}
                                </td>
                                <td className="py-1 text-right font-bold tabular-nums text-primary">
                                  {formatTransactionMoney(selling)}
                                </td>
                                <td
                                  className={cn(
                                    'py-1 text-right font-bold tabular-nums',
                                    profit >= 0 ? 'text-status-returned' : 'text-status-sold'
                                  )}
                                >
                                  {formatTransactionMoney(profit)}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Ammunition Details */}
                {ammoLines.length > 0 && (
                  <div className="rounded-lg border p-3">
                    <span className="text-xs font-semibold">{t('inv.ammunition')}</span>
                    <div className="mt-2 overflow-x-auto custom-scrollbar">
                      <table className="w-full text-[10px]">
                        <thead>
                          <tr className="text-left text-muted-foreground">
                            <th className="pb-1 font-medium">{t('sales.caliber')}</th>
                            <th className="pb-1 text-right font-medium">{t('sales.sellMode')}</th>
                            <th className="pb-1 text-right font-medium">{t('sales.quantity')}</th>
                            <th className="pb-1 text-right font-medium">{t('sales.unitPrice')}</th>
                            <th className="pb-1 text-right font-medium">{t('sales.total')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ammoLines.map((l) => {
                            const qty = Number(l.quantity) || 0;
                            const unitPrice = Number(l.unitPrice) || 0;
                            const lineTotal = qty * unitPrice;
                            const sellModeLabel = l.sellMode === "package" ? t('sales.package') : t('sales.round');
                            return (
                              <tr key={l.ammo.id} className="border-t">
                                <td className="py-1 pr-2">{l.ammo.caliber}</td>
                                <td className="py-1 text-right">{sellModeLabel}</td>
                                <td className="py-1 text-right tabular-nums">{qty}</td>
                                <td className="py-1 text-right tabular-nums">{formatTransactionMoney(unitPrice)}</td>
                                <td className="py-1 text-right font-bold tabular-nums text-primary">{formatTransactionMoney(lineTotal)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Accessory Details */}
                {accessoryLines.length > 0 && (
                  <div className="rounded-lg border p-3">
                    <span className="text-xs font-semibold">{t('inv.accessories')}</span>
                    <div className="mt-2 overflow-x-auto custom-scrollbar">
                      <table className="w-full text-[10px]">
                        <thead>
                          <tr className="text-left text-muted-foreground">
                            <th className="pb-1 font-medium">{t('sales.accessory')}</th>
                            <th className="pb-1 text-right font-medium">{t('sales.quantity')}</th>
                            <th className="pb-1 text-right font-medium">{t('sales.unitPrice')}</th>
                            <th className="pb-1 text-right font-medium">{t('sales.total')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {accessoryLines.map((l) => {
                            const qty = Number(l.quantity) || 0;
                            const unitPrice = Number(l.unitPrice) || 0;
                            const lineTotal = qty * unitPrice;
                            return (
                              <tr key={l.accessory.id} className="border-t">
                                <td className="py-1 pr-2">{l.accessory.name} <span className="text-muted-foreground">({l.accessory.type})</span></td>
                                <td className="py-1 text-right tabular-nums">{qty}</td>
                                <td className="py-1 text-right tabular-nums">{formatTransactionMoney(unitPrice)}</td>
                                <td className="py-1 text-right font-bold tabular-nums text-primary">{formatTransactionMoney(lineTotal)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 3. Payment Method */}
                <div className="rounded-lg border p-3">
                  <span className="text-xs font-semibold">{t('sales.paymentMethod')}</span>
                  <Tabs value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)} className="mt-2">
                    <TabsList className="grid h-8 w-full grid-cols-3">
                      <TabsTrigger value="cash" className="text-xs"><Banknote className="size-3" /> {t('sales.cash')}</TabsTrigger>
                      <TabsTrigger value="card" className="text-xs"><CreditCard className="size-3" /> {t('sales.card')}</TabsTrigger>
                      <TabsTrigger value="bank_transfer" className="text-xs"><Landmark className="size-3" /> {t('sales.transfer')}</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>

                {/* 4. Payment Summary (Discounts → Payment Terms → Tax → Total) */}
                <div className="rounded-lg border p-4 space-y-4">
                  <h3 className="text-sm font-semibold">{t("sales.paymentSummary")}</h3>

                  {/* Discounts First */}
                  <div className="space-y-3">
                    {/* Bargain Discount Input */}
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">{t("sales.bargainDiscount")}</Label>
                      <div className="flex items-center gap-2">
                        <SmartCurrencyInput
                          value={bargainDiscount}
                          onValueChange={setBargainDiscount}
                          currency={saleCurrency}
                          onCurrencyChange={setSaleCurrency}
                          placeholder="0"
                          className="h-8 flex-1"
                        />
                        {bargainDiscountAmount > 0 && bargainDiscountValid && (
                          <Button size="xs" variant="ghost" onClick={() => setBargainDiscount("")} className="h-8">
                            <X className="size-3" />
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Original Discount */}
                    {discountAmount > 0 && (
                      <>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{t("sales.discount")}</span>
                          <span className="font-medium tabular-nums text-status-reserved-fg">-{formatTransactionMoney(discountAmount)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="font-medium">{t("sales.negotiatedSubtotal")}</span>
                          <span className="font-semibold tabular-nums">{formatTransactionMoney(totalNegotiated)}</span>
                        </div>
                      </>
                    )}

                    {/* Additional Discount */}
                    {bargainDiscountAmount > 0 && bargainDiscountValid && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{t("sales.additionalDiscount")}</span>
                        <span className="font-medium tabular-nums text-status-reserved-fg">-{formatTransactionMoney(bargainDiscountAmount)}</span>
                      </div>
                    )}
                  </div>

                  <Separator />

                  {/* Payment Terms (After discount) */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground">{t("sales.paymentTerms")}</span>
                    <Button
                      variant={isDebt ? "default" : "outline"}
                      size="sm"
                      onClick={() => setIsDebt(!isDebt)}
                      className="h-7 text-xs"
                    >
                      <Clock className="size-3 mr-1" />
                      {isDebt ? t("sales.fullPayment") : t("sales.addDebtPayLater")}
                    </Button>
                  </div>

                  {isDebt && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label className="text-[10px]">{t("sales.amountPaidNow")} ({saleCurrency})</Label>
                        <Input
                          type="number"
                          value={paidAmount}
                          onChange={(e) => setPaidAmount(String(Number(e.target.value) || 0))}
                          placeholder={t("sales.leaveEmptyFull")}
                          className="h-8"
                        />
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {t("sales.remaining")}{" "}
                          <span className="font-medium tabular-nums">{formatTransactionMoney(balanceDue)}</span>
                        </p>
                      </div>
                      <div>
                        <Label className="text-[10px]">{t("sales.dueDateRemaining")}</Label>
                        <DatePicker value={debtDueDate} onChange={setDebtDueDate} min={invoiceDate} className="h-8 text-xs" required />
                      </div>
                    </div>
                  )}

                  {/* Tax */}
                  {settings.taxPercent > 0 && (
                    <>
                      <Separator />
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{t("sales.tax")} ({settings.taxPercent}%)</span>
                        <span className="font-medium tabular-nums">{formatTransactionMoney(taxAmount)}</span>
                      </div>
                    </>
                  )}

                  <Separator />

                  {/* Grand Total */}
                  <div className="flex justify-between items-center">
                    <span className="text-base font-semibold">{t("sales.grandTotal")}</span>
                    <span className="text-lg font-bold text-primary tabular-nums">{formatTransactionMoney(grandTotal)}</span>
                  </div>

                  {/* Debt Info */}
                  {isDebt && balanceDue > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 rounded-md p-2">
                      <Info className="size-3.5 shrink-0" />
                      {t("sales.customerWillOwe", {
                        amount: formatTransactionMoney(balanceDue),
                        date: debtDueDate,
                      })}
                    </div>
                  )}
                </div>

                {/* 5. Profit Summary */}
                <div className="rounded-lg border p-3">
                  <span className="text-xs font-semibold">{t('sales.profitSummary')}</span>
                  <div className="mt-2 grid gap-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('sales.costBasis')}</span>
                      <span className="tabular-nums">{formatTransactionMoney(totalCost)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium">{t('sales.netProfit')}</span>
                      <span className={cn("font-bold tabular-nums", netProfit >= 0 ? "text-status-returned" : "text-status-sold")}>
                        {formatTransactionMoney(netProfit)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium">{t('sales.margin')}</span>
                      <span className={cn("font-bold", marginViolation ? "text-status-sold" : "text-status-returned")}>
                        {marginPercent.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  {marginViolation && (
                    <div className="mt-2 flex items-start gap-2 rounded-md border border-status-sold/30 bg-status-sold/10 p-2">
                      <Shield className="size-4 shrink-0 text-status-sold" />
                      <div className="flex flex-col">
                        <span className="text-xs font-medium text-status-sold-fg">{t('sales.managerApprovalRequired')}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {t('sales.marginBelowMin', { margin: marginPercent.toFixed(1), min: settings.minProfitMarginPercent })}
                        </span>
                        <Button
                          size="xs"
                          variant="outline"
                          className="mt-1.5 h-5"
                          onClick={() => { setApproved(true); toast.success(t('sales.managerApprovalGranted')) }}
                        >
                          {approved ? <><Check className="size-3" /> {t('sales.approved')}</> : t('sales.approveSale')}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 6. Documents */}
                <div className="rounded-lg border p-3">
                  <span className="text-xs font-semibold">{t('sales.documents')}</span>
                  <div className="mt-2 flex gap-2">
                    <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} />
                    <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} className="h-8 text-xs">
                      <Paperclip className="size-3.5" /> {t('sales.attach')}
                    </Button>
                    {pendingFile && (
                      <>
                        <Input placeholder={t('sales.docName')} value={newDocName} onChange={(e) => setNewDocName(e.target.value)} className="h-8 text-xs flex-1" />
                        <Button size="sm" onClick={handleAddPendingDocument} className="h-8 text-xs">
                          <Plus className="size-3.5" /> {t('common.add')}
                        </Button>
                      </>
                    )}
                  </div>
                  {documents.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {documents.map((doc, i) => (
                        <Badge key={i} variant="secondary" className="gap-1"><FileText className="size-3" /> {doc.name}</Badge>
                      ))}
                    </div>
                  )}
                </div>

                {/* 7. Invoice Date & Number */}
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">{t('common.date')}</Label>
                    <DatePicker value={invoiceDate} onChange={setInvoiceDate} className="h-8 text-xs" required />
                  </div>
                  <div>
                    <Label className="text-xs">{t('sales.invoiceNum')}</Label>
                    <div className="flex gap-1.5">
                      <Input
                        value={invoiceNumber}
                        onChange={(e) => {
                          setInvoiceNumber(e.target.value)
                          if (e.target.value.trim()) setInvoiceNumberError(false)
                        }}
                        placeholder={previewInvoiceNumber}
                        aria-invalid={invoiceNumberError}
                        className={cn("h-8 text-xs font-mono", invoiceNumberError && "border-destructive focus-visible:ring-destructive")}
                      />
                      <Button size="sm" variant="outline" className="h-8" onClick={() => { setInvoiceNumber(generateInvoiceNumber(invoices)); setInvoiceNumberError(false) }}>
                        {t('sales.auto')}
                      </Button>
                    </div>
                    {invoiceNumberError && <p className="mt-1 text-[10px] text-destructive">{t('common.required')}</p>}
                  </div>
                </div>

                {/* 8. Notes */}
                <div>
                  <Label className="text-xs">{t("common.notes")}</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={t("sales.optionalNotes")}
                    className="mt-1 min-h-24 resize-y text-xs"
                  />
                </div>
              </div>
            )}

          </div>


          {/* Footer navigation */}
          <DialogFooter className="shrink-0 gap-2 sm:justify-between pt-2 border-t">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {(step === 3 && ammoStockIssues.length > 0) ||
                (step === 4 && accessoryStockIssues.length > 0) ||
                (step === 5 && hasStockIssues) ? (
                <span className="text-status-sold flex items-center gap-1">
                  <AlertTriangle className="size-3" />
                  {t('sales.fixStockIssues')}
                </span>
              ) : null}
            </div>
            <div className="flex gap-2">
              {step > 1 && <Button variant="outline" onClick={goBack}><ChevronLeft className="size-3.5" /> {t('sales.back')}</Button>}
              {step < 5 && (
                <Button
                  onClick={goNext}
                  disabled={
                    (step === 1 && !canProceedStep1) ||
                    (step === 2 && !canProceedStep2) ||
                    (step === 3 && !canProceedStep3) ||
                    (step === 4 && !canProceedStep4)
                  }
                >
                  {step === 1 ? t('sales.nextWeapons') : step === 2 ? t('sales.nextAmmunition') : step === 3 ? t('sales.nextAccessories') : t('sales.nextReview')}
                  <ChevronRight className="size-3.5" />
                </Button>
              )}
              {step === 5 && (
                <Button onClick={requestSaleConfirmation} disabled={!canComplete || isSubmitting}>
                  <Check className="size-3.5" /> {t('sales.completeSaleAmount', { amount: formatTransactionMoney(grandTotal) })}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('sales.confirmSaleTitle')}
        description={t('sales.confirmSaleDesc', { mode: t(mode === "Wholesale" ? 'sales.wholesale' : 'sales.retail'), buyer: selectedBuyerName || "the customer", amount: formatTransactionMoney(grandTotal) })}
        variant={marginViolation ? "warning" : "default"}
        confirmLabel={t('sales.completeSale')}
        onConfirm={handleConfirmSale}
        pending={isSubmitting}
        impactSummary={[
          t('sales.weaponsWillBeSold', { count: selectedWeapons.length }),
          ...ammoLines.map((l) => {
            const before = ammoTotalRounds(l.ammo)
            const sold = Number(l.quantity) || 0
            return t('sales.ammoImpact', { caliber: l.ammo.caliber, sold, before, after: Math.max(0, before - sold) })
          }),
          ...accessoryLines.map((l) => {
            const before = l.accessory.quantity
            const after = Math.max(0, before - (Number(l.quantity) || 0))
            return t('sales.accessoryImpact', { name: l.accessory.name, qty: l.quantity, before, after })
          }),
          t('sales.invoiceTax', { invoice: previewInvoiceNumber, tax: formatTransactionMoney(taxAmount) }),
          bargainDiscountAmount > 0 ? t('sales.bargainDiscountApplied', { amount: formatTransactionMoney(bargainDiscountAmount) }) : "",
          isDebt
            ? t('sales.partialPayment', { paid: formatTransactionMoney(paid), balance: formatTransactionMoney(balanceDue), date: debtDueDate })
            : t('sales.fullPaymentReceipt', { amount: formatTransactionMoney(grandTotal) }),
          marginViolation
            ? t('sales.marginBelow', { margin: marginPercent.toFixed(1), min: settings.minProfitMarginPercent, approved: approved ? t('sales.marginApproved') : '' })
            : t('sales.marginMeets', { margin: marginPercent.toFixed(1) }),
          documents.length ? `${documents.length} document(s) attached` : "",
        ].filter(Boolean)}
      />
    </div>
  )
}
