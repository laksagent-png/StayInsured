import { format, parseISO } from "date-fns";
import type { Category, PolicyStatus } from "./types";

const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const compact = new Intl.NumberFormat("en-IN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return currency.format(value);
}

/** Short form for tiles, where "₹1.2Cr" reads better than the full number. */
export function moneyCompact(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `₹${compact.format(value)}`;
}

export function count(value: number): string {
  return new Intl.NumberFormat("en-IN").format(value);
}

export function date(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return format(parseISO(value), "dd MMM yyyy");
  } catch {
    return value;
  }
}

export function dateInput(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "";
}

export function relativeDays(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days < 0) return `${Math.abs(days)} days ago`;
  return `in ${days} days`;
}

export const categoryLabels: Record<Category, string> = {
  health: "Health",
  life: "Life",
  motor: "Motor",
  travel: "Travel / International",
  home: "Home",
  personal_accident: "Personal Accident",
  critical_illness: "Critical Illness",
  other: "Other",
};

export function categoryLabel(category: string): string {
  return categoryLabels[category as Category] ?? "Other";
}

export const statusLabels: Record<PolicyStatus, string> = {
  active: "Active",
  expired: "Expired",
  renewed: "Renewed",
  lapsed: "Lapsed",
  cancelled: "Cancelled",
};

/** Colour by urgency so a long list can be scanned rather than read. */
export function urgencyTone(days: number, status: PolicyStatus): "danger" | "warning" | "ok" | "muted" {
  if (status === "renewed" || status === "cancelled") return "muted";
  if (days < 0) return "danger";
  if (days <= 15) return "danger";
  if (days <= 45) return "warning";
  return "ok";
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function titleCase(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
