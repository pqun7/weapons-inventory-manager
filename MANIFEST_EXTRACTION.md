# Shipment manifest extraction engine

The import pipeline is local-first. Spreadsheet and Word (DOC/DOCX) structure is parsed in an Electron worker into a normalized document model containing tables, cells, paragraphs, headers, footers, textboxes, merges, locations, original text, and field evidence. The deterministic engine then discovers table regions and grouped text sections, maps multilingual headers, classifies rows, and extracts strongly-supported fields. AI is an optional enrichment layer and only receives document/header context plus locally uncertain rows. Inventory is never changed during extraction or review.

DOCX is read directly from its OOXML parts. Embedded images are detected, linked to their relationship and nearby paragraph context, and forwarded for visual analysis when the provider supports their format and size. Legacy DOC continues to use the established text extractor and also conservatively recovers raw PNG/JPEG payloads from OLE streams. Unsupported or unprocessed visual content is explicitly marked as an incomplete-extraction anomaly; legacy DOC remains labelled `legacy-text` because its original table geometry and every possible image format cannot be guaranteed.

Arabic weapon descriptions are normalized to stable English business fields before review and persistence. The original Arabic description remains available in `source.text` and `rawData._translation.originalProductName`; the visible shipment contents use canonical names such as `12-Gauge Shotgun`, `.22-Caliber Air Rifle`, and `9mm Blank-Firing Pistol`. Ammunition is normalized to names such as `12-Gauge Shotshell`, `.22 Caliber Air Rifle Pellet`, and `9mm Blank Cartridge`.

## Safety invariants

- An explicit quantity is never changed to match the number of serials. A mismatch remains visible and blocks receipt.
- Carton numbers, weights, dimensions, dates, model tokens, and totals are not treated as quantities or serials.
- Values without source evidence remain `null`; inferred weapon quantity is allowed only when no explicit quantity exists and explicit serials are present.
- Native and AI rows are matched using source location, serials, product codes, and normalized product identity. Explicit native evidence wins field-by-field; conflicts and the resolution decision remain in `rawData._reconciliation`.
- Confidence is inherited from source evidence. Deterministic translation and classification may reduce that confidence but never raise it because a value merely looks plausible.
- AI payloads are validated recursively against the strict schema before any value is mapped into a shipment item.
- Verification records missing critical fields, duplicate serials, quantity/serial mismatches, low-confidence values, native/AI conflicts, incomplete visual extraction, evidence coverage, and an overall quality score.
- Provider errors are detailed in developer logs but reduced to a short, non-sensitive review warning in the UI.
- Confirmation and inventory receipt remain transactional and are revalidated against inventory and pending shipments.

## Fixture accuracy checkpoint

Measured with schema `1.4` and prompt `shipment-manifest-v7`. “Core valid” means product name/type and positive integer quantity are present, and serialized weapons have an equal explicit serial count. Database duplicate checks and receipt-only product/price requirements run afterward. Reviewed textual values are matched to relational master data automatically during confirmation, and new canonical values are learned transactionally for future imports.

| Fixture | Previous review result | Deterministic items | Core valid | Core invalid | Why invalid remains |
| --- | ---: | ---: | ---: | ---: | --- |
| `PACKING LIST.xlsx` | 0 valid / 39 invalid | 37 | 37 | 0 | Two non-product lines are no longer emitted as items. |
| `SERIAL NUMBERS.xlsx` | 0 valid / 45 invalid | 45 | 45 | 0 | Shared description/serial columns and continuation rows are grouped. |
| `طلبية شاهين 4 يوليو 2026 (1).doc` | Not previously supported | 3 | 2 | 1 | The declared shotgun quantity is 203 but only 202 explicit serial numbers are present; the mismatch remains visible. |
| `SUDAN PACKİNG REV 2.xlsx` | 0 valid / 99 invalid / 14 review | 112 | 109 | 3 | One grips row and two pump rows contain no defensible quantity; the engine does not guess. |

## Public compatibility

The existing exports remain the integration boundary, with additive structured capabilities: `parseSpreadsheetBuffer`, `parseSpreadsheetBufferAsync`, `parseWordDocumentBuffer`, `parseWordDocumentBufferAsync`, `heuristicSpreadsheetItems`, `extractSerials`, `inferProductType`, `inferCaliber`, and `inferWeaponMechanisms`, together with `NativeExtraction`, `NormalizedManifestDocument`, `ParsedManifestItem`, `ManifestReviewItem`, and `ManifestSource`.
