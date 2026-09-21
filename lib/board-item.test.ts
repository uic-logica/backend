import { describe, expect, it } from "vitest";
import { budgetRollup, FIRST_STAGE, parseBoardItem, STAGES, STAGE_LABELS, validStage } from "./board-item";

describe("stages", () => {
  it("keeps the two pipelines apart", () => {
    expect(validStage("MONEY", "APPROVED")).toBe(true);
    expect(validStage("OUTREACH", "APPROVED")).toBe(false);
    expect(validStage("OUTREACH", "SCHEDULED")).toBe(true);
    expect(validStage("MONEY", "SCHEDULED")).toBe(false);
  });

  it("starts each kind at its own first stage", () => {
    expect(STAGES.MONEY[0]).toBe(FIRST_STAGE.MONEY);
    expect(STAGES.OUTREACH[0]).toBe(FIRST_STAGE.OUTREACH);
  });

  it("has a human label for every stage", () => {
    for (const stage of [...STAGES.MONEY, ...STAGES.OUTREACH]) {
      expect(STAGE_LABELS[stage], stage).toBeTruthy();
    }
  });
});

describe("budgetRollup", () => {
  const items = [
    { stage: "PAID", amountCents: 5000, paidByUserId: null },
    { stage: "REIMBURSED", amountCents: 2000, paidByUserId: "u1" },
    { stage: "APPROVED", amountCents: 3000, paidByUserId: null },
    { stage: "REQUESTED", amountCents: 1000, paidByUserId: null },
    { stage: "DECLINED", amountCents: 9999, paidByUserId: null },
  ];

  it("counts money out the door as spent and commitments as pending", () => {
    const r = budgetRollup(20000, items);
    expect(r.spentCents).toBe(7000); // PAID + REIMBURSED
    expect(r.pendingCents).toBe(4000); // APPROVED + REQUESTED
  });

  it("does not let approved money be spent twice", () => {
    // remaining subtracts pending as well as spent — 20000 - 7000 - 4000.
    expect(budgetRollup(20000, items).remainingCents).toBe(9000);
  });

  it("ignores declined spends entirely", () => {
    const r = budgetRollup(20000, items);
    expect(r.spentCents + r.pendingCents).toBe(11000);
  });

  it("can go negative rather than clamping", () => {
    // A treasurer who has overspent needs to see it, not a zero.
    expect(budgetRollup(1000, items).remainingCents).toBe(-10000);
  });

  it("owes back only what someone fronted and hasn't been repaid", () => {
    const r = budgetRollup(20000, [
      { stage: "PAID", amountCents: 5000, paidByUserId: "u1" }, // fronted, not yet repaid
      { stage: "REIMBURSED", amountCents: 2000, paidByUserId: "u1" }, // already repaid
      { stage: "PAID", amountCents: 4000, paidByUserId: null }, // club card, nobody to repay
      { stage: "DECLINED", amountCents: 8000, paidByUserId: "u2" }, // never happening
    ]);
    expect(r.owedBackCents).toBe(5000);
  });

  it("treats a missing amount as zero", () => {
    expect(budgetRollup(100, [{ stage: "PAID", amountCents: null }]).spentCents).toBe(0);
  });

  it("handles an empty budget", () => {
    expect(budgetRollup(0, [])).toEqual({
      amountCents: 0,
      spentCents: 0,
      pendingCents: 0,
      remainingCents: 0,
      owedBackCents: 0,
    });
  });
});

describe("parseBoardItem", () => {
  const create = (body: Record<string, unknown>, kind: "MONEY" | "OUTREACH" = "MONEY") =>
    parseBoardItem(body, kind, { creating: true });

  it("defaults a new item to its first stage", () => {
    expect(create({ title: "Pizza" }).stage).toBe("REQUESTED");
    expect(create({ title: "Zebra" }, "OUTREACH").stage).toBe("PROSPECT");
  });

  it("requires a title on create", () => {
    expect(() => create({})).toThrow(/title/i);
    expect(() => create({ title: "   " })).toThrow(/title/i);
  });

  it("leaves an omitted field undefined so a PATCH doesn't blank it", () => {
    const patch = parseBoardItem({ stage: "PAID" }, "MONEY", { creating: false });
    expect(patch.title).toBeUndefined();
    expect(patch.detail).toBeUndefined();
    expect(patch.stage).toBe("PAID");
  });

  it("clears a field that was explicitly emptied", () => {
    expect(parseBoardItem({ detail: "" }, "MONEY", { creating: false }).detail).toBeNull();
  });

  it("rejects a stage from the other pipeline", () => {
    expect(() => create({ title: "Pizza", stage: "SCHEDULED" })).toThrow(/isn't a stage/);
  });

  it("accepts a lowercase stage", () => {
    expect(create({ title: "Pizza", stage: "approved" }).stage).toBe("APPROVED");
  });

  it("only writes the fields that belong to the kind", () => {
    const money = create({ title: "Pizza", amountCents: 1250, org: "Zebra" });
    expect(money.amountCents).toBe(1250);
    expect(money.org).toBeUndefined();

    const outreach = create({ title: "Zebra", org: "Zebra", amountCents: 1250 }, "OUTREACH");
    expect(outreach.org).toBe("Zebra");
    expect(outreach.amountCents).toBeUndefined();
  });

  it("rejects amounts that aren't whole non-negative cents", () => {
    expect(() => create({ title: "x", amountCents: 12.5 })).toThrow(/whole cents/);
    expect(() => create({ title: "x", amountCents: -1 })).toThrow(/negative/);
    expect(() => create({ title: "x", amountCents: "abc" })).toThrow(/whole cents/);
  });

  /** A stored javascript: URL becomes an anchor the whole board clicks. */
  it("rejects a link that isn't http(s)", () => {
    expect(() => create({ title: "x", receiptUrl: "javascript:alert(1)" })).toThrow(/http/);
    expect(() => create({ title: "x", receiptUrl: "data:text/html,hi" })).toThrow(/http/);
    expect(() => create({ title: "x", receiptUrl: "not a url" })).toThrow(/valid URL/);
    expect(create({ title: "x", receiptUrl: "https://drive.google.com/f" }).receiptUrl).toBe(
      "https://drive.google.com/f",
    );
  });

  it("rejects a date that isn't one", () => {
    expect(() => create({ title: "x", nextStepAt: "next tuesday" })).toThrow(/real date/);
  });
});
