import { test, expect } from "bun:test";
import {
  advanceMonth,
  advanceYear,
  advanceDays,
  computeNextDate,
  anchorDayOf,
} from "./recurrence";

test("advanceMonth moves to the same day next month", () => {
  expect(advanceMonth("2026-01-15", 15)).toBe("2026-02-15");
});

test("advanceMonth does not skip February from the 31st", () => {
  // setUTCMonth(+1) asks for "31 February", which rolls to 3 March and skips
  // the month entirely — the bug this whole module exists to prevent.
  expect(advanceMonth("2026-01-31", 31)).toBe("2026-02-28");
});

test("advanceMonth clamps to 29 February in a leap year", () => {
  expect(advanceMonth("2028-01-30", 30)).toBe("2028-02-29");
  expect(advanceMonth("2028-01-31", 31)).toBe("2028-02-29");
});

test("advanceMonth handles a 31-day month following a 30-day one", () => {
  expect(advanceMonth("2026-03-31", 31)).toBe("2026-04-30");
});

test("the anchor day is restored after a short month", () => {
  // A bill on the 31st must return to the 31st, not stay on February's 28th.
  const feb = advanceMonth("2026-01-31", 31);
  expect(feb).toBe("2026-02-28");
  expect(advanceMonth(feb, 31)).toBe("2026-03-31");
  expect(advanceMonth("2026-03-31", 31)).toBe("2026-04-30");
});

test("advanceMonth rolls over the year in December", () => {
  expect(advanceMonth("2026-12-10", 10)).toBe("2027-01-10");
  expect(advanceMonth("2026-12-31", 31)).toBe("2027-01-31");
});

test("advanceYear clamps 29 February to the 28th in a non-leap year", () => {
  // setUTCFullYear(+1) would roll this to 1 March.
  expect(advanceYear("2028-02-29", 29)).toBe("2029-02-28");
});

test("advanceYear is a plain year step otherwise", () => {
  expect(advanceYear("2026-06-15", 15)).toBe("2027-06-15");
});

test("advanceDays crosses month and year boundaries", () => {
  expect(advanceDays("2026-01-31", 1)).toBe("2026-02-01");
  expect(advanceDays("2026-12-31", 1)).toBe("2027-01-01");
  expect(advanceDays("2026-02-25", 7)).toBe("2026-03-04");
});

test("computeNextDate honours each frequency", () => {
  expect(computeNextDate("2026-01-31", "daily", 31)).toBe("2026-02-01");
  expect(computeNextDate("2026-01-31", "weekly", 31)).toBe("2026-02-07");
  expect(computeNextDate("2026-01-31", "biweekly", 31)).toBe("2026-02-14");
  expect(computeNextDate("2026-01-31", "monthly", 31)).toBe("2026-02-28");
  expect(computeNextDate("2026-01-31", "yearly", 31)).toBe("2027-01-31");
});

test("computeNextDate falls back to monthly for an unknown frequency", () => {
  expect(computeNextDate("2026-01-31", "fortnightly-ish", 31)).toBe("2026-02-28");
});

test("anchorDayOf reads the day from a start date", () => {
  expect(anchorDayOf("2026-01-31")).toBe(31);
  expect(anchorDayOf("2026-01-05")).toBe(5);
});

test("a monthly series anchored on the 31st keeps its shape across a year", () => {
  const anchor = 31;
  let date = "2026-01-31";
  const dates: string[] = [];
  for (let i = 0; i < 12; i++) {
    date = computeNextDate(date, "monthly", anchor);
    dates.push(date);
  }

  expect(dates).toEqual([
    "2026-02-28",
    "2026-03-31",
    "2026-04-30",
    "2026-05-31",
    "2026-06-30",
    "2026-07-31",
    "2026-08-31",
    "2026-09-30",
    "2026-10-31",
    "2026-11-30",
    "2026-12-31",
    "2027-01-31",
  ]);
});
