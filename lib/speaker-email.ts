/**
 * Plain-text + HTML body for the "you've been invited to the portal" email.
 *
 * Two stages, two emails. A candidate is invited so we can work out whether
 * a date is even possible — promising them a talk at this point would be a
 * lie. Once the board confirms them, they're a speaker.
 */
export function speakerInviteEmail(username: string, tempPassword: string, confirmed = true) {
  const subject = confirmed
    ? "You're confirmed — sign in to LOGICA @ UIC"
    : "Let's find a date — sign in to LOGICA @ UIC";
  const opening = confirmed
    ? "You're confirmed as a speaker with LOGICA @ UIC. Sign in to manage your talk details."
    : "The LOGICA @ UIC board has set up an account for you. Sign in and tell us when you're free — that's all we need to work out whether we can make a date happen.";
  const text = `${opening}\n\nSign in at /speaker-signin with:\nUsername: ${username}\nTemporary password: ${tempPassword}\n\nYou'll be asked to set your own password the first time you sign in.\n`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
  <p style="margin:0 0 16px">${opening}</p>
  <p style="margin:0 0 4px"><strong>Username:</strong> ${username}</p>
  <p style="margin:0 0 16px"><strong>Temporary password:</strong> ${tempPassword}</p>
  <p style="margin:0;color:#555;font-size:14px">You'll set your own password the first time you sign in.</p>
</div>`;
  return { subject, text, html };
}
