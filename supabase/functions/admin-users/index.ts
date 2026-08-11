import { createClient } from "npm:@supabase/supabase-js@2.112.2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

type UserPayload = {
  id: string
  username: string
  name: string
  role: "Admin" | "Employee" | "Manager" | "Sales" | "Inventory" | "Accountant" | "Read-Only"
  permissions: Record<string, boolean>
  password_set?: boolean
}

type AdminRequest =
  | { action: "create"; user: UserPayload }
  | { action: "update"; user: UserPayload }
  | { action: "delete"; userId: string }

function jsonResponse(status: number, body: Record<string, Json>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`${name} is not configured for this Edge Function`)
  return value
}

function validateUser(value: UserPayload): void {
  if (!value.id?.trim() || !value.name?.trim()) throw new Error("User ID and name are required")
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.username)) throw new Error("Username must be a valid email address")
  if (!new Set(["Admin", "Employee", "Manager", "Sales", "Inventory", "Accountant", "Read-Only"]).has(value.role)) {
    throw new Error("Invalid application role")
  }
  if (typeof value.permissions !== "object" || Array.isArray(value.permissions)) throw new Error("Permissions must be an object")
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed" })

  try {
    const supabaseUrl = requiredEnvironment("SUPABASE_URL")
    const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY")
    const authorization = request.headers.get("Authorization")
    if (!authorization?.startsWith("Bearer ")) return jsonResponse(401, { error: "Authentication required" })

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const accessToken = authorization.slice("Bearer ".length)
    const { data: authData, error: authError } = await adminClient.auth.getUser(accessToken)
    if (authError || !authData.user) return jsonResponse(401, { error: "Invalid session" })

    const { data: actor, error: actorError } = await adminClient
      .from("users")
      .select("id,role,is_active")
      .eq("auth_user_id", authData.user.id)
      .eq("is_active", true)
      .single()
    if (actorError || actor?.role !== "Admin") return jsonResponse(403, { error: "Administrator role is required" })

    const body = await request.json() as AdminRequest
    if (body.action === "create") {
      validateUser(body.user)
      const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(body.user.username, {
        data: { app_user_id: body.user.id, display_name: body.user.name },
      })
      if (inviteError || !invited.user) throw new Error(inviteError?.message ?? "Failed to invite user")
      const { error: insertError } = await adminClient.from("users").insert({
        id: body.user.id,
        auth_user_id: invited.user.id,
        username: body.user.username.toLowerCase(),
        name: body.user.name.trim(),
        role: body.user.role,
        permissions: body.user.permissions,
        password_set: false,
        is_active: true,
      })
      if (insertError) {
        await adminClient.auth.admin.deleteUser(invited.user.id)
        throw new Error(insertError.message)
      }
      return jsonResponse(200, { success: true, userId: body.user.id })
    }

    if (body.action === "update") {
      validateUser(body.user)
      const { data: existing, error: existingError } = await adminClient
        .from("users")
        .select("id,auth_user_id,username,name")
        .eq("id", body.user.id)
        .single()
      if (existingError || !existing) throw new Error("User not found")
      if (existing.auth_user_id) {
        const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(existing.auth_user_id, {
          email: body.user.username.toLowerCase(),
          user_metadata: { app_user_id: body.user.id, display_name: body.user.name },
        })
        if (authUpdateError) throw new Error(authUpdateError.message)
      }
      const { error: updateError } = await adminClient.from("users").update({
        username: body.user.username.toLowerCase(),
        name: body.user.name.trim(),
        role: body.user.role,
        permissions: body.user.permissions,
      }).eq("id", body.user.id)
      if (updateError) {
        if (existing.auth_user_id) {
          await adminClient.auth.admin.updateUserById(existing.auth_user_id, {
            email: existing.username,
            user_metadata: { app_user_id: existing.id, display_name: existing.name },
          })
        }
        throw new Error(updateError.message)
      }
      return jsonResponse(200, { success: true, userId: body.user.id })
    }

    if (body.action === "delete") {
      const { data: existing, error: existingError } = await adminClient
        .from("users")
        .select("id,auth_user_id")
        .eq("id", body.userId)
        .single()
      if (existingError || !existing) throw new Error("User not found")
      if (existing.id === actor.id) throw new Error("An administrator cannot delete the active account")
      const { error: deactivateError } = await adminClient.from("users").update({ is_active: false }).eq("id", existing.id)
      if (deactivateError) throw new Error(deactivateError.message)
      if (existing.auth_user_id) {
        const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(existing.auth_user_id)
        if (authDeleteError) throw new Error(authDeleteError.message)
      }
      return jsonResponse(200, { success: true, userId: existing.id })
    }

    return jsonResponse(400, { error: "Invalid action" })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected user administration failure"
    return jsonResponse(400, { error: message })
  }
})
