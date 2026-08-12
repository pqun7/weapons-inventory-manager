import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCurrency } from "@/lib/currency-context"
import type { PricingMode, ProductAdditionalCostInput } from "@/lib/types"
import { PricingFields } from "./pricing-fields"
import { ProductCostEditor } from "./product-cost-editor"

export interface PricingSectionProps {
    purchasePrice: string
    onPurchasePriceChange: (value: string) => void
    currency: string
    onCurrencyChange: (value: string) => void
    quantity: number
    onQuantityChange: (value: number) => void
    showQuantity?: boolean
    additionalCosts: ProductAdditionalCostInput[]
    onAdditionalCostsChange: (costs: ProductAdditionalCostInput[]) => void
    finalCost: number
    retailPrice: string
    retailPriceMode: PricingMode
    onRetailChange: (next: { value: string; mode: PricingMode }) => void
    wholesalePrice: string
    wholesalePriceMode: PricingMode
    onWholesaleChange: (next: { value: string; mode: PricingMode }) => void
    errors?: { purchasePrice?: string; retailPrice?: string }
}

export function PricingSection(props: PricingSectionProps) {
    const { currencies, currencyPresentation } = useCurrency()
    return (
        <div className="space-y-4">
            <div className={`grid grid-cols-1 gap-3 ${props.showQuantity === false ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
                <div className="flex flex-col gap-1">
                    <Label className="text-xs">Currency</Label>
                    <Select value={props.currency} onValueChange={props.onCurrencyChange}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{currencies.map((item) => <SelectItem key={item.isoCode} value={item.isoCode}>{item.isoCode} — {currencyPresentation(item.isoCode).name}</SelectItem>)}</SelectContent>
                    </Select>
                </div>
                <div className="flex flex-col gap-1">
                    <Label className="text-xs">Unit Purchase Price ({currencyPresentation(props.currency).compactSymbol})</Label>
                    <Input type="number" min={0} step="any" value={props.purchasePrice} onChange={(event) => props.onPurchasePriceChange(event.target.value)} className="h-8 text-xs" />
                    {props.errors?.purchasePrice && <span className="text-[10px] text-destructive">{props.errors.purchasePrice}</span>}
                </div>
                {props.showQuantity !== false && (
                    <div className="flex flex-col gap-1">
                        <Label className="text-xs">Quantity</Label>
                        <Input
                            type="number"
                            min={1}
                            value={props.quantity}
                            onChange={(event) => {
                                const val = event.target.value;

                                // السماح بالقيمة الفارغة مؤقتاً لتسهيل عملية مسح الرقم القديم
                                if (val === '') {
                                    props.onQuantityChange('' as any);
                                    return;
                                }

                                const value = Number(val);
                                if (Number.isFinite(value)) {
                                    // الحفاظ على الأعداد الصحيحة فقط
                                    props.onQuantityChange(Math.trunc(value));
                                }
                            }}
                            onBlur={() => {
                                // العودة للرقم 1 كحد أدنى فقط عند الخروج من الحقل إذا كان فارغاً أو أقل من 1
                                if (!props.quantity || props.quantity < 1) {
                                    props.onQuantityChange(1);
                                }
                            }}
                            className="h-8 text-xs"
                        />
                    </div>
                )}
            </div>
            <ProductCostEditor originalAmount={props.purchasePrice || "0"} originalCurrency={props.currency} costs={props.additionalCosts} onChange={props.onAdditionalCostsChange} />
            <PricingFields finalCost={props.finalCost} currency={props.currency} retail={{ value: props.retailPrice, mode: props.retailPriceMode }} wholesale={{ value: props.wholesalePrice, mode: props.wholesalePriceMode }} onRetailChange={props.onRetailChange} onWholesaleChange={props.onWholesaleChange} />
            {props.errors?.retailPrice && <span className="text-[10px] text-destructive">{props.errors.retailPrice}</span>}
        </div>
    )
}
