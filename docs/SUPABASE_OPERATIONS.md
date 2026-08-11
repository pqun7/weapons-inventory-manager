# Supabase production operations

The desktop application uses Supabase PostgreSQL as its only operational database. Electron performs local document parsing for shipment manifests but does not open, create, back up, or restore any local database.

## Public renderer environment

Only these variables are allowed in a renderer build:

```env
VITE_SUPABASE_URL=https://PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=PUBLIC_ANON_OR_PUBLISHABLE_KEY
```

Never expose a service-role/secret key, a database password, an AI provider key, or an administrator password through a `VITE_` variable, preload API, or renderer source.

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

Administrator account management is isolated in the deployed `admin-users` Edge Function. Configure its service-role credentials only in Supabase Function secrets, never in the desktop renderer:

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
