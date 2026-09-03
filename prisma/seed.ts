import { prisma } from "../lib/prisma";

// logica-lean: throwaway local dev data for the bare-minimum E2E branch —
// not wired into CI or `prisma migrate`. Run with `npx tsx prisma/seed.ts`.
async function main() {
  await prisma.form.upsert({
    where: { slug: "startup-intake" },
    create: {
      slug: "startup-intake",
      title: "Startup Intake",
      fields: {
        create: [
          { label: "Startup name", type: "text" },
          { label: "What does it do?", type: "textarea" },
        ],
      },
    },
    update: {},
  });

  await prisma.form.upsert({
    where: { slug: "company-visit-signup" },
    create: {
      slug: "company-visit-signup",
      title: "Company Visit Signup",
      fields: {
        create: [
          { label: "Full name", type: "text" },
          { label: "Dietary restrictions", type: "text" },
        ],
      },
    },
    update: {},
  });

  await prisma.event.upsert({
    where: { id: "seed-event-1" },
    create: {
      id: "seed-event-1",
      title: "General Body Meeting",
      description: "Weekly GBM",
      location: "SEL 24",
      startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    update: {},
  });

  console.log("Seeded.");
}

main().finally(() => prisma.$disconnect());
