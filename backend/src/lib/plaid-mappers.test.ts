import { test, expect } from "bun:test";
import { mapAccountType, mapCategory } from "./plaid-mappers";

test("mapAccountType maps Plaid types to app vocabulary", () => {
  expect(mapAccountType("credit", "credit card")).toBe("credit");
  expect(mapAccountType("investment", "ira")).toBe("investment");
  expect(mapAccountType("depository", "savings")).toBe("savings");
  expect(mapAccountType("depository", "checking")).toBe("checking");
  expect(mapAccountType("depository", "money market")).toBe("other");
  expect(mapAccountType()).toBe("other");
});

test("mapCategory classifies common Plaid categories", () => {
  expect(mapCategory(["Food and Drink", "Restaurants"])).toBe("Food");
  expect(mapCategory(["Travel", "Taxi"])).toBe("Transport");
  expect(mapCategory(["Shops", "Retail"])).toBe("Shopping");
  expect(mapCategory(["Recreation", "Gyms and Fitness Centers"])).toBe("Gym");
  expect(mapCategory(["Service", "Subscription"])).toBe("Subscriptions");
  expect(mapCategory(["Transfer"])).toBe("Other");
  expect(mapCategory(null)).toBe("Other");
  expect(mapCategory([])).toBe("Other");
});
