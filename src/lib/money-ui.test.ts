import { afterEach, describe, expect, it, vi } from "vitest"
import { CurrencyService } from "@/lib/currency-service"
import {
  formatInvoiceMoney,
  formatInvoiceLineMoney,
  formatPaymentMoney,
  formatUnknownOriginal,
  formatValuation,
  convertValuationToCurrency,
  invoiceAccountingAmount,
  paymentAccountingAmount,
  sumMoney,
  valuationAccountingAmount,
} from "@/lib/money-ui"
import type { Invoice, MoneyValuation, PaymentRecord } from "@/lib/types"

const valuation: MoneyValuation = {
  originalAmount: 600_000,
  originalCurrency: "SDG",
  accountingAmount: 1_000,
  accountingCurrency: "USD",
  exchangeRate: 600,
  exchangeRateDate: "2026-01-01T00:00:00.000Z",
  rateSource: "manual",
}

describe("frontend immutable money presentation", () => {
  afterEach(() => vi.restoreAllMocks())

  it("keeps the saved original amount when display currency matches the transaction currency", () => {
    CurrencyService.configureAccountingCurrency("USD")
    const convert = vi.spyOn(CurrencyService, "convertFromAccounting").mockReturnValue(700_000)

    expect(formatValuation(valuation, "SDG", "en-US", "display")).toContain("600,000")
    expect(convert).not.toHaveBeenCalled()
  })

  it("uses explicit accounting invoice fields instead of the negotiated total valuation for balance", () => {
    const invoice = {
      totalNegotiatedAccounting: 1_000,
      balanceAccounting: 400,
      totalValuation: valuation,
    } as Invoice

    expect(invoiceAccountingAmount(invoice, "totalNegotiated")).toBe(1_000)
    expect(invoiceAccountingAmount(invoice, "balance")).toBe(400)
  })

  it("does not reconvert an invoice or payment when shown in its original currency", () => {
    CurrencyService.configureAccountingCurrency("USD")
    const convert = vi.spyOn(CurrencyService, "convertFromAccounting").mockReturnValue(700_000)
    const invoice = {
      currency: "SDG",
      accountingCurrency: "USD",
      balance: 400_000,
      balanceAccounting: 400,
    } as Invoice
    const payment = {
      amount: 1_000,
      currency: "USD",
      accountingAmount: 1_000,
      accountingCurrency: "USD",
    } as PaymentRecord

    expect(formatInvoiceMoney(invoice, "balance", "SDG", "en-US", "display")).toContain("400,000")
    expect(formatPaymentMoney(payment, "USD", "en-US", "display")).toContain("1,000")
    expect(convert).not.toHaveBeenCalled()
  })

  it("sums accounting amounts with decimal arithmetic", () => {
    expect(sumMoney([0.1, 0.2, null])).toBe(0.3)
  })

  it("displays legacy accounting prices in the selected header currency without turning them into zero", () => {
    CurrencyService.configureAccountingCurrency("USD")
    vi.spyOn(CurrencyService, "convertFromAccounting").mockImplementation((amount, currency) => {
      expect(currency).toBe("SDG")
      return amount * 600
    })

    expect(formatValuation(undefined, "SDG", "en-US", "display", 1_056, "USD"))
      .toBe("SDG 633,600.00")
    expect(convertValuationToCurrency(undefined, "SDG", 1_056)).toBe(633_600)
    expect(valuationAccountingAmount(undefined, 1_056)).toBe(1_056)
  })

  it("does not manufacture a zero when a monetary amount is missing", () => {
    CurrencyService.configureAccountingCurrency("USD")
    expect(formatValuation(undefined, "USD", "en-US", "display", undefined, "USD")).toBe("—")
  })

  it("formats legacy invoices and payments as accounting records", () => {
    CurrencyService.configureAccountingCurrency("USD")
    vi.spyOn(CurrencyService, "convertFromAccounting").mockImplementation((amount) => amount * 600)
    const legacyInvoice = { balance: 1_065 } as Invoice
    const legacyPayment = { amount: 250 } as PaymentRecord

    expect(invoiceAccountingAmount(legacyInvoice, "balance")).toBe(1_065)
    expect(paymentAccountingAmount(legacyPayment)).toBe(250)
    expect(formatInvoiceMoney(legacyInvoice, "balance", "SDG", "en-US", "display"))
      .toBe("SDG 639,000.00")
    expect(formatPaymentMoney(legacyPayment, "SDG", "en-US", "display"))
      .toBe("SDG 150,000.00")
  })

  it("uses the invoice rate snapshot for line items instead of the current transaction rate", () => {
    CurrencyService.configureAccountingCurrency("USD")
    const currentRateConversion = vi.spyOn(CurrencyService, "convertFromAccounting")
    const invoice = {
      currency: "SDG",
      accountingCurrency: "USD",
      exchangeRate: 600,
    } as Invoice

    expect(formatInvoiceLineMoney(invoice, 600_000, "USD", "en-US")).toBe("$ 1,000.00")
    expect(currentRateConversion).not.toHaveBeenCalled()
  })

  it("never renders the legacy unknown-currency placeholder", () => {
    expect(formatUnknownOriginal(12.5, "en-US")).toBe("12.5")
    expect(formatUnknownOriginal(12.5, "en-US")).not.toContain("[?]")
  })

  it("uses the ISO code when a stored currency symbol is missing or invalid", () => {
    const service = CurrencyService as unknown as {
      currencies: Map<string, { isoCode: string; name: string; symbol: string; decimalPrecision: number; isActive: boolean; lastKnownRate: number; lastRateUpdatedAt: null }>
    }
    service.currencies.set("TST", {
      isoCode: "TST",
      name: "Test Currency",
      symbol: "[?]",
      decimalPrecision: 2,
      isActive: true,
      lastKnownRate: 2,
      lastRateUpdatedAt: null,
    })
    try {
      expect(CurrencyService.format(10, "TST", "en-US")).toBe("TST 10.00")
    } finally {
      service.currencies.delete("TST")
    }
  })
})
