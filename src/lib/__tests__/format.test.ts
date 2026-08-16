/**
 * The formatters every screen reads through.
 *
 * A number that reads wrongly here reads wrongly on every list, tile and form
 * in the app, so the awkward values — nothing, zero, negatives, the boundaries
 * — matter more than the tidy ones.
 */

import { describe, expect, it } from "vitest";

import {
  categoryLabel,
  categoryLabels,
  count,
  date,
  dateInput,
  fileSize,
  initials,
  money,
  moneyCompact,
  relativeDays,
  statusLabels,
  titleCase,
  urgencyTone,
} from "@/lib/format";

describe("money", () => {
  it("writes whole rupees in the Indian grouping", () => {
    expect(money(0)).toBe("₹0");
    expect(money(999)).toBe("₹999");
    expect(money(12_500)).toBe("₹12,500");
    expect(money(150_000)).toBe("₹1,50,000");
    expect(money(12_500_000)).toBe("₹1,25,00,000");
  });

  it("shows a dash when there is no amount at all", () => {
    expect(money(null)).toBe("—");
    expect(money(undefined)).toBe("—");
  });

  it("keeps a refund readable, with the minus ahead of the symbol", () => {
    expect(money(-5_000)).toBe("-₹5,000");
    expect(money(-1_500.5)).toBe("-₹1,501");
  });

  it("rounds paise away rather than showing them", () => {
    expect(money(1_234.56)).toBe("₹1,235");
    expect(money(1_234.4)).toBe("₹1,234");
  });
});

describe("moneyCompact", () => {
  it("shortens lakhs and crores for the tiles", () => {
    expect(moneyCompact(1_500)).toBe("₹1.5K");
    expect(moneyCompact(150_000)).toBe("₹1.5L");
    expect(moneyCompact(15_000_000)).toBe("₹1.5Cr");
    expect(moneyCompact(1_000_000_000)).toBe("₹100Cr");
  });

  it("leaves small amounts alone", () => {
    expect(moneyCompact(0)).toBe("₹0");
    expect(moneyCompact(999)).toBe("₹999");
  });

  it("shows a dash when there is no amount at all", () => {
    expect(moneyCompact(null)).toBe("—");
    expect(moneyCompact(undefined)).toBe("—");
  });

  it("rounds to one decimal, which can push a total over the next unit", () => {
    expect(moneyCompact(12_500_000)).toBe("₹1.3Cr");
    // ₹9,99,999 reads as ₹10L: a tile can claim a lakh more than the book holds.
    expect(moneyCompact(999_999)).toBe("₹10L");
  });

  it("keeps the minus ahead of the symbol, the way money does", () => {
    expect(moneyCompact(-500_000)).toBe("-₹5L");
  });
});

describe("count", () => {
  it("groups the Indian way", () => {
    expect(count(0)).toBe("0");
    expect(count(17)).toBe("17");
    expect(count(1_000)).toBe("1,000");
    expect(count(1_234_567)).toBe("12,34,567");
  });
});

describe("fileSize", () => {
  it("rounds anything under a megabyte to whole kilobytes", () => {
    expect(fileSize(1024)).toBe("1 KB");
    expect(fileSize(2048)).toBe("2 KB");
    expect(fileSize(123_456)).toBe("121 KB");
  });

  it("floors a small attachment at 1 KB rather than rounding it to nothing", () => {
    expect(fileSize(400)).toBe("1 KB");
    expect(fileSize(1)).toBe("1 KB");
  });

  it("switches to megabytes at a megabyte", () => {
    expect(fileSize(1024 * 1024)).toBe("1.0 MB");
    expect(fileSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(fileSize(1_572_864)).toBe("1.5 MB");
  });

  it("rolls up to megabytes instead of printing 1024 KB", () => {
    expect(fileSize(1024 * 1024 - 1)).toBe("1.0 MB");
  });

  it("says an empty file is empty", () => {
    expect(fileSize(0)).toBe("0 KB");
  });
});

describe("date", () => {
  it("writes an ISO date the way the app reads dates", () => {
    expect(date("2026-08-14")).toBe("14 Aug 2026");
    expect(date("2026-01-01")).toBe("01 Jan 2026");
  });

  it("takes the date out of a full timestamp", () => {
    expect(date("2026-08-14T15:45:00")).toBe("14 Aug 2026");
    // The shape SQLite stores, with a space instead of a T.
    expect(date("2026-08-14 10:00:00")).toBe("14 Aug 2026");
  });

  it("shows a dash when there is no date", () => {
    expect(date(null)).toBe("—");
    expect(date(undefined)).toBe("—");
    expect(date("")).toBe("—");
  });

  it("hands back anything it cannot read, rather than showing nonsense", () => {
    expect(date("not a date")).toBe("not a date");
    expect(date("14/08/2026")).toBe("14/08/2026");
    expect(date("2026-02-30")).toBe("2026-02-30");
  });
});

describe("dateInput", () => {
  it("gives a date field the yyyy-mm-dd it needs", () => {
    expect(dateInput("2026-08-14")).toBe("2026-08-14");
    expect(dateInput("2026-08-14T15:45:00")).toBe("2026-08-14");
    expect(dateInput("2026-08-14 10:00:00")).toBe("2026-08-14");
  });

  it("empties the field when there is no date", () => {
    expect(dateInput(null)).toBe("");
    expect(dateInput(undefined)).toBe("");
    expect(dateInput("")).toBe("");
  });
});

describe("relativeDays", () => {
  it("names the days either side of today", () => {
    expect(relativeDays(0)).toBe("Today");
    expect(relativeDays(1)).toBe("Tomorrow");
    expect(relativeDays(-1)).toBe("Yesterday");
  });

  it("counts forwards and backwards from there", () => {
    expect(relativeDays(7)).toBe("in 7 days");
    expect(relativeDays(45)).toBe("in 45 days");
    expect(relativeDays(-7)).toBe("7 days ago");
    expect(relativeDays(-30)).toBe("30 days ago");
  });

  it("stays in days however far away the date is", () => {
    expect(relativeDays(365)).toBe("in 365 days");
    expect(relativeDays(-400)).toBe("400 days ago");
  });
});

describe("categoryLabel", () => {
  it("labels every category the app knows", () => {
    expect(categoryLabel("health")).toBe("Health");
    expect(categoryLabel("life")).toBe("Life");
    expect(categoryLabel("motor")).toBe("Motor");
    expect(categoryLabel("travel")).toBe("Travel / International");
    expect(categoryLabel("home")).toBe("Home");
    expect(categoryLabel("personal_accident")).toBe("Personal Accident");
    expect(categoryLabel("critical_illness")).toBe("Critical Illness");
    expect(categoryLabel("other")).toBe("Other");
  });

  it("keeps the table and the lookup in step", () => {
    for (const [key, label] of Object.entries(categoryLabels)) {
      expect(categoryLabel(key)).toBe(label);
    }
  });

  it("falls back to Other for a category it has never heard of", () => {
    expect(categoryLabel("pet")).toBe("Other");
    expect(categoryLabel("")).toBe("Other");
  });

  it("falls back to Other for a category named after an Object member", () => {
    expect(categoryLabel("toString")).toBe("Other");
    expect(categoryLabel("constructor")).toBe("Other");
  });
});

describe("statusLabels", () => {
  it("names every status a policy can hold", () => {
    expect(statusLabels).toEqual({
      active: "Active",
      expired: "Expired",
      renewed: "Renewed",
      lapsed: "Lapsed",
      cancelled: "Cancelled",
    });
  });
});

describe("urgencyTone", () => {
  it("shouts about a policy that has already expired", () => {
    expect(urgencyTone(-1, "active")).toBe("danger");
    expect(urgencyTone(-30, "expired")).toBe("danger");
    expect(urgencyTone(-400, "lapsed")).toBe("danger");
  });

  it("shouts up to a fortnight out", () => {
    expect(urgencyTone(0, "active")).toBe("danger");
    expect(urgencyTone(7, "active")).toBe("danger");
    expect(urgencyTone(15, "active")).toBe("danger");
  });

  it("warns from sixteen days to forty-five", () => {
    expect(urgencyTone(16, "active")).toBe("warning");
    expect(urgencyTone(45, "active")).toBe("warning");
  });

  it("relaxes past forty-five days", () => {
    expect(urgencyTone(46, "active")).toBe("ok");
    expect(urgencyTone(365, "active")).toBe("ok");
  });

  it("mutes a policy that has been dealt with, whatever its dates say", () => {
    expect(urgencyTone(5, "renewed")).toBe("muted");
    expect(urgencyTone(5, "cancelled")).toBe("muted");
    // The status is checked before the days are, so an expired-but-cancelled
    // policy stays quiet rather than joining the overdue reds.
    expect(urgencyTone(-30, "renewed")).toBe("muted");
    expect(urgencyTone(-30, "cancelled")).toBe("muted");
  });
});

describe("initials", () => {
  it("takes the first letter of the first two names", () => {
    expect(initials("Rohit")).toBe("R");
    expect(initials("Rohit Sharma")).toBe("RS");
    expect(initials("Rohit Kumar Sharma")).toBe("RK");
  });

  it("ignores the spacing a pasted name arrives with", () => {
    expect(initials("  Rohit   Sharma  ")).toBe("RS");
    expect(initials(" Anita")).toBe("A");
  });

  it("copes with a name that is barely there", () => {
    expect(initials("")).toBe("");
    expect(initials("   ")).toBe("");
    expect(initials("a")).toBe("A");
  });
});

describe("titleCase", () => {
  it("turns a stored key into a heading", () => {
    expect(titleCase("snake_case")).toBe("Snake Case");
    expect(titleCase("smtp_from_email")).toBe("Smtp From Email");
    expect(titleCase("expiry_reminder")).toBe("Expiry Reminder");
  });

  it("leaves a written label as it is", () => {
    expect(titleCase("Already Capitalised")).toBe("Already Capitalised");
    expect(titleCase("Health")).toBe("Health");
  });

  it("copes with nothing to case", () => {
    expect(titleCase("")).toBe("");
  });
});
