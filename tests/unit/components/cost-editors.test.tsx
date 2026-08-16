import React, { useState } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { I18nProvider } from "@/lib/i18n"
import { CurrencyService } from "@/lib/currency-service"
import type { ProductAdditionalCostInput, ShipmentAdditionalCostInput } from "@/lib/types"
import { ProductCostEditor } from "@/components/product-cost-editor"
import { ShipmentCostEditor } from "@/components/shipment-cost-editor"

vi.mock("@/lib/currency-context", () => ({
  useCurrency: () => ({
    currencies: [{ isoCode: "USD", name: "US Dollar", symbol: "$", decimalPrecision: 2, isActive: true }],
    formatOriginal: (amount: number, currency: string) => `${amount.toFixed(2)} ${currency}`,
  }),
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider lang="en" onLangChange={() => undefined}>{children}</I18nProvider>
}

describe("daily-use cost editors", () => {
  beforeEach(() => {
    vi.spyOn(CurrencyService, "convert").mockImplementation((amount) => amount)
  })

  it("shows a simple empty state and calculates a fixed product cost", () => {
    function Harness() {
      const [costs, setCosts] = useState<ProductAdditionalCostInput[]>([])
      return <ProductCostEditor originalAmount={50} originalCurrency="USD" costs={costs} onChange={setCosts} />
    }
    render(<Harness />, { wrapper: Wrapper })

    expect(screen.getByText("No additional costs")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /add cost/i }))
    expect(screen.getByPlaceholderText("Customs, shipping…")).toBeInTheDocument()
    expect(screen.getByText("Final Cost")).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "11" } })
    expect(screen.getByText("61.00 USD")).toBeInTheDocument()
  })

  it("marks manual shipment allocation invalid until it balances", () => {
    const onValidityChange = vi.fn()
    function Harness() {
      const [costs, setCosts] = useState<ShipmentAdditionalCostInput[]>([{
        id: "cost-1",
        name: "Customs",
        calculationType: "fixed",
        amount: "10",
        calculationBase: "original_purchase_cost",
        currency: "USD",
        scope: "entire_shipment",
        allocationMethod: "manual",
        selectedShipmentItemIds: [],
        manualAllocations: { a: "6", b: "3" },
      }])
      return <ShipmentCostEditor items={[{ id: "a", label: "Weapon A", value: 60, quantity: 1 }, { id: "b", label: "Weapon B", value: 40, quantity: 1 }]} shipmentCurrency="USD" costs={costs} onChange={setCosts} onValidityChange={onValidityChange} />
    }
    render(<Harness />, { wrapper: Wrapper })

    expect(screen.getByText("Difference:")).toBeInTheDocument()
    expect(screen.getByText("1 USD")).toBeInTheDocument()
    expect(onValidityChange).toHaveBeenLastCalledWith(false)

    fireEvent.change(screen.getByDisplayValue("3"), { target: { value: "4" } })
    expect(screen.getByText("Balanced")).toBeInTheDocument()
    expect(onValidityChange).toHaveBeenLastCalledWith(true)
  })

  it("shows only the percentage field when percentage is selected", () => {
    render(<ProductCostEditor originalAmount={200} originalCurrency="USD" costs={[{ id: "p", name: "Insurance", calculationType: "percentage", amount: "", percentageRate: "5", calculationBase: "original_purchase_cost", currency: "USD" }]} onChange={() => undefined} />, { wrapper: Wrapper })

    expect(screen.getByLabelText("Rate")).toHaveValue("5")
    expect(screen.queryByLabelText("Amount")).not.toBeInTheDocument()
    expect(screen.getByText("210.00 USD")).toBeInTheDocument()
  })

  it("keeps financial values readable in the Arabic RTL interface", () => {
    render(
      <I18nProvider lang="ar" onLangChange={() => undefined}>
        <ProductCostEditor originalAmount={50} originalCurrency="USD" costs={[]} onChange={() => undefined} />
      </I18nProvider>,
    )

    expect(document.documentElement.dir).toBe("rtl")
    expect(screen.getByText("التكلفة النهائية")).toBeInTheDocument()
    expect(document.querySelectorAll('[dir="ltr"]').length).toBeGreaterThan(0)
    expect(screen.getByTestId("product-cost-editor").innerHTML).toContain("sm:grid-cols-")
  })
})
