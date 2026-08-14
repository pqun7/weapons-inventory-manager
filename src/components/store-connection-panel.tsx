import { useEffect, useState } from "react"
import { Copy, Database, LogOut, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useI18n } from "@/lib/i18n"
import { configuredSupabaseConnection, getSupabaseClient } from "@/lib/supabase/client"
import { createStoreConnectionCode, type StoreConnectionConfiguration } from "@/lib/store-connection"

const COPY = {
  ar: {
    title: "اتصال المتجر",
    help: "بيانات هذا المتجر محفوظة على هذا الجهاز. شارك رمز الربط مع موظفي المتجر فقط.",
    store: "المتجر",
    project: "مشروع Supabase",
    schema: "إصدار المخطط",
    code: "رمز ربط المتجر",
    copy: "نسخ الرمز",
    copied: "تم نسخ رمز ربط المتجر",
    disconnect: "فصل هذا الجهاز",
    disconnectTitle: "فصل الجهاز عن المتجر؟",
    disconnectHelp: "سيتم تسجيل الخروج وحذف إعداد الاتصال المحلي فقط. لن تُحذف قاعدة البيانات أو حسابات الموظفين ويمكن إعادة الربط بالرمز.",
    cancel: "إلغاء",
    confirm: "فصل الجهاز",
    unavailable: "إدارة اتصال المتجر متاحة في تطبيق سطح المكتب.",
  },
  en: {
    title: "Store connection",
    help: "This store connection is saved on this device. Share its connection code only with store staff.",
    store: "Store",
    project: "Supabase project",
    schema: "Schema version",
    code: "Store connection code",
    copy: "Copy code",
    copied: "Store connection code copied",
    disconnect: "Disconnect this device",
    disconnectTitle: "Disconnect this device from the store?",
    disconnectHelp: "This signs out and removes only the local connection. It does not delete the database or staff accounts, and the device can be connected again with the code.",
    cancel: "Cancel",
    confirm: "Disconnect device",
    unavailable: "Store connection management is available in the desktop application.",
  },
} as const

interface ConnectionView {
  connection: StoreConnectionConfiguration
  connectionCode: string
}

export function StoreConnectionPanel() {
  const { lang } = useI18n()
  const t = COPY[lang]
  const [view, setView] = useState<ConnectionView | null>(null)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    void window.electronAPI?.storeConnection.get().then((response) => {
      if (response.success && response.data) setView(response.data)
      else {
        const connection = configuredSupabaseConnection()
        if (connection) setView({ connection, connectionCode: createStoreConnectionCode(connection) })
      }
    })
  }, [])

  if (!window.electronAPI?.storeConnection) {
    return <Card><CardHeader><CardTitle>{t.title}</CardTitle><CardDescription>{t.unavailable}</CardDescription></CardHeader></Card>
  }

  const copyCode = async () => {
    if (!view) return
    await navigator.clipboard.writeText(view.connectionCode)
    toast.success(t.copied)
  }

  const disconnect = async () => {
    setWorking(true)
    try {
      await getSupabaseClient().auth.signOut({ scope: "local" })
      const response = await window.electronAPI!.storeConnection.clear()
      if (!response.success) throw new Error(response.error ?? "Could not disconnect this device")
      window.location.reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not disconnect this device")
      setWorking(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Database className="size-4" />{t.title}</CardTitle>
        <CardDescription>{t.help}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {view && <>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="grid gap-1.5"><Label>{t.store}</Label><Input readOnly value={view.connection.storeName} className="bg-muted" /></div>
            <div className="grid gap-1.5"><Label>{t.project}</Label><Input readOnly dir="ltr" value={new URL(view.connection.supabaseUrl).hostname.split(".")[0]} className="bg-muted" /></div>
            <div className="grid gap-1.5"><Label>{t.schema}</Label><Input readOnly dir="ltr" value={view.connection.schemaVersion} className="bg-muted" /></div>
          </div>
          <div className="grid gap-1.5"><Label>{t.code}</Label><Textarea readOnly dir="ltr" value={view.connectionCode} className="min-h-28 break-all bg-muted font-mono text-xs" /></div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={copyCode}><Copy className="size-4" />{t.copy}</Button>
            <AlertDialog>
              <AlertDialogTrigger asChild><Button variant="destructive"><LogOut className="size-4" />{t.disconnect}</Button></AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader><AlertDialogTitle className="flex items-center gap-2"><ShieldCheck className="size-5" />{t.disconnectTitle}</AlertDialogTitle><AlertDialogDescription>{t.disconnectHelp}</AlertDialogDescription></AlertDialogHeader>
                <AlertDialogFooter><AlertDialogCancel>{t.cancel}</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={working} onClick={disconnect}>{t.confirm}</AlertDialogAction></AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </>}
      </CardContent>
    </Card>
  )
}
