import { readFileSync, readdirSync, statSync } from "node:fs"
import { X509Certificate } from "node:crypto"
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

  it("accepts owner-supplied provisioning values only for the one-time main-process setup", () => {
    const screen = read("src/components/first-run-setup-screen.tsx")
    const handler = read("electron/ipc/store-installation-handler.ts")
    const setupService = read("electron/services/store-installation-service.ts")

    expect(screen).toContain("supabaseUrl, publishableKey, serverKey, databaseUrl")
    expect(screen).toContain('setServerKey("")')
    expect(screen).toContain('setDatabaseUrl("")')
    expect(handler).toContain("initializeStore({")
    expect(handler).not.toContain("initializeStoreFromEnvironment({")
    expect(setupService).toContain("saveStoredConnection(connection)")
    expect(setupService).toContain("supabaseUrl: normalizeSupabaseUrl")
    expect(setupService).toContain("publishableKey: validatePublishableKey")
    expect(setupService).not.toMatch(/validatedStoredConnection[\s\S]{0,1200}(?:serverKey|databaseUrl|ownerPassword)/)
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

  it("pins the Supabase database CA and keeps full TLS verification enabled", () => {
    const setupService = read("electron/services/store-installation-service.ts")
    const pem = setupService.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)?.[0]
    expect(pem).toBeDefined()
    const certificate = new X509Certificate(pem!)
    expect(certificate.subject).toContain("CN=Supabase Root 2021 CA")
    expect(certificate.issuer).toContain("CN=Supabase Root 2021 CA")
    expect(setupService).toContain("ca: SUPABASE_DATABASE_CA_CERTIFICATE")
    expect(setupService).toContain("rejectUnauthorized: true")
    expect(setupService).not.toContain("rejectUnauthorized: false")
    expect(setupService).toContain("stripPostgresSslQueryOptions(databaseUrl)")
  })

  it("allows slow Supabase projects enough time to initialize safely", () => {
    const setupService = read("electron/services/store-installation-service.ts")
    expect(setupService).toContain("DATABASE_CONNECTION_TIMEOUT_MS = 90_000")
    expect(setupService).toContain("DATABASE_QUERY_TIMEOUT_MS = 300_000")
    expect(setupService).toContain("STORE_VERIFICATION_TIMEOUT_MS = 45_000")
    expect(setupService).toContain("keepAlive: true")
    expect(setupService).toContain("Supabase setup timed out during ${currentStage}")
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

  it("stages provider migrations behind administrator RPCs and a destination safety backup", () => {
    const providerMigration = migration("20260815000100_provider_migration_workflow.sql")
    const migratedActivation = migration("20260815000200_migrated_user_activation.sql")
    expect(providerMigration).toContain("alter table public.provider_migration_sessions enable row level security")
    expect(providerMigration).toContain("alter table public.provider_migration_chunks enable row level security")
    expect(providerMigration).toContain("revoke all on public.provider_migration_sessions from public, anon, authenticated")
    expect(providerMigration).toContain("revoke all on public.provider_migration_chunks from public, anon, authenticated")
    expect(providerMigration).toContain("actor.role <> 'Admin'::public.app_role")
    expect(providerMigration).toContain("public.create_system_backup(")
    expect(providerMigration).toContain("pg_advisory_xact_lock(hashtext('armory-provider-migration'))")
    expect(providerMigration).toContain("jsonb_array_length(p_rows) > 500")
    expect(providerMigration).toContain("pg_column_size(p_rows) > 4194304")
    expect(providerMigration).toContain("grant execute on function public.apply_provider_migration(uuid) to authenticated")
    expect(providerMigration).toContain("revoke all on function public.insert_provider_migration_rows(text, jsonb) from public, anon, authenticated")
    expect(migratedActivation).toContain("@local.weapon-store.invalid")
    expect(migratedActivation).toContain("if account.auth_user_id is null then")
    expect(migratedActivation).toContain("created_auth_user_id := (auth_response ->> 'id')::uuid")
    expect(migratedActivation).toContain("if created_auth_user_id is not null then")
  })

  it("releases deleted account identities without losing historical user rows", () => {
    const reusableIdentity = migration("20260815000700_reusable_deleted_user_identities.sql")
    const deadlockFreeDelete = migration("20260815000800_deadlock_free_auth_user_deletion.sql")
    const compatibleHttp = migration("20260815000900_provider_compatible_auth_http.sql")
    const nativeHttp = migration("20260815001000_restore_native_auth_http_defaults.sql")
    const decryptedVault = migration("20260815001100_restore_decrypted_vault_credentials.sql")
    expect(reusableIdentity).toContain("where is_active and email is not null")
    expect(reusableIdentity).toContain("where is_active and username is not null")
    expect(reusableIdentity).toContain("release_conflicting_inactive_user_identities(clean_name, clean_email)")
    expect(reusableIdentity).toContain("release_user_identity(target.id)")
    expect(reusableIdentity).toContain("auth_admin_request('DELETE'")
    expect(reusableIdentity).toContain("case when action_name = ''create''")
    expect(reusableIdentity).toContain("else coalesce(user_payload ->> ''id'', p_request ->> ''userId'')")
    expect(reusableIdentity).not.toContain("delete from public.users")
    expect(deadlockFreeDelete.indexOf("auth_admin_request('DELETE'")).toBeLessThan(deadlockFreeDelete.indexOf("for update"))
    expect(deadlockFreeDelete).toContain("ON DELETE SET NULL")
    expect(compatibleHttp).toContain("http_reset_curlopt()")
    expect(compatibleHttp).not.toContain("http_set_curlopt")
    expect(nativeHttp).not.toContain("http_set_curlopt")
    expect(nativeHttp).not.toContain("http_reset_curlopt")
    expect(decryptedVault).toContain("decrypted.decrypted_secret into service_key")
    expect(decryptedVault).toContain("decrypted.decrypted_secret into project_url")
    expect(decryptedVault).not.toMatch(/select decrypted\.secret into/)
  })

  it("uses the supported Auth user update method and handles modern secret keys", () => {
    const reliableActivation = migration("20260815001200_reliable_auth_user_activation.sql")
    expect(reliableActivation).toContain("upper(p_method) = 'PATCH' then 'PUT'")
    expect(reliableActivation).toContain("service_key not like 'sb_secret_%'")
    expect(reliableActivation).toContain("decrypted.decrypted_secret into service_key")
    expect(reliableActivation).toContain("auth_admin_request(''PUT''")
    expect(reliableActivation).toContain("response_json ->> 'error_description'")
    expect(reliableActivation).toContain("Auth API status")
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
