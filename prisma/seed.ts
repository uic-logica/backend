import { prisma } from "../lib/prisma";

// logica-lean: throwaway local dev data for the bare-minimum E2E branch —
// not wired into CI or `prisma migrate`. Run with `npm run db:seed`.

// ponytail: real events live here as plain data. Stable ids + upsert-with-update
// means re-running the seed corrects them instead of duplicating.
// TBD events carry a placeholder startsAt (the column is required) — the "Date &
// time TBD" prefix in the description is what's authoritative until we know.
const events = [
  {
    id: "event-taco-social-2026-09-03",
    title: "Meet the Board Taco Social",
    description:
      "Meet the LOGICA board over tacos. Food is first come, first serve. 5:00–6:30 PM. RSVP: https://luma.com/4mpvcw1x",
    location: "CDRLC Room 1413",
    startsAt: new Date("2026-09-03T17:00:00-05:00"),
  },
  {
    id: "event-gbm-1-2026-09-08",
    title: "First General Body Meeting",
    description:
      "Learn more about LOGICA, hear about opportunities and upcoming events, and connect with peers. Snacks and a raffle for prizes. 5:30–6:30 PM. RSVP: https://luma.com/enakkvt5",
    location: "CDRLC Room 1413",
    startsAt: new Date("2026-09-08T17:30:00-05:00"),
  },
  {
    id: "event-greenwood-2026-09-21",
    title: "The Greenwood Project — with SHPE, NSBE & SWE",
    description:
      "The Greenwood Project is a Chicago nonprofit that introduces Black and Latino college students to careers in finance through rigorous training and internships. They're targeting freshmen and sophomores for their academy tracks, including a Fintech academy for CS students. Come learn about the program from a representative and ask questions. 5:00–7:00 PM.",
    location: "EIEP Lounge (SELE 2268)",
    startsAt: new Date("2026-09-21T17:00:00-05:00"),
  },
  {
    id: "event-lit-code-hot-wings",
    title: "LIT-Code with Hot Wings",
    description: "Date & time TBD. LeetCode practice, hot wings. Details coming soon.",
    location: null,
    startsAt: new Date("2026-10-15T17:00:00-05:00"),
  },
  {
    id: "event-company-visit-8451",
    title: "Company Visit: 84.51°",
    description: "Date & time TBD. Company visit to 84.51°. Details coming soon.",
    location: null,
    startsAt: new Date("2026-11-05T17:00:00-05:00"),
  },
];

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

  for (const event of events) {
    const { id, ...fields } = event;
    await prisma.event.upsert({
      where: { id },
      create: { id, ...fields },
      update: fields,
    });
  }

  console.log(`Seeded ${events.length} events.`);
}

main().finally(() => prisma.$disconnect());
