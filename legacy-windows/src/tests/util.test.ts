/**
 * `dates_and_numbers_are_parsed_the_way_agencies_write_them`, case for case, plus
 * the boundaries that a JavaScript `Date` would get wrong where `chrono` does not.
 *
 * This is the file that catches the cheapest kind of divergence: an agency types
 * 31/03/2027, one edition stores 2027-03-31 and the other stores 2027-31-03 or
 * shifts it a day for a timezone. Nothing about that shows up as an error.
 */

import { expect, suite, test } from "./harness";
import {
  CATEGORIES,
  addDays,
  daysUntil,
  expiryAfter,
  formatDate,
  formatMoney,
  looksLikeEmail,
  normaliseCategory,
  normaliseGender,
  normalisePhone,
  normaliseRelationship,
  parseDate,
  parseNumber,
  tidyName,
  todayIso,
} from "../core/util";

suite("dates as agencies write them", () => {
  test("reads the shapes a spreadsheet arrives in", () => {
    expect.equal(parseDate("31/03/2027"), "2027-03-31");
    expect.equal(parseDate("31-03-2027"), "2027-03-31");
    expect.equal(parseDate("2027-03-31"), "2027-03-31");
    expect.equal(parseDate("31-Mar-2027"), "2027-03-31");
    expect.equal(parseDate("2027-03-31T00:00:00"), "2027-03-31");
    // Excel serial for 2027-03-31.
    expect.equal(parseDate("46477"), "2027-03-31");
    expect.equal(parseDate("not a date"), null);
    expect.equal(parseDate(""), null);
  });

  test("assumes day-first, because the target agencies write it", () => {
    expect.equal(parseDate("03/04/2027"), "2027-04-03", "the third of April, not the fourth of March");
    expect.equal(parseDate("13/04/2027"), "2027-04-13");
    expect.equal(
      parseDate("04/13/2027"),
      null,
      "and a month-first date is refused rather than quietly swapped into another day",
    );
  });

  test("refuses a date that does not exist", () => {
    expect.equal(parseDate("31/02/2027"), null, "February has no 31st, so it is not a date");
    expect.equal(parseDate("29/02/2027"), null, "2027 is not a leap year");
    expect.equal(parseDate("29/02/2028"), "2028-02-29", "2028 is");
  });

  test("keeps a premium from being read as a date", () => {
    expect.equal(parseDate("45000"), "2023-03-15", "inside the serial range, so it is a date");
    expect.equal(parseDate("19999"), null, "and outside it, a number stays a number");
    expect.equal(parseDate("80000"), null);
  });

  test("counts days without a daylight saving jump moving a policy", () => {
    // The clocks change in most of the world somewhere in these ranges. Arithmetic
    // through local time would land on 23:00 the day before and lose a day.
    expect.equal(addDays("2027-03-27", 1), "2027-03-28");
    expect.equal(addDays("2027-10-30", 1), "2027-10-31");
    expect.equal(addDays("2027-03-31", 365), "2028-03-30");
    expect.equal(addDays("2027-01-01", -1), "2026-12-31");
    expect.equal(daysUntil(todayIso()), 0, "today is nought days away, in any timezone");
    expect.equal(daysUntil(addDays(todayIso(), 30)!), 30);
    expect.equal(daysUntil(addDays(todayIso(), -5)!), -5);
  });

  test("runs a term minus a day, including out of February", () => {
    expect.equal(expiryAfter("2026-04-01", 1), "2027-03-31");
    expect.equal(expiryAfter("2027-02-28", 1), "2028-02-27");
    expect.equal(
      expiryAfter("2026-04-01", 3),
      "2029-03-31",
      "a three-year term runs to the day before the third anniversary",
    );
    // A 29 February start has no anniversary in a common year.
    expect.equal(expiryAfter("2028-02-29", 1), "2029-02-27");
  });

  test("prints a date the way the setting asks", () => {
    expect.equal(formatDate("2027-03-31", "dd/MM/yyyy"), "31/03/2027");
    expect.equal(formatDate("2027-03-31", "dd MMM yyyy"), "31 Mar 2027");
    expect.equal(formatDate("2027-03-31", "yyyy-MM-dd"), "2027-03-31");
    expect.equal(formatDate("not a date", "dd/MM/yyyy"), "not a date", "left alone rather than blanked");
  });
});

suite("money and numbers", () => {
  test("strips whatever was typed around the number", () => {
    expect.equal(parseNumber("₹10,00,000"), 1_000_000);
    expect.equal(parseNumber("Rs. 24,500.50"), 24_500.5);
    expect.equal(parseNumber("-"), null);
    expect.equal(parseNumber(""), null);
  });

  test("groups rupees the Indian way", () => {
    expect.equal(formatMoney(1_000_000, "INR"), "₹10,00,000");
    expect.equal(formatMoney(24_500.5, "INR"), "₹24,500.50");
    expect.equal(formatMoney(999, "INR"), "₹999");
    expect.equal(formatMoney(1_00_00_00_000, "INR"), "₹1,00,00,00,000");
  });
});

suite("text the importer has to make sense of", () => {
  test("lands a product name in one of the categories the app knows", () => {
    expect.equal(normaliseCategory("Two Wheeler Insurance"), "motor");
    expect.equal(normaliseCategory("Overseas Travel"), "travel");
    expect.equal(normaliseCategory("Term Plan"), "life");
    expect.equal(normaliseCategory(""), "other");
    expect.equal(normaliseCategory("something nobody sells"), "other");
    for (const category of CATEGORIES) {
      expect.equal(normaliseCategory(category), category, "a category already ours is left alone");
    }
  });

  test("tidies the fields a human filled in", () => {
    expect.equal(normalisePhone("+91 98765-43210"), "+919876543210");
    expect.equal(normalisePhone("  "), null);
    expect.equal(normaliseGender("M"), "male");
    expect.equal(normaliseGender(""), null);
    expect.equal(normaliseRelationship("wife"), "spouse");
    expect.equal(normaliseRelationship("cousin"), "other");
    expect.equal(tidyName("RAJESH kumar"), "Rajesh Kumar");
    expect.equal(tidyName("SBI general"), "SBI General", "an initialism is not shouting");
  });

  test("knows an address it could send to from one it could not", () => {
    expect.ok(looksLikeEmail("a@b.co"));
    expect.ok(!looksLikeEmail("a@b"));
    expect.ok(!looksLikeEmail("no at sign"));
  });
});
