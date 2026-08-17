# Password Recovery and Gmail SMTP

Armory Store uses two deliberately different recovery paths:

| Account | SQLite store | Supabase store |
| --- | --- | --- |
| Employee | A pending request appears in **Settings → Users**. An administrator verifies the employee, approves it, and securely shares the one-time code. | The same administrator-approval workflow is enforced by PostgreSQL RPCs and RLS. |
| Administrator | Electron sends a one-time code through Gmail SMTP. | Supabase Auth sends its recovery OTP through the project's custom Gmail SMTP configuration. |

Codes expire after 15 minutes and can be used once. Requests are throttled to one per two minutes and five per hour. Employee codes are stored only as salted SHA-256 hashes, are invalidated after completion, and stop working after five incorrect attempts.

## Cost and delivery expectations

Gmail and Google Workspace SMTP can be used without adding a paid email provider, subject to the sending limits and acceptable-use rules of the Google account. It is not an unlimited mail service. Google and recipient providers make the final spam-placement decision, so no application can guarantee that every message avoids Spam. The configuration and message format below follow [Google's email sender guidelines](https://support.google.com/mail/answer/81126) and reduce common causes of filtering.

For a larger production deployment, high volume, delivery analytics, or contractual delivery requirements, use a dedicated transactional-email provider instead of a personal Gmail mailbox.

## Prepare the Google account

1. Create or select a dedicated Gmail account controlled by the store, such as `store.security@gmail.com`. Do not use a personal employee mailbox.
2. Enable **2-Step Verification** in the Google Account security settings.
3. Follow [Google's App Password instructions](https://support.google.com/accounts/answer/185833), create a password for Armory Store, and copy the generated 16-character value. App passwords are available only when the Google account and its organization policy allow them.
4. Never use the normal Gmail password and never commit an App Password to Git, paste it into support messages, or expose it through a `VITE_` environment variable.
5. If the credential is disclosed or the administrator changes, revoke the App Password immediately and issue a new one.

## Configure SQLite recovery

Create a file named `.env` either beside the packaged executable or in the Armory Store user-data directory, and add:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=store.security@gmail.com
SMTP_APP_PASSWORD=abcdefghijklmnop
SMTP_FROM_EMAIL=store.security@gmail.com
SMTP_FROM_NAME=Armory Store
```

`SMTP_FROM_EMAIL` must exactly match `SMTP_USER`; the application rejects a different sender to prevent spoofing. Restrict the file so only the Windows account that runs Armory Store can read it, then restart the application. These values are loaded only by Electron's main process and are not exposed to the renderer.

The administrator's account must also have a valid recovery email in **Settings → General**. Test recovery while another administrator is still signed in, so a configuration mistake cannot lock everyone out.

## Configure Supabase recovery

Supabase Auth performs administrator email recovery; the application never receives Gmail credentials.

1. Follow the [Supabase custom SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp). In the store's Supabase Dashboard, open **Authentication → SMTP Settings** and enable custom SMTP.
2. Set the host to `smtp.gmail.com`, the sender/user to the dedicated Gmail address, and the password to its Google App Password. Use port `465` with implicit TLS if offered, or port `587` with STARTTLS according to the current Supabase form.
3. Keep the sender email identical to the authenticated Gmail account and use a consistent sender name such as `Armory Store`.
4. Open **Authentication → Email Templates → Reset Password**. The application verifies a typed OTP, so the template must visibly include the [Supabase email-template token](https://supabase.com/docs/guides/auth/auth-email-templates) variable `{{ .Token }}`. A minimal line is: `Your Armory Store verification code is {{ .Token }}`. Do not include service-role keys or other secrets.
5. Save the settings and send a test recovery to an administrator account. The Auth login email—not an employee's display identifier—is the delivery destination.

Apply the bundled Supabase migrations before using the feature:

```bash
npm run supabase:schema:apply
```

## Delivery and anti-spam practices

- Use a dedicated, stable sender and never forge the `From` address. The SQLite sender includes Date, Message-ID, plain-text and HTML alternatives, and automatic-message headers.
- Ask administrators to add the sender to their contacts and check Spam during the first test.
- Send only requested recovery messages. Built-in cooldown and hourly limits must not be removed.
- Keep the subject and content consistent, short, and truthful. Avoid URL shorteners, unnecessary attachments, all-capital wording, and marketing text in security messages.
- For a custom-domain Google Workspace address, publish SPF, enable DKIM in Google Admin, and add a gradual DMARC policy. A plain `gmail.com` sender uses Google's domain authentication; you cannot publish DNS records for `gmail.com` yourself.
- Monitor rejected deliveries and Google security alerts. Repeated failures often indicate a revoked App Password, disabled SMTP access, an organizational restriction, or a quota limit.
- Never log an OTP, App Password, recovery password, Supabase secret key, or full SMTP conversation.

## Operational test checklist

1. Employee request: submit recovery, confirm only active administrators see it in **Settings → Users**, approve it, and verify the shown code works once.
2. Incorrect code: verify repeated wrong codes are rejected and the request locks after five attempts.
3. Expiration: verify a code older than 15 minutes is rejected.
4. Administrator request: confirm delivery to the configured Gmail address and verify the OTP resets the password.
5. Replay: verify the same code cannot reset the account a second time.
6. Authorization: confirm an employee cannot list or approve recovery requests through SQLite IPC or Supabase RPCs.
7. Rate limiting: confirm another request inside two minutes is rejected.

Keep at least two administrator accounts with current recovery addresses and test this procedure after changing Gmail, Supabase Auth, or deployment settings.
