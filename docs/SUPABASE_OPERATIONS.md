# Supabase production operations

The desktop application uses Supabase PostgreSQL as its only operational database. Electron performs local document parsing for shipment manifests but does not open, create, back up, or restore any local database.

## Generic release and runtime connection

Public releases do not embed a Supabase project. On first launch, the owner can
initialize their own new project once by entering its connection values in the
protected first-run form, or a staff device can import a store connection code.
Electron stores only the project URL, publishable/anon key, installation
ID, store label, and schema version in the application's user-data directory.
The Auth storage key is namespaced by installation ID so sessions cannot leak
between store projects.

These renderer variables remain optional for local development and legacy
private builds:

```env
VITE_SUPABASE_URL=https://PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=PUBLIC_ANON_OR_PUBLISHABLE_KEY
```

Never expose a service-role/secret key, a database password, an AI provider key, or an administrator password through a `VITE_` variable, preload API, or renderer source.

During one-time owner setup, the renderer sends the form values once to Electron
main over the isolated IPC bridge, then clears the server key, PostgreSQL URL,
and owner password fields after the attempt. Electron main validates the project
URL, public key, server key, and PostgreSQL connection string; applies the packaged
migrations with checksums and advisory locking; stores the server key and
project URL in the owner's Supabase Vault; creates the protected primary owner;
then persists only public client configuration. The server key, PostgreSQL URL,
database password, and owner password are never written to device configuration
or logs and are never returned from Electron main to the renderer.

If the selected project already contains Armory Store accounts, setup normally
requires the existing primary owner's credentials. The owner can instead opt in
to account replacement for a project dedicated exclusively to this store. That
explicitly confirmed operation hard-deletes every Supabase Auth user in the
selected project, anonymizes and disables historical application profiles so
business/audit foreign keys remain valid, and creates one new primary owner. It
does not delete business records, the Supabase project or organization, or any
other Supabase project. Never enable replacement for a project shared with
another application.

Store connection codes are portable because they contain only the project URL
and public client key. They are not authentication credentials: a user account,
password/activation claim, and RLS authorization are still required.

## Apply PostgreSQL migrations

Use a direct connection string from the Supabase dashboard in a private administrator environment:

```env
SUPABASE_DB_URL=postgresql://postgres:ENCODED_PASSWORD@HOST:5432/postgres?sslmode=require
```

Then run:

```powershell
python -m pip install -r scripts/requirements-migration.txt
python scripts/apply-supabase-migrations.py
```

The apply script processes every file under `supabase/migrations` in filename order, applies each migration transactionally, records its checksum, and refuses changed checksums.

## Edge Functions

The current renderer uses authenticated database RPCs for administrator account
management. Those RPCs read the store-owned server credential from Supabase
Vault. The legacy `admin-users` Edge Function is not part of the production path
and should not be deployed unless the application is deliberately migrated to
it and its origin policy is configured.

For that legacy deployment only:

```powershell
supabase secrets set SUPABASE_URL=https://PROJECT_REF.supabase.co SUPABASE_SERVICE_ROLE_KEY=SERVER_SIDE_SECRET
supabase functions deploy admin-users --project-ref PROJECT_REF
```

## Backup and rollback

Production recovery uses Supabase managed backups or point-in-time recovery. Portable JSON/Excel exports remain user-controlled exports and are not a substitute for a database recovery point.

Before a schema release:

1. confirm a current managed backup or PITR point;
2. apply migrations in order;
3. run authentication/RLS and operational verification;
4. run TypeScript, tests, production build, and Electron packaging;
5. reopen writes only after all checks pass.

If a release fails, stop writes, restore the chosen Supabase recovery point, rerun verification, and only then reopen the application.
