import { describe, expect, it } from "vitest"
import { mappers } from "@/lib/db/mappers"

describe("customer custom fields", () => {
  it("round-trips named values between Supabase rows and application models", () => {
    const row = {
      id: "CUST-TEST",
      name: "Test customer",
      phone: "",
      email: "",
      address: "",
      is_wholesale_buyer: false,
      wholesale_discount_percent: 0,
      date_added: "2026-08-13",
      notes: "",
      custom_fields: { "National ID": "12345", Employer: "Example Company" },
    }

    const customer = mappers.rowToCustomer(row)
    expect(customer.customFields).toEqual({ "National ID": "12345", Employer: "Example Company" })
    expect(mappers.customerToRow(customer).custom_fields).toEqual(row.custom_fields)
  })

  it("ignores malformed non-string values received from an untrusted row", () => {
    const customer = mappers.rowToCustomer({
      id: "CUST-TEST",
      name: "Test customer",
      phone: "",
      email: "",
      address: "",
      is_wholesale_buyer: false,
      wholesale_discount_percent: 0,
      date_added: "2026-08-13",
      notes: "",
      custom_fields: { safe: "value", malformed: 123 },
    })
    expect(customer.customFields).toEqual({ safe: "value" })
  })
})
