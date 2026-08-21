import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ManifestReviewProblemsAlert } from "@/components/manifest-review-problems-alert"
import { I18nProvider } from "@/lib/i18n"
import type { ManifestReviewItem, ShipmentManifestReview } from "@/lib/shipment-manifest"

function weapon(): ManifestReviewItem {
  return {
    id: "weapon-1", rowIndex: 4, productType: "weapon", productName: "G17", category: null,
    weaponType: "Pistol", manufacturer: null, model: "G17", caliber: "9mm", sku: null,
    productCode: null, serialNumber: "S-1", serialNumbers: ["S-1"], quantity: 1, unitPrice: null,
    totalPrice: null, currency: "USD", countryOfOrigin: null, weaponTypeId: null, weaponSubtypeId: null,
    brandId: null, modelId: null, caliberId: null, storageLocationId: null, confidence: {}, source: {},
    rawData: {}, status: "needs_review", issues: [],
  }
}

function review(): ShipmentManifestReview {
  return {
    id: "review-1", shipmentId: null, status: "pending_review", fileName: "manifest.xlsx",
    fileType: "application/xlsx", fileSize: 100, fileHash: "hash", shipmentNumber: null,
    supplierName: null, supplierId: null, supplierReference: null, invoiceNumber: null,
    manifestNumber: null, shipmentDate: null, expectedArrivalDate: null, origin: null, destination: null,
    currency: "USD", reviewNote: null, additionalCosts: [], aiProvider: null, aiModel: null,
    aiRequestId: null, aiProcessingMs: null, processingWarning: null, promptVersion: null,
    schemaVersion: "1", validationSummary: { valid: 0, needsReview: 1, invalid: 0, duplicate: 0, conflict: 0 },
    items: [weapon()], issues: [],
    createdAt: "2026-08-17T00:00:00Z", updatedAt: "2026-08-17T00:00:00Z",
  }
}

function renderAlert(lang: "en" | "ar") {
  return render(
    <I18nProvider lang={lang} onLangChange={() => undefined}>
      <ManifestReviewProblemsAlert
        review={review()}
        missingFieldsById={new Map([["weapon-1", ["unitPrice", "manufacturer", "weaponSubtype"]]])}
      />
    </I18nProvider>,
  )
}

describe("manifest review problems alert", () => {
  it("keeps precise English item details collapsed until requested", () => {
    renderAlert("en")

    expect(screen.getByText("Shipment data needs review")).toBeInTheDocument()
    expect(screen.queryByText("Purchase Price")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /shipment data needs review/i }))
    expect(screen.getByText("Source row 4")).toBeInTheDocument()
    expect(screen.getByText("Purchase Price")).toBeInTheDocument()
    expect(screen.getByText("Brand")).toBeInTheDocument()
    expect(screen.getByText("Sub-type")).toBeInTheDocument()
  })

  it("shows the same precise fields in Arabic", () => {
    renderAlert("ar")
    fireEvent.click(screen.getByRole("button", { name: /بيانات الشحنة تحتاج إلى مراجعة/ }))

    expect(screen.getByText("صف المصدر 4")).toBeInTheDocument()
    expect(screen.getByText("سعر الشراء")).toBeInTheDocument()
    expect(screen.getByText("العلامة")).toBeInTheDocument()
    expect(screen.getByText("النوع الفرعي")).toBeInTheDocument()
  })
})
