import { createTransport } from "nodemailer";
import { logEmail } from "@/lib/email-log";

// `|| 587` (not `??`) so an empty EMAIL_SERVER_PORT="" falls back too.
const port = Number(process.env.EMAIL_SERVER_PORT) || 587;

// SMTP for local dev (Ethereal) or any SMTP account. In production Resend's
// key is set and sendMail uses its HTTP API instead; `host` here only marks
// "something is configured".
const smtp = process.env.RESEND_API_KEY
  ? { host: "smtp.resend.com", port: 465, secure: true, auth: { user: "resend", pass: process.env.RESEND_API_KEY } }
  : {
      host: process.env.EMAIL_SERVER_HOST,
      port,
      // 465 is implicit TLS; everything else (587, 25) starts plaintext and upgrades via STARTTLS.
      secure: port === 465,
      auth: {
        user: process.env.EMAIL_SERVER_USER,
        pass: process.env.EMAIL_SERVER_PASSWORD,
      },
    };

/**
 * The one sender: Resend's HTTP API when RESEND_API_KEY is set (it hands
 * back an id, so the email log can look up delivery later), otherwise SMTP
 * from the EMAIL_SERVER_* settings (local dev). Every attempt is written to
 * the email log (lib/email-log.ts), sent or failed.
 */
export async function sendMail({
  to,
  subject,
  text,
  html,
  redact,
}: {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** A secret in the body (a reset link) blanked out of the logged copy; execs can read the log. */
  redact?: string;
}): Promise<{ id: string | null }> {
  const hide = (body: string) => (redact ? body.replaceAll(redact, "[redacted]") : body);
  try {
    if (!smtp.host || !process.env.EMAIL_FROM) {
      throw new Error("Set RESEND_API_KEY (or EMAIL_SERVER_HOST) and EMAIL_FROM to send email");
    }
    const replyTo = process.env.EMAIL_REPLY_TO || undefined;
    let id: string | null = null;
    if (process.env.RESEND_API_KEY) {
      const res = await fetch("https://api.resend.com/emails", {
        signal: AbortSignal.timeout(10_000),
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject, text, html, ...(replyTo && { reply_to: replyTo }) }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok) throw new Error(body.message ?? `Resend refused the email (${res.status})`);
      id = body.id ?? null;
    } else {
      const result = await createTransport(smtp).sendMail({ to, from: process.env.EMAIL_FROM, ...(replyTo && { replyTo }), subject, text, html });
      const failed = [...(result.rejected ?? []), ...(result.pending ?? [])].filter(Boolean);
      if (failed.length) throw new Error(`Email could not be sent to ${failed.join(", ")}`);
      id = result.messageId ?? null;
    }
    await logEmail({ to, subject, status: "SENT", providerId: process.env.RESEND_API_KEY ? id : null, text: hide(text), html: hide(html) });
    return { id };
  } catch (err) {
    await logEmail({ to, subject, status: "FAILED", error: (err as Error).message, text: hide(text), html: hide(html) });
    throw err;
  }
}
