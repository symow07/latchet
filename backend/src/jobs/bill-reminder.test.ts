import { test, expect } from "bun:test";
import { advanceMonth } from "./bill-reminder-checker";

test("advanceMonth moves a recurring bill to the next month", () => {
  expect(advanceMonth("2026-01-15", 15)).toBe("2026-02-15");
});

test("advanceMonth clamps the due day to the last day of a short month", () => {
  // Jan 31 → Feb (2026 is not a leap year) clamps to the 28th.
  expect(advanceMonth("2026-01-31", 31)).toBe("2026-02-28");
});

test("advanceMonth rolls over the year in December", () => {
  expect(advanceMonth("2026-12-10", 10)).toBe("2027-01-10");
});
