import { useMemo, useRef } from "react"
import { toast } from "sonner"
import { SearchableCombobox } from "@/components/ui/searchable-combobox"
import { useStore } from "@/lib/store"
import { useI18n } from "@/lib/i18n"

type ProductTypeCategory = "accessory" | "ammunition"

interface CreatableProductTypeSelectProps {
  category: ProductTypeCategory
  value: string
  onValueChange: (value: string) => void
  defaults?: readonly string[]
  placeholder?: string
}

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase()
}

export function CreatableProductTypeSelect({
  category,
  value,
  onValueChange,
  defaults = [],
  placeholder,
}: CreatableProductTypeSelectProps) {
  const productTypes = useStore((state) => state.inventoryProductTypes)
  const { t } = useI18n()
  const createType = useStore((state) => state.createInventoryProductType)
  const previousValue = useRef(value)

  const options = useMemo(() => {
    const unique = new Map<string, string>()
    for (const option of defaults) unique.set(normalized(option), option.trim())
    for (const type of productTypes) {
      if (type.category === category) unique.set(normalized(type.name), type.name)
    }
    return [...unique.values()].sort((left, right) => left.localeCompare(right))
  }, [category, defaults, productTypes])

  const handleCreate = async (name: string) => {
    const beforeCreate = previousValue.current
    const result = await createType(category, name)
    if (!result.success || !result.type) {
      onValueChange(beforeCreate)
      toast.error(t("productType.createFailed"))
      return
    }
    previousValue.current = result.type.name
    onValueChange(result.type.name)
    toast.success(t(result.created ? "productType.created" : "productType.existingSelected"))
  }

  return (
    <SearchableCombobox
      value={value}
      onValueChange={(next) => {
        previousValue.current = next
        onValueChange(next)
      }}
      options={options}
      placeholder={placeholder}
      allowCreate
      onCreateNew={(name) => void handleCreate(name)}
    />
  )
}
