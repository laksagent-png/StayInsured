/**
 * A port of `src-tauri/src/exporter.rs`.
 *
 * One list per export holds the header and the value beside each other, so a
 * spreadsheet and a csv of the same book cannot disagree about either the columns
 * or their order. What the columns hold is what the screens show — a category by
 * its label, a status as a word, an opt-out as "On" rather than as 0 — because an
 * export is read by a person, and often by a person the agency is sending it to.
 *
 * The Rust core writes xlsx through `rust_xlsxwriter` and csv through the `csv`
 * crate. Here SheetJS writes the workbook and the csv is written directly, which
 * is what keeps a csv from this edition the same file: SheetJS ends a row with a
 * bare newline and quotes fields by its own rules, and the `csv` crate does
 * neither.
 *
 * Two things about the workbook are the app's and cannot be had here: SheetJS
 * writes no cell styles, so the header row is plain rather than white on teal, and
 * it cannot freeze a pane. The cells, the column widths and the filter are the
 * same, and those are what the export is for.
 */

import fs from "node:fs";
import path from "node:path";

import * as XLSX from "xlsx";

import { AppError } from "./errors";
import type { Client, Policy } from "./types";
import { categoryLabel, riderLabel } from "./util";

/** A header paired with a value extractor, so xlsx and csv stay identical. */
type Column<T> = [string, (row: T) => string];

const POLICY_COLUMNS: Column<Policy>[] = [
  ["Client code", (p) => p.clientCode],
  ["Client name", (p) => p.clientName],
  ["Email", (p) => p.clientEmail ?? ""],
  ["Phone", (p) => p.clientPhone ?? ""],
  ["City", (p) => p.clientCity ?? ""],
  ["Policy number", (p) => p.policyNumber],
  ["Insurer", (p) => p.insurerName],
  ["Plan", (p) => p.productName ?? ""],
  ["Category", (p) => categoryLabel(p.category)],
  ["Status", (p) => titleCase(p.status)],
  ["Policy year", (p) => `${p.policyYear}`],
  ["Start date", (p) => p.startDate],
  ["Expiry date", (p) => p.expiryDate],
  ["Days to expiry", (p) => `${p.daysToExpiry}`],
  ["Sum insured", (p) => number(p.sumInsured)],
  ["Premium", (p) => number(p.premiumAmount)],
  ["GST", (p) => number(p.gstAmount)],
  ["Frequency", (p) => titleCase(p.premiumFrequency)],
  ["Payment mode", (p) => p.paymentMode ?? ""],
  ["Commission %", (p) => number(p.commissionRate)],
  ["Commission amount", (p) => number(p.commissionExpected)],
  ["Nominee", (p) => p.nomineeName ?? ""],
  ["Vehicle number", (p) => p.vehicleNumber ?? ""],
  // The health detail. Every category gets the columns and only health fills
  // them in: one sheet the agency can sort and hand over beats a second sheet
  // to line up against this one.
  ["Variant", (p) => p.variant ?? ""],
  ["Riders", (p) => p.riders.map(riderLabel).join(", ")],
  ["Plan type", (p) => (p.planType === null ? "" : titleCase(p.planType))],
  ["Term (years)", (p) => (p.term === null ? "" : String(p.term))],
  ["Policy type", (p) => (p.policyType === null ? "" : titleCase(p.policyType))],
  ["Broker", (p) => p.broker ?? ""],
  ["Inbuilt rider", (p) => p.inbuiltRider ?? ""],
  ["Notes", (p) => p.notes ?? ""],
];

const CLIENT_COLUMNS: Column<Client>[] = [
  ["Client code", (c) => c.clientCode],
  ["Name", (c) => c.fullName],
  ["Email", (c) => c.email ?? ""],
  ["Phone", (c) => c.phone ?? ""],
  ["Alternate phone", (c) => c.altPhone ?? ""],
  ["Date of birth", (c) => c.dateOfBirth ?? ""],
  ["Gender", (c) => c.gender ?? ""],
  [
    "Address",
    (c) =>
      [c.addressLine1, c.addressLine2].filter((line): line is string => line !== null).join(", "),
  ],
  ["City", (c) => c.city ?? ""],
  ["State", (c) => c.state ?? ""],
  ["Pincode", (c) => c.pincode ?? ""],
  ["Occupation", (c) => c.occupation ?? ""],
  ["PAN", (c) => c.pan ?? ""],
  ["Active policies", (c) => `${c.activePolicies}`],
  ["Total policies", (c) => `${c.totalPolicies}`],
  ["Next expiry", (c) => c.nextExpiry ?? ""],
  ["Reminders", (c) => (c.remindersOptedOut ? "Opted out" : "On")],
  ["Notes", (c) => c.notes ?? ""],
];

export function exportPolicies(rows: Policy[], target: string): number {
  write(target, "Policies", headers(POLICY_COLUMNS), values(POLICY_COLUMNS, rows));
  return rows.length;
}

export function exportClients(rows: Client[], target: string): number {
  write(target, "Clients", headers(CLIENT_COLUMNS), values(CLIENT_COLUMNS, rows));
  return rows.length;
}

function headers<T>(columns: Column<T>[]): string[] {
  return columns.map(([header]) => header);
}

function values<T>(columns: Column<T>[], rows: T[]): string[][] {
  return rows.map((row) => columns.map(([, get]) => get(row)));
}

function write(target: string, sheetName: string, headings: string[], rows: string[][]): void {
  // A name carrying no extension at all is a spreadsheet, which is what the save
  // dialog offers first. `Path::extension` answering None is where the Rust core
  // decides the same thing.
  const suffix = path.extname(target);
  const extension = suffix === "" ? "xlsx" : suffix.slice(1).toLowerCase();

  switch (extension) {
    case "csv":
      writeCsv(target, headings, rows);
      return;
    case "xlsx":
      writeXlsx(target, sheetName, headings, rows);
      return;
    default:
      throw AppError.validation(`Cannot export to .${extension} files — choose .xlsx or .csv`);
  }
}

/** The `csv` crate's defaults: CRLF endings, and a field quoted only when it must be. */
function writeCsv(target: string, headings: string[], rows: string[][]): void {
  const lines = [headings, ...rows].map((row) => row.map(quoted).join(","));
  try {
    fs.writeFileSync(target, lines.map((line) => `${line}\r\n`).join(""));
  } catch (error) {
    throw AppError.spreadsheet(error);
  }
}

function quoted(value: string): string {
  return /["\r\n,]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function writeXlsx(target: string, sheetName: string, headings: string[], rows: string[][]): void {
  const sheet = XLSX.utils.aoa_to_sheet([headings, ...rows.map((row) => row.map(cell))]);

  sheet["!cols"] = headings.map(() => ({ wch: 18 }));
  sheet["!autofilter"] = {
    // An empty export still gets a filter over one row, as it does in Rust, so the
    // header behaves the same in a workbook nobody had anything to put in.
    ref: XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: Math.max(rows.length, 1), c: headings.length - 1 },
    }),
  };

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, sheetName);

  try {
    // The bytes are built in memory and written here rather than through
    // `XLSX.writeFile`, so the file the operator named is what decides the format
    // and not what SheetJS guesses from its extension — an export to a name with no
    // extension is still a workbook.
    fs.writeFileSync(target, XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer);
  } catch (error) {
    throw AppError.spreadsheet(error);
  }
}

/**
 * Numbers go in as numbers so totals and sorting work in Excel. Fifteen digits is
 * where a run of them stops being a number and starts being an identifier — a
 * policy or an Aadhaar number rounded into scientific notation is worse than one
 * Excel refuses to sum.
 */
function cell(value: string): string | number {
  const parsed = asNumber(value);
  return parsed === null || value === "" || value.length >= 15 ? value : parsed;
}

/**
 * What `str::parse::<f64>()` accepts, which is narrower than `Number()`: that
 * reads "" as zero, takes hex, and ignores surrounding space.
 */
function asNumber(value: string): number | null {
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Money and rates: whole amounts without a decimal point, the rest with two. */
function number(value: number | null): string {
  if (value === null) return "";
  return Number.isInteger(value) ? `${value}` : value.toFixed(2);
}

/** A stored word — `active`, `half_yearly` — as a person reads it. */
function titleCase(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced === "" ? "" : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
