/**
 * Filler accounts and filler data for a QA environment.
 *
 * Every account here is fake and every row it creates is fake. The point is
 * that a tester can sign in as each of the four roles and find every page
 * populated, without anyone handing out a real member's credentials.
 *
 * Run it against the QA database only:
 *   DATABASE_URL=<qa> ALLOWED_EMAIL_DOMAIN=qa.logica.test npx tsx --env-file=.env.qa prisma/seed-qa.ts
 *
 * It refuses to run on a database that holds accounts outside QA_DOMAIN, so
 * pointing it at production by mistake stops instead of seeding it. Re-running
 * is safe: everything upserts on a stable id.
 */
import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/password";
import { generateCheckInCode } from "../lib/check-in";

const QA_DOMAIN = "qa.logica.test";
/** Shared on purpose — these accounts guard nothing real. */
const PASSWORD = "logica-qa-2026";

const day = (offset: number, hour = 17) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(hour, 0, 0, 0);
  return d;
};
const ymd = (offset: number) => day(offset).toISOString().slice(0, 10);

type Filler = {
  id: string;
  name: string;
  email: string;
  role: "MEMBER" | "BOARD" | "EXEC_BOARD";
  officer?: "PRESIDENT" | "VICE_PRESIDENT" | "TREASURER" | "SECRETARY" | "OUTREACH" | "OTHER";
  major?: string;
  gradYear?: number;
  bio?: string;
};

// Four roles, several of each, so two testers can be signed in as the same
// role at once without fighting over one session.
const MEMBERS: Filler[] = [
  { id: "qa-exec-1", name: "Ada Placeholder", email: `exec1@${QA_DOMAIN}`, role: "EXEC_BOARD", officer: "PRESIDENT", major: "Computer Science", gradYear: 2027, bio: "Filler exec account for QA." },
  { id: "qa-exec-2", name: "Bruno Placeholder", email: `exec2@${QA_DOMAIN}`, role: "EXEC_BOARD", officer: "TREASURER", major: "Information Technology", gradYear: 2026 },
  { id: "qa-exec-3", name: "Cleo Placeholder", email: `exec3@${QA_DOMAIN}`, role: "EXEC_BOARD", officer: "OUTREACH", major: "Data Science", gradYear: 2028 },
  { id: "qa-board-1", name: "Dev Placeholder", email: `board1@${QA_DOMAIN}`, role: "BOARD", officer: "SECRETARY", major: "Computer Science", gradYear: 2027 },
  { id: "qa-board-2", name: "Esme Placeholder", email: `board2@${QA_DOMAIN}`, role: "BOARD", officer: "VICE_PRESIDENT", major: "Computer Engineering", gradYear: 2026 },
  { id: "qa-board-3", name: "Femi Placeholder", email: `board3@${QA_DOMAIN}`, role: "BOARD", officer: "OTHER", major: "Mathematics", gradYear: 2029 },
  { id: "qa-member-1", name: "Gia Placeholder", email: `member1@${QA_DOMAIN}`, role: "MEMBER", major: "Computer Science", gradYear: 2028, bio: "Filler member account for QA." },
  { id: "qa-member-2", name: "Hugo Placeholder", email: `member2@${QA_DOMAIN}`, role: "MEMBER", major: "Information Technology", gradYear: 2027 },
  { id: "qa-member-3", name: "Iris Placeholder", email: `member3@${QA_DOMAIN}`, role: "MEMBER", major: "Data Science", gradYear: 2029 },
  { id: "qa-member-4", name: "Jonas Placeholder", email: `member4@${QA_DOMAIN}`, role: "MEMBER" },
];

/** One guest per stage, so every branch of the speaker portal has an account behind it. */
const GUESTS = [
  { id: "qa-guest-candidate", sub: "qa-sub-candidate", name: "Kira Placeholder", org: "Filler Labs", kind: "TALK" as const, status: "PENDING" as const, confirmedAvailability: false, note: "Candidate who has not confirmed availability yet." },
  { id: "qa-guest-ready", sub: "qa-sub-ready", name: "Luca Placeholder", org: "Placeholder Analytics", kind: "WORKSHOP" as const, status: "PENDING" as const, confirmedAvailability: true, note: "Candidate with confirmed availability — ready for the board to decide." },
  { id: "qa-guest-speaker", sub: "qa-sub-speaker", name: "Mira Placeholder", org: "Example Systems", kind: "TALK" as const, status: "CONFIRMED" as const, confirmedAvailability: true, note: "Confirmed speaker with a scheduled talk." },
  { id: "qa-guest-declined", sub: "qa-sub-declined", name: "Nico Placeholder", org: "Sample Ventures", kind: "COMPANY_VISIT" as const, status: "DECLINED" as const, confirmedAvailability: true, note: "Declined guest — checks the 'we could not make this work' screen." },
];

const EVENTS = [
  { id: "qa-event-past-gbm", title: "QA: General Body Meeting", description: "Filler event in the past, with attendance on it.", location: "CDRLC 1413", startsAt: day(-14), link: null },
  { id: "qa-event-past-workshop", title: "QA: Git Workshop", description: "Filler past workshop.", location: "SELE 2268", startsAt: day(-5), link: null },
  { id: "qa-event-soon", title: "QA: Resume Review Night", description: "Filler event two days out — check RSVP and the reminder copy.", location: "CDRLC 1413", startsAt: day(2), link: "https://example.com/qa-rsvp" },
  { id: "qa-event-talk", title: "QA: Guest Talk — Example Systems", description: "Filler event linked to the confirmed QA speaker.", location: "LC F3", startsAt: day(9), link: null },
  { id: "qa-event-far", title: "QA: End of Semester Social", description: "Filler event far out, no RSVPs yet — checks the empty-ish state.", location: "TBD", startsAt: day(45), link: null },
];

async function guard() {
  const outsiders = await prisma.user.count({ where: { email: { not: { endsWith: `@${QA_DOMAIN}` } } } });
  if (outsiders > 0 && process.env.QA_SEED_FORCE !== "1") {
    throw new Error(
      `Refusing to seed: this database has ${outsiders} account(s) outside @${QA_DOMAIN}, so it is not a QA database. ` +
        `Point DATABASE_URL at the QA database. (QA_SEED_FORCE=1 overrides — do not use it on production.)`,
    );
  }
}

async function main() {
  await guard();
  const passwordHash = hashPassword(PASSWORD);

  for (const m of MEMBERS) {
    const fields = {
      name: m.name,
      email: m.email,
      role: m.role,
      officer: m.officer ?? null,
      major: m.major ?? null,
      gradYear: m.gradYear ?? null,
      bio: m.bio ?? null,
      accountKind: "MEMBER" as const,
      passwordHash,
      mustChangePassword: false,
      emailVerified: new Date(),
    };
    await prisma.user.upsert({ where: { id: m.id }, create: { id: m.id, ...fields }, update: fields });
  }

  for (const e of EVENTS) {
    await prisma.event.upsert({ where: { id: e.id }, create: e, update: e });
  }

  // Guests: submission first, then the account that points at it.
  for (const g of GUESTS) {
    const availability = [
      { startDate: ymd(7), endDate: ymd(11), startTime: "10:00", endTime: "14:00" },
      { startDate: ymd(18), endDate: ymd(18), startTime: "16:00", endTime: "19:30" },
    ];
    const sub = {
      name: g.name,
      email: `${g.id}@${QA_DOMAIN}`,
      organization: g.org,
      referredBy: "QA seed",
      availability,
      needs: "Projector, HDMI, and a mic.",
      note: g.note,
      publicOptIn: true,
      status: g.status,
      kind: g.kind,
      submittedAt: new Date(),
      availabilityConfirmedAt: g.confirmedAvailability ? new Date() : null,
      talkTitle: g.status === "CONFIRMED" ? "QA: What placeholder data teaches us" : null,
      slidesUrl: g.status === "CONFIRMED" ? "https://example.com/qa-slides" : null,
      eventId: g.status === "CONFIRMED" ? "qa-event-talk" : null,
    };
    await prisma.speakerSubmission.upsert({ where: { id: g.sub }, create: { id: g.sub, ...sub }, update: sub });

    const user = {
      name: g.name,
      email: `${g.id}@${QA_DOMAIN}`,
      username: g.id,
      accountKind: "SPEAKER" as const,
      role: "MEMBER" as const,
      passwordHash,
      mustChangePassword: false,
      speakerSubmissionId: g.sub,
      emailVerified: new Date(),
    };
    await prisma.user.upsert({ where: { id: g.id }, create: { id: g.id, ...user }, update: user });

    // A thread with something already in it, so Messages is never blank.
    await prisma.speakerMessage.upsert({
      where: { id: `${g.sub}-msg` },
      create: { id: `${g.sub}-msg`, submissionId: g.sub, authorId: "qa-exec-1", body: `Thanks for the windows, ${g.name.split(" ")[0]} — checking them against the room calendar.` },
      update: {},
    });
  }

  // Feed
  const posts = [
    { id: "qa-post-1", authorId: "qa-exec-1", body: "QA filler post: welcome to the test environment. Nothing here is real." },
    { id: "qa-post-2", authorId: "qa-board-1", body: "QA filler post: second item, so the feed has more than one row." },
    { id: "qa-post-3", authorId: "qa-exec-3", body: "QA filler post: check spacing, timestamps and long-text wrapping — aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa." },
    { id: "qa-post-event", authorId: "qa-exec-1", body: "QA filler post attached to an event.", eventId: "qa-event-soon" },
  ];
  for (const p of posts) {
    await prisma.post.upsert({ where: { id: p.id }, create: p, update: { body: p.body } });
  }

  // RSVPs and attendance, so events and participation have numbers on them.
  const attendees = MEMBERS.slice(3);
  for (const [i, m] of attendees.entries()) {
    await prisma.rsvp.upsert({
      where: { eventId_userId: { eventId: "qa-event-soon", userId: m.id } },
      create: { eventId: "qa-event-soon", userId: m.id, status: i % 4 === 3 ? "NOT_GOING" : "GOING" },
      update: {},
    });
    if (i % 3 !== 2) {
      await prisma.attendance.upsert({
        where: { eventId_userId: { eventId: "qa-event-past-gbm", userId: m.id } },
        create: { eventId: "qa-event-past-gbm", userId: m.id, checkedInById: "qa-board-1" },
        update: {},
      });
    }
    if (i % 2 === 0) {
      await prisma.attendance.upsert({
        where: { eventId_userId: { eventId: "qa-event-past-workshop", userId: m.id } },
        create: { eventId: "qa-event-past-workshop", userId: m.id },
        update: {},
      });
    }
  }

  // An open check-in code on the soonest event, for the /attendance flow.
  const code = generateCheckInCode();
  await prisma.checkInCode.upsert({
    where: { eventId: "qa-event-soon" },
    create: { eventId: "qa-event-soon", code, expiresAt: day(2, 23) },
    update: { code, expiresAt: day(2, 23) },
  });

  // Money: a budget with items across every stage.
  await prisma.budget.upsert({
    where: { id: "qa-budget" },
    create: { id: "qa-budget", label: "QA Term Budget", amountCents: 250000, startsAt: day(-60), endsAt: day(120) },
    update: {},
  });
  const money = [
    { id: "qa-money-1", title: "QA: Pizza for GBM", stage: "PAID", amountCents: 12500, paidByUserId: "qa-board-1" },
    { id: "qa-money-2", title: "QA: Sticker printing", stage: "REQUESTED", amountCents: 4800 },
    { id: "qa-money-3", title: "QA: Hackathon travel", stage: "APPROVED", amountCents: 60000 },
    { id: "qa-money-4", title: "QA: Banner reprint", stage: "REIMBURSED", amountCents: 9900, paidByUserId: "qa-exec-2" },
    { id: "qa-money-5", title: "QA: Drone rental", stage: "DECLINED", amountCents: 150000 },
  ];
  for (const m of money) {
    const row = { kind: "MONEY" as const, budgetId: "qa-budget", ownerId: "qa-exec-2", createdById: "qa-exec-2", detail: "Filler row for QA.", ...m };
    await prisma.boardItem.upsert({ where: { id: m.id }, create: row, update: row });
  }

  const outreach = [
    { id: "qa-out-1", title: "QA: Example Systems — guest talk", stage: "SCHEDULED", org: "Example Systems", contactName: "Mira Placeholder", contactEmail: `qa-guest-speaker@${QA_DOMAIN}`, channel: "Referral", category: "talk", eventId: "qa-event-talk" },
    { id: "qa-out-2", title: "QA: Filler Labs — company visit", stage: "CONTACTED", org: "Filler Labs", contactName: "Kira Placeholder", contactEmail: `qa-guest-candidate@${QA_DOMAIN}`, channel: "LinkedIn", category: "company visit" },
    { id: "qa-out-3", title: "QA: Placeholder Analytics — workshop", stage: "NEEDS_REPLY", org: "Placeholder Analytics", channel: "Email", category: "workshop" },
    { id: "qa-out-4", title: "QA: Sample Ventures — sponsorship", stage: "PASSED", org: "Sample Ventures", channel: "In person", category: "partner" },
    { id: "qa-out-5", title: "QA: Unnamed prospect", stage: "PROSPECT", org: "Placeholder Co", channel: "Email", category: "talk" },
  ];
  for (const o of outreach) {
    const row = { kind: "OUTREACH" as const, ownerId: "qa-exec-3", createdById: "qa-exec-3", detail: "Filler row for QA.", lastTouchAt: day(-3), ...o };
    await prisma.boardItem.upsert({ where: { id: o.id }, create: row, update: row });
  }

  // Membership applications, one per status.
  const applications = [
    { id: "qa-app-1", name: "Opal Placeholder", email: `applicant1@${QA_DOMAIN}`, track: "SOFTWARE_ENGINEER" as const, major: "Computer Science" as string | null, gradYear: 2029 as number | null, why: "Filler application, pending review.", status: "PENDING" as const },
    { id: "qa-app-2", name: "Pax Placeholder", email: `applicant2@${QA_DOMAIN}`, track: "BOARD_MEMBER" as const, major: "Information Technology", gradYear: 2027, why: "Filler application, already accepted.", status: "ACCEPTED" as const },
    { id: "qa-app-3", name: "Quinn Placeholder", email: `applicant3@${QA_DOMAIN}`, track: "GENERAL" as const, major: null, gradYear: null, why: "Filler application, declined.", status: "DECLINED" as const },
    { id: "qa-app-4", name: "Remy Placeholder", email: `applicant4@${QA_DOMAIN}`, track: "MENTORSHIP" as const, major: "Computer Science", gradYear: 2028, why: "Filler application, at the interview stage.", status: "INTERVIEW" as const },
  ];
  for (const a of applications) {
    await prisma.membershipApplication.upsert({ where: { id: a.id }, create: a, update: a });
  }

  // Notifications and email preferences for the accounts most testers will use.
  for (const id of ["qa-exec-1", "qa-board-1", "qa-member-1", "qa-guest-candidate"]) {
    await prisma.notification.upsert({
      where: { id: `${id}-notif-1` },
      create: { id: `${id}-notif-1`, userId: id, message: "QA filler notification — unread." },
      update: {},
    });
    await prisma.notification.upsert({
      where: { id: `${id}-notif-2` },
      create: { id: `${id}-notif-2`, userId: id, message: "QA filler notification — already read.", readAt: day(-1) },
      update: {},
    });
    await prisma.emailPreference.upsert({
      where: { userId: id },
      create: { userId: id, eventReminders: true, announcements: true },
      update: {},
    });
  }

  for (const i of [1, 2, 3]) {
    await prisma.subscriber.upsert({
      where: { email: `subscriber${i}@${QA_DOMAIN}` },
      create: { email: `subscriber${i}@${QA_DOMAIN}` },
      update: {},
    });
  }

  // Forms, plus one submission so the responses view isn't empty.
  const form = await prisma.form.upsert({
    where: { slug: "qa-filler-form" },
    create: {
      slug: "qa-filler-form",
      title: "QA Filler Form",
      fields: { create: [{ label: "Your name", type: "text" }, { label: "What should we test?", type: "textarea" }] },
    },
    update: {},
    include: { fields: true },
  });
  await prisma.submission.upsert({
    where: { id: "qa-submission-1" },
    create: { id: "qa-submission-1", formId: form.id, userId: "qa-member-1", data: { [form.fields[0]?.id ?? "name"]: "Gia Placeholder", [form.fields[1]?.id ?? "what"]: "Every page, twice." } },
    update: {},
  });

  const counts = {
    accounts: MEMBERS.length + GUESTS.length,
    events: EVENTS.length,
    boardItems: money.length + outreach.length,
    applications: applications.length,
  };
  console.log(`QA seed complete: ${JSON.stringify(counts)}`);
  console.log(`\nSign in with password: ${PASSWORD}`);
  console.log(`Members/board/exec (email login): ${MEMBERS.map((m) => m.email).join(", ")}`);
  console.log(`Guests (username login): ${GUESTS.map((g) => g.id).join(", ")}`);
  console.log(`Check-in code for "QA: Resume Review Night": ${code}`);
  console.log(`\nALLOWED_EMAIL_DOMAIN must be ${QA_DOMAIN} (or *) for member login to work.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
