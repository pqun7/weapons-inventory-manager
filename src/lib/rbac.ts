import type { User, UserPermissions, UserRole } from "./types.js"
import type { PageKey } from "./nav-types.js"

export type PermissionKey = keyof UserPermissions

export const EMPLOYEE_DEFAULT_PERMISSIONS: UserPermissions = {
  canImportExcel: false,
  canExportData: false,
  canViewReports: false,
  canManageUsers: false,
  canRegisterPayments: false,
  canVoidInvoices: false,
  canExtendDueDates: false,
  canDeleteRecords: false,
  "inventory.view": true,
  "inventory.edit": false,
  "sales.create": true,
  "customers.manage": false,
  "suppliers.manage": false,
  "currencies.view": false,
  "currencies.edit": false,
  "currencies.add": false,
  "currencies.delete": false,
  "backups.view": true,
  "backups.personal.create": true,
  "backups.personal.restore": true,
  "backups.system.create": false,
}

export const ADMIN_PERMISSIONS: UserPermissions = new Proxy({ ...EMPLOYEE_DEFAULT_PERMISSIONS }, {
  get: () => true,
}) as UserPermissions

export const EDITABLE_EMPLOYEE_PERMISSIONS: ReadonlyArray<{ key: PermissionKey; label: string }> = [
  { key: "inventory.view", label: "View inventory" },
  { key: "inventory.edit", label: "Edit inventory" },
  { key: "sales.create", label: "Create sales" },
  { key: "customers.manage", label: "Manage customers" },
  { key: "suppliers.manage", label: "Manage suppliers" },
  { key: "shipment.import", label: "Import shipments" },
  { key: "shipment.review", label: "Review shipments" },
  { key: "shipment.edit", label: "Edit shipments" },
  { key: "shipment.receive", label: "Receive shipments" },
  { key: "currencies.view", label: "View currencies" },
  { key: "currencies.edit", label: "Edit currencies and rates" },
  { key: "currencies.add", label: "Add currencies" },
  { key: "currencies.delete", label: "Delete currencies" },
  { key: "backups.system.create", label: "Create full system backups (no restore)" },
]

const ADMIN_ONLY_PAGES = new Set<PageKey>(["dashboard", "financials", "audit"])

export function isAdmin(user: Pick<User, "role"> | null | undefined): boolean {
  return user?.role === "Admin"
}

export function hasPermission(
  user: Pick<User, "role" | "permissions"> | null | undefined,
  permission: PermissionKey,
): boolean {
  return user?.role === "Admin" || user?.permissions?.[permission] === true
}

export function canAccessPage(user: Pick<User, "role" | "permissions">, page: PageKey): boolean {
  if (user.role === "Admin") return true
  if (ADMIN_ONLY_PAGES.has(page)) return false
  if (page === "inventory") return hasPermission(user, "inventory.view")
  if (page === "sales") return hasPermission(user, "sales.create")
  if (page === "shipments") return hasPermission(user, "shipment.review") || hasPermission(user, "shipment.import")
  return true
}

export function permissionsForRole(role: UserRole, permissions?: Partial<UserPermissions>): UserPermissions {
  if (role === "Admin") return ADMIN_PERMISSIONS
  return { ...EMPLOYEE_DEFAULT_PERMISSIONS, ...permissions, canViewReports: false, canManageUsers: false }
}
