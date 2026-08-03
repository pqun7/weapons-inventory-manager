import { createClient } from "npm:@supabase/supabase-js@2.45.0"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
}

const API_URL = "https://open.er-api.com/v1/latest/USD"

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: "Missing Supabase configuration" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    })

    // Get all currencies set to automatic mode
    const { data: overrides, error: overrideError } = await supabase
      .from("exchange_rate_overrides")
      .select("currency_code, mode")
      .eq("mode", "automatic")

    if (overrideError) throw overrideError

    const autoCurrencies = (overrides ?? []).map((o) => o.currency_code)

    if (autoCurrencies.length === 0) {
      return new Response(
        JSON.stringify({ synced: 0, failed: 0, errors: [], message: "No currencies set to automatic mode" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Fetch rates from the API
    const apiResponse = await fetch(API_URL, {
      headers: { "Accept": "application/json" },
    })

    if (!apiResponse.ok) {
      // Fall back to last cached rates — don't block business operations
      const errors: string[] = [`API returned HTTP ${apiResponse.status}`]
      let failed = 0

      for (const code of autoCurrencies) {
        const { data: currency } = await supabase
          .from("currencies")
          .select("last_known_rate")
          .eq("iso_code", code)
          .single()

        if (currency?.last_known_rate) {
          failed++
        }
      }

      return new Response(
        JSON.stringify({
          synced: 0,
          failed,
          errors,
          message: "API unavailable — using last cached rates",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const apiData = await apiResponse.json()
    const rates: Record<string, number> = apiData.rates ?? {}

    let synced = 0
    let failed = 0
    const errors: string[] = []

    const now = new Date().toISOString()

    for (const code of autoCurrencies) {
      const rate = rates[code]
      if (rate == null || isNaN(rate) || rate <= 0) {
        failed++
        errors.push(`No rate available for ${code}`)
        continue
      }

      // Update currency's last known rate
      const { error: updateError } = await supabase
        .from("currencies")
        .update({
          last_known_rate: rate,
          last_rate_updated_at: now,
        })
        .eq("iso_code", code)

      if (updateError) {
        failed++
        errors.push(`Failed to update ${code}: ${updateError.message}`)
        continue
      }

      // Record in immutable history
      const { error: historyError } = await supabase
        .from("exchange_rate_history")
        .insert({
          currency_code: code,
          rate,
          source: "api",
        })

      if (historyError) {
        errors.push(`Failed to record history for ${code}: ${historyError.message}`)
      }

      synced++
    }

    return new Response(
      JSON.stringify({ synced, failed, errors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
        synced: 0,
        failed: 0,
        errors: [err instanceof Error ? err.message : "Unknown error"],
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
