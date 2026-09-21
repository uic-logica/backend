import "dotenv/config";
import { prisma } from "../lib/prisma";
import { issueMemberPassword, normalizeMemberEmail } from "../lib/member-password";

// Server-admin recovery/bootstrap only. Requires direct database access.
// No passwords in command arguments, source files, or reusable seed data.
async function main() {
  const email = normalizeMemberEmail(process.argv[2]);
  if (!email || process.argv.length !== 3) {
    throw new Error("Usage: npx tsx scripts/issue-member-password.ts member@uic.edu");
  }
  if (!process.stdout.isTTY) throw new Error("Run in an interactive terminal; do not log or redirect credentials.");
  const issued = await issueMemberPassword(email);
  console.log(`Email: ${issued.email}\nPassword (shown once): ${issued.password}\nDeliver privately after verifying the recipient. Existing sessions and MCP tokens were revoked.`);
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Could not issue password.");
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
