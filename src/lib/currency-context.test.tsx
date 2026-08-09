import React, { useEffect } from "react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CurrencyProvider, useCurrency } from "@/lib/currency-context"
import { CurrencyService, type CurrencyInfo } from "@/lib/currency-service"
import { useStore } from "@/lib/store"
import type { Invoice } from "@/lib/types"

const currencies: CurrencyInfo[] = [
  { isoCode: "USD", name: "US Dollar", symbol: "$", decimalPrecision: 2, isActive: true, lastKnownRate: 1, lastRateUpdatedAt: null },
  { isoCode: "SDG", name: "Sudanese Pound", symbol: "SDG", decimalPrecision: 2, isActive: true, lastKnownRate: 600, lastRateUpdatedAt: null },
]

const aed: CurrencyInfo = {
  isoCode: "AED", name: "UAE Dirham", symbol: "AED", decimalPrecision: 2,
  isActive: true, lastKnownRate: 3.67, lastRateUpdatedAt: null,
}

const legacyInvoice = { balance: 1_000 } as Invoice

function Probe({ onCurrency }: { onCurrency: (currency: string) => void }) {
  const { displayCurrency, setDisplayCurrency, formatInvoice } = useCurrency()
  useEffect(() => onCurrency(displayCurrency), [displayCurrency, onCurrency])
  return (
    <div>
      <output data-testid="money">{formatInvoice(legacyInvoice, "balance")}</output>
      <button onClick={() => setDisplayCurrency("USD")}>USD</button>
    </div>
  )
}

describe("header display currency authority", () => {
  const originalState = useStore.getState()

  beforeEach(() => {
    useStore.setState({
      settings: {
        ...originalState.settings,
        accountingCurrencyCode: "USD",
        currencyCode: "USD",
        preferredDisplayCurrency: "SDG",
      },
    })
    vi.spyOn(CurrencyService, "load").mockResolvedValue()
    vi.spyOn(CurrencyService, "getCurrencies").mockReturnValue(currencies)
    vi.spyOn(CurrencyService, "convertFromAccounting").mockImplementation((amount, currency) =>
      currency === "SDG" ? amount * 600 : amount)
  })

  afterEach(() => {
    act(() => useStore.setState(originalState, true))
    vi.restoreAllMocks()
  })

  it("uses the header currency for normal money display even if report mode is accounting", async () => {
    const onDisplayCurrencyChange = vi.fn()
    await act(async () => {
      render(
        <CurrencyProvider
          locale="en-US"
          displayCurrency="SDG"
          reportViewMode="accounting"
          onDisplayCurrencyChange={onDisplayCurrencyChange}
          onReportViewModeChange={vi.fn()}
        >
          <Probe onCurrency={vi.fn()} />
        </CurrencyProvider>,
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(screen.getByTestId("money")).toHaveTextContent("SDG 600,000.00")
    await waitFor(() => expect(CurrencyService.getCurrencies).toHaveBeenCalled())
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "USD" }))
    })
    expect(onDisplayCurrencyChange).toHaveBeenCalledWith("USD")
  })

  it("switches synchronously to an active display currency when the current one is deactivated", async () => {
    useStore.setState({
      settings: { ...useStore.getState().settings, preferredDisplayCurrency: "USD" },
    })
    const getCurrencies = vi.spyOn(CurrencyService, "getCurrencies").mockReturnValue([...currencies, aed])
    let notifyCurrencyChange: (() => void) | undefined
    vi.spyOn(CurrencyService, "subscribe").mockImplementation((listener) => {
      notifyCurrencyChange = listener
      return () => undefined
    })
    const onDisplayCurrencyChange = vi.fn()

    await act(async () => {
      render(
        <CurrencyProvider
          locale="en-US"
          displayCurrency="AED"
          reportViewMode="display"
          onDisplayCurrencyChange={onDisplayCurrencyChange}
          onReportViewModeChange={vi.fn()}
        >
          <Probe onCurrency={vi.fn()} />
        </CurrencyProvider>,
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    getCurrencies.mockReturnValue(currencies)
    await act(async () => notifyCurrencyChange?.())

    await waitFor(() => expect(onDisplayCurrencyChange).toHaveBeenCalledWith("USD"))
    expect(screen.getByTestId("money")).toHaveTextContent("$ 1,000.00")
  })
})
