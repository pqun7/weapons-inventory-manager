import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto"
import { getDb } from "../database.js"
import type {
  ApprovedPasswordRecoveryRequest,
  LocalSession,
  PasswordRecoveryCompleteInput,
  PasswordRecoveryRequestResult,
  PendingPasswordRecoveryRequest,
} from "../../src/lib/database-provider.js"
import { requireLocalSession, resetLocalPasswordWithRecovery } from "./local-auth-service.js"
import { sendAdministratorRecoveryEmail } from "./smtp-service.js"

const CODE_LIFETIME_MS = 15 * 60 * 1_000
const MIN_REQUEST_INTERVAL_MS = 2 * 60 * 1_000
const MAX_REQUESTS_PER_HOUR = 5

interface RecoveryUser {
  id: string
  username: string
  name: string
  email: string | null
  login_email: string | null
  role: "Admin" | "Employee"
}

function normalizedIdentifier(value: string): string {
  const identifier = value.trim().toLowerCase()
  if (!identifier || identifier.length > 160) throw new Error("Enter a valid account identifier")
  return identifier
}

function userFor(identifier: string): RecoveryUser | undefined {
  return getDb().prepare(`SELECT id,username,name,email,login_email,role FROM users WHERE is_active=1 AND
    (username=? COLLATE NOCASE OR email=? COLLATE NOCASE OR login_email=? COLLATE NOCASE) LIMIT 1`)
    .get(identifier, identifier, identifier) as RecoveryUser | undefined
}

function recoveryCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0")
}

function codeHash(requestId: string, code: string): Buffer {
  return createHash("sha256").update(`${requestId}:${code.trim().toUpperCase()}`, "utf8").digest()
}

function destinationHint(email: string): string {
  const [local, domain] = email.split("@")
  return `${local.slice(0, 2)}${"*".repeat(Math.max(2, local.length - 2))}@${domain}`
}

function enforceRateLimit(userId: string): void {
  const rows = getDb().prepare(`SELECT requested_at FROM password_recovery_requests
    WHERE user_id=? AND requested_at>=? ORDER BY requested_at DESC`).all(userId, new Date(Date.now() - 60 * 60 * 1_000).toISOString()) as Array<{ requested_at: string }>
  if (rows.length >= MAX_REQUESTS_PER_HOUR) throw new Error("Too many recovery requests. Try again later")
  if (rows[0] && Date.now() - Date.parse(rows[0].requested_at) < MIN_REQUEST_INTERVAL_MS) {
    throw new Error("Wait two minutes before requesting another code")
  }
}

export async function requestLocalPasswordRecovery(rawIdentifier: string): Promise<PasswordRecoveryRequestResult> {
  const identifier = normalizedIdentifier(rawIdentifier)
  const user = userFor(identifier)
  if (!user) throw new Error("If the account exists, recovery instructions will be available")
  enforceRateLimit(user.id)
  const requestId = randomUUID()
  if (user.role === "Employee") {
    getDb().transaction(() => {
      getDb().prepare(`INSERT INTO password_recovery_requests(id,user_id,account_role,status,requested_at)
        VALUES(?,?,'Employee','pending',?)`).run(requestId, user.id, new Date().toISOString())
      const admins = getDb().prepare("SELECT id FROM users WHERE role='Admin' AND is_active=1").all() as Array<{ id: string }>
      const insert = getDb().prepare(`INSERT INTO app_notifications(id,type,title,message,date,is_read,entity_id,user_id)
        VALUES(?,'System',?,?,?,0,?,?)`)
      for (const admin of admins) insert.run(`N-${randomUUID()}`, "Password recovery approval", `${user.name} requested a password reset. Review it in Settings → Users.`, new Date().toISOString(), requestId, admin.id)
    })()
    return { requestId, channel: "admin_approval" }
  }

  const recipient = user.email?.trim().toLowerCase()
  if (!recipient) throw new Error("The administrator account does not have a recovery email. Configure it in Settings first")
  const code = recoveryCode()
  const expiresAt = new Date(Date.now() + CODE_LIFETIME_MS).toISOString()
  getDb().prepare(`INSERT INTO password_recovery_requests(id,user_id,account_role,status,code_hash,requested_at,expires_at)
    VALUES(?,?,'Admin','approved',?,?,?)`).run(requestId, user.id, codeHash(requestId, code).toString("hex"), new Date().toISOString(), expiresAt)
  try {
    await sendAdministratorRecoveryEmail(recipient, code)
  } catch (error) {
    getDb().prepare("UPDATE password_recovery_requests SET status='cancelled' WHERE id=?").run(requestId)
    throw error
  }
  return { requestId, channel: "email", destinationHint: destinationHint(recipient) }
}

export function listPendingLocalPasswordRecoveries(): PendingPasswordRecoveryRequest[] {
  const actor = requireLocalSession()
  if (actor.role !== "Admin") throw new Error("Administrator role is required")
  return getDb().prepare(`SELECT r.id, r.user_id AS userId, u.name AS userName, r.requested_at AS requestedAt
    FROM password_recovery_requests r JOIN users u ON u.id=r.user_id
    WHERE r.status='pending' ORDER BY r.requested_at`).all() as unknown as PendingPasswordRecoveryRequest[]
}

export function approveLocalPasswordRecovery(requestId: string): ApprovedPasswordRecoveryRequest {
  const actor = requireLocalSession()
  if (actor.role !== "Admin") throw new Error("Administrator role is required")
  const request = getDb().prepare(`SELECT r.id,r.user_id,u.name FROM password_recovery_requests r JOIN users u ON u.id=r.user_id
    WHERE r.id=? AND r.status='pending' AND r.account_role='Employee'`).get(requestId) as { id: string; user_id: string; name: string } | undefined
  if (!request) throw new Error("Pending recovery request was not found")
  const code = recoveryCode()
  const expiresAt = new Date(Date.now() + CODE_LIFETIME_MS).toISOString()
  getDb().prepare(`UPDATE password_recovery_requests SET status='approved',code_hash=?,expires_at=?,approved_by=?,approved_at=? WHERE id=?`)
    .run(codeHash(requestId, code).toString("hex"), expiresAt, actor.userId, new Date().toISOString(), requestId)
  return { requestId, userId: request.user_id, userName: request.name, code, expiresAt }
}

export function completeLocalPasswordRecovery(input: PasswordRecoveryCompleteInput): LocalSession {
  normalizedIdentifier(input.identifier)
  const request = getDb().prepare(`SELECT r.id,r.user_id,r.code_hash,r.expires_at,r.attempts,u.username,u.email,u.login_email
    FROM password_recovery_requests r JOIN users u ON u.id=r.user_id
    WHERE r.id=? AND r.status='approved'`).get(input.requestId) as { id: string; user_id: string; code_hash: string; expires_at: string; attempts: number; username: string; email: string | null; login_email: string | null } | undefined
  if (!request || ![request.username, request.email, request.login_email].filter(Boolean).some((value) => value!.toLowerCase() === input.identifier.trim().toLowerCase())) {
    throw new Error("Recovery request is invalid or expired")
  }
  if (Date.parse(request.expires_at) <= Date.now() || request.attempts >= 5) throw new Error("Recovery code is invalid or expired")
  const actual = codeHash(request.id, input.code)
  const expected = Buffer.from(request.code_hash, "hex")
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    getDb().prepare("UPDATE password_recovery_requests SET attempts=attempts+1 WHERE id=?").run(request.id)
    throw new Error("Recovery code is invalid or expired")
  }
  return getDb().transaction(() => {
    const session = resetLocalPasswordWithRecovery(request.user_id, input.password)
    const completed = getDb().prepare(`UPDATE password_recovery_requests
      SET status='completed',completed_at=?,code_hash=NULL WHERE id=? AND status='approved'`)
      .run(new Date().toISOString(), request.id)
    if (Number(completed.changes) !== 1) throw new Error("Recovery request is invalid or expired")
    return session
  })()
}
