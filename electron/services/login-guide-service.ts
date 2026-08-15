import { BrowserWindow, dialog } from "electron"
import fs from "node:fs"
import path from "node:path"
import { getDb } from "../database.js"
import type { ExportLoginGuideInput, ExportLoginGuideResult } from "../../src/lib/database-provider.js"
import { isSupportedActivationCode, normalizeActivationCode } from "../../src/lib/activation-code.js"
import { readStorageConfig } from "./storage-config-service.js"
import { connectionCodeFor, readStoredConnection } from "./store-installation-service.js"
import { requireLocalSession } from "./local-auth-service.js"

function safeFilePart(value: string): string {
  return value.normalize("NFKC").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "account"
}

function validateInput(input: ExportLoginGuideInput): ExportLoginGuideInput {
  const values = {
    userId: input.userId?.trim(),
    accountName: input.accountName?.trim(),
    loginIdentifier: input.loginIdentifier?.trim().toLowerCase(),
    activationCode: normalizeActivationCode(input.activationCode ?? ""),
    language: input.language,
  }
  if (!values.userId || values.userId.length > 160) throw new Error("User identifier is invalid")
  if (!values.accountName || values.accountName.length > 120) throw new Error("Account name is invalid")
  if (!values.loginIdentifier || values.loginIdentifier.length > 160) throw new Error("Login identifier is invalid")
  if (!isSupportedActivationCode(values.activationCode)) throw new Error("Activation code is invalid")
  if (values.language !== "ar" && values.language !== "en") throw new Error("Guide language is invalid")
  return values
}

function sqliteIdentity(input: ExportLoginGuideInput): { accountName: string; loginIdentifier: string; storeName: string } {
  const actor = requireLocalSession()
  if (actor.role !== "Admin") throw new Error("Administrator access is required")
  const user = getDb().prepare("SELECT name, username, email, is_active FROM users WHERE id = ?").get(input.userId) as {
    name: string
    username: string
    email: string | null
    is_active: number
  } | undefined
  if (!user || user.is_active !== 1) throw new Error("The account no longer exists or is inactive")
  const settings = getDb().prepare(`
    SELECT COALESCE(
      (SELECT NULLIF(store_name, '') FROM app_installation WHERE singleton = 1),
      (SELECT NULLIF(company_name, '') FROM system_settings WHERE id = 1)
    ) AS store_name
  `).get() as { store_name?: string } | undefined
  return {
    accountName: user.name,
    loginIdentifier: user.email || user.username,
    storeName: settings?.store_name?.trim() || "Armory Store",
  }
}

function arabicGuide(details: {
  provider: "sqlite" | "supabase"
  storeName: string
  accountName: string
  loginIdentifier: string
  activationCode: string
  storeCode: string | null
}): string {
  const storage = details.provider === "sqlite" ? "محلية على هذا الجهاز (SQLite)" : "سحابية مشتركة (Supabase)"
  const connection = details.storeCode
    ? `كود دخول المتجر:\n${details.storeCode}\n`
    : "كود دخول المتجر: غير مطلوب؛ هذا الحساب يعمل على جهاز المتجر المحلي نفسه.\n"
  return `دليل الدخول إلى متجر ${details.storeName}\n\nطريقة التخزين: ${storage}\nاسم الحساب: ${details.accountName}\nاسم/بريد الدخول: ${details.loginIdentifier}\nرمز التفعيل لمرة واحدة: ${details.activationCode}\n${connection}\nخطوات أول استخدام:\n1. ثبّت تطبيق إدارة متجر الأسلحة وافتحه.\n2. ${details.storeCode ? "اختر التخزين السحابي، ثم اختر الانضمام إلى متجر موجود والصق كود دخول المتجر كاملًا." : "افتح التطبيق على جهاز المتجر الذي أُنشئ عليه هذا الحساب؛ لا تختَر قاعدة سحابية."}\n3. في شاشة الدخول اكتب اسم/بريد الدخول المبين أعلاه.\n4. عند طلب التفعيل الأول أدخل رمز التفعيل، ثم أنشئ كلمة مرور قوية خاصة بك.\n5. لا تشارك كلمة المرور أو رمز التفعيل مع أي شخص، ولا ترسل هذا الملف عبر قناة غير موثوقة.\n\nمهم:\n- رمز التفعيل صالح لمرة واحدة وتنتهي صلاحيته خلال 7 أيام.\n- لا يحتوي هذا الملف على كلمة مرور أو مفاتيح قاعدة البيانات.\n- إذا انتهت صلاحية الرمز، اطلب من مسؤول المتجر إنشاء رمز جديد.\n`
}

function englishGuide(details: {
  provider: "sqlite" | "supabase"
  storeName: string
  accountName: string
  loginIdentifier: string
  activationCode: string
  storeCode: string | null
}): string {
  const storage = details.provider === "sqlite" ? "Local on this device (SQLite)" : "Shared cloud storage (Supabase)"
  const connection = details.storeCode
    ? `Store connection code:\n${details.storeCode}\n`
    : "Store connection code: Not required; this account is available on the store's local device only.\n"
  return `Login guide for ${details.storeName}\n\nStorage mode: ${storage}\nAccount name: ${details.accountName}\nLogin name/email: ${details.loginIdentifier}\nOne-time activation code: ${details.activationCode}\n${connection}\nFirst-use steps:\n1. Install and open the Armory Store application.\n2. ${details.storeCode ? "Choose cloud storage, select Join an existing store, and paste the complete store connection code." : "Open the application on the store device where this account was created; do not select a cloud database."}\n3. Enter the login name/email shown above.\n4. When first-use activation appears, enter the activation code and create your own strong password.\n5. Never share your password or activation code, and send this file only through a trusted channel.\n\nImportant:\n- The activation code is single-use and expires after 7 days.\n- This file contains no password or database key.\n- Ask the store administrator for a new code if this one expires.\n`
}

export async function exportLoginGuide(
  input: ExportLoginGuideInput,
  owner: BrowserWindow | null,
): Promise<ExportLoginGuideResult> {
  const validated = validateInput(input)
  const config = readStorageConfig().config
  if (!config) throw new Error("The database provider has not been configured")

  let accountName = validated.accountName
  let loginIdentifier = validated.loginIdentifier
  let storeName = "Armory Store"
  let storeCode: string | null = null
  if (config.databaseProvider === "sqlite") {
    const identity = sqliteIdentity(validated)
    accountName = identity.accountName
    loginIdentifier = identity.loginIdentifier
    storeName = identity.storeName
  } else {
    const connection = readStoredConnection()
    if (!connection) throw new Error("The saved Supabase store connection is unavailable")
    storeName = connection.storeName
    storeCode = connectionCodeFor(connection)
  }

  const details = { provider: config.databaseProvider, storeName, accountName, loginIdentifier, activationCode: validated.activationCode, storeCode }
  const content = validated.language === "ar" ? arabicGuide(details) : englishGuide(details)
  const filename = `${safeFilePart(storeName)}-${safeFilePart(accountName)}-${validated.language}-login.txt`
  const options = {
    title: validated.language === "ar" ? "حفظ دليل دخول المستخدم" : "Save user login guide",
    defaultPath: filename,
    filters: [{ name: "Text", extensions: ["txt"] }],
    properties: ["createDirectory", "showOverwriteConfirmation"] as Array<"createDirectory" | "showOverwriteConfirmation">,
  }
  const response = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
  if (response.canceled || !response.filePath) return { canceled: true }
  const destination = path.resolve(response.filePath)
  if (path.extname(destination).toLowerCase() !== ".txt") throw new Error("The login guide must be saved as a .txt file")
  fs.writeFileSync(destination, `\uFEFF${content}`, { encoding: "utf8", mode: 0o600 })
  return { canceled: false }
}
