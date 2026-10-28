import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logEmail } from "@/lib/email-log";

vi.mock("@/lib/email-log", () => ({ logEmail: vi.fn() }));

const mail = { to: "ana@uic.edu", subject: "Hi", text: "t", html: "<p>t</p>" };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("EMAIL_FROM", "LOGICA @ UIC <hello@logicauic.org>");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("sendMail through Resend", () => {
  it("logs a sent email with Resend's id", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "re_123" }))));
    const { sendMail } = await import("./mailer");
    expect(await sendMail(mail)).toEqual({ id: "re_123" });
    expect(logEmail).toHaveBeenCalledWith({ to: "ana@uic.edu", subject: "Hi", status: "SENT", providerId: "re_123", text: "t", html: "<p>t</p>" });
  });

  it("logs a refused email with Resend's reason and still throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "Domain not verified" }), { status: 403 })));
    const { sendMail } = await import("./mailer");
    await expect(sendMail(mail)).rejects.toThrow("Domain not verified");
    expect(logEmail).toHaveBeenCalledWith({ to: "ana@uic.edu", subject: "Hi", status: "FAILED", error: "Domain not verified", text: "t", html: "<p>t</p>" });
  });

  it("sends a redacted secret but keeps it out of the log", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ id: "re_1" })));
    vi.stubGlobal("fetch", fetchMock);
    const { sendMail } = await import("./mailer");
    await sendMail({ ...mail, text: "go to /reset#token=rst_abc", html: "<a href='/reset#token=rst_abc'>x</a>", redact: "rst_abc" });
    expect(fetchMock.mock.calls[0][1]?.body).toContain("rst_abc");
    expect(JSON.stringify(vi.mocked(logEmail).mock.calls)).not.toContain("rst_abc");
  });
});
