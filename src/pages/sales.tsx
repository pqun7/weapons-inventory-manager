import { useState, useMemo, useCallback, useRef, Fragment } from "react"
import {
  Search, ShoppingCart, UserPlus, Check, Receipt, TrendingUp, Package,
  X, Shield, Plus, ChevronRight, ChevronLeft, ChevronDown, Trash2, AlertTriangle,
  Zap, Banknote, CreditCard, Landmark, Clock, FileText,
  Info, Paperclip,
} from "lucide-react"
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
import { SmartCurrencyInput } from "@/components/ui/smart-currency-input"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useStore } from "@/lib/store"
import { SaleService } from "@/lib/services"
import { formatCurrency, generateInvoiceNumber, statusBadgeClass, statusDotClass } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ammoTotalRounds } from "@/lib/types"
import type { SaleMode, Weapon, Ammunition, Accessory } from "@/lib/types"
import { toast } from "sonner"
import { useI18n } from "@/lib/i18n"
import { Textarea } from "@/components/ui/textarea";


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

type PaymentMethod = "cash" | "card" | "bank_transfer"

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
  const addCustomer = useStore((s) => s.addCustomer)
  const sellAmmo = useStore((s) => s.sellAmmo)

  // Wizard state
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<WizardStep>(1)
  const [mode, setMode] = useState<SaleMode>("Retail")

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

  // ---------- Pricing ----------
  const weaponsSubtotal = useMemo(
    () => selectedWeapons.reduce((s, w) => {
      const custom = customPrices[w.id]
      return s + (custom ? Number(custom) || 0 : mode === "Wholesale" ? w.wholesalePrice : w.retailPrice)
    }, 0),
    [selectedWeapons, customPrices, mode]
  )
  const weaponsOriginal = useMemo(
    () => selectedWeapons.reduce((s, w) => s + (mode === "Wholesale" ? w.wholesalePrice : w.retailPrice), 0),
    [selectedWeapons, mode]
  )
  const ammoSubtotal = useMemo(
    () => ammoLines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0),
    [ammoLines]
  )
  const accessorySubtotal = useMemo(
    () => accessoryLines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0),
    [accessoryLines]
  )

  const totalOriginal = weaponsOriginal + ammoSubtotal + accessorySubtotal
  const totalNegotiated = weaponsSubtotal + ammoSubtotal + accessorySubtotal
  const discountAmount = totalOriginal - totalNegotiated

  // الخصم الإضافي
  const bargainDiscountAmount = bargainDiscount.trim() ? Number(bargainDiscount) || 0 : 0
  const bargainDiscountValid = bargainDiscountAmount >= 0 && bargainDiscountAmount <= totalNegotiated
  const finalSubtotal = bargainDiscountValid ? totalNegotiated - bargainDiscountAmount : totalNegotiated
  const finalTax = finalSubtotal * (settings.taxPercent / 100)
  const finalGrandTotal = finalSubtotal + finalTax

  const totalCost = useMemo(
    () => selectedWeapons.reduce((s, w) => s + w.purchasePrice, 0),
    [selectedWeapons]
  )
  const netProfit = finalSubtotal - totalCost
  const marginPercent = totalCost > 0 ? (netProfit / totalCost) * 100 : 100
  const marginViolation = marginPercent < settings.minProfitMarginPercent

  const grandTotal = finalGrandTotal
  const taxAmount = finalTax

  const ammoStockIssues = ammoLines.filter((l) => (Number(l.quantity) || 0) > ammoTotalRounds(l.ammo))
  const accessoryStockIssues = accessoryLines.filter((l) => (Number(l.quantity) || 0) > l.accessory.quantity)
  const hasStockIssues = ammoStockIssues.length > 0 || accessoryStockIssues.length > 0

  const canProceedStep1 = buyerType === "new" ? newName.trim().length > 0 : buyerOptions.some((b) => b.id === selectedCustomerId)
  const canProceedStep2 = selectedWeapons.length > 0
  const canComplete = !hasStockIssues && (!marginViolation || approved)

  const previewInvoiceNumber = invoiceNumber.trim() || generateInvoiceNumber(invoices)
  const selectedBuyerName = buyerType === "new" ? newName.trim() : buyerOptions.find((b) => b.id === selectedCustomerId)?.name ?? ""

  const paid = paidAmount.trim() ? Number(paidAmount) || 0 : grandTotal
  const balanceDue = Math.max(0, grandTotal - paid)

  // ---------- Handlers ----------
  const handleAddWeapon = useCallback((weapon: Weapon) => {
    setSelectedWeapons((prev) => (prev.find((w) => w.id === weapon.id) ? prev : [...prev, weapon]))
  }, [])

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
    setAmmoLines((prev) => [...prev, { ammo, quantity: "1", unitPrice: ammo.price, sellMode: "round", packageInput: "" }])

    setAmmoPicker("")
  }

  const handleRemoveAmmo = (id: string) => setAmmoLines((prev) => prev.filter((l) => l.ammo.id !== id))

  const handleAddAccessory = (label: string) => {
    if (!label) return
    const accessory = accessories.find((a) => `${a.name} — ${a.type}` === label)
    if (!accessory) return
    if (accessoryLines.find((l) => l.accessory.id === accessory.id)) { toast.error(t('sales.accessoryAlreadyAdded', { name: accessory.name })); return }
    setAccessoryLines((prev) => [...prev, { accessory, quantity: "1", unitPrice: accessory.price }])
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
    if (!pendingFile) return toast.error("No file selected")
    const name = newDocName.trim() || pendingFileName.trim()
    if (!name) return toast.error("Document name required")
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
    setBuyerType("existing")
    setSelectedCustomerId("")
    setNewName(""); setNewPhone(""); setNewEmail("")
    setSerialInput(""); setWeaponSearch("")
    setSelectedWeapons([]); setCustomPrices({})
    setAmmoLines([]); setAmmoPicker("")
    setAccessoryLines([]); setAccessoryPicker("")
    setInvoiceDate(todayDate()); setInvoiceNumber(""); setNotes("")
    setPaymentMethod("cash"); setIsDebt(false); setPaidAmount(""); setDebtDueDate(todayDate())
    setDocuments([]); setNewDocName("")
    setPendingFile(null);
    setPendingFileName("");
    setApproved(false); setConfirmOpen(false)
    setBargainDiscount("")
    setExpandedIds(new Set());
    setExpandedAmmoIds(new Set());
    setExpandedAccessoryIds(new Set());
  }, [])

  const openWizard = () => { resetForm(); setOpen(true) }

  const handleConfirmSale = async () => {
    setConfirmOpen(false)
    if (hasStockIssues) { toast.error(t('sales.stockExceedsAvailable')); return }
    if (marginViolation && !approved) { toast.error(t('sales.managerApprovalReq')); return }

    let customerId = selectedCustomerId
    let customerName = ""
    if (buyerType === "new") {
      if (!newName.trim()) { toast.error(t('sales.customerNameRequired')); return }
      const custResult = await addCustomer({
        name: newName.trim(), phone: newPhone.trim(), email: newEmail.trim(),
        address: "", isWholesaleBuyer: mode === "Wholesale", wholesaleDiscountPercent: 0,
      })
      if (!custResult.success || !custResult.customer) { toast.error(custResult.error ?? 'Failed'); return }
      customerId = custResult.customer.id
      customerName = custResult.customer.name
    } else {
      const buyer = buyerOptions.find((b) => b.id === selectedCustomerId)
      if (!buyer) { toast.error(t('sales.selectBuyerError')); return }
      customerId = buyer.id
      customerName = buyer.name
    }

    const lineItems = [
      ...selectedWeapons.map((w) => {
        const unit = customPrices[w.id] ? Number(customPrices[w.id]) || 0 : (mode === "Wholesale" ? w.wholesalePrice : w.retailPrice)
        return { itemType: "weapon" as const, itemId: w.id, name: `${w.brand} ${w.model}`, quantity: 1, unitPrice: unit, total: unit }
      }),
      ...ammoLines.map((l) => {
        const qty = Number(l.quantity) || 0
        const unit = Number(l.unitPrice) || 0
        return { itemType: "ammunition" as const, itemId: l.ammo.id, name: l.ammo.caliber, quantity: qty, unitPrice: unit, total: qty * unit }
      }),
      ...accessoryLines.map((l) => {
        const qty = Number(l.quantity) || 0
        const unit = Number(l.unitPrice) || 0
        return { itemType: "accessory" as const, itemId: l.accessory.id, name: l.accessory.name, quantity: qty, unitPrice: unit, total: qty * unit }
      }),
    ]

    const attachments = documents.map(d => JSON.stringify(d))
    const dueDate = isDebt && balanceDue > 0 ? debtDueDate : invoiceDate

    const result = await SaleService.execute({
      weaponIds: selectedWeapons.map((w) => w.id),
      lineItems,
      customerId,
      customerName,
      mode,
      invoiceNumber: previewInvoiceNumber,
      totalNegotiated: finalSubtotal,
      totalOriginal,
      dueDate,
      attachments,
      notes: notes.trim() + (bargainDiscountAmount > 0 ? ` | ${t('sales.bargainDiscountApplied', { amount: formatCurrency(bargainDiscountAmount, settings.currencySymbol) })}` : ""),
      taxAmount: finalTax,
      date: invoiceDate,
      paidAmount: isDebt ? paid : grandTotal,
      balance: isDebt ? balanceDue : 0,
      paymentMethod,
    } as any)

    if (result.success) {
      for (const l of ammoLines) {
        const rounds = Number(l.quantity) || 0
        if (rounds > 0) await sellAmmo({ itemId: l.ammo.id, rounds })
      }
      toast.success(t('sales.saleCompletedInvoice', { invoice: result.invoiceNumber ?? "" }), {
        description: t('sales.saleCompletedDesc', { count: lineItems.length, buyer: customerName, amount: formatCurrency(grandTotal, settings.currencySymbol) }),
      })
      setOpen(false)
      resetForm()
    } else {
      toast.error(result.error || t('sales.saleFailedMsg'))
    }
  }

  const goNext = () => setStep((s) => Math.min(5, s + 1) as WizardStep)
  const goBack = () => setStep((s) => Math.max(1, s - 1) as WizardStep)

  const modePrice = (w: Weapon) => (mode === "Wholesale" ? w.wholesalePrice : w.retailPrice)

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
                      <td className="py-1.5 pr-3 text-right tabular-nums">{formatCurrency(inv.totalNegotiated + inv.taxAmount, settings.currencySymbol)}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        <Badge variant={inv.balance > 0 ? "secondary" : "outline"} className="text-[9px]">{formatCurrency(inv.balance, settings.currencySymbol)}</Badge>
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
        <DialogContent className="sm:max-w-5xl max-h-[95vh] flex flex-col">
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
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 custom-scrollbar" style={{ maxHeight: "calc(85vh - 220px)" }}>
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
                                  {formatCurrency(modePrice(w), settings.currencySymbol)}
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
                              const profit = finalPrice - w.purchasePrice;
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
                                        placeholder={formatCurrency(modePrice(w), settings.currencySymbol)}
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
                                      {formatCurrency(profit, settings.currencySymbol)}
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono text-[11px] font-bold tabular-nums text-primary">
                                      {formatCurrency(finalPrice, settings.currencySymbol)}
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
                                              {formatCurrency(w.purchasePrice, settings.currencySymbol)}
                                            </div>
                                          </div>
                                          <div>
                                            <span className="text-muted-foreground">{t('sales.retailPrice')}</span>
                                            <div className="font-medium tabular-nums">
                                              {formatCurrency(w.retailPrice, settings.currencySymbol)}
                                            </div>
                                          </div>
                                          <div>
                                            <span className="text-muted-foreground">{t('sales.wholesalePrice')}</span>
                                            <div className="font-medium tabular-nums">
                                              {formatCurrency(w.wholesalePrice, settings.currencySymbol)}
                                            </div>
                                          </div>
                                          <div>
                                            <span className="text-muted-foreground">{t('sales.profitMargin')}</span>
                                            <div className={cn("font-medium tabular-nums", profit >= 0 ? "text-emerald-600" : "text-red-500")}>
                                              {((profit / (w.purchasePrice || 1)) * 100).toFixed(1)}%
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
                            {formatCurrency(weaponsSubtotal, settings.currencySymbol)}
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
                                      className="h-7 w-16 text-[10px] text-left font-mono"
                                    />
                                  </div>
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex items-center justify-end gap-1">
                                    <span className="text-[10px] text-muted-foreground">
                                      {settings.currencySymbol}
                                    </span>
                                    <Input
                                      type="text"
                                      inputMode="decimal"
                                      dir="ltr"
                                      value={l.unitPrice}
                                      onChange={(e) =>
                                        setAmmoLines((prev) =>
                                          prev.map((x) =>
                                            x.ammo.id === l.ammo.id
                                              ? { ...x, unitPrice: Number(e.target.value) || 0 }
                                              : x
                                          )
                                        )
                                      }
                                      className="h-7 w-20 text-[10px] text-left font-mono"
                                    />
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-[11px] font-medium tabular-nums">
                                  {formatCurrency(lineTotal, settings.currencySymbol)}
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
                                          {formatCurrency(
                                            l.ammo.price,
                                            settings.currencySymbol
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
                          {formatCurrency(ammoSubtotal, settings.currencySymbol)}
                        </span>
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
                                      className="h-7 w-16 text-[10px] text-left font-mono"
                                    />
                                  </div>
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex items-center justify-end gap-1">
                                    <span className="text-[10px] text-muted-foreground">
                                      {settings.currencySymbol}
                                    </span>
                                    <Input
                                      type="text"
                                      inputMode="decimal"
                                      dir="ltr"
                                      value={l.unitPrice}
                                      onChange={(e) =>
                                        setAccessoryLines((prev) =>
                                          prev.map((x) =>
                                            x.accessory.id === l.accessory.id
                                              ? { ...x, unitPrice: Number(e.target.value) || 0 }
                                              : x
                                          )
                                        )
                                      }
                                      className="h-7 w-20 text-[10px] text-left font-mono"
                                    />
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-[11px] font-medium tabular-nums">
                                  {formatCurrency(lineTotal, settings.currencySymbol)}
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
                                          {formatCurrency(
                                            l.accessory.price,
                                            settings.currencySymbol
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
                          {formatCurrency(accessorySubtotal, settings.currencySymbol)}
                        </span>
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
                {selectedWeapons.length > 0 && (
                  <div className="rounded-lg border p-3">
                    <span className="text-xs font-semibold">{t('sales.weaponPricingDetails')}</span>
                    <div className="mt-2 overflow-x-auto custom-scrollbar">
                      <table className="w-full text-[10px]">
                        <thead>
                          <tr className="text-left text-muted-foreground">
                            <th className="pb-1 font-medium">{t('sales.weapon')}</th>
                            <th className="pb-1 text-right font-medium">{t('sales.retailPrice')}</th>
                            <th className="pb-1 text-right font-medium">{t('sales.wholesalePrice')}</th>
                            <th className="pb-1 text-right font-medium">{t('sales.cost')}</th>
                            <th className="pb-1 text-right font-medium">{t('sales.selling')}</th>
                            <th className="pb-1 text-right font-medium">{t('common.profit')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedWeapons.map((w) => {
                            const retail = w.retailPrice
                            const wholesale = w.wholesalePrice
                            const cost = w.purchasePrice
                            const selling = customPrices[w.id] ? Number(customPrices[w.id]) || 0 : modePrice(w)
                            const profit = selling - cost
                            return (
                              <tr key={w.id} className="border-t">
                                <td className="py-1 pr-2">{w.brand} {w.model} <span className="text-muted-foreground">({w.serialNumber})</span></td>
                                <td className="py-1 text-right tabular-nums">{formatCurrency(retail, settings.currencySymbol)}</td>
                                <td className="py-1 text-right tabular-nums">{formatCurrency(wholesale, settings.currencySymbol)}</td>
                                <td className="py-1 text-right tabular-nums">{formatCurrency(cost, settings.currencySymbol)}</td>
                                <td className="py-1 text-right font-bold tabular-nums text-primary">{formatCurrency(selling, settings.currencySymbol)}</td>
                                <td className={cn("py-1 text-right font-bold tabular-nums", profit >= 0 ? "text-status-returned" : "text-status-sold")}>
                                  {formatCurrency(profit, settings.currencySymbol)}
                                </td>
                              </tr>
                            )
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
                          <span className="font-medium tabular-nums text-status-reserved-fg">-{formatCurrency(discountAmount, settings.currencySymbol)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="font-medium">{t("sales.negotiatedSubtotal")}</span>
                          <span className="font-semibold tabular-nums">{formatCurrency(totalNegotiated, settings.currencySymbol)}</span>
                        </div>
                      </>
                    )}

                    {/* Additional Discount */}
                    {bargainDiscountAmount > 0 && bargainDiscountValid && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{t("sales.additionalDiscount")}</span>
                        <span className="font-medium tabular-nums text-status-reserved-fg">-{formatCurrency(bargainDiscountAmount, settings.currencySymbol)}</span>
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
                        <Label className="text-[10px]">{t("sales.amountPaidNow")}</Label>
                        <Input
                          type="number"
                          value={paidAmount}
                          onChange={(e) => setPaidAmount(String(Number(e.target.value) || 0))}
                          placeholder={t("sales.leaveEmptyFull")}
                          className="h-8"
                        />
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {t("sales.remaining")}{" "}
                          <span className="font-medium tabular-nums">{formatCurrency(balanceDue, settings.currencySymbol)}</span>
                        </p>
                      </div>
                      <div>
                        <Label className="text-[10px]">{t("sales.dueDateRemaining")}</Label>
                        <Input type="date" value={debtDueDate} onChange={(e) => setDebtDueDate(e.target.value)} className="h-8 text-xs" />
                      </div>
                    </div>
                  )}

                  {/* Tax */}
                  {settings.taxPercent > 0 && (
                    <>
                      <Separator />
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{t("sales.tax")} ({settings.taxPercent}%)</span>
                        <span className="font-medium tabular-nums">{formatCurrency(taxAmount, settings.currencySymbol)}</span>
                      </div>
                    </>
                  )}

                  <Separator />

                  {/* Grand Total */}
                  <div className="flex justify-between items-center">
                    <span className="text-base font-semibold">{t("sales.grandTotal")}</span>
                    <span className="text-lg font-bold text-primary tabular-nums">{formatCurrency(grandTotal, settings.currencySymbol)}</span>
                  </div>

                  {/* Debt Info */}
                  {isDebt && balanceDue > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 rounded-md p-2">
                      <Info className="size-3.5 shrink-0" />
                      {t("sales.customerWillOwe", {
                        amount: formatCurrency(balanceDue, settings.currencySymbol),
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
                      <span className="tabular-nums">{formatCurrency(totalCost, settings.currencySymbol)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium">{t('sales.netProfit')}</span>
                      <span className={cn("font-bold tabular-nums", netProfit >= 0 ? "text-status-returned" : "text-status-sold")}>
                        {formatCurrency(netProfit, settings.currencySymbol)}
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
                    <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="h-8 text-xs" />
                  </div>
                  <div>
                    <Label className="text-xs">{t('sales.invoiceNum')}</Label>
                    <div className="flex gap-1.5">
                      <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder={previewInvoiceNumber} className="h-8 text-xs font-mono" />
                      <Button size="sm" variant="outline" className="h-8" onClick={() => setInvoiceNumber(generateInvoiceNumber(invoices))}>
                        {t('sales.auto')}
                      </Button>
                    </div>
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
              {step === 5 && hasStockIssues && <span className="text-status-sold flex items-center gap-1"><AlertTriangle className="size-3" /> {t('sales.fixStockIssues')}</span>}
            </div>
            <div className="flex gap-2">
              {step > 1 && <Button variant="outline" onClick={goBack}><ChevronLeft className="size-3.5" /> {t('sales.back')}</Button>}
              {step < 5 && (
                <Button onClick={goNext} disabled={(step === 1 && !canProceedStep1) || (step === 2 && !canProceedStep2)}>
                  {step === 1 ? t('sales.nextWeapons') : step === 2 ? t('sales.nextAmmunition') : step === 3 ? t('sales.nextAccessories') : t('sales.nextReview')}
                  <ChevronRight className="size-3.5" />
                </Button>
              )}
              {step === 5 && (
                <Button onClick={() => setConfirmOpen(true)} disabled={!canComplete}>
                  <Check className="size-3.5" /> {t('sales.completeSaleAmount', { amount: formatCurrency(grandTotal, settings.currencySymbol) })}
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
        description={t('sales.confirmSaleDesc', { mode: t(mode === "Wholesale" ? 'sales.wholesale' : 'sales.retail'), buyer: selectedBuyerName || "the customer", amount: formatCurrency(grandTotal, settings.currencySymbol) })}
        variant={marginViolation ? "warning" : "default"}
        confirmLabel={t('sales.completeSale')}
        onConfirm={handleConfirmSale}
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
          t('sales.invoiceTax', { invoice: previewInvoiceNumber, tax: formatCurrency(taxAmount, settings.currencySymbol) }),
          bargainDiscountAmount > 0 ? t('sales.bargainDiscountApplied', { amount: formatCurrency(bargainDiscountAmount, settings.currencySymbol) }) : "",
          isDebt
            ? t('sales.partialPayment', { paid: formatCurrency(paid, settings.currencySymbol), balance: formatCurrency(balanceDue, settings.currencySymbol), date: debtDueDate })
            : t('sales.fullPaymentReceipt', { amount: formatCurrency(grandTotal, settings.currencySymbol) }),
          marginViolation
            ? t('sales.marginBelow', { margin: marginPercent.toFixed(1), min: settings.minProfitMarginPercent, approved: approved ? t('sales.marginApproved') : '' })
            : t('sales.marginMeets', { margin: marginPercent.toFixed(1) }),
          documents.length ? `${documents.length} document(s) attached` : "",
        ].filter(Boolean)}
      />
    </div>
  )
}