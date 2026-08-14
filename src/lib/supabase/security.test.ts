import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = resolve(import.meta.dirname, "../../..")
const read = (path: string) => readFileSync(join(root, path), "utf8")
const migration = (name: string) => read(`supabase/migrations/${name}`)

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx|cts)$/.test(name) ? [path] : []
  })
}

describe("Supabase security boundary", () => {
  it("enables RLS for every application table and hardens the later counter table", () => {
    const schema = migration("20260811000100_initial_schema.sql")
    const security = migration("20260811000200_security_and_rls.sql")
    const hardening = migration("20260811000700_realtime_and_policy_hardening.sql")
    const tables = [...schema.matchAll(/create table public\.([a-z_]+)/gi)].map((match) => match[1])
    const securityTables = new Set([...security.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]))
    for (const table of tables.filter((name) => name !== "business_id_counters")) {
      expect(securityTables, `${table} is absent from the RLS migration`).toContain(table)
    }
    expect(hardening).toContain("alter table public.business_id_counters enable row level security")
  })

  it("does not expose service credentials in renderer or preload code", () => {
    const files = [...sourceFiles(join(root, "src")), join(root, "electron/preload.cts")]
      .filter((path) => !path.endsWith("security.test.ts"))
    for (const file of files) {
      const content = readFileSync(file, "utf8")
      expect(content, file).not.toMatch(/SUPABASE_(?:SERVICE_ROLE|SECRET)_KEY/)
    }
    expect(read("src/lib/supabase/client.ts")).toMatch(/VITE_SUPABASE_URL/)
    expect(read("src/lib/supabase/client.ts")).toMatch(/VITE_SUPABASE_ANON_KEY/)
  })

  it("forces every packaged application build to omit developer Supabase values", () => {
    const packageJson = JSON.parse(read("package.json")) as { scripts: Record<string, string> }
    const packagingScripts = Object.entries(packageJson.scripts).filter(([name]) => name.startsWith("electron:") && name !== "electron:dev")
    expect(packagingScripts.length).toBeGreaterThan(0)
    for (const [name, command] of packagingScripts) {
      expect(command, name).toContain("ARMORY_GENERIC_BUILD=true")
    }
    const buildConfig = read("rsbuild.config.ts")
    expect(buildConfig).toContain('process.env.ARMORY_GENERIC_BUILD === "true"')
    expect(buildConfig).toMatch(/filter\(\(\[key\]\) => !key\.includes\("SUPABASE"\)\)/)
  })

  it("exposes only non-sensitive installation metadata and keeps the installation table behind RLS", () => {
    const installation = migration("20260814000100_independent_store_installation.sql")
    const metadataFunction = installation.match(/create or replace function public\.armory_installation_info\(\)[\s\S]*?\$\$;/i)?.[0]
    expect(installation).toContain("alter table public.app_installation enable row level security")
    expect(installation).toContain("revoke all on table public.app_installation from public, anon, authenticated")
    expect(installation).toContain("grant execute on function public.armory_installation_info() to anon, authenticated")
    expect(metadataFunction).toBeDefined()
    expect(metadataFunction).not.toMatch(/service_role|decrypted_secret|project_url|publishable/i)
  })

  it("uses explicit columns in every active Supabase repository", () => {
    const repository = read("src/lib/db/index.ts")
    const manifestRepository = read("src/lib/manifest-client.ts")
    expect(repository).not.toMatch(/\.select\(\s*["'`]\*["'`]\s*\)/)
    expect(manifestRepository).not.toMatch(/\.select\(\s*["'`]\*["'`]\s*\)/)
  })

  it("keeps Employee away from shipment administration and independent payments", () => {
    const security = migration("20260811000200_security_and_rls.sql")
    const business = migration("20260811000300_business_rpcs.sql")
    const manageShipmentBody = security.match(/create or replace function public\.can_manage_shipments\(\)[\s\S]*?\$\$;/i)?.[0]
    expect(manageShipmentBody).toBeDefined()
    expect(manageShipmentBody).not.toMatch(/'Employee'/)
    expect(business).toContain("if not public.has_app_permission('canRegisterPayments')")
  })

  it("implements atomic sale, payment, shipment, inventory, and invoice-void RPCs", () => {
    const sql = [
      migration("20260811000300_business_rpcs.sql"),
      migration("20260811000400_inventory_and_invoice_rpcs.sql"),
      migration("20260811000500_inventory_cost_and_shipment_rpcs.sql"),
    ].join("\n")
    for (const functionName of [
      "complete_sale", "register_payment", "bulk_intake_weapons", "bulk_create_shipment",
      "adjust_inventory_stock", "receive_ammunition", "void_invoice",
    ]) {
      expect(sql).toMatch(new RegExp(`function public\\.${functionName}\\b`, "i"))
    }
    expect(sql).toMatch(/for update/gi)
    expect(sql).toContain("security definer")
  })

  it("keeps the production runtime independent from a local database", () => {
    const packageJson = read("package.json")
    const main = read("electron/main.ts")
    const preload = read("electron/preload.cts")
    expect(packageJson).not.toContain("better-sqlite3")
    expect(main).not.toMatch(/initDatabase|registerIpcHandlers/)
    expect(preload).not.toMatch(/db:getAll|settings:update|sale:complete/)
  })
})
