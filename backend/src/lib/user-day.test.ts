import { test, expect } from "bun:test";
import {
  MAX_TIME_ZONE_LENGTH,
  canonicalTimeZone,
  earliestStartOf,
  latestToday,
  userToday,
  utcDay,
} from "./user-day";

/** 10:30 UTC on 12 October 2026. */
const AT = new Date("2026-10-12T10:30:00Z");

test("user's local day: the date in the user's zone, not UTC's", () => {
  expect(userToday("Pacific/Kiritimati", AT)).toBe("2026-10-13"); // UTC+14: 00:30
  expect(userToday("Pacific/Pago_Pago", AT)).toBe("2026-10-11"); // UTC-11: 23:30
  expect(userToday("Asia/Shanghai", AT)).toBe("2026-10-12"); // UTC+8: 18:30
  expect(userToday("America/Los_Angeles", new Date("2026-10-12T06:59:59Z"))).toBe("2026-10-11");
  expect(userToday("America/Los_Angeles", new Date("2026-10-12T07:00:00Z"))).toBe("2026-10-12");
  // Odd offsets, and summer time: Lord Howe moves by half an hour, Kathmandu sits at +5:45.
  expect(userToday("Asia/Kathmandu", new Date("2026-10-11T18:14:59Z"))).toBe("2026-10-11");
  expect(userToday("Asia/Kathmandu", new Date("2026-10-11T18:15:00Z"))).toBe("2026-10-12");
  expect(userToday("Australia/Lord_Howe", new Date("2026-01-11T12:59:59Z"))).toBe("2026-01-11"); // +11 in summer
  expect(userToday("Australia/Lord_Howe", new Date("2026-07-11T13:29:59Z"))).toBe("2026-07-11"); // +10:30 in winter
  expect(userToday("Australia/Lord_Howe", new Date("2026-07-11T13:30:00Z"))).toBe("2026-07-12");
});

test("user's local day: no zone, or one this runtime does not know, is UTC's day", () => {
  for (const zone of [null, undefined, "", "Mars/Olympus_Mons", "not a zone"]) {
    expect(userToday(zone, AT)).toBe("2026-10-12");
  }
  expect(utcDay(new Date("2026-10-12T23:59:59.999Z"))).toBe("2026-10-12");
});

test("user's local day: no zone's today is later than latestToday, and no date begins before earliestStartOf", () => {
  const zones = Intl.supportedValuesOf("timeZone");
  expect(zones.length).toBeGreaterThan(300);
  const instants = [AT, new Date("2026-01-01T00:00:00Z"), new Date("2026-06-30T09:59:59Z"), new Date("2026-03-29T10:00:00Z")];
  for (const now of instants) {
    const latest = latestToday(now);
    for (const zone of zones) {
      const today = userToday(zone, now);
      expect(today <= latest).toBe(true);
      // The date it is in that zone had begun there, so it had begun at UTC+14.
      expect(earliestStartOf(today).getTime()).toBeLessThanOrEqual(now.getTime());
    }
  }
  // And the bound is tight: at UTC+14 it is exactly latestToday.
  expect(latestToday(AT)).toBe(userToday("Pacific/Kiritimati", AT));
  expect(earliestStartOf("2026-10-13").toISOString()).toBe("2026-10-12T10:00:00.000Z");
});

test("canonicalTimeZone keeps the IANA names Intl knows, in their canonical spelling, and refuses everything else", () => {
  expect(canonicalTimeZone("Europe/Paris")).toBe("Europe/Paris");
  expect(canonicalTimeZone("asia/shanghai")).toBe("Asia/Shanghai");
  expect(canonicalTimeZone(" Africa/Casablanca ")).toBe("Africa/Casablanca");
  expect(canonicalTimeZone("UTC")).toBe("UTC");
  expect(canonicalTimeZone("America/Argentina/Buenos_Aires")).toBe("America/Argentina/Buenos_Aires");
  for (const bad of [
    "Mars/Olympus_Mons", "+01:00", "-05:00", "", "   ", "Europe/Paris\u0000", "../../etc/passwd",
    `Europe/${"x".repeat(MAX_TIME_ZONE_LENGTH)}`, null, undefined, 5, {}, ["Europe/Paris"],
  ]) {
    expect(canonicalTimeZone(bad)).toBeNull();
  }
});
