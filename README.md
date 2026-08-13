# Armory Store

[![CI](https://github.com/pqun7/weapon_store/actions/workflows/ci.yml/badge.svg)](https://github.com/pqun7/weapon_store/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](package.json)
[![Electron](https://img.shields.io/badge/Desktop-Electron-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)

Armory Store is an open-source desktop ERP for regulated inventory retailers. It brings serialized inventory, purchasing, shipment intake, sales, receivables, multi-currency accounting, user permissions, and operational audit history into one bilingual Electron application backed by Supabase PostgreSQL.

> This software helps manage records; it does not replace licensing, background checks, transfer procedures, tax rules, export controls, or any other legal obligation. Operators are responsible for configuring and using it in accordance with every law applicable to their jurisdiction.

## Why Armory Store

- **Serialized inventory integrity** — track weapons by unique serial number, classification, caliber, condition, status, supplier, shipment, and storage location. Atomic database operations reject duplicates and keep intake consistent.
- **Intelligent shipment intake** — import XLSX, XLS, CSV, PDF, and image manifests; combine deterministic local parsing with optional AI extraction; review confidence, validation issues, edits, and duplicate conflicts before receipt.
- **End-to-end shipment workflow** — manage draft, review, scheduled, delayed, arrived, received, failed, and cancelled states with documents, timeline events, landed-cost allocation, and reconciliation.
- **Sales and receivables** — create retail or wholesale sales, reserve or sell inventory, track invoices and partial payments, identify overdue balances, extend due dates, and void records through controlled workflows.
- **Multi-currency accounting** — preserve the original amount, transaction-time exchange rate, accounting value, rate source, and immutable historical context rather than recalculating old transactions.
- **Defense-in-depth access control** — Supabase Auth, PostgreSQL RLS, a protected primary administrator, Admin/Employee roles, fine-grained employee capabilities, activation codes, and rate-limited account claiming.
- **Audit and recovery** — business-focused audit events, notifications, personal/system backups, transaction-safe restore operations, and Supabase-managed backup guidance.
- **Desktop-first, bilingual UI** — Electron packaging for Windows, macOS, and Linux; responsive React interface; Arabic/English localization; light/dark themes; Excel export and thermal-print settings.

## Technology

| Layer | Technology |
| --- | --- |
| Desktop | Electron 32, electron-builder |
| UI | React 19, TypeScript, Rsbuild, Tailwind CSS 4, Radix UI |
| State and validation | Zustand, Zod, React Hook Form |
| Data | Supabase PostgreSQL, Auth, RLS, Realtime, Edge Functions |
| Documents | SheetJS plus local PDF/image/spreadsheet parsing |
| Optional AI | OpenAI with configurable DeepSeek fallback |
| Quality | Vitest, Testing Library, TypeScript project references, Python `unittest` |

## Prerequisites

- Node.js 20 or newer and npm 10 or newer
- Python 3.10 or newer
- A Supabase project with direct PostgreSQL connection access
- Supabase CLI for deploying Edge Functions
- Git

## Quick start

1. Clone and install dependencies.

   ```bash
   git clone https://github.com/pqun7/weapon_store.git
   cd weapon_store
   npm ci
   python -m pip install -r scripts/requirements-migration.txt
   ```

2. Copy `.env.example` to `.env.local` and configure the required values.

   ```env
   VITE_SUPABASE_URL=https://PROJECT_REF.supabase.co
   VITE_SUPABASE_ANON_KEY=your-public-anon-or-publishable-key
   SUPABASE_URL=https://PROJECT_REF.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-server-side-service-role-key
   SUPABASE_DB_URL=postgresql://postgres:ENCODED_PASSWORD@HOST:5432/postgres?sslmode=require
   ```

   Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are allowed in the renderer. Database passwords, service-role keys, administrator passwords, and AI keys must never use the `VITE_` prefix.

3. Apply the database migrations.

   ```bash
   npm run supabase:schema:apply
   ```

4. Configure and deploy the authentication Edge Functions.

   ```bash
   supabase secrets set SUPABASE_URL=https://PROJECT_REF.supabase.co SUPABASE_SERVICE_ROLE_KEY=YOUR_SECRET ALLOWED_ORIGINS=http://localhost:3000
   supabase functions deploy account-auth --project-ref PROJECT_REF
   supabase functions deploy admin-users --project-ref PROJECT_REF
   ```

5. Start the desktop development application.

   ```bash
   npm run dev
   ```

## Optional AI manifest analysis

AI analysis is optional for each upload from the **Shipment manifest workspace**. The switch is enabled by default to preserve the existing extraction flow; users can turn it off before choosing a file. When it is off, the document is not sent to an AI provider and XLSX, XLS, and CSV files are processed with the local deterministic parser only. PDF and image manifests require AI analysis because the application does not include a local OCR engine.

To enable OpenAI analysis, add these desktop-only variables to `.env.local` during development. For a packaged application, place the same values in a `.env` file beside the executable or in the application's user-data directory. Never prefix AI secrets with `VITE_`.

```env
CHATGPT_API_KEY=your-openai-api-key
CHATGPT_MODEL=gpt-4.1
```

DeepSeek can optionally remain the existing fallback for spreadsheet manifests when OpenAI fails. Configure it with:

```env
DEEPSEEK_API_KEY=your-deepseek-api-key
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_FALLBACK_ENABLED=true
DEEPSEEK_MAX_RETRIES=2
DEEPSEEK_FALLBACK_ON=timeout,rate_limit,service_unavailable,invalid_api_key,invalid_response
```

Restart the Electron application after changing these variables. API keys are read only by the Electron main process and are never exposed to the React renderer.

## Database lifecycle commands

Both maintenance commands load `.env.local` by default, acquire PostgreSQL advisory locks, validate their result before commit, and are preview-only unless `--confirm` is supplied.

### Create a clean first-run database

`reset-db` removes **all public application data and all Supabase Auth identities** while preserving migrations and schema objects. It recreates only four required currencies and the default system settings row.

To create the first administrator as part of the reset, put credentials in `.env.local` so the password is not stored in shell history:

```env
RESET_ADMIN_NAME=Primary Admin
RESET_ADMIN_EMAIL=owner@example.com
RESET_ADMIN_PASSWORD=ReplaceWithAStrongPassword1
```

Preview, then execute:

```bash
npm run reset-db
npm run reset-db -- --confirm
```

The database trigger serializes the first user insertion and forces that user to be an active, protected primary `Admin`, even if the optional reset credentials are omitted and the account is added later by a trusted bootstrap path.

> `reset-db --confirm` is destructive. Take a verified Supabase backup or PITR recovery point, confirm the target project URL, stop application writes, and read the preview before continuing.

### Add demonstration data

`seed-db` adds a compact, internally consistent dataset: master data, locations, one completed shipment, serialized weapons, ammunition, accessories, retail and wholesale customers, one invoice, and a partial payment.

If `reset-db` already created the primary Admin, the seed command reuses it. Otherwise configure a demo login in `.env.local`:

```env
SEED_ADMIN_NAME=Demo Admin
SEED_ADMIN_EMAIL=demo-admin@example.com
SEED_ADMIN_PASSWORD=ReplaceWithAStrongPassword1
```

Then preview and seed:

```bash
npm run seed-db
npm run seed-db -- --confirm
```

The command refuses to run over existing business data. To return to a clean system, run `reset-db` again; do not use demo data in production.

## Available commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the React dev server and Electron shell |
| `npm run build` | Type-check and create the production renderer build |
| `npm run electron:build` | Build the packaged desktop application |
| `npm test` | Run the Vitest suite once |
| `npm run test:coverage` | Run tests with coverage |
| `npm run typecheck` | Run TypeScript project checks |
| `npm run test:db-scripts` | Run safe unit tests for reset/seed helpers |
| `npm run supabase:schema:apply` | Apply unapplied SQL migrations transactionally |
| `npm run verify:supabase` | Verify Auth, RLS, inventory, and core database behavior |
| `npm run reset-db` | Preview a full first-run reset; add `-- --confirm` to execute |
| `npm run seed-db` | Preview the demo dataset; add `-- --confirm` to execute |

## Architecture and security boundaries

- The React renderer receives only the Supabase URL and public client key.
- RLS and security-definer RPCs are the authoritative authorization boundary; hiding a UI control is not treated as security.
- Administrator Auth operations run through Supabase server-side facilities using service-role credentials that are never bundled into Electron.
- Document bytes are validated by extension, size, and signature before parsing. AI output is untrusted, schema-constrained, and reviewed before database intake.
- Monetary writes persist original and accounting values together with their transaction-time rate metadata.
- Migration files are immutable after application: the migration runner records SHA-256 checksums and rejects altered applied migrations.

See [Supabase operations](docs/SUPABASE_OPERATIONS.md) and [RBAC user management](docs/RBAC_USER_MANAGEMENT.md) for deeper operational guidance.

## Production checklist

1. Use a dedicated production Supabase project and least-privilege operator accounts.
2. Enable RLS on every exposed table and test anonymous, Employee, Admin, and primary-Admin boundaries.
3. Store secrets in a secrets manager or protected deployment environment; never commit `.env.local`.
4. Configure exact allowed origins whenever the deployment has stable origins.
5. Enable managed backups/PITR and rehearse restore procedures before accepting real records.
6. Apply migrations in a maintenance window, then run `typecheck`, tests, build, and Supabase verification.
7. Keep Electron, Node.js, Supabase libraries, and parsers patched; review dependency alerts regularly.
8. Review local legal requirements, retention policies, licensing, audit access, and incident-response procedures.
9. Do not enable AI manifest extraction for sensitive documents until the selected provider and data-processing terms are approved by your organization.

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing a change. Security vulnerabilities must be reported privately according to [SECURITY.md](SECURITY.md), not opened as public issues.

## License

Released under the [MIT License](LICENSE). The license covers the software only and grants no authorization to buy, sell, transfer, import, export, or possess regulated items.
