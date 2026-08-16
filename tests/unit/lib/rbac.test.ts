import { describe, expect, it } from "vitest"
import { canAccessPage, hasPermission, permissionsForRole } from "@/lib/rbac"
import type { User } from "@/lib/types"

function employee(overrides: Partial<User["permissions"]> = {}): User {
  return {
    id: "U-EMP", username: "employee", name: "Employee", role: "Employee",
    permissions: permissionsForRole("Employee", overrides), passwordSet: true, passwordHash: "",
  }
}

describe("RBAC boundaries", () => {
  it("never delegates financial reports or user management to employees", () => {
    const user = employee({ canViewReports: true, canManageUsers: true })
    expect(user.permissions.canViewReports).toBe(false)
    expect(user.permissions.canManageUsers).toBe(false)
    expect(canAccessPage(user, "dashboard")).toBe(false)
    expect(canAccessPage(user, "financials")).toBe(false)
    expect(canAccessPage(user, "audit")).toBe(false)
  })

  it("supports independent currency capabilities", () => {
    const viewer = employee({ "currencies.view": true })
    expect(hasPermission(viewer, "currencies.view")).toBe(true)
    expect(hasPermission(viewer, "currencies.edit")).toBe(false)
    expect(hasPermission(viewer, "currencies.delete")).toBe(false)
  })

  it("delegates backup creation without granting administrative access", () => {
    const backupOperator = employee({ "backups.system.create": true })
    expect(hasPermission(backupOperator, "backups.system.create")).toBe(true)
    expect(backupOperator.role).toBe("Employee")
    expect(canAccessPage(backupOperator, "financials")).toBe(false)
    expect(backupOperator.permissions.canManageUsers).toBe(false)
  })

  it("gives administrators unrestricted page and capability access", () => {
    const admin = { ...employee(), role: "Admin" as const }
    expect(canAccessPage(admin, "financials")).toBe(true)
    expect(hasPermission(admin, "currencies.delete")).toBe(true)
  })
})
