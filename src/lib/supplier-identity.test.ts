import { describe, expect, it } from "vitest"
import { canonicalSupplierName, extractSupplierLegalName } from "./supplier-identity"

describe("supplier identity", () => {
  it("keeps the legal company name and drops a same-line address", () => {
    expect(extractSupplierLegalName("Shamal Arms Trading LLC   P.O. Box 123, Riyadh")).toBe("Shamal Arms Trading LLC")
  })

  it("matches harmless punctuation, case, and ampersand differences", () => {
    expect(canonicalSupplierName("ACME Arms & Co., Ltd.")).toBe(canonicalSupplierName("acme arms and co ltd"))
  })
})
