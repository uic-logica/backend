import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { type Stage, stageOf } from "@/lib/stage";

const PREFIX = "logica_";

/** 256 bits of CSPRNG output, shown to the person exactly once. */
export function mintToken() {
  const secret = `${PREFIX}${randomBytes(32).toString("base64url")}`;
  return { secret, tokenHash: hashToken(secret) };
}

export function hashToken(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

/** Constant-time compare so a wrong token can't be narrowed down by timing. */
function sameHash(a: string, b: string) {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export type Caller = {
  id: string;
  name: string | null;
  email: string;
  stage: Stage;
  submissionId: string | null;
};

/**
 * Resolves `Authorization: Bearer <token>` to the person it belongs to, and
 * re-derives their stage from the live record every time. A token carries
 * no permissions of its own: demote someone, or move a speaker back to
 * candidate, and their agent loses the matching tools on the next call.
 */
export async function callerFor(header: string | null): Promise<Caller | null> {
  const secret = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!secret?.startsWith(PREFIX)) return null;

  const row = await prisma.mcpToken.findUnique({
    where: { tokenHash: hashToken(secret) },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          accountKind: true,
          speakerSubmissionId: true,
          speakerSubmission: { select: { status: true } },
        },
      },
    },
  });
  if (!row || row.revokedAt) return null;
  if (!sameHash(row.tokenHash, hashToken(secret))) return null;

  // Best-effort: a failed touch must not fail the call it's recording.
  void prisma.mcpToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  const { user } = row;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    stage: stageOf(
      user.accountKind,
      user.role,
      user.speakerSubmission?.status ?? null,
    ),
    submissionId: user.speakerSubmissionId,
  };
}
