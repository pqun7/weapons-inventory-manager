export function userFacingError(error: unknown, fallback: string): string {
  const technical = error instanceof Error ? error.message : String(error ?? "")
  const message = technical.toLocaleLowerCase()
  if (message.includes("duplicate") || message.includes("unique constraint")) return "This record already exists."
  if (message.includes("permission") || message.includes("42501") || message.includes("not authorized")) return "You do not have permission to perform this action."
  if (message.includes("network") || message.includes("fetch") || message.includes("offline")) return "Unable to connect. Check your internet connection and try again."
  if (message.includes("below") && message.includes("cost")) return "The selling price cannot be below the final cost."
  if (message.includes("active invoices")) return "This customer cannot be deleted while active invoices exist."
  return fallback
}
