# RBAC, user administration, and backups

## Deployment

Apply the Supabase migrations in order through `20260812004000`. The production
database used for this repository has already been migrated and its PostgREST
schema cache reloaded.

The user administration path no longer calls an Edge Function from the renderer.
The frontend calls the authenticated `admin_users_action`, `resolve_account`, and
`claim_account` database RPCs. The security-definer implementation calls the
Supabase Auth admin API from PostgreSQL and reads these server-only Vault secrets:

- `weapon_store_project_url`
- `weapon_store_service_role`

Never place the service-role key in a `VITE_` variable, the renderer, source
control, or an RPC response. Execution of the internal `auth_admin_request`
function is revoked from `anon` and `authenticated`.

## User lifecycle

- Only an active administrator can create an account.
- Name is required, case-insensitively unique, and immutable.
- Business email is optional and can be added, changed, or removed later.
- Role is `Admin` or `Employee`.
- A new account receives a one-time activation code valid for seven days.
- On first login, the user selects the permanent password. The temporary Auth
  password is random, server-only, and below the Auth bcrypt byte limit.
- Deletion bans the Auth identity and deactivates the application profile.
- The primary administrator is `ايمن علي`. This account cannot be deleted or
  demoted. Only this account can delete another administrator; other
  administrators may delete employees only.

The immutable internal `login_email` is separate from the editable business
email. Account resolution maps the current name or business email to that private
login value, so changing the business email does not break authentication.

## Authorization

RLS is authoritative. The React route guard and component capability checks are
defense in depth, not the security boundary.

- Administrators have unrestricted application access.
- Employees can never access statistics, financial reports, audit administration,
  or user management, even if those legacy JSON flags are forged.
- Currency view/edit/add/delete permissions are independent.
- Master data is readable by employees and writable by administrators only.
- `backups.system.create` lets an employee create and view full server-side
  backups. It never grants restore or delete access.

## Backup workflow

`app_backups` is the only catalog. The obsolete `backup_catalog` view and legacy
personal-backup RPCs are removed.

- A full backup serializes the configured public application tables and the Auth
  state for application users on the server. Payloads are never selectable by the
  renderer.
- Administrators can create, view, restore, and delete system backups.
- A permitted employee can create and view system backups only.
- Restore is administrator-only and atomic. Foreign-key constraints remain active.
- Immediately before a restore, the server creates an automatic safety backup of
  the current state.
- The UI requires acknowledgement of an Arabic/English warning before restore.
- Restore replaces application data and restores Auth password hashes, metadata,
  ban state, and deletion state. Application users absent from the selected
  snapshot are banned.

## Audit log

Row-level create, update, and delete operations record actor ID/name, action,
table, record ID, and before/after JSON. Private login values, activation hashes,
and backup payloads are redacted. Deletes store an empty `new_values` object to
match the established non-null audit schema.

## Verification

Before release, run:

```sh
npm run typecheck
npm test
npm run build
```

Also verify against the target Supabase project:

- `app_backups` is discoverable through PostgREST and the new RPCs are present.
- Admin creates accounts with and without email.
- First-login activation succeeds and rejects weak, expired, or incorrect input.
- Business email can be added and changed without changing the immutable name.
- A normal admin cannot delete an admin but can delete an employee.
- `ايمن علي` can delete other admins and cannot be deleted or demoted.
- A permitted employee can create a system backup but cannot restore or delete it.
- A real full restore succeeds and creates a valid automatic safety backup.
