# Armory Store

[![CI](https://github.com/pqun7/weapons-inventory-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/pqun7/weapons-inventory-manager/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](package.json)
[![Electron](https://img.shields.io/badge/Desktop-Electron-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)

Armory Store is an open-source desktop ERP for regulated inventory retailers. It brings serialized inventory, purchasing, shipment intake, sales, receivables, multi-currency accounting, user permissions, and operational audit history into one bilingual Electron application backed by Supabase PostgreSQL.

> This software helps manage records; it does not replace licensing, background checks, transfer procedures, tax rules, export controls, or any other legal obligation. Operators are responsible for configuring and using it in accordance with every law applicable to their jurisdiction.

## إعداد متجر مستقل على Supabase

نسخة Windows المنشورة **عامة وغير مرتبطة بمشروع Supabase خاص بالمطور**. النموذج الصحيح هو مشروع Supabase واحد لكل متجر أو شركة، وليس مشروعًا لكل جهاز:

- موظفو المتجر الواحد يتصلون بالمشروع نفسه لكي يشاهدوا المخزون والمبيعات نفسها.
- كل متجر مختلف ينشئ مشروع Supabase في حساب يملكه، ولذلك يتحمل حصته وفوترته ونسخه الاحتياطية بنفسه.
- لا توجد خدمة مركزية أو سجل متاجر تابع للمطور، ولا تمر بيانات المتجر أو رموز الدخول عبر خادم وسيط.
- إعداد قاعدة البيانات يتم مرة واحدة فقط بواسطة المالك. كل جهاز موظف يحتاج إلى ربط محلي مرة واحدة، ثم يحتفظ التطبيق بالاتصال على ذلك الجهاز.

### الخيار الأول: إنشاء متجر جديد كمالك

استخدم هذا الخيار على جهاز موثوق يملكه مدير المتجر:

1. أنشئ مشروعًا **جديدًا وفارغًا** من [Supabase Dashboard](https://supabase.com/dashboard). لا تستخدم مشروعًا يحتوي بيانات تطبيق آخر.
2. من صفحة المشروع انسخ القيم التالية:
   - **Project URL** من نافذة **Connect** أو **Settings → API**.
   - **Publishable key** من **Settings → API Keys**. يمكن استخدام مفتاح `anon` القديم للتوافق فقط.
   - **Secret key** من **Settings → API Keys**. يمكن استخدام `service_role` القديم للتوافق فقط.
   - **PostgreSQL connection string** من نافذة **Connect**. استخدم Direct connection أو Session pooler على المنفذ `5432` وتأكد من وجود `sslmode=require`. لا تستخدم Transaction pooler على المنفذ `6543` في الإعداد.
3. شغّل التطبيق واختر **أنا مالك متجر جديد**.
4. أدخل اسم المتجر وقيم Supabase واسم المالك وبريده وكلمة مرور قوية.
5. وافق على التحذير الأمني ثم اضغط **تهيئة المتجر**. لا تغلق التطبيق أثناء هذه المرحلة.
6. ينفذ التطبيق محليًا، وبترتيب آمن:
   - يتحقق أن العنوان والمفاتيح ورابط PostgreSQL تعود إلى مشروع Supabase نفسه.
   - يطبق migrations المضمّنة بالترتيب مع checksum وقفل يمنع تنفيذ إعدادين متزامنين.
   - يخزن Project URL ومفتاح الخادم مشفرين داخل **Supabase Vault** في مشروع المتجر.
   - ينشئ حساب المالك كمدير رئيسي محمي.
   - يتحقق من إصدار المخطط ثم يحفظ على الجهاز عنوان المشروع والمفتاح العام فقط.
7. بعد النجاح احفظ **رمز ربط المتجر**، ثم انتقل إلى تسجيل الدخول ببريد المالك وكلمة المرور التي اخترتها.

لا يُكتب Secret key أو PostgreSQL connection string في ملف إعدادات الجهاز أو السجلات. يبقيهما التطبيق في ذاكرة عملية Electron الموثوقة خلال طلب الإعداد فقط. يبقى مفتاح الخادم داخل Vault لأن عمليات إنشاء حسابات الموظفين وتفعيلها تحتاج إليه من داخل قاعدة البيانات.

### الخيار الثاني: الانضمام إلى متجر قائم

ينفذ المدير الخطوات التالية أولًا:

1. يسجل الدخول ثم يفتح **الإعدادات → المستخدمون → إضافة حساب**.
2. ينشئ حسابًا مستقلًا للموظف ويحدد دوره وصلاحياته.
3. يحفظ **رمز تفعيل المستخدم** الذي يظهر مرة واحدة وتنتهي صلاحيته بعد سبعة أيام.
4. يفتح **الإعدادات → اتصال المتجر** وينسخ **رمز ربط المتجر**.
5. يرسل الرمزين إلى الموظف عبر قناة موثوقة، ويفضل إرسالهما منفصلين.

ثم ينفذ الموظف:

1. يثبت النسخة نفسها ويختار **الانضمام إلى متجر** عند أول تشغيل.
2. يلصق رمز ربط المتجر. يتحقق التطبيق من مشروع Supabase وإصدار المخطط قبل حفظ الاتصال.
3. في شاشة الدخول يكتب الاسم أو البريد الذي أنشأه المدير.
4. يدخل رمز تفعيل المستخدم ويختار كلمة مروره الخاصة. لا يطلب التطبيق رمز التفعيل مرة أخرى بعد نجاح هذه الخطوة.

هناك رمزان مختلفان عمدًا:

| الرمز | المحتوى | الصلاحية | الغرض |
| --- | --- | --- | --- |
| رمز ربط المتجر | Project URL والمفتاح العام فقط | قابل لإعادة الاستخدام داخل المتجر | تعريف الجهاز بمشروع المتجر؛ لا يسجل المستخدم ولا يتجاوز RLS |
| رمز تفعيل المستخدم | قيمة عشوائية محفوظ hash لها في قاعدة البيانات | استخدام واحد، 7 أيام | إثبات أن المدير أنشأ حساب الموظف والسماح له بتعيين كلمة المرور |

لا يمكن توفير رمز متجر قصير قابل للاكتشاف دون تشغيل خدمة مركزية. لذلك رمز الربط أطول لكنه مستقل بالكامل ولا يستهلك أي بنية تحتية تابعة للمطور. المفتاح العام آمن للاستخدام في تطبيق سطح المكتب بحسب نموذج Supabase، بينما الحماية الفعلية للبيانات تفرضها المصادقة وPostgreSQL RLS.

### الإدارة والاستعادة والأعطال الشائعة

- يستطيع المدير إعادة نسخ رمز الربط أو فصل جهازه من **الإعدادات → اتصال المتجر**. الفصل يحذف الاتصال والجلسة من الجهاز فقط ولا يحذف مشروع Supabase.
- إذا ظهر `incompatible schema`، يجب على مالك المشروع تحديث مخطط قاعدة البيانات قبل أن يستطيع الموظفون ربط إصدار التطبيق الجديد.
- إذا تعذر اتصال PostgreSQL على شبكة IPv4، استخدم **Session pooler** على المنفذ `5432` بدل Direct connection. لا تستخدم المنفذ `6543` لتطبيق migrations.
- إذا فشل إنشاء المالك بعد إنشاء مستخدم Auth جزئيًا وتعذر تنظيفه آليًا، احذف ذلك المستخدم من **Authentication → Users** في Supabase ثم أعد المحاولة.
- لا ترسل Secret key أو `service_role` أو PostgreSQL connection string أو كلمة مرور المالك إلى الموظفين أو دعم غير موثوق.
- فعّل Supabase backups/PITR بحسب خطة المتجر، وأنشئ نسخة نظام من داخل التطبيق قبل الترقيات المهمة.
- للترقية من نسخة قديمة مرتبطة عبر `VITE_SUPABASE_*`، طبّق آخر migrations على المشروع أولًا. بعد ذلك يستطيع المدير نسخ رمز الربط من صفحة **اتصال المتجر** ثم استخدام النسخة العامة على بقية الأجهزة.

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

2. A generic release requires no `VITE_SUPABASE_*` values. For local development against an existing private project, copy `.env.example` to `.env.local` and optionally configure:

   ```env
   VITE_SUPABASE_URL=https://PROJECT_REF.supabase.co
   VITE_SUPABASE_ANON_KEY=your-public-anon-or-publishable-key
   SUPABASE_DB_URL=postgresql://postgres:ENCODED_PASSWORD@HOST:5432/postgres?sslmode=require
   ```

   Omit both `VITE_` values to exercise the packaged first-run connection flow. Only public URL/key values may use the `VITE_` prefix. Database passwords, secret/service-role keys, administrator passwords, and AI keys must never be bundled into a renderer build.

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
