import { useState, type FormEvent } from "react"
import { LockKeyhole, WifiOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type AuthScreenProps = {
  error: string | null
  onSignIn: (email: string, password: string) => Promise<void>
}

export function AuthScreen({ error, onSignIn }: AuthScreenProps) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    try {
      await onSignIn(email, password)
    } catch {
      // The auth hook exposes a user-safe error message in the form.
    } finally {
      setSubmitting(false)
    }
  }

  const networkError = error ? /fetch|network|offline|connection/i.test(error) : false
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4" dir="auto">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <LockKeyhole className="size-5" />
          </div>
          <CardTitle>Weapon Store</CardTitle>
          <CardDescription>Sign in with the Supabase account assigned by your administrator.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={submit}>
            <div className="grid gap-1.5">
              <Label htmlFor="auth-email">Email</Label>
              <Input id="auth-email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="auth-password">Password</Label>
              <Input id="auth-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                {networkError && <WifiOff className="mt-0.5 size-3.5 shrink-0" />}
                <span>{networkError ? "Cannot reach Supabase. Check your internet connection and try again." : error}</span>
              </div>
            )}
            <Button type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
