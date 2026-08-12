import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260812002300_repair_deleted_manifest_reimports.sql"),
  "utf8",
)
const rowDeletionMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260812002400_manifest_row_deletion_and_remove_confidence.sql"),
  "utf8",
)
const schemaReloadMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260812002500_reload_manifest_rpc_schema.sql"),
  "utf8",
)
const performanceMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260812002600_bulk_manifest_updates_and_early_receipt.sql"),
  "utf8",
)

describe("deleted manifest shipment recovery migration", () => {
  it("repairs existing scheduled imports whose shipment was deleted", () => {
    expect(migration).toContain("where manifest.status = 'scheduled'")
    expect(migration).toContain("and manifest.shipment_id is null")
    expect(migration).toContain("status = 'pending_review'")
  })

  it("deletes the linked manifest workspace with future pre-receipt shipment deletions", () => {
    expect(migration).toContain("linked_import_id := shipment_row.import_id")
    expect(migration).toContain("delete from public.shipment_imports as manifest")
  })

  it("does not de-duplicate a re-upload against an orphaned confirmed import", () => {
    expect(migration).toContain("i.status in ('processing', 'pending_review')")
    expect(migration).toContain("and i.shipment_id is not null")
    expect(migration).toContain("exists (select 1 from public.shipments")
  })

  it("removes the stale pending-review-only error from the deployed edit functions", () => {
    expect(migration).not.toContain("only manifests pending review can be edited")
    expect(migration).toContain("manifest cannot be edited while linked to an active shipment")
  })
})

describe("manifest bulk update and receipt migration", () => {
  it("updates row-specific patches in one RPC and validates once", () => {
    expect(performanceMigration).toContain("create or replace function public.bulk_update_manifest_items")
    expect(performanceMigration).toContain("for update_entry in select value from jsonb_array_elements(p_updates)")
    expect(performanceMigration.match(/perform public\.validate_manifest_import\(p_import_id\)/g)).toHaveLength(1)
    expect(performanceMigration).toContain("grant execute on function public.bulk_update_manifest_items(text, jsonb) to authenticated")
  })

  it("uses legal scheduled-arrived-received transitions during early receipt", () => {
    const arrived = performanceMigration.indexOf("set status = 'arrived'")
    const received = performanceMigration.indexOf("set status = 'received'")
    expect(arrived).toBeGreaterThan(0)
    expect(received).toBeGreaterThan(arrived)
    expect(performanceMigration).toContain("'actualArrivalDate', current_date")
  })
})

describe("manifest product-row deletion migration", () => {
  it("removes confidence from the final database schema and persistence path", () => {
    expect(rowDeletionMigration).toContain("drop column if exists confidence_json")
    const createReviewBody = rowDeletionMigration.slice(0, rowDeletionMigration.indexOf("alter table public.shipment_import_items"))
    expect(createReviewBody).not.toContain("confidence_json")
  })

  it("supports authorized single and multi-row deletion without deleting the final row", () => {
    expect(rowDeletionMigration).toContain("create or replace function public.delete_manifest_items")
    expect(rowDeletionMigration).toContain("i.status in ('pending_review', 'failed')")
    expect(rowDeletionMigration).toContain("select distinct value from jsonb_array_elements_text(p_item_ids)")
    expect(rowDeletionMigration).toContain("remaining_count - target_count < 1")
    expect(rowDeletionMigration).toContain("perform public.validate_manifest_import(p_import_id)")
    expect(rowDeletionMigration).toContain("grant execute on function public.delete_manifest_items(text, jsonb) to authenticated")
  })

  it("reloads the PostgREST schema after publishing the deletion RPC", () => {
    expect(schemaReloadMigration).toContain("pg_notify('pgrst', 'reload schema')")
  })

  it("persists the complete line-item price contract after import", () => {
    expect(rowDeletionMigration).toContain("retail_price, wholesale_price, retail_price_mode")
    expect(rowDeletionMigration).toContain("wholesale_price_mode, additional_costs, total_price")
  })
})
