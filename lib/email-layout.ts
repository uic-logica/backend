import { frontendOrigin } from "@/lib/linkedin-oauth";

/**
 * What an email says. Every LOGICA email is this one layout: logo, an
 * optional eyebrow and serif heading, paragraphs, an optional details box
 * (When / Where), an optional quoted note, one button, and the footer.
 */
export type EmailContent = {
  /** Shown in the inbox list next to the subject. */
  preheader?: string;
  eyebrow?: string;
  heading?: string;
  paragraphs: string[];
  details?: [label: string, value: string][];
  /** Someone's words, quoted as-is (a board message, a review note). */
  quote?: string;
  button?: { label: string; url: string };
  /** Small print under the button. */
  footnote?: string;
};

// The site's light palette (frontend src/app/tokens.css). Email clients
// can't read CSS variables, and most ignore dark-mode styles, so it's fixed.
const C = {
  page: "#f0eee6",
  card: "#ffffff",
  rule: "#e6e3d8",
  sunken: "#faf9f5",
  ink: "#1a1915",
  muted: "#5c5a54",
  gold: "#fecc15",
  goldText: "#7a5c00",
};
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
// Source Serif on the site; Georgia is the serif every mail client has.
const SERIF = "Georgia,'Times New Roman',serif";

const esc = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const lines = (text: string) => esc(text).replace(/\n/g, "<br>");

/** The HTML and plain-text bodies for one email. */
export function renderEmail(content: EmailContent): { html: string; text: string } {
  const site = frontendOrigin();
  const settings = `${site}/dashboard/settings`;
  const p = (text: string) =>
    `<p style="margin:0 0 16px;font:16px/1.6 ${SANS};color:${C.ink}">${lines(text)}</p>`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(content.heading ?? "LOGICA @ UIC")}</title></head>
<body style="margin:0;padding:0;background:${C.page}">
${content.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(content.preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 20px">
  <a href="${site}" style="text-decoration:none;color:${C.ink}"><img src="${site}/logica-logo-black.png" width="36" height="36" alt="" style="vertical-align:middle;border:0"><span style="vertical-align:middle;margin-left:10px;font:800 15px/1 ${SANS};letter-spacing:1px;color:${C.ink}">LOGICA</span></a>
</td></tr>
<tr><td style="background:${C.card};border:1px solid ${C.rule};border-radius:14px;padding:36px 36px 28px">
${content.eyebrow ? `<p style="margin:0 0 10px;font:700 12px/1 ${SANS};letter-spacing:1.2px;text-transform:uppercase;color:${C.goldText}">${esc(content.eyebrow)}</p>` : ""}
${content.heading ? `<h1 style="margin:0 0 18px;font:400 28px/1.2 ${SERIF};color:${C.ink}">${esc(content.heading)}</h1>` : ""}
${content.paragraphs.map(p).join("\n")}
${
  content.details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;background:${C.sunken};border:1px solid ${C.rule};border-radius:10px">${content.details
        .map(
          ([label, value], i) =>
            `<tr><td style="padding:12px 16px;${i ? `border-top:1px solid ${C.rule};` : ""}font:13px/1.4 ${SANS};color:${C.muted};width:84px;vertical-align:top">${esc(label)}</td><td style="padding:12px 16px 12px 0;${i ? `border-top:1px solid ${C.rule};` : ""}font:600 15px/1.4 ${SANS};color:${C.ink}">${lines(value)}</td></tr>`,
        )
        .join("")}</table>`
    : ""
}
${content.quote ? `<div style="margin:4px 0 20px;padding:4px 0 4px 16px;border-left:3px solid ${C.gold};font:16px/1.6 ${SANS};color:${C.ink}">${lines(content.quote)}</div>` : ""}
${
  content.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px"><tr><td style="background:${C.ink};border-radius:8px"><a href="${esc(content.button.url)}" style="display:inline-block;padding:13px 22px;font:600 15px/1 ${SANS};color:#faf9f5;text-decoration:none">${esc(content.button.label)}</a></td></tr></table>`
    : ""
}
${content.footnote ? `<p style="margin:18px 0 0;font:13px/1.5 ${SANS};color:${C.muted}">${lines(content.footnote)}</p>` : ""}
</td></tr>
<tr><td style="padding:20px 8px 0;font:12px/1.6 ${SANS};color:${C.muted};text-align:center">
  LOGICA @ UIC · Latinx computing and academics community<br>
  <a href="${site}" style="color:${C.muted}">logicauic.org</a> · <a href="${settings}" style="color:${C.muted}">Email settings</a>
</td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = [
    content.heading,
    ...content.paragraphs,
    ...(content.details ?? []).map(([label, value]) => `${label}: ${value}`),
    content.quote && `"${content.quote}"`,
    content.button && `${content.button.label}: ${content.button.url}`,
    content.footnote,
    `--\nLOGICA @ UIC · ${site}\nEmail settings: ${settings}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { html, text };
}
