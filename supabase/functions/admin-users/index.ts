import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.112.2"

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]
type Role = "Admin" | "Employee"

type UserPayload = {
  id: string
  name: string
  email?: string | null
  username?: string | null
  role: Role
  permissions?: Record<string, boolean>
}

type AdminRequest =
  | { action: "create"; user: UserPayload }
  | { action: "update"; user: UserPayload }
  | { action: "delete"; userId: string }
  | { action: "reset-activation"; userId: string }

class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code: string) {
    super(message)
  }
}

function env(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new HttpError(500, `${name} is not configured`, "missing_configuration")
  return value
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") ?? "*"
  const configured = (Deno.env.get("ALLOWED_ORIGINS") ?? "*").split(",").map((item) => item.trim())
  const allowOrigin = configured.includes("*") || configured.includes(origin) ? origin : configured[0]
  return {
    "Access-Control-Allow-Origin": allowOrigin || "*",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  }
}

function respond(request: Request, status: number, body: Record<string, Json>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json; charset=utf-8" },
  })
}

function normalizedEmail(value?: string | null): string | null {
  const email = value?.trim().toLowerCase() || null
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(422, "Email is invalid", "invalid_email")
  }
  return email
}

function payloadEmail(user: UserPayload): string | null {
  return normalizedEmail(Object.prototype.hasOwnProperty.call(user, "email") ? user.email : user.username)
}

function validateUser(user: UserPayload): void {
  if (!user?.id?.trim()) throw new HttpError(422, "User ID is required", "missing_user_id")
  const name = user.name?.trim().replace(/\s+/g, " ")
  if (!name || name.length > 120) throw new HttpError(422, "Name is required and must be at most 120 characters", "invalid_name")
  payloadEmail(user)
  if (user.role !== "Admin" && user.role !== "Employee") throw new HttpError(422, "Role must be Admin or Employee", "invalid_role")
  if (user.permissions && (typeof user.permissions !== "object" || Array.isArray(user.permissions))) {
    throw new HttpError(422, "Permissions must be an object", "invalid_permissions")
  }
}

function randomBootstrapPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(48))
  return `${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}Aa1!`
}

function activationCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function internalEmail(id: string): string {
  const safeId = id.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 32) || crypto.randomUUID().replaceAll("-", "")
  return `${safeId}.${crypto.randomUUID().slice(0, 8)}@local.weapon-store.invalid`
}

async function requireAdmin(adminClient: SupabaseClient, token: string) {
  const { data: authData, error: authError } = await adminClient.auth.getUser(token)
  if (authError || !authData.user) throw new HttpError(401, "The session is invalid or expired", "invalid_session")

  const { data: actor, error: actorError } = await adminClient
    .from("users")
    .select("id,name,role,is_active,is_primary_admin")
    .eq("auth_user_id", authData.user.id)
    .eq("is_active", true)
    .single()
  if (actorError || !actor) throw new HttpError(403, "The signed-in account is not linked to an active app user", "unlinked_user")
  if (actor.role !== "Admin") throw new HttpError(403, "Administrator role is required", "admin_required")
  return actor as { id: string; name: string; role: Role; is_active: boolean; is_primary_admin: boolean }
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID()
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) })
  if (request.method !== "POST") return respond(request, 405, { error: "Method not allowed", code: "method_not_allowed", requestId })

  try {
    const authorization = request.headers.get("authorization")
    if (!authorization?.startsWith("Bearer ")) throw new HttpError(401, "Authentication required", "missing_authorization")
    const token = authorization.slice("Bearer ".length)
    const url = env("SUPABASE_URL")
    const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY")
    const adminClient = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    // Database writes carry the administrator JWT so auth.uid(), RLS, and audit triggers
    // identify the real actor instead of the service role.
    const actorClient = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    })
    const actor = await requireAdmin(adminClient, token)

    let body: AdminRequest
    try {
      body = await request.json() as AdminRequest
    } catch {
      throw new HttpError(400, "Request body must be valid JSON", "invalid_json")
    }

    if (body.action === "create") {
      validateUser(body.user)
      const name = body.user.name.trim().replace(/\s+/g, " ")
      const email = payloadEmail(body.user)
      const loginEmail = email ?? internalEmail(body.user.id)
      const setupCode = activationCode()
      const setupCodeHash = await sha256(setupCode)
      const { data: created, error: authCreateError } = await adminClient.auth.admin.createUser({
        email: loginEmail,
        password: randomBootstrapPassword(),
        email_confirm: true,
        user_metadata: { app_user_id: body.user.id, display_name: name, requires_password_setup: true },
      })
      if (authCreateError || !created.user) {
        throw new HttpError(409, authCreateError?.message ?? "Auth user creation failed", "auth_create_failed")
      }

      const { error: insertError } = await actorClient.from("users").insert({
        id: body.user.id,
        auth_user_id: created.user.id,
        username: email ?? name,
        email,
        login_email: loginEmail,
        name,
        role: body.user.role,
        permissions: body.user.role === "Admin" ? {} : (body.user.permissions ?? {}),
        password_set: false,
        activation_token_hash: setupCodeHash,
        activation_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
        is_active: true,
      })
      if (insertError) {
        const { error: rollbackError } = await adminClient.auth.admin.deleteUser(created.user.id)
        console.error(JSON.stringify({ requestId, stage: "profile_insert", insertError, rollbackError }))
        throw new HttpError(insertError.code === "23505" ? 409 : 500, insertError.message, "profile_insert_failed")
      }
      return respond(request, 201, { success: true, userId: body.user.id, activationCode: setupCode, requestId })
    }

    if (body.action === "update") {
      validateUser(body.user)
      const { data: existing, error: existingError } = await adminClient.from("users")
        .select("id,name,email,role,is_active,is_primary_admin")
        .eq("id", body.user.id).single()
      if (existingError || !existing) throw new HttpError(404, "User not found", "user_not_found")
      if (body.user.name.trim().replace(/\s+/g, " ") !== existing.name) {
        throw new HttpError(409, "A user name cannot be changed", "immutable_name")
      }
      if (existing.id === actor.id && body.user.role !== "Admin") {
        throw new HttpError(409, "You cannot remove your own administrator role", "cannot_demote_self")
      }
      if (existing.is_primary_admin && body.user.role !== "Admin") {
        throw new HttpError(409, "The primary administrator cannot be demoted", "primary_admin_protected")
      }
      if (existing.role === "Admin" && body.user.role !== "Admin") {
        const { count } = await adminClient.from("users").select("id", { count: "exact", head: true }).eq("role", "Admin").eq("is_active", true)
        if ((count ?? 0) <= 1) throw new HttpError(409, "The last active administrator cannot be demoted", "last_admin")
      }
      const email = payloadEmail(body.user)
      const { error: updateError } = await actorClient.from("users").update({
        email,
        username: email ?? existing.name,
        role: body.user.role,
        permissions: body.user.role === "Admin" ? {} : (body.user.permissions ?? {}),
      }).eq("id", body.user.id)
      if (updateError) throw new HttpError(500, updateError.message, "profile_update_failed")
      return respond(request, 200, { success: true, userId: body.user.id, requestId })
    }

    if (body.action === "delete") {
      const { data: existing, error: existingError } = await adminClient.from("users")
        .select("id,auth_user_id,role,is_primary_admin")
        .eq("id", body.userId).single()
      if (existingError || !existing) throw new HttpError(404, "User not found", "user_not_found")
      if (existing.id === actor.id) throw new HttpError(409, "You cannot deactivate your own account", "cannot_delete_self")
      if (existing.is_primary_admin) throw new HttpError(409, "The primary administrator cannot be deleted", "primary_admin_protected")
      if (existing.role === "Admin") {
        if (!actor.is_primary_admin) {
          throw new HttpError(403, "Only the primary administrator can delete another administrator", "primary_admin_required")
        }
        const { count } = await adminClient.from("users").select("id", { count: "exact", head: true }).eq("role", "Admin").eq("is_active", true)
        if ((count ?? 0) <= 1) throw new HttpError(409, "The last active administrator cannot be deactivated", "last_admin")
      }
      const { error: deactivateError } = await actorClient.from("users").update({ is_active: false }).eq("id", existing.id)
      if (deactivateError) throw new HttpError(500, deactivateError.message, "profile_deactivate_failed")
      if (existing.auth_user_id) {
        const { error: banError } = await adminClient.auth.admin.updateUserById(existing.auth_user_id, { ban_duration: "876000h" })
        if (banError) {
          await actorClient.from("users").update({ is_active: true }).eq("id", existing.id)
          throw new HttpError(500, banError.message, "auth_deactivate_failed")
        }
      }
      return respond(request, 200, { success: true, userId: existing.id, requestId })
    }

    if (body.action === "reset-activation") {
      const setupCode = activationCode()
      const { data: existing, error: existingError } = await adminClient.from("users")
        .select("id,password_set,is_active").eq("id", body.userId).single()
      if (existingError || !existing) throw new HttpError(404, "User not found", "user_not_found")
      if (!existing.is_active) throw new HttpError(409, "A deactivated account cannot be activated", "inactive_user")
      if (existing.password_set) throw new HttpError(409, "This account has already completed password setup", "already_claimed")
      const { error: resetError } = await actorClient.from("users").update({
        activation_token_hash: await sha256(setupCode),
        activation_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
      }).eq("id", existing.id)
      if (resetError) throw new HttpError(500, resetError.message, "activation_reset_failed")
      return respond(request, 200, { success: true, userId: existing.id, activationCode: setupCode, requestId })
    }

    throw new HttpError(400, "Unsupported action", "invalid_action")
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    const code = error instanceof HttpError ? error.code : "unexpected_error"
    const message = error instanceof Error ? error.message : "Unexpected user administration failure"
    console.error(JSON.stringify({ requestId, code, message, stack: error instanceof Error ? error.stack : undefined }))
    return respond(request, status, { error: message, code, requestId })
  }
})
