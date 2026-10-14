import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test, type Mock } from "bun:test";
import { isUndeliverableAddress, sendEmail } from "./email";

describe("reserved recipients", () => {
  test("RFC 2606 and 6761 names are undeliverable", () => {
    for (const address of [
      "a@example.com",
      "a@mail.example.org",
      "a@EXAMPLE.NET",
      "reset-1@example.test",
      "u@e2e.test",
      "u@x.test.",
      "u@foo.example",
      "u@nowhere.invalid",
      "u@localhost",
      "no-at-sign",
      "trailing@",
    ]) {
      expect(isUndeliverableAddress(address)).toBe(true);
    }
  });

  test("real domains are deliverable, including ones that merely contain a reserved word", () => {
    for (const address of ["a@gmail.com", "a@example.co", "a@examples.com", "a@notexample.com", "a@testing.io", "a@mail.spotify.co.uk"]) {
      expect(isUndeliverableAddress(address)).toBe(false);
    }
  });
});

describe("sendEmail to a reserved domain", () => {
  let fetchSpy: Mock<typeof fetch>;
  let warnSpy: Mock<typeof console.warn>;
  beforeAll(() => {
    fetchSpy = spyOn(globalThis, "fetch");
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    fetchSpy.mockClear();
    warnSpy.mockClear();
  });
  // Files share one process: leave fetch and console as the next file expects them.
  afterAll(() => {
    fetchSpy.mockRestore();
    warnSpy.mockRestore();
  });

  test("never reaches a provider, and outside production logs the plain text with its link", async () => {
    const link = "http://localhost:3000/api/auth/reset-password/TOKEN?callbackURL=latchet%3A%2F%2Freset-password";
    await sendEmail({ to: "someone@e2e.test", subject: "Subject line", html: "<p>x</p>", text: `Hello\n\n${link}\n` });

    expect(fetchSpy).not.toHaveBeenCalled();
    const logged = warnSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("[mail:dev]");
    expect(logged).toContain("someone@e2e.test");
    expect(logged.split("\n")).toContain(link);
  });
});
