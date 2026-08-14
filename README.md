# Armory Store

[![CI](https://github.com/pqun7/weapons-inventory-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/pqun7/weapons-inventory-manager/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-339933?logo=node.js&logoColor=white)](package.json)
[![Electron](https://img.shields.io/badge/Desktop-Electron-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)

Armory Store is an open-source desktop ERP for regulated inventory retailers. It brings serialized inventory, purchasing, shipment intake, sales, receivables, multi-currency accounting, user permissions, and operational audit history into one bilingual Electron application backed by Supabase PostgreSQL.

> This software helps manage records; it does not replace licensing, background checks, transfer procedures, tax rules, export controls, or any other legal obligation. Operators are responsible for configuring and using it in accordance with every law applicable to their jurisdiction.

## Setting Up a Standalone Store on Supabase

The published Windows build is **generic and is not connected to a Supabase project owned by the developer**. The intended model is one Supabase project per store or company, not one project per device:

- Employees at the same store connect to the same project so they can access the same inventory and sales data.
- Each separate store creates a Supabase project in an account it owns and is therefore responsible for its own quota, billing, and backups.
- There is no developer-operated central service or store registry, and store data and access tokens never pass through an intermediary server.
- The owner sets up the database only once. Each employee device must be linked locally once, after which the application retains the connection on that device.

### Option One: Create a New Store as the Owner

Use this option on a trusted device owned by the store administrator:

1. Create a **new, empty** project from the [Supabase Dashboard](https://supabase.com/dashboard). Do not use a project that contains data from another application.
2. Copy the following values from the project page:
   - **Project URL** from the **Connect** dialog or **Settings → API**.
   - **Publishable key** from **Settings → API Keys**. The legacy `anon` key may be used only for compatibility.
   - **Secret key** from **Settings → API Keys**. The legacy `service_role` key may be used only for compatibility.
   - **PostgreSQL connection string** from the **Connect** dialog. Use a direct connection or the Session pooler on port `5432`. The application upgrades it to `sslmode=verify-full` and verifies it with the pinned Supabase CA. Do not use the Transaction pooler on port `6543` during setup.
3. Start the application and select **I am the owner of a new store**.
4. Enter the store name, Supabase values, the owner's name and email address, and a strong password.
5. Accept the security warning, then click **Initialize Store**. Do not close the application during this stage.
6. The application performs the following steps locally and in a safe order:
   - Verifies that the URL, keys, and PostgreSQL connection string belong to the same Supabase project.
   - Applies the bundled migrations in order, using checksums and a lock that prevents two setup processes from running concurrently.
   - Stores the Project URL and server key encrypted in **Supabase Vault** within the store's project.
   - Creates the owner's account as a protected primary administrator.
   - Verifies the schema version, then saves only the project URL and public key on the device.
7. After setup succeeds, save the **store connection code**, then sign in using the owner's email address and the password you chose.

The Secret key and PostgreSQL connection string are never written to the device configuration file or logs. The application keeps them in the trusted Electron process memory only for the duration of the setup request. The server key remains in Vault because employee account creation and activation operations require it from within the database.

### Option Two: Join an Existing Store

The administrator first completes the following steps:

1. Sign in, then open **Settings → Users → Add Account**.
2. Create a separate account for the employee and assign the appropriate role and permissions.
3. Save the **user activation code**, which is shown once and expires after seven days.
4. Open **Settings → Store Connection** and copy the **store connection code**.
5. Send both codes to the employee through a trusted channel, preferably in separate messages.

The employee then completes these steps:

1. Install the same application version and select **Join a Store** on first launch.
2. Paste the store connection code. The application verifies the Supabase project and schema version before saving the connection.
3. On the sign-in screen, enter the name or email address created by the administrator.
4. Enter the user activation code and choose a personal password. The application will not request the activation code again after this step succeeds.

There are intentionally two different codes:

| Code | Contents | Validity | Purpose |
| --- | --- | --- | --- |
| Store connection code | Project URL and public key only | Reusable within the store | Connects the device to the store's project; it neither signs in the user nor bypasses RLS |
| User activation code | A random value whose hash is stored in the database | One use, 7 days | Proves that the administrator created the employee account and allows the employee to set a password |

A short, discoverable store code cannot be provided without operating a central service. The connection code is therefore longer, but it is fully self-contained and consumes no developer-operated infrastructure. Under the Supabase security model, the public key is safe to use in a desktop application, while authentication and PostgreSQL RLS provide the actual data protection.

### Administration, Recovery, and Common Issues

- The administrator can copy the connection code again or disconnect the device from **Settings → Store Connection**. Disconnecting removes only the connection and session from that device; it does not delete the Supabase project.
- If `incompatible schema` appears, the project owner must update the database schema before employees can connect the new application version.
- If a PostgreSQL connection is unavailable on an IPv4 network, use the **Session pooler** on port `5432` instead of a direct connection. Do not use port `6543` to apply migrations.
- If owner creation fails after an Auth user has been partially created and automatic cleanup is unsuccessful, delete that user from **Authentication → Users** in Supabase, then try again.
- Never send the Secret key, `service_role` key, PostgreSQL connection string, or owner password to employees or untrusted support personnel.
- Enable Supabase backups/PITR according to the store's plan, and create a system backup from within the application before major upgrades.
- To upgrade from an older version connected through `VITE_SUPABASE_*`, first apply the latest migrations to the project. The administrator can then copy the connection code from **Store Connection** and use the generic build on the remaining devices.

## Why Armory Store

- **Serialized inventory integrity** — track weapons by unique serial number, classification, caliber, condition, status, supplier, shipment, and storage location. Atomic database operations reject duplicates and keep intake consistent.
- **Intelligent shipment intake** — import XLSX, XLS, CSV, DOC, DOCX, PDF, and image manifests; combine deterministic local parsing with optional AI extraction; review confidence, validation issues, edits, and duplicate conflicts before receipt.
- **Arabic manifest normalization** — preserve the original source evidence while storing and displaying Arabic weapon descriptions through consistent English product names, weapon types, subtypes, and calibers.
- **End-to-end shipment workflow** — manage draft, review, scheduled, delayed, arrived, received, failed, and cancelled states with documents, timeline events, landed-cost allocation, and reconciliation.
- **Sales and receivables** — create retail or wholesale sales, reserve or sell inventory, track invoices and partial payments, identify overdue balances, extend due dates, and void records through controlled workflows.
- **Multi-currency accounting** — preserve the original amount, transaction-time exchange rate, accounting value, rate source, and immutable historical context rather than recalculating old transactions.
- **Defense-in-depth access control** — Supabase Auth, PostgreSQL RLS, a protected primary administrator, Admin/Employee roles, fine-grained employee capabilities, activation codes, and rate-limited account claiming.
- **Audit and recovery** — business-focused audit events, notifications, personal/system backups, transaction-safe restore operations, and Supabase-managed backup guidance.
- **Desktop-first, bilingual UI** — Electron packaging for Windows, macOS, and Linux; responsive React interface; Arabic/English localization; light/dark themes; Excel export and thermal-print settings.

## Technology

| Layer | Technology |
| --- | --- |
| Desktop | Electron 43, electron-builder |
| UI | React 19, TypeScript, Rsbuild, Tailwind CSS 4, Radix UI |
| State and validation | Zustand, Zod, React Hook Form |
| Data | Supabase PostgreSQL, Auth, RLS, Realtime, Edge Functions |
| Documents | SheetJS plus structural OOXML/legacy Word parsing, embedded-image detection, and optional AI extraction for PDF/images |
| Optional AI | OpenAI with configurable DeepSeek fallback |
| Quality | Vitest, Testing Library, TypeScript project references, Python `unittest` |

## Developer prerequisites

- Node.js 24.15 or newer and npm 11 or newer
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

2. A generic release requires no `VITE_SUPABASE_*` values. For local development against an existing private project, copy `.env.example` to `.env.local` and optionally configure:

   ```env
   VITE_SUPABASE_URL=https://PROJECT_REF.supabase.co
   VITE_SUPABASE_ANON_KEY=your-public-anon-or-publishable-key
   SUPABASE_DB_URL=postgresql://postgres:ENCODED_PASSWORD@HOST:5432/postgres?sslmode=verify-full
   ```

   Store these values only in the gitignored `.env.local` file and restrict access
   to the operating-system account running the maintenance command. Never commit,
   paste into issue reports, or prefix a database password, Secret/service-role key,
   administrator password, or AI key with `VITE_`.

   Omit both `VITE_` values to exercise the packaged first-run connection flow.
   The packaged application is safer for store owners: database credentials and
   the owner password remain in memory for the one-time setup and are not written
   to device files or logs. The server Secret key is stored encrypted inside the
   store owner's Supabase Vault, while only the public project connection and the
   required authenticated session are retained on the device. PostgreSQL setup
   uses the pinned Supabase CA with full certificate and hostname verification.

3. Apply the database migrations.

   ```bash
   npm run supabase:schema:apply
   ```

   Databases created before checksum tracking may preview and explicitly reconcile
   the verified legacy baseline with `npm run supabase:schema:reconcile`; never use
   that command for a genuinely unapplied migration.

4. Authentication uses the database RPCs installed by the migrations. The legacy
   Edge Function implementations are not part of the renderer's production path
   and should not be deployed unless the application is deliberately migrated to
   that API and its allowed origins are restricted.

5. Start the desktop development application.

   ```bash
   npm run dev
   ```

## Optional AI manifest analysis

AI analysis is optional for each upload from the **Shipment manifest workspace**. The switch is enabled by default to preserve the existing extraction flow; users can turn it off before choosing a file. When it is off, the document is not sent to an AI provider and XLSX, XLS, CSV, DOC, and DOCX files are processed with the local deterministic parser only. PDF and image manifests require AI analysis because the application does not include a local OCR engine.

To enable OpenAI analysis, add these desktop-only variables to `.env.local` during development. For a packaged application, place the same values in a `.env` file beside the executable or in the application's user-data directory. Never prefix AI secrets with `VITE_`.

```env
CHATGPT_API_KEY=your-openai-api-key
CHATGPT_MODEL=gpt-4.1
```

DeepSeek can optionally remain the existing text fallback for spreadsheet and Word manifests when OpenAI fails. Configure it with:

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
| `npm run lint` | Run the zero-warning ESLint quality gate |
| `npm run test:db-scripts` | Run safe unit tests for reset/seed helpers |
| `npm run test:db-integrity` | Run read-only migration, RLS, relationship, constraint, and index checks against the configured database |
| `npm run supabase:schema:apply` | Apply unapplied SQL migrations transactionally |
| `npm run supabase:schema:reconcile` | Preview reconciliation of verified superseded baseline records; add `-- --confirm` to commit |
| `npm run verify:supabase` | Verify Auth, RLS, inventory, and core database behavior |
| `npm run reset-db` | Preview a full first-run reset; add `-- --confirm` to execute |
| `npm run seed-db` | Preview the demo dataset; add `-- --confirm` to execute |

## Signed Windows releases

Production releases are created only from version tags matching `package.json`.
The release workflow deliberately builds without any Supabase project variables,
creates the generic installer, generates SHA-256 checksums, and publishes the EXE,
blockmap, update metadata, and checksum file to GitHub Releases. Configure
`CSC_LINK` and `CSC_KEY_PASSWORD` to Authenticode-sign public releases. The
workflow verifies the installer and unpacked executable when signing credentials
are available; unsigned development builds should be identified clearly.

## Architecture and security boundaries

- The React renderer receives only the selected store's Supabase URL and public client key. Generic release artifacts contain neither value.
- One-time database/server credentials are accepted only by Electron main-process IPC, are sanitized from errors, are never returned through preload, and are persisted only inside the store owner's Supabase Vault.
- Store connection codes contain only public client configuration. They never contain database passwords, secret/service-role keys, owner passwords, or user activation codes.
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
