import { randomUUID } from "node:crypto"
import tls from "node:tls"

export interface SmtpConfig {
  host: string
  port: number
  user: string
  password: string
  fromEmail: string
  fromName: string
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not configured. See docs/PASSWORD_RECOVERY.md`)
  return value
}

export function readSmtpConfig(): SmtpConfig {
  const host = (process.env.SMTP_HOST?.trim() || "smtp.gmail.com").toLowerCase()
  const port = Number(process.env.SMTP_PORT?.trim() || "465")
  const user = required("SMTP_USER").toLowerCase()
  const fromEmail = (process.env.SMTP_FROM_EMAIL?.trim() || user).toLowerCase()
  const password = required("SMTP_APP_PASSWORD").replace(/\s+/g, "")
  if (host !== "smtp.gmail.com" || port !== 465) throw new Error("Only Gmail SMTP over TLS port 465 is supported")
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) {
    throw new Error("SMTP sender email is invalid")
  }
  if (fromEmail !== user) throw new Error("SMTP_FROM_EMAIL must match SMTP_USER to prevent sender spoofing")
  if (!/^[A-Za-z0-9]{16}$/.test(password)) throw new Error("SMTP_APP_PASSWORD must be a 16-character Google App Password")
  return {
    host,
    port,
    user,
    password,
    fromEmail,
    fromName: (process.env.SMTP_FROM_NAME?.trim() || "Armory Store").slice(0, 80),
  }
}

function encodedHeader(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`
}

export function buildAdministratorRecoveryEmail(config: SmtpConfig, recipient: string, code: string, expiresMinutes: number): string {
  const boundary = `armory-${randomUUID()}`
  const subject = "Armory Store password recovery code"
  const text = `Your Armory Store administrator recovery code is: ${code}\n\nIt expires in ${expiresMinutes} minutes and can be used once. If you did not request it, ignore this message. Never share this code.`
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#172033"><h2>Armory Store</h2><p>Your administrator password recovery code is:</p><p style="font-size:30px;font-weight:700;letter-spacing:6px;padding:16px;background:#f3f4f6;text-align:center">${code}</p><p>This code expires in ${expiresMinutes} minutes and can be used once.</p><p style="color:#667085">If you did not request this code, ignore this message. Never share it.</p></div>`
  const domain = config.fromEmail.split("@")[1]
  return [
    `From: ${encodedHeader(config.fromName)} <${config.fromEmail}>`,
    `To: <${recipient}>`,
    `Reply-To: <${config.fromEmail}>`,
    `Subject: ${encodedHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    "Auto-Submitted: auto-generated",
    "X-Auto-Response-Suppress: All",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(text, "utf8").toString("base64"),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(html, "utf8").toString("base64"),
    `--${boundary}--`,
    "",
  ].join("\r\n")
}

async function smtpSend(config: SmtpConfig, recipient: string, content: string): Promise<void> {
  const socket = tls.connect({ host: config.host, port: config.port, servername: config.host, rejectUnauthorized: true })
  socket.setTimeout(15_000)
  let buffered = ""
  const responses: string[] = []
  let pending: { resolve: (value: string) => void; reject: (error: Error) => void } | null = null
  let terminalError: Error | null = null
  socket.setEncoding("utf8")
  socket.on("data", (chunk: string) => {
    buffered += chunk
    const lines = buffered.split("\r\n")
    buffered = lines.pop() ?? ""
    for (const line of lines) {
      if (!/^\d{3} /.test(line)) continue
      if (pending) {
        const waiter = pending
        pending = null
        waiter.resolve(line)
      } else {
        responses.push(line)
      }
    }
  })
  const fail = (error: Error) => {
    terminalError = error
    if (!pending) return
    const waiter = pending
    pending = null
    waiter.reject(error)
  }
  socket.on("error", (error) => fail(error))
  socket.on("close", () => fail(new Error("SMTP connection closed unexpectedly")))
  socket.on("timeout", () => {
    const error = new Error("SMTP connection timed out")
    fail(error)
    socket.destroy(error)
  })
  const response = () => new Promise<string>((resolve, reject) => {
    if (terminalError) return reject(terminalError)
    const queued = responses.shift()
    if (queued) return resolve(queued)
    const timer = setTimeout(() => {
      pending = null
      reject(new Error("SMTP response timed out"))
    }, 15_000)
    pending = {
      resolve: (line) => { clearTimeout(timer); resolve(line) },
      reject: (error) => { clearTimeout(timer); reject(error) },
    }
  })
  const expect = async (allowed: number[]) => {
    const line = await response()
    const status = Number(line.slice(0, 3))
    if (!allowed.includes(status)) throw new Error(`SMTP rejected the request (${status})`)
  }
  const command = async (value: string, allowed: number[]) => {
    socket.write(`${value}\r\n`)
    await expect(allowed)
  }
  try {
    await expect([220])
    await command("EHLO armory-store.local", [250])
    await command("AUTH LOGIN", [334])
    await command(Buffer.from(config.user).toString("base64"), [334])
    await command(Buffer.from(config.password).toString("base64"), [235])
    await command(`MAIL FROM:<${config.fromEmail}>`, [250])
    await command(`RCPT TO:<${recipient}>`, [250, 251])
    await command("DATA", [354])
    socket.write(`${content.replace(/\r\n\./g, "\r\n..")}\r\n.\r\n`)
    await expect([250])
    socket.write("QUIT\r\n")
  } finally {
    socket.end()
  }
}

export async function sendAdministratorRecoveryEmail(recipient: string, code: string, expiresMinutes = 15): Promise<void> {
  const email = recipient.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("The administrator account needs a valid Gmail address")
  const config = readSmtpConfig()
  await smtpSend(config, email, buildAdministratorRecoveryEmail(config, email, code, expiresMinutes))
}
