/** Plain-text + HTML body for the "you've been invited to the speaker portal" email. */
export function speakerInviteEmail(username: string, tempPassword: string) {
  const subject = "You're confirmed — sign in to LOGICA @ UIC";
  const text = `You're confirmed as a speaker with LOGICA @ UIC.\n\nSign in at /speaker-signin with:\nUsername: ${username}\nTemporary password: ${tempPassword}\n\nYou'll be asked to set your own password the first time you sign in.\n`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
  <p style="margin:0 0 16px">You're confirmed as a speaker with LOGICA @ UIC. Sign in to manage your availability and details.</p>
  <p style="margin:0 0 4px"><strong>Username:</strong> ${username}</p>
  <p style="margin:0 0 16px"><strong>Temporary password:</strong> ${tempPassword}</p>
  <p style="margin:0;color:#555;font-size:14px">You'll set your own password the first time you sign in.</p>
</div>`;
  return { subject, text, html };
}
