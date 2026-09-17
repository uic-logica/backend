import { createTransport } from "nodemailer";

// `|| 587` (not `??`) so an empty EMAIL_SERVER_PORT="" falls back too.
const port = Number(process.env.EMAIL_SERVER_PORT) || 587;

const smtp = {
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
 * Shared SMTP sender — same server config `auth.ts`'s Nodemailer provider
 * uses for sign-in codes, factored out so anything else that needs to email
 * someone (speaker invites, notifications) doesn't redefine the transport.
 */
export async function sendMail({
  to,
  subject,
  text,
  html,
}: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  if (!process.env.EMAIL_SERVER_HOST || !process.env.EMAIL_FROM) {
    throw new Error("EMAIL_SERVER_HOST and EMAIL_FROM must be set to send email");
  }

  const result = await createTransport(smtp).sendMail({
    to,
    from: process.env.EMAIL_FROM,
    subject,
    text,
    html,
  });

  const failed = [...(result.rejected ?? []), ...(result.pending ?? [])].filter(Boolean);
  if (failed.length) throw new Error(`Email could not be sent to ${failed.join(", ")}`);
}
