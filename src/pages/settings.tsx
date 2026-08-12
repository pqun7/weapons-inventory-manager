import { useEffect, useMemo, useState, type FormEvent } from "react"
import { AlertTriangle, Coins, Database, KeyRound, Layers, Lock, Plus, RotateCcw, Shield, Trash2, UserRound, Users } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PasswordInput } from "@/components/ui/password-input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CurrencyManagementPanel } from "@/components/currency-management-panel"
import { MasterDataPanel } from "@/components/master-data-panel"
import { getSupabaseClient } from "@/lib/supabase/client"
import * as db from "@/lib/db"
import { useStore } from "@/lib/store"
import type { User, UserPermissions, UserRole } from "@/lib/types"
import { EDITABLE_EMPLOYEE_PERMISSIONS, EMPLOYEE_DEFAULT_PERMISSIONS, hasPermission, isAdmin, permissionsForRole } from "@/lib/rbac"

const EMPTY_NEW_USER = { name: "", email: "", role: "Employee" as UserRole }

export function SettingsPage() {
  const store = useStore()
  const currentUser = store.getCurrentUser()
  const admin = isAdmin(currentUser)
  const canViewCurrencies = admin || hasPermission(currentUser, "currencies.view")
  const [addOpen, setAddOpen] = useState(false)
  const [newUser, setNewUser] = useState(EMPTY_NEW_USER)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [createdActivationCode, setCreatedActivationCode] = useState("")

  const tabs = useMemo(() => [
    { value: "general", label: "General", icon: UserRound, visible: true },
    { value: "currencies", label: "Currencies", icon: Coins, visible: canViewCurrencies },
    { value: "master", label: "Master Data", icon: Layers, visible: true },
    { value: "users", label: "Users", icon: Users, visible: admin },
    { value: "backup", label: "Backup / Data", icon: Database, visible: true },
  ].filter((tab) => tab.visible), [admin, canViewCurrencies])

  const createUser = async (event: FormEvent) => {
    event.preventDefault()
    const name = newUser.name.trim().replace(/\s+/g, " ")
    const email = newUser.email.trim().toLowerCase()
    if (!name) return toast.error("Name is required")
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast.error("Enter a valid email or leave it blank")
    const result = await store.addUser({
      name,
      email: email || undefined,
      username: email || name,
      role: newUser.role,
      permissions: permissionsForRole(newUser.role),
    })
    if (!result.success) return toast.error(result.error ?? "Could not create user")
    setCreatedActivationCode(result.activationCode ?? "")
    setNewUser(EMPTY_NEW_USER)
    setAddOpen(false)
    toast.success("Account created. The user will choose a password on first login.")
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Account, access control, reference data, and backups.</p>
      </div>

      <Tabs defaultValue="general" className="space-y-4">
        <TabsList className="h-auto flex-wrap justify-start">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5 text-xs">
              <tab.icon className="size-3.5" />{tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="general"><GeneralSettings user={currentUser} /></TabsContent>
        {canViewCurrencies && <TabsContent value="currencies"><CurrencyManagementPanel /></TabsContent>}
        <TabsContent value="master"><MasterDataPanel readOnly={!admin} /></TabsContent>
        {admin && (
          <TabsContent value="users">
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base"><Shield className="size-4" />Users & RBAC</CardTitle>
                  <CardDescription>Only administrators can create accounts or edit employee capabilities.</CardDescription>
                </div>
                <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="size-4" />Add account</Button>
              </CardHeader>
              <CardContent>
                <div className="overflow-hidden rounded-md border">
                  <Table>
                    <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Password</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {store.users.map((user) => (
                        <TableRow key={user.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedUser(user)}>
                          <TableCell className="font-medium">{user.name}{user.isPrimaryAdmin && <Badge variant="outline" className="ms-2">Primary admin</Badge>}</TableCell>
                          <TableCell>{user.email ?? <span className="text-muted-foreground">Name login only</span>}</TableCell>
                          <TableCell><Badge variant={user.role === "Admin" ? "default" : "secondary"}>{user.role}</Badge></TableCell>
                          <TableCell><Badge variant={user.passwordSet ? "secondary" : "outline"}>{user.passwordSet ? "Set" : "Pending first login"}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
        <TabsContent value="backup"><BackupSettings user={currentUser} /></TabsContent>
      </Tabs>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={createUser} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Create account</DialogTitle>
              <DialogDescription>The administrator does not set a password. The user creates it at first login.</DialogDescription>
            </DialogHeader>
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-center text-sm font-semibold text-amber-800 dark:text-amber-300" dir="rtl">
              الاسم لا يمكن تغييره لاحقاً
            </div>
            <div className="grid gap-1.5"><Label htmlFor="new-user-name">Name *</Label><Input id="new-user-name" required maxLength={120} value={newUser.name} onChange={(e) => setNewUser((value) => ({ ...value, name: e.target.value }))} /></div>
            <div className="grid gap-1.5"><Label htmlFor="new-user-email">Email (optional)</Label><Input id="new-user-email" type="email" value={newUser.email} onChange={(e) => setNewUser((value) => ({ ...value, email: e.target.value }))} /></div>
            <div className="grid gap-1.5">
              <Label>Role</Label>
              <Select value={newUser.role} onValueChange={(role) => setNewUser((value) => ({ ...value, role: role as UserRole }))}>
                <SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Employee">Employee</SelectItem><SelectItem value="Admin">Admin</SelectItem></SelectContent>
              </Select>
            </div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button><Button type="submit">Create account</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <UserPermissionsDialog user={selectedUser} actor={currentUser} onActivationCode={setCreatedActivationCode} onClose={() => setSelectedUser(null)} />
      <Dialog open={Boolean(createdActivationCode)} onOpenChange={(open) => { if (!open) setCreatedActivationCode("") }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>One-time activation code</DialogTitle><DialogDescription>Give this code to the new user through a trusted channel. It expires in 7 days and is shown only once.</DialogDescription></DialogHeader>
          <div className="select-all rounded-md border bg-muted p-4 text-center font-mono text-2xl font-bold tracking-widest">{createdActivationCode}</div>
          <DialogFooter><Button onClick={() => setCreatedActivationCode("")}>I saved the code</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function GeneralSettings({ user }: { user: User }) {
  const refreshFromDb = useStore((state) => state.refreshFromDb)
  const [email, setEmail] = useState(user.email ?? "")
  const [emailSaving, setEmailSaving] = useState(false)
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => setEmail(user.email ?? ""), [user.email])

  const changePassword = async (event: FormEvent) => {
    event.preventDefault()
    if (password !== confirmation) return toast.error("Passwords do not match")
    if (password.length < 8 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) return toast.error("Use at least 8 characters with upper-case, lower-case, and a number")
    setSaving(true)
    const { error } = await getSupabaseClient().auth.updateUser({ password })
    setSaving(false)
    if (error) return toast.error(error.message)
    setPassword(""); setConfirmation("")
    toast.success("Password changed")
  }

  const saveEmail = async (event: FormEvent) => {
    event.preventDefault()
    const normalized = email.trim().toLowerCase()
    if (normalized && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return toast.error("Enter a valid email or leave it empty")
    setEmailSaving(true)
    try {
      await db.dbUpdateOwnEmail(normalized || null)
      await refreshFromDb()
      toast.success(normalized ? "Email updated" : "Email removed")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update email")
    } finally {
      setEmailSaving(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><UserRound className="size-4" />Account information</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5"><Label>Name</Label><Input value={user.name} readOnly aria-readonly="true" className="bg-muted" /><p className="flex items-center gap-1 text-xs text-muted-foreground"><Lock className="size-3" />Name cannot be changed after account creation.</p></div>
          <form className="grid gap-1.5" onSubmit={saveEmail}><Label htmlFor="account-email">Email (optional)</Label><div className="flex gap-2"><Input id="account-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /><Button type="submit" variant="outline" disabled={emailSaving}>{emailSaving ? "Saving…" : "Save email"}</Button></div><p className="text-xs text-muted-foreground">You can add, change, or remove your email at any time.</p></form>
          <div className="grid gap-1.5"><Label>Role</Label><Input value={user.role} readOnly className="bg-muted" /></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><KeyRound className="size-4" />Change password</CardTitle><CardDescription>Changing your password signs future sessions in with the new value.</CardDescription></CardHeader>
        <CardContent><form className="grid gap-3" onSubmit={changePassword}><div className="grid gap-1.5"><Label>New password</Label><PasswordInput autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div><div className="grid gap-1.5"><Label>Confirm password</Label><PasswordInput autoComplete="new-password" required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></div><Button disabled={saving}>{saving ? "Saving…" : "Change password"}</Button></form></CardContent>
      </Card>
    </div>
  )
}

function UserPermissionsDialog({ user, actor, onActivationCode, onClose }: { user: User | null; actor: User; onActivationCode: (code: string) => void; onClose: () => void }) {
  const updateUser = useStore((state) => state.updateUser)
  const deleteUser = useStore((state) => state.deleteUser)
  const resetUserActivation = useStore((state) => state.resetUserActivation)
  const [role, setRole] = useState<UserRole>("Employee")
  const [permissions, setPermissions] = useState<UserPermissions>(EMPLOYEE_DEFAULT_PERMISSIONS)
  const [email, setEmail] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!user) return
    setRole(user.role)
    setEmail(user.email ?? "")
    setPermissions(permissionsForRole(user.role, user.permissions))
  }, [user])

  const save = async () => {
    if (!user) return
    const normalizedEmail = email.trim().toLowerCase()
    if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return toast.error("Enter a valid email or leave it empty")
    setSaving(true)
    const result = await updateUser(user.id, { email: normalizedEmail || undefined, role, permissions: permissionsForRole(role, permissions) })
    setSaving(false)
    if (!result.success) return toast.error(result.error ?? "Could not update user")
    toast.success("User access updated")
    onClose()
  }

  const deactivate = async () => {
    if (!user || user.id === actor.id) return
    const result = await deleteUser(user.id)
    if (!result.success) return toast.error(result.error ?? "Could not deactivate user")
    toast.success("User deleted")
    onClose()
  }

  const resetActivation = async () => {
    if (!user) return
    const result = await resetUserActivation(user.id)
    if (!result.success || !result.activationCode) return toast.error(result.error ?? "Could not create a new activation code")
    onClose()
    onActivationCode(result.activationCode)
  }

  return (
    <Dialog open={Boolean(user)} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>{user?.name}</DialogTitle><DialogDescription>The name is permanent. Role and employee permissions can be changed at any time.</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5"><Label>Email (optional)</Label><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /></div>
          <div className="grid gap-1.5"><Label>Role</Label><Select value={role} onValueChange={(value) => setRole(value as UserRole)} disabled={user?.id === actor.id || user?.isPrimaryAdmin}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Employee">Employee</SelectItem><SelectItem value="Admin">Admin</SelectItem></SelectContent></Select></div>
          {role === "Employee" && <div className="grid gap-2 rounded-md border p-3">{EDITABLE_EMPLOYEE_PERMISSIONS.map(({ key, label }) => <div key={key} className="flex items-center justify-between gap-4"><Label htmlFor={`permission-${key}`} className="font-normal">{label}</Label><Switch id={`permission-${key}`} checked={permissions[key] === true} onCheckedChange={(checked) => setPermissions((value) => ({ ...value, [key]: checked }))} /></div>)}</div>}
        </div>
        <DialogFooter className="sm:justify-between"><div className="flex gap-2"><Button variant="destructive" onClick={deactivate} disabled={!user || user.id === actor.id || user.isPrimaryAdmin || (user.role === "Admin" && !actor.isPrimaryAdmin)}><Trash2 className="size-4" />Delete user</Button>{user && !user.passwordSet && <Button variant="outline" onClick={resetActivation}>New activation code</Button>}</div><div className="flex gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save access"}</Button></div></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BackupSettings({ user }: { user: User }) {
  const [backups, setBackups] = useState<db.BackupRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<db.BackupRecord | null>(null)
  const [warningAccepted, setWarningAccepted] = useState(false)
  const admin = isAdmin(user)
  const canCreateSystem = admin || hasPermission(user, "backups.system.create")

  const refresh = async () => {
    setLoading(true)
    try { setBackups(await db.dbListBackups()) } catch (error) { toast.error(error instanceof Error ? error.message : "Could not load backups") } finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])

  const createSystem = async () => {
    setWorking(true)
    try {
      await db.dbCreateSystemBackup(`System backup ${new Date().toLocaleString()}`)
      await refresh()
      toast.success("Full system backup created")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Backup failed")
    } finally {
      setWorking(false)
    }
  }

  const restoreSystem = async () => {
    if (!restoreTarget || !admin || !warningAccepted) return
    setWorking(true)
    try {
      await db.dbRestoreSystemBackup(restoreTarget.id)
      await useStore.getState().refreshFromDb()
      await refresh()
      setRestoreTarget(null)
      setWarningAccepted(false)
      toast.success("The complete system was restored. A safety backup of the previous state was created automatically.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Restore failed")
    } finally {
      setWorking(false)
    }
  }

  const deleteBackup = async (backup: db.BackupRecord) => {
    if (!admin) return
    setWorking(true)
    try {
      await db.dbDeleteBackup(backup.id)
      await refresh()
      toast.success("Backup deleted")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete backup")
    } finally {
      setWorking(false)
    }
  }

  const formatSize = (bytes: number) => bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Database className="size-4" />System backups</CardTitle><CardDescription>{admin ? "Create, view, restore, and delete complete database backups. Restoring also creates an automatic safety backup of the current state." : canCreateSystem ? "You may create and view complete system backups. Only an administrator can restore or delete them." : "Backup creation requires permission from an administrator."}</CardDescription></CardHeader>
        <CardContent>{canCreateSystem && <Button onClick={createSystem} disabled={working}><Plus className="size-4" />{working ? "Working…" : "Create full system backup"}</Button>}</CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Backup history</CardTitle></CardHeader>
        <CardContent>{loading ? <p className="text-sm text-muted-foreground">Loading…</p> : backups.length === 0 ? <p className="text-sm text-muted-foreground">No backups available.</p> : <div className="overflow-hidden rounded-md border"><Table><TableHeader><TableRow><TableHead>Created</TableHead><TableHead>Name</TableHead><TableHead>Created by</TableHead><TableHead>Rows / Size</TableHead><TableHead>Status</TableHead><TableHead>Last restored</TableHead><TableHead /></TableRow></TableHeader><TableBody>{backups.filter((backup) => backup.scope === "system").map((backup) => <TableRow key={backup.id}><TableCell>{new Date(backup.created_at).toLocaleString()}</TableCell><TableCell className="font-medium">{backup.label}</TableCell><TableCell>{backup.created_by_name}</TableCell><TableCell>{backup.item_count.toLocaleString()} / {formatSize(backup.size_bytes)}</TableCell><TableCell><Badge variant={backup.status === "completed" ? "secondary" : backup.status === "failed" ? "destructive" : "outline"}>{backup.status}</Badge>{backup.error_message && <p className="mt-1 max-w-52 text-xs text-destructive">{backup.error_message}</p>}</TableCell><TableCell>{backup.restored_at ? new Date(backup.restored_at).toLocaleString() : "—"}</TableCell><TableCell><div className="flex gap-1">{admin && backup.status === "completed" && <Button size="sm" variant="outline" onClick={() => { setRestoreTarget(backup); setWarningAccepted(false) }} disabled={working}><RotateCcw className="size-3.5" />Restore</Button>}{admin && <Button size="icon-sm" variant="ghost" className="text-destructive" onClick={() => void deleteBackup(backup)} disabled={working}><Trash2 className="size-3.5" /></Button>}</div></TableCell></TableRow>)}</TableBody></Table></div>}</CardContent>
      </Card>

      <Dialog open={Boolean(restoreTarget)} onOpenChange={(open) => { if (!open && !working) { setRestoreTarget(null); setWarningAccepted(false) } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-destructive"><AlertTriangle className="size-5" />Restore the complete system?</DialogTitle><DialogDescription>This operation replaces all application data and user state with the selected backup.</DialogDescription></DialogHeader>
          <div className="grid gap-3">
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm" dir="rtl"><strong>تحذير:</strong> قم بحفظ نسخة احتياطية للحالة الحالية حتى تتمكن من الرجوع إليها. سيقوم النظام أيضاً بإنشاء نسخة أمان تلقائياً قبل الاستعادة.</div>
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"><strong>Warning:</strong> Save a backup of the current state so you can return to it. The system will also create an automatic safety backup before restoring.</div>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={warningAccepted} onChange={(event) => setWarningAccepted(event.target.checked)} /><span>I understand that all current system data will be replaced / أفهم أنه سيتم استبدال جميع بيانات النظام الحالية</span></label>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setRestoreTarget(null)} disabled={working}>Cancel</Button><Button variant="destructive" onClick={() => void restoreSystem()} disabled={!warningAccepted || working}>{working ? "Restoring…" : "Restore complete system"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
