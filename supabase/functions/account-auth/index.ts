import { createClient } from "npm:@supabase/supabase-js@2.112.2"

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]
type RequestBody =
  | { action: "resolve"; identifier: string }
  | { action: "claim"; identifier: string; activationCode: string; password: string }

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
}

function response(status: number, body: Record<string, Json>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } })
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID()
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors })
  if (request.method !== "POST") return response(405, { error: "Method not allowed", requestId })

  try {
    const body = await request.json() as RequestBody
    const identifier = body.identifier?.trim().replace(/\s+/g, " ")
    if (!identifier || identifier.length > 254) return response(422, { error: "Name or email is required", requestId })

    const client = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
    const [identifierHash, ipHash] = await Promise.all([sha256(identifier.toLocaleLowerCase()), sha256(ip)])
    const cutoff = new Date(Date.now() - 15 * 60_000).toISOString()
    const { count } = await client.from("account_auth_attempts")
      .select("id", { count: "exact", head: true })
      .eq("identifier_hash", identifierHash).eq("ip_hash", ipHash).gte("attempted_at", cutoff)
    if ((count ?? 0) >= 10) return response(429, { error: "Too many attempts. Try again in 15 minutes.", code: "rate_limited", requestId })
    await client.from("account_auth_attempts").insert({ identifier_hash: identifierHash, ip_hash: ipHash })

    const isEmail = identifier.includes("@")
    let query = client.from("users").select("id,name,email,login_email,auth_user_id,password_set,is_active,activation_token_hash,activation_expires_at").eq("is_active", true)
    query = isEmail ? query.ilike("email", identifier) : query.ilike("name", identifier)
    const { data: account, error: findError } = await query.maybeSingle()
    if (findError) throw findError
    if (!account) return response(404, { error: "Account not found", code: "account_not_found", requestId })

    if (body.action === "resolve") {
      return response(200, {
        success: true,
        passwordSet: account.password_set,
        loginEmail: account.login_email,
        displayName: account.name,
        requestId,
      })
    }

    if (body.action !== "claim") return response(400, { error: "Unsupported action", requestId })
    if (account.password_set) return response(409, { error: "Password setup has already been completed", code: "already_claimed", requestId })
    if (!account.activation_token_hash || !account.activation_expires_at || Date.parse(account.activation_expires_at) < Date.now()) {
      return response(403, { error: "The activation code is missing or expired. Ask an administrator for a new code.", code: "activation_expired", requestId })
    }
    if (await sha256(body.activationCode?.trim().toUpperCase() ?? "") !== account.activation_token_hash) {
      return response(403, { error: "Activation code is incorrect", code: "invalid_activation_code", requestId })
    }
    if (body.password.length < 8 || !/[a-z]/.test(body.password) || !/[A-Z]/.test(body.password) || !/\d/.test(body.password)) {
      return response(422, { error: "Use at least 8 characters with upper-case, lower-case, and a number", code: "weak_password", requestId })
    }

    // Reserve the one-time claim before touching Auth. Only one concurrent request wins.
    const { data: reserved, error: reserveError } = await client.from("users")
      .update({ password_set: true, activation_token_hash: null, activation_expires_at: null }).eq("id", account.id).eq("password_set", false).select("id").maybeSingle()
    if (reserveError) throw reserveError
    if (!reserved) return response(409, { error: "Password setup has already been completed", code: "already_claimed", requestId })

    const { error: passwordError } = await client.auth.admin.updateUserById(account.auth_user_id, {
      password: body.password,
      user_metadata: { app_user_id: account.id, display_name: account.name, requires_password_setup: false },
    })
    if (passwordError) {
      await client.from("users").update({ password_set: false, activation_token_hash: account.activation_token_hash, activation_expires_at: account.activation_expires_at }).eq("id", account.id)
      throw passwordError
    }

    await client.from("audit_logs").insert({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      date: new Date().toISOString().slice(0, 10),
      user_id: account.id,
      user_name: account.name,
      action_type: "Update",
      event_action: "PASSWORD_SETUP",
      description: `${account.name} completed first-login password setup`,
      metadata: { account_id: account.id },
      table_name: "users",
      record_id: account.id,
    })
    return response(200, { success: true, loginEmail: account.login_email, requestId })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Account authentication failed"
    console.error(JSON.stringify({ requestId, message, stack: error instanceof Error ? error.stack : undefined }))
    return response(500, { error: message, code: "account_auth_failed", requestId })
  }
})
