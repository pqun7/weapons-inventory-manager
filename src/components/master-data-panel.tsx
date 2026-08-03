import { useState } from "react"
import { Plus, Trash2, Database, RefreshCw, AlertCircle, Layers } from "lucide-react"
import { useDynamicMasterData } from "@/hooks/use-dynamic-master-data"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { toast } from "sonner"

export function MasterDataPanel() {
  const md = useDynamicMasterData()

  const [newTypeName, setNewTypeName] = useState("")
  const [newSubtypeName, setNewSubtypeName] = useState("")
  const [newSubtypeParent, setNewSubtypeParent] = useState("")
  const [newCaliberName, setNewCaliberName] = useState("")
  const [newBrandName, setNewBrandName] = useState("")
  const [newModelName, setNewModelName] = useState("")
  const [newModelBrand, setNewModelBrand] = useState("")
  const [newWarehouseName, setNewWarehouseName] = useState("")
  const [newLocWarehouse, setNewLocWarehouse] = useState("")
  const [newLocShelf, setNewLocShelf] = useState("")
  const [newLocBin, setNewLocBin] = useState("")

  if (md.loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
        <Spinner className="size-4" />
        <span className="text-xs">Loading master data…</span>
      </div>
    )
  }

  if (md.error) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
        <AlertCircle className="size-4 shrink-0" />
        {md.error}
        <Button size="sm" variant="outline" className="ml-auto h-7" onClick={md.refresh}>
          <RefreshCw className="size-3.5" /> Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Master Data</span>
        </div>
        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={md.refresh}>
          <RefreshCw className="size-3.5" /> Refresh
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Manage weapon classification lookups, brands, models, and storage locations used across all intake and shipment forms.
      </p>
      <Separator />

      <Accordion type="multiple" className="flex flex-col gap-1">

        {/* ── Weapon Types ── */}
        <AccordionItem value="weapon-types" className="rounded-lg border px-3">
          <AccordionTrigger className="py-2 text-xs font-medium hover:no-underline">
            Weapon Types
            <Badge variant="secondary" className="ml-auto mr-2 text-[10px]">{md.weaponTypes.length}</Badge>
          </AccordionTrigger>
          <AccordionContent className="pb-3">
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="h-7 text-[10px]">Label</TableHead>
                    <TableHead className="h-7 w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {md.weaponTypes.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="py-1.5 text-[11px] font-medium">{t.label}</TableCell>
                      <TableCell className="py-1.5">
                        <DeleteBtn onConfirm={() => md.deleteWeaponType(t.id)} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <AddRow
              placeholder="New weapon type (e.g. Revolver)"
              value={newTypeName}
              onChange={setNewTypeName}
              onAdd={() => {
                if (!newTypeName.trim()) return
                md.createWeaponType(newTypeName.trim())
                toast.success(`Weapon type "${newTypeName}" added`)
                setNewTypeName("")
              }}
            />
          </AccordionContent>
        </AccordionItem>

        {/* ── Weapon Subtypes ── */}
        <AccordionItem value="weapon-subtypes" className="rounded-lg border px-3">
          <AccordionTrigger className="py-2 text-xs font-medium hover:no-underline">
            Weapon Sub-Types
            <Badge variant="secondary" className="ml-auto mr-2 text-[10px]">{md.weaponSubtypes.length}</Badge>
          </AccordionTrigger>
          <AccordionContent className="pb-3">
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="h-7 text-[10px]">Parent Type</TableHead>
                    <TableHead className="h-7 text-[10px]">Sub-Type</TableHead>
                    <TableHead className="h-7 w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {md.weaponSubtypes.map((s) => {
                    const parent = md.weaponTypes.find(t => t.id === s.weapon_type_id)
                    return (
                      <TableRow key={s.id}>
                        <TableCell className="py-1.5 text-[11px] text-muted-foreground">{parent?.label ?? "—"}</TableCell>
                        <TableCell className="py-1.5 text-[11px] font-medium">{s.label}</TableCell>
                        <TableCell className="py-1.5">
                          <DeleteBtn onConfirm={() => md.deleteWeaponSubtype(s.id)} />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Select value={newSubtypeParent} onValueChange={setNewSubtypeParent}>
                <SelectTrigger className="h-7 w-36 text-[11px]">
                  <SelectValue placeholder="Parent type" />
                </SelectTrigger>
                <SelectContent>
                  {md.weaponTypes.map(t => (
                    <SelectItem key={t.id} value={t.label} className="text-xs">{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="h-7 text-[11px] flex-1"
                placeholder="Sub-type name"
                value={newSubtypeName}
                onChange={(e) => setNewSubtypeName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newSubtypeName.trim() && newSubtypeParent) {
                    md.createWeaponSubtype(newSubtypeParent, newSubtypeName.trim())
                    toast.success(`Sub-type "${newSubtypeName}" added`)
                    setNewSubtypeName("")
                  }
                }}
              />
              <Button
                size="sm" className="h-7 shrink-0"
                disabled={!newSubtypeName.trim() || !newSubtypeParent}
                onClick={() => {
                  md.createWeaponSubtype(newSubtypeParent, newSubtypeName.trim())
                  toast.success(`Sub-type "${newSubtypeName}" added`)
                  setNewSubtypeName("")
                }}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* ── Calibers ── */}
        <AccordionItem value="calibers" className="rounded-lg border px-3">
          <AccordionTrigger className="py-2 text-xs font-medium hover:no-underline">
            Calibers
            <Badge variant="secondary" className="ml-auto mr-2 text-[10px]">{md.calibers.length}</Badge>
          </AccordionTrigger>
          <AccordionContent className="pb-3">
            <div className="max-h-52 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="h-7 text-[10px]">Caliber</TableHead>
                    <TableHead className="h-7 w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {md.calibers.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="py-1.5 font-mono text-[11px]">{c.label}</TableCell>
                      <TableCell className="py-1.5">
                        <DeleteBtn onConfirm={() => md.deleteCaliber(c.id)} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <AddRow
              placeholder="New caliber (e.g. .45 ACP)"
              value={newCaliberName}
              onChange={setNewCaliberName}
              onAdd={() => {
                if (!newCaliberName.trim()) return
                md.createCaliber(newCaliberName.trim())
                toast.success(`Caliber "${newCaliberName}" added`)
                setNewCaliberName("")
              }}
            />
          </AccordionContent>
        </AccordionItem>

        {/* ── Brands ── */}
        <AccordionItem value="brands" className="rounded-lg border px-3">
          <AccordionTrigger className="py-2 text-xs font-medium hover:no-underline">
            Brands
            <Badge variant="secondary" className="ml-auto mr-2 text-[10px]">{md.brands.length}</Badge>
          </AccordionTrigger>
          <AccordionContent className="pb-3">
            <div className="flex flex-wrap gap-1.5 py-1">
              {md.brands.map((b) => (
                <div key={b.id} className="flex items-center gap-1 rounded-full border bg-muted/40 pl-2.5 pr-1 py-0.5">
                  <span className="text-[11px]">{b.label}</span>
                  <DeleteBtn onConfirm={() => md.deleteBrand(b.id)} iconOnly />
                </div>
              ))}
            </div>
            <AddRow
              placeholder="New brand (e.g. Heckler & Koch)"
              value={newBrandName}
              onChange={setNewBrandName}
              onAdd={() => {
                if (!newBrandName.trim()) return
                md.createBrand(newBrandName.trim())
                toast.success(`Brand "${newBrandName}" added`)
                setNewBrandName("")
              }}
            />
          </AccordionContent>
        </AccordionItem>

        {/* ── Models ── */}
        <AccordionItem value="models" className="rounded-lg border px-3">
          <AccordionTrigger className="py-2 text-xs font-medium hover:no-underline">
            Models
            <Badge variant="secondary" className="ml-auto mr-2 text-[10px]">{md.models.length}</Badge>
          </AccordionTrigger>
          <AccordionContent className="pb-3">
            <div className="max-h-52 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="h-7 text-[10px]">Model</TableHead>
                    <TableHead className="h-7 text-[10px]">Brand</TableHead>
                    <TableHead className="h-7 w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {md.models.map((m) => {
                    const brand = md.brands.find(b => b.id === m.brand_id)
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="py-1.5 text-[11px] font-medium">{m.label}</TableCell>
                        <TableCell className="py-1.5 text-[11px] text-muted-foreground">{brand?.label ?? <span className="italic">unlinked</span>}</TableCell>
                        <TableCell className="py-1.5">
                          <DeleteBtn onConfirm={() => md.deleteModel(m.id)} />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  {md.models.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="py-4 text-center text-[11px] text-muted-foreground italic">No models yet — add one below</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Select value={newModelBrand} onValueChange={setNewModelBrand}>
                <SelectTrigger className="h-7 w-32 text-[11px]">
                  <SelectValue placeholder="Brand (opt.)" />
                </SelectTrigger>
                <SelectContent>
                  {md.brands.map(b => (
                    <SelectItem key={b.id} value={b.label} className="text-xs">{b.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="h-7 text-[11px] flex-1"
                placeholder="Model name (e.g. G17)"
                value={newModelName}
                onChange={(e) => setNewModelName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newModelName.trim()) {
                    md.createModel(newModelName.trim(), newModelBrand || undefined)
                    toast.success(`Model "${newModelName}" added`)
                    setNewModelName(""); setNewModelBrand("")
                  }
                }}
              />
              <Button
                size="sm" className="h-7 shrink-0"
                disabled={!newModelName.trim()}
                onClick={() => {
                  md.createModel(newModelName.trim(), newModelBrand || undefined)
                  toast.success(`Model "${newModelName}" added`)
                  setNewModelName(""); setNewModelBrand("")
                }}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* ── Warehouses ── */}
        <AccordionItem value="warehouses" className="rounded-lg border px-3">
          <AccordionTrigger className="py-2 text-xs font-medium hover:no-underline">
            Warehouses
            <Badge variant="secondary" className="ml-auto mr-2 text-[10px]">{md.warehouses.length}</Badge>
          </AccordionTrigger>
          <AccordionContent className="pb-3">
            <div className="flex flex-wrap gap-2 py-1">
              {md.warehouses.map((w) => {
                const locCount = md.storageLocations.filter(sl => sl.warehouse_id === w.id).length
                return (
                  <div key={w.id} className="flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1">
                    <Database className="size-3 text-muted-foreground" />
                    <span className="text-[11px] font-medium">{w.label}</span>
                    <Badge variant="outline" className="text-[9px]">{locCount} locations</Badge>
                    <DeleteBtn onConfirm={() => md.deleteWarehouse(w.id)} iconOnly />
                  </div>
                )
              })}
            </div>
            <AddRow
              placeholder="New warehouse (e.g. Vault)"
              value={newWarehouseName}
              onChange={setNewWarehouseName}
              onAdd={() => {
                if (!newWarehouseName.trim()) return
                md.createWarehouse(newWarehouseName.trim())
                toast.success(`Warehouse "${newWarehouseName}" added`)
                setNewWarehouseName("")
              }}
            />
          </AccordionContent>
        </AccordionItem>

        {/* ── Storage Locations ── */}
        <AccordionItem value="storage-locations" className="rounded-lg border px-3">
          <AccordionTrigger className="py-2 text-xs font-medium hover:no-underline">
            Storage Locations
            <Badge variant="secondary" className="ml-auto mr-2 text-[10px]">{md.storageLocations.length}</Badge>
          </AccordionTrigger>
          <AccordionContent className="pb-3">
            <div className="max-h-52 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="h-7 text-[10px]">Warehouse</TableHead>
                    <TableHead className="h-7 text-[10px]">Shelf</TableHead>
                    <TableHead className="h-7 text-[10px]">Bin</TableHead>
                    <TableHead className="h-7 w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {md.storageLocations.map((sl) => {
                    const wh = md.warehouses.find(w => w.id === sl.warehouse_id)
                    return (
                      <TableRow key={sl.id}>
                        <TableCell className="py-1.5 text-[11px]">{wh?.label ?? "—"}</TableCell>
                        <TableCell className="py-1.5 font-mono text-[11px]">{sl.shelf}</TableCell>
                        <TableCell className="py-1.5 font-mono text-[11px]">{sl.bin || "—"}</TableCell>
                        <TableCell className="py-1.5">
                          <DeleteBtn onConfirm={() => md.deleteStorageLocation(sl.id)} />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  {md.storageLocations.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-4 text-center text-[11px] text-muted-foreground italic">No locations yet</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Select value={newLocWarehouse} onValueChange={setNewLocWarehouse}>
                <SelectTrigger className="h-7 w-28 text-[11px]">
                  <SelectValue placeholder="Warehouse" />
                </SelectTrigger>
                <SelectContent>
                  {md.warehouses.map(w => (
                    <SelectItem key={w.id} value={w.label} className="text-xs">{w.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input className="h-7 text-[11px] w-20" placeholder="Shelf" value={newLocShelf} onChange={(e) => setNewLocShelf(e.target.value)} />
              <Input className="h-7 text-[11px] w-20" placeholder="Bin" value={newLocBin} onChange={(e) => setNewLocBin(e.target.value)} />
              <Button
                size="sm" className="h-7 shrink-0"
                disabled={!newLocWarehouse || !newLocShelf.trim()}
                onClick={() => {
                  md.createStorageLocation(newLocWarehouse, newLocShelf.trim(), newLocBin.trim())
                  toast.success("Storage location added")
                  setNewLocShelf(""); setNewLocBin("")
                }}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
          </AccordionContent>
        </AccordionItem>

      </Accordion>
    </div>
  )
}

function AddRow({ placeholder, value, onChange, onAdd }: {
  placeholder: string
  value: string
  onChange: (v: string) => void
  onAdd: () => void
}) {
  return (
    <div className="mt-2 flex items-center gap-2">
      <Input
        className="h-7 text-[11px] flex-1"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onAdd() }}
      />
      <Button size="sm" className="h-7 shrink-0" disabled={!value.trim()} onClick={onAdd}>
        <Plus className="size-3.5" />
      </Button>
    </div>
  )
}

function DeleteBtn({ onConfirm }: { onConfirm: () => void; iconOnly?: boolean }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" className="size-6 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10">
          <Trash2 className="size-3" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-sm">Delete this entry?</AlertDialogTitle>
          <AlertDialogDescription className="text-xs">
            This removes the lookup value permanently. Existing weapon records retain their current text — only future entries stop seeing it as a suggestion.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-8 text-xs">Cancel</AlertDialogCancel>
          <AlertDialogAction className="h-8 text-xs bg-destructive hover:bg-destructive/90" onClick={onConfirm}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
