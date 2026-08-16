import { afterEach, describe, expect, it, vi } from "vitest"
import { analyzeManifestWithAi, classifyAiHttpFailure, readAiFallbackConfig, userFacingAiError } from "@electron/services/openai-manifest-service"

afterEach(() => vi.unstubAllGlobals())

const itemConfidence = Object.fromEntries([
  "productName", "category", "productType", "weaponType", "manufacturer", "model", "caliber", "sku", "productCode",
  "actionType", "feedingType", "serialNumber", "quantity", "unitPrice", "totalPrice", "currency", "countryOfOrigin",
].map((field) => [field, 0.8]))
const shipmentConfidence = Object.fromEntries([
  "shipmentNumber", "supplier", "supplierReference", "invoiceNumber", "manifestNumber", "shipmentDate", "expectedArrivalDate", "origin", "destination", "currency",
].map((field) => [field, 0]))

function validExtractionJson(): string {
  return JSON.stringify({
    shipment: {
      shipmentNumber: null, supplier: null, supplierReference: null, invoiceNumber: null, manifestNumber: null,
      shipmentDate: null, expectedArrivalDate: null, origin: null, destination: null, currency: null, confidence: shipmentConfidence,
    },
    items: [{
      productName: "Test item", category: null, productType: "accessory", weaponType: null, manufacturer: null, model: null,
      caliber: null, actionType: null, feedingType: null, sku: null, productCode: null, serialNumber: null, serialNumbers: [],
      quantity: 1, unitPrice: null, totalPrice: null, currency: null, countryOfOrigin: null, confidence: itemConfidence,
      source: { sheet: "Manifest", page: null, row: 2, column: "A", text: "Test item" }, rawDataJson: "{}",
    }],
    ambiguities: [],
  })
}

describe("shipment manifest AI fallback", () => {
  it("enables DeepSeek with two retries and all requested failure categories by default", () => {
    const config = readAiFallbackConfig({})
    expect(config.enabled).toBe(true)
    expect(config.maxRetries).toBe(2)
    expect([...config.fallbackOn]).toEqual([
      "timeout",
      "rate_limit",
      "service_unavailable",
      "invalid_api_key",
      "invalid_response",
    ])
  })

  it("allows safe environment overrides without accepting unbounded retries", () => {
    const config = readAiFallbackConfig({
      DEEPSEEK_FALLBACK_ENABLED: "false",
      DEEPSEEK_MAX_RETRIES: "99",
      DEEPSEEK_FALLBACK_ON: "timeout,rate_limit,unknown",
    })
    expect(config.enabled).toBe(false)
    expect(config.maxRetries).toBe(5)
    expect([...config.fallbackOn]).toEqual(["timeout", "rate_limit"])
  })

  it("classifies provider failures used by fallback routing", () => {
    expect(classifyAiHttpFailure(401)).toBe("invalid_api_key")
    expect(classifyAiHttpFailure(408)).toBe("timeout")
    expect(classifyAiHttpFailure(429)).toBe("rate_limit")
    expect(classifyAiHttpFailure(503)).toBe("service_unavailable")
    expect(classifyAiHttpFailure(400, "No credits remaining")).toBe("service_unavailable")
    expect(classifyAiHttpFailure(422)).toBe("invalid_response")
  })

  it("routes an OpenAI authentication failure to DeepSeek and records the provider", async () => {
    const previous = {
      CHATGPT_API_KEY: process.env.CHATGPT_API_KEY,
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
      DEEPSEEK_FALLBACK_ENABLED: process.env.DEEPSEEK_FALLBACK_ENABLED,
      DEEPSEEK_MAX_RETRIES: process.env.DEEPSEEK_MAX_RETRIES,
    }
    process.env.CHATGPT_API_KEY = "invalid-openai-test-key"
    process.env.DEEPSEEK_API_KEY = "deepseek-test-key"
    process.env.DEEPSEEK_FALLBACK_ENABLED = "true"
    process.env.DEEPSEEK_MAX_RETRIES = "0"
    const extractedJson = validExtractionJson()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "deepseek-request", choices: [{ message: { content: extractedJson } }] }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    try {
      const result = await analyzeManifestWithAi({
        fileName: "manifest.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes: new Uint8Array(),
        nativeExtraction: { kind: "spreadsheet", sheets: [], text: "Product | Qty\nTest item | 1", raw: {} },
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(result?.provider).toBe("deepseek")
      expect(result?.requestId).toBe("deepseek-request")
      expect(result?.fallbackReason).toBe("OpenAI was unavailable; DeepSeek fallback completed the analysis.")
      expect(result?.items).toHaveLength(1)
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value == null) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  it("rejects a deeply malformed fallback payload instead of coercing missing fields", async () => {
    const previous = {
      CHATGPT_API_KEY: process.env.CHATGPT_API_KEY,
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
      DEEPSEEK_FALLBACK_ENABLED: process.env.DEEPSEEK_FALLBACK_ENABLED,
      DEEPSEEK_MAX_RETRIES: process.env.DEEPSEEK_MAX_RETRIES,
    }
    process.env.CHATGPT_API_KEY = "invalid-openai-test-key"
    process.env.DEEPSEEK_API_KEY = "deepseek-test-key"
    process.env.DEEPSEEK_FALLBACK_ENABLED = "true"
    process.env.DEEPSEEK_MAX_RETRIES = "0"
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ shipment: {}, items: [{}], ambiguities: [] }) } }] }), { status: 200 })))
    try {
      await expect(analyzeManifestWithAi({
        fileName: "manifest.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes: new Uint8Array(),
        nativeExtraction: { kind: "spreadsheet", sheets: [], text: "Product | Qty\nTest item | 1", raw: {} },
      })).rejects.toThrow(/schema violation/i)
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value == null) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  it("keeps provider credit details out of the user-facing message", async () => {
    const previous = {
      CHATGPT_API_KEY: process.env.CHATGPT_API_KEY,
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
      DEEPSEEK_FALLBACK_ENABLED: process.env.DEEPSEEK_FALLBACK_ENABLED,
      DEEPSEEK_MAX_RETRIES: process.env.DEEPSEEK_MAX_RETRIES,
    }
    process.env.CHATGPT_API_KEY = "invalid-openai-test-key"
    process.env.DEEPSEEK_API_KEY = "deepseek-test-key"
    process.env.DEEPSEEK_FALLBACK_ENABLED = "true"
    process.env.DEEPSEEK_MAX_RETRIES = "0"
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Insufficient Balance" } }), { status: 402 })))
    try {
      let providerError: unknown
      try { await analyzeManifestWithAi({
        fileName: "manifest.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes: new Uint8Array(),
        nativeExtraction: { kind: "spreadsheet", sheets: [], text: "Product | Qty\nTest item | 1", raw: {} },
      }) } catch (error) { providerError = error }
      expect(providerError).toBeInstanceOf(Error)
      expect(userFacingAiError(providerError)).toContain("processed locally")
      expect(userFacingAiError(providerError)).not.toMatch(/credit|balance|token|billing/i)
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value == null) delete process.env[key]
        else process.env[key] = value
      }
    }
  })
})
