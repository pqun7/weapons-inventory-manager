# Shipment manifest extraction engine

The import pipeline is local-first. Spreadsheet structure is parsed in an Electron worker, then the deterministic engine discovers table regions, maps multilingual headers, classifies rows, extracts strongly-supported fields, and retains field evidence in `rawData._extraction`. AI is an optional enrichment layer and only receives document/header context plus locally uncertain rows. Inventory is never changed during extraction or review.

## Safety invariants

- An explicit quantity is never changed to match the number of serials. A mismatch remains visible and blocks receipt.
- Carton numbers, weights, dimensions, dates, model tokens, and totals are not treated as quantities or serials.
- Values without source evidence remain `null`; inferred weapon quantity is allowed only when no explicit quantity exists and explicit serials are present.
- Native values win unless AI supplies a supported field with materially higher confidence.
- Provider errors are detailed in developer logs but reduced to a short, non-sensitive review warning in the UI.
- Confirmation and inventory receipt remain transactional and are revalidated against inventory and pending shipments.

## Fixture accuracy checkpoint

Measured on the three supplied workbooks with schema `1.3` and prompt `shipment-manifest-v4`. “Core valid” means product name/type and positive integer quantity are present, and serialized weapons have an equal explicit serial count. Database duplicate checks and receipt-only product/price requirements run afterward. Reviewed textual values are matched to relational master data automatically during confirmation, and new canonical values are learned transactionally for future imports.

| Fixture | Previous review result | Deterministic items | Core valid | Core invalid | Why invalid remains |
| --- | ---: | ---: | ---: | ---: | --- |
| `PACKING LIST.xlsx` | 0 valid / 39 invalid | 37 | 37 | 0 | Two non-product lines are no longer emitted as items. |
| `SERIAL NUMBERS.xlsx` | 0 valid / 45 invalid | 45 | 45 | 0 | Shared description/serial columns and continuation rows are grouped. |
| `SUDAN PACKİNG REV 2.xlsx` | 0 valid / 99 invalid / 14 review | 112 | 109 | 3 | One grips row and two pump rows contain no defensible quantity; the engine does not guess. |

## Public compatibility

The existing exports remain the integration boundary: `parseSpreadsheetBuffer`, `parseSpreadsheetBufferAsync`, `heuristicSpreadsheetItems`, `extractSerials`, `inferProductType`, and `inferCaliber`, together with `NativeExtraction`, `ParsedManifestItem`, `ManifestReviewItem`, and `ManifestSource`.
