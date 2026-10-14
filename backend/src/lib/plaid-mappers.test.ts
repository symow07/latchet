import { describe, test, expect } from "bun:test";
import {
  categoryForTransaction,
  mapAccountType,
  movementOf,
  mapCategory,
  mapPersonalFinanceCategory,
} from "./plaid-mappers";

test("mapAccountType maps Plaid types to app vocabulary", () => {
  expect(mapAccountType("credit", "credit card")).toBe("credit");
  expect(mapAccountType("investment", "ira")).toBe("investment");
  expect(mapAccountType("depository", "savings")).toBe("savings");
  expect(mapAccountType("depository", "checking")).toBe("checking");
  expect(mapAccountType("depository", "money market")).toBe("other");
  expect(mapAccountType()).toBe("other");
  expect(mapAccountType("loan", "student")).toBe("loan");
  expect(mapAccountType("loan", "mortgage")).toBe("loan");
});

test("movement: Plaid's categories for money that only moves, in the app's words", () => {
  expect(movementOf({ primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" })).toBe("card_payment");
  expect(movementOf({ primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT" })).toBe("loan_payment");
  expect(movementOf({ primary: "TRANSFER_IN", detailed: "TRANSFER_IN_ACCOUNT_TRANSFER" })).toBe("transfer_in");
  expect(movementOf({ primary: "INCOME", detailed: "INCOME_SALARY" })).toBe("income");
  expect(movementOf({ primary: "ENTERTAINMENT", detailed: "ENTERTAINMENT_TV_AND_MOVIES" })).toBeNull();
  expect(movementOf({ primary: "TRANSFER_OUT", detailed: "TRANSFER_OUT_ACCOUNT_TRANSFER" })).toBeNull();
  expect(movementOf(null)).toBeNull();
  expect(movementOf(undefined)).toBeNull();
});

describe("plaid category", () => {
  test("plaid category: spending primaries map to the app's categories", () => {
    expect(mapPersonalFinanceCategory({ primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_RESTAURANT" })).toBe("Food");
    expect(mapPersonalFinanceCategory({ primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_GROCERIES" })).toBe("Food");
    expect(mapPersonalFinanceCategory({ primary: "TRANSPORTATION", detailed: "TRANSPORTATION_TAXIS_AND_RIDE_SHARES" })).toBe("Transport");
    expect(mapPersonalFinanceCategory({ primary: "GENERAL_MERCHANDISE", detailed: "GENERAL_MERCHANDISE_ELECTRONICS" })).toBe("Shopping");
  });

  test("plaid category: the detailed code decides where it differs from its primary", () => {
    // Netflix and Spotify are ENTERTAINMENT, but they are paid monthly.
    expect(mapPersonalFinanceCategory({ primary: "ENTERTAINMENT", detailed: "ENTERTAINMENT_TV_AND_MOVIES" })).toBe("Subscriptions");
    expect(mapPersonalFinanceCategory({ primary: "ENTERTAINMENT", detailed: "ENTERTAINMENT_MUSIC_AND_AUDIO" })).toBe("Subscriptions");
    expect(mapPersonalFinanceCategory({ primary: "RENT_AND_UTILITIES", detailed: "RENT_AND_UTILITIES_TELEPHONE" })).toBe("Subscriptions");
    expect(mapPersonalFinanceCategory({ primary: "RENT_AND_UTILITIES", detailed: "RENT_AND_UTILITIES_INTERNET_AND_CABLE" })).toBe("Subscriptions");
    expect(mapPersonalFinanceCategory({ primary: "PERSONAL_CARE", detailed: "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS" })).toBe("Gym");
    expect(mapPersonalFinanceCategory({ primary: "PERSONAL_CARE", detailed: "PERSONAL_CARE_HAIR_AND_BEAUTY" })).toBe("Other");
    expect(mapPersonalFinanceCategory({ primary: "TRAVEL", detailed: "TRAVEL_FLIGHTS" })).toBe("Transport");
    expect(mapPersonalFinanceCategory({ primary: "TRAVEL", detailed: "TRAVEL_LODGING" })).toBe("Other");
    expect(mapPersonalFinanceCategory({ primary: "GENERAL_MERCHANDISE", detailed: "GENERAL_MERCHANDISE_CONVENIENCE_STORES" })).toBe("Food");
    expect(mapPersonalFinanceCategory({ primary: "GENERAL_SERVICES", detailed: "GENERAL_SERVICES_AUTOMOTIVE" })).toBe("Transport");
  });

  test("plaid category: money that is not spending, and anything unknown, is Other", () => {
    for (const [primary, detailed] of [
      ["INCOME", "INCOME_SALARY"], // taxonomy v2
      ["INCOME", "INCOME_WAGES"], // taxonomy v1
      ["TRANSFER_OUT", "TRANSFER_OUT_WIRE"],
      ["LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"],
      ["LOAN_DISBURSEMENTS", "LOAN_DISBURSEMENTS_EWA"],
      ["BANK_FEES", "BANK_FEES_OVERDRAFT_FEES"],
      ["RENT_AND_UTILITIES", "RENT_AND_UTILITIES_RENT"],
      ["MEDICAL", "MEDICAL_PHARMACIES_AND_SUPPLEMENTS"],
      ["OTHER", "OTHER_OTHER"],
      ["SOMETHING_NEW", "SOMETHING_NEW_ENTIRELY"],
    ]) {
      expect(mapPersonalFinanceCategory({ primary, detailed })).toBe("Other");
    }
  });

  test("plaid category: personal_finance_category wins over the legacy array", () => {
    // The legacy array says Shops; the current field knows it is a gym.
    expect(categoryForTransaction({
      personal_finance_category: { primary: "PERSONAL_CARE", detailed: "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS" },
      category: ["Shops", "Sporting Goods"],
    })).toBe("Gym");
    // Even when the current field says Other, the legacy array is not consulted.
    expect(categoryForTransaction({
      personal_finance_category: { primary: "TRANSFER_OUT", detailed: "TRANSFER_OUT_ACCOUNT_TRANSFER" },
      category: ["Food and Drink"],
    })).toBe("Other");
  });

  test("plaid category: the legacy array is the fallback only when the current field is absent", () => {
    expect(categoryForTransaction({ category: ["Food and Drink", "Restaurants"] })).toBe("Food");
    expect(categoryForTransaction({ personal_finance_category: null, category: ["Travel", "Taxi"] })).toBe("Transport");
    expect(categoryForTransaction({ personal_finance_category: { primary: null, detailed: null }, category: ["Shops"] })).toBe("Shopping");
    expect(categoryForTransaction({})).toBe("Other");
  });

  test("plaid category: codes are read whatever their case, and a lone detailed code names its primary", () => {
    expect(mapPersonalFinanceCategory({ primary: "food_and_drink", detailed: "food_and_drink_coffee" })).toBe("Food");
    expect(mapPersonalFinanceCategory({ detailed: "TRANSPORTATION_GAS" })).toBe("Transport");
    expect(mapPersonalFinanceCategory({ primary: "", detailed: "" })).toBeNull();
    expect(mapPersonalFinanceCategory(undefined)).toBeNull();
  });
});

test("mapCategory classifies the legacy Plaid categories", () => {
  expect(mapCategory(["Food and Drink", "Restaurants"])).toBe("Food");
  expect(mapCategory(["Travel", "Taxi"])).toBe("Transport");
  expect(mapCategory(["Shops", "Retail"])).toBe("Shopping");
  expect(mapCategory(["Recreation", "Gyms and Fitness Centers"])).toBe("Gym");
  expect(mapCategory(["Service", "Subscription"])).toBe("Subscriptions");
  expect(mapCategory(["Transfer"])).toBe("Other");
  expect(mapCategory(null)).toBe("Other");
  expect(mapCategory([])).toBe("Other");
});
