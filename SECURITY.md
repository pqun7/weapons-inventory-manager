# Security policy

## Supported version

Security fixes are applied to the latest revision of the `main` branch. Packaged releases should be upgraded to the newest available version.

## Reporting a vulnerability

Do not open a public issue for a vulnerability or include secrets, customer records, serial numbers, database dumps, or exploit details in public discussions.

Use GitHub's **Security > Report a vulnerability** private reporting flow for this repository. Include the affected revision, impact, reproduction steps, and a minimal proof of concept with synthetic data. Maintainers should acknowledge a complete report within seven days and coordinate disclosure after a fix is available.

## Operator responsibilities

- Rotate any credential that may have been exposed and review Supabase Auth and audit history.
- Keep service-role keys, database URLs, AI keys, and administrator passwords outside renderer code and source control.
- Enable Supabase backups/PITR and test recovery.
- Review RLS after every schema change and restrict Edge Function origins.
- Treat imported documents and AI responses as untrusted input.
- Follow applicable incident-reporting, retention, licensing, transfer, and privacy obligations.
