import { createHash, randomBytes } from "node:crypto";
import type { VisitKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * The one link a board member sends a guest.
 *
 * Clicking it lets them pick an email and a password and walk straight into
 * their own dashboard — no emailed temp password, no second step, nothing
 * for the board to chase.
 *
 * That makes the link a credential, so it is treated like one: 256 bits of
 * CSPRNG output, stored only as sha256, dead on first use, and expired
 * after two weeks either way. The old `/speak/:id` link exposed a form and
 * nothing more, which is why a plain cuid was enough for it; this is a
 * different thing and gets a different kind of secret.
 */
const PREFIX = "inv_";
const LIFETIME_DAYS = 14;

export function hashInvite(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function mintInvite() {
  const secret = `${PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    secret,
    inviteTokenHash: hashInvite(secret),
    inviteExpiresAt: new Date(Date.now() + LIFETIME_DAYS * 24 * 60 * 60 * 1000),
    inviteUsedAt: null,
  };
}

export type InviteLookup =
  | { ok: true; submission: InvitedSubmission }
  | { ok: false; reason: "unknown" | "expired" | "used" | "claimed" };

type InvitedSubmission = {
  id: string;
  name: string | null;
  email: string | null;
  organization: string | null;
  kind: VisitKind;
};

/**
 * Resolve a link to the guest it belongs to. Every failure is reported
 * separately so the page can say something true — "this link has already
 * been used" is a different problem from "this link never existed", and
 * telling someone the wrong one sends them to the wrong person for help.
 */
export async function lookupInvite(secret: unknown): Promise<InviteLookup> {
  if (typeof secret !== "string" || !secret.startsWith(PREFIX)) {
    return { ok: false, reason: "unknown" };
  }
  const row = await prisma.speakerSubmission.findUnique({
    where: { inviteTokenHash: hashInvite(secret) },
    select: {
      id: true,
      name: true,
      email: true,
      organization: true,
      kind: true,
      inviteExpiresAt: true,
      inviteUsedAt: true,
      user: { select: { id: true } },
    },
  });
  if (!row) return { ok: false, reason: "unknown" };
  if (row.inviteUsedAt) return { ok: false, reason: "used" };
  // An account made some other way (the exec email invite) also closes this
  // link — two accounts for one guest is worse than a dead link.
  if (row.user) return { ok: false, reason: "claimed" };
  if (row.inviteExpiresAt && row.inviteExpiresAt < new Date()) {
    return { ok: false, reason: "expired" };
  }
  return {
    ok: true,
    submission: {
      id: row.id,
      name: row.name,
      email: row.email,
      organization: row.organization,
      kind: row.kind,
    },
  };
}

export const INVITE_PROBLEM: Record<
  Exclude<InviteLookup, { ok: true }>["reason"],
  string
> = {
  unknown: "This link isn't valid. Ask whoever sent it for a new one.",
  expired: "This link has expired. Ask whoever sent it for a new one.",
  used: "This link has already been used. Sign in instead, or ask for a new one.",
  claimed: "There's already an account for this. Try signing in.",
};

export const VISIT_NOUN: Record<VisitKind, string> = {
  TALK: "talk",
  WORKSHOP: "workshop",
  COMPANY_VISIT: "company visit",
};

export function isVisitKind(value: unknown): value is VisitKind {
  return value === "TALK" || value === "WORKSHOP" || value === "COMPANY_VISIT";
}

/** Passwords the guest picks themselves — the only rule is length. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length === 0) {
    return "Choose a password.";
  }
  // logica-lean: length only, no character-class rules. NIST dropped those
  // years ago — they push people toward "Password1!" and nothing else.
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 200) return "That password is too long.";
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return EMAIL_RE.test(email) ? email : null;
}
