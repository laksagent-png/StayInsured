/**
 * A port of `src-tauri/src/importer.rs`.
 *
 * Reading someone else's spreadsheet is where the two editions are most likely to
 * disagree without anyone noticing. calamine and SheetJS will both hand back "the
 * value in that cell", but they do not agree on what a date is, and a file read as
 * 4 January instead of 1 April imports perfectly cleanly and puts the renewal on
 * the wrong day. So cells are converted here rather than by the library's own
 * formatter, and delimited files are parsed here rather than handed to SheetJS,
 * whose CSV reader guesses at dates month-first the way the `csv` crate never
 * does.
 *
 * Everything else follows `importer.rs`: the field catalogue and its synonyms, the
 * two-pass header matching, one transaction for the run with a savepoint per row,
 * and the counters wound back when a row is dropped.
 */

import fs from "node:fs";
import path from "node:path";

import * as XLSX from "xlsx";

import type { Conn } from "./db";
import { AppError, describe } from "./errors";
import * as clients from "./repo/clients";
import * as insurers from "./repo/insurers";
import * as policies from "./repo/policies";
import * as products from "./repo/products";
import * as relations from "./repo/relations";
import type {
  ImportFieldInfo,
  ImportOptions,
  ImportPreview,
  ImportReport,
  PolicyInput,
} from "./types";
import {
  addDays,
  looksLikeEmail,
  normaliseCategory,
  normaliseGender,
  normalisePhone,
  parseDate,
  parseNumber,
  todayIso,
} from "./util";

/** A field the importer can fill, with the header names it recognises. */
export interface FieldSpec {
  key: string;
  label: string;
  group: string;
  required: boolean;
  synonyms: string[];
}

export const FIELDS: FieldSpec[] = [
  {
    key: "fullName",
    label: "Client name",
    group: "Client",
    required: true,
    synonyms: [
      "client name",
      "customer name",
      "name",
      "insured name",
      "proposer name",
      "policy holder",
      "policyholder",
      "holder name",
    ],
  },
  {
    key: "clientCode",
    label: "Client code",
    group: "Client",
    required: false,
    synonyms: ["client code", "client id", "customer id", "customer code", "code", "ref", "reference"],
  },
  {
    key: "email",
    label: "Email",
    group: "Client",
    required: false,
    synonyms: ["email", "email id", "e mail", "mail", "email address"],
  },
  {
    key: "phone",
    label: "Mobile",
    group: "Client",
    required: false,
    synonyms: ["phone", "mobile", "mobile no", "contact", "contact no", "cell", "phone number"],
  },
  {
    key: "altPhone",
    label: "Alternate phone",
    group: "Client",
    required: false,
    synonyms: ["alt phone", "alternate phone", "landline", "secondary phone", "phone 2"],
  },
  {
    key: "dateOfBirth",
    label: "Date of birth",
    group: "Client",
    required: false,
    synonyms: ["dob", "date of birth", "birth date", "birthday"],
  },
  {
    key: "gender",
    label: "Gender",
    group: "Client",
    required: false,
    synonyms: ["gender", "sex"],
  },
  {
    key: "addressLine1",
    label: "Address",
    group: "Client",
    required: false,
    synonyms: ["address", "address 1", "address line 1", "street"],
  },
  {
    key: "addressLine2",
    label: "Address line 2",
    group: "Client",
    required: false,
    synonyms: ["address 2", "address line 2", "locality", "area"],
  },
  {
    key: "city",
    label: "City",
    group: "Client",
    required: false,
    synonyms: ["city", "town", "district"],
  },
  {
    key: "state",
    label: "State",
    group: "Client",
    required: false,
    synonyms: ["state", "province"],
  },
  {
    key: "pincode",
    label: "Pincode",
    group: "Client",
    required: false,
    synonyms: ["pincode", "pin code", "postal code", "zip", "zipcode", "pin"],
  },
  {
    key: "occupation",
    label: "Occupation",
    group: "Client",
    required: false,
    synonyms: ["occupation", "profession", "job"],
  },
  {
    key: "pan",
    label: "PAN",
    group: "Client",
    required: false,
    synonyms: ["pan", "pan no", "pan number"],
  },
  {
    key: "policyNumber",
    label: "Policy number",
    group: "Policy",
    required: true,
    synonyms: ["policy no", "policy number", "policy", "certificate no", "policy id"],
  },
  {
    key: "insurerName",
    label: "Insurer",
    group: "Policy",
    required: true,
    synonyms: [
      "insurer",
      "insurance company",
      "company",
      "insurance provider",
      "underwriter",
      "insurer name",
    ],
  },
  {
    key: "productName",
    label: "Plan / product",
    group: "Policy",
    required: false,
    synonyms: ["product", "plan", "plan name", "product name", "scheme", "policy type name"],
  },
  {
    key: "category",
    label: "Category",
    group: "Policy",
    required: false,
    synonyms: [
      "category",
      "type",
      "policy type",
      "line of business",
      "lob",
      "segment",
      "product category",
    ],
  },
  {
    key: "startDate",
    label: "Start date",
    group: "Policy",
    required: false,
    synonyms: [
      "start date",
      "from date",
      "issue date",
      "commencement",
      "risk start",
      "inception",
      "policy start",
    ],
  },
  {
    key: "expiryDate",
    label: "Expiry date",
    group: "Policy",
    required: true,
    synonyms: [
      "expiry date",
      "expiry",
      "end date",
      "to date",
      "valid till",
      "renewal date",
      "due date",
      "maturity date",
      "policy end",
    ],
  },
  {
    key: "sumInsured",
    label: "Sum insured",
    group: "Policy",
    required: false,
    synonyms: ["sum insured", "sum assured", "si", "cover", "coverage", "cover amount"],
  },
  {
    key: "premiumAmount",
    label: "Premium",
    group: "Policy",
    required: false,
    synonyms: ["premium", "premium amount", "gross premium", "total premium", "amount"],
  },
  {
    key: "gstAmount",
    label: "GST",
    group: "Policy",
    required: false,
    synonyms: ["gst", "tax", "gst amount", "service tax"],
  },
  {
    key: "premiumFrequency",
    label: "Premium frequency",
    group: "Policy",
    required: false,
    synonyms: ["frequency", "premium frequency", "payment frequency", "mode of payment term"],
  },
  {
    key: "paymentMode",
    label: "Payment mode",
    group: "Policy",
    required: false,
    synonyms: ["payment mode", "mode", "paid by", "payment method"],
  },
  {
    key: "commissionRate",
    label: "Commission %",
    group: "Policy",
    required: false,
    synonyms: ["commission rate", "commission %", "comm %", "brokerage %", "commission percent"],
  },
  {
    key: "commissionExpected",
    label: "Commission amount",
    group: "Policy",
    required: false,
    synonyms: ["commission", "commission amount", "brokerage", "payout"],
  },
  {
    key: "nomineeName",
    label: "Nominee",
    group: "Policy",
    required: false,
    synonyms: ["nominee", "nominee name", "beneficiary"],
  },
  {
    key: "nomineeRelation",
    label: "Nominee relation",
    group: "Policy",
    required: false,
    synonyms: ["nominee relation", "nominee relationship", "relation with nominee"],
  },
  {
    key: "vehicleNumber",
    label: "Vehicle number",
    group: "Policy",
    required: false,
    synonyms: ["vehicle no", "vehicle number", "registration no", "reg no", "rc number"],
  },
  {
    key: "memberNames",
    label: "Covered members",
    group: "Policy",
    required: false,
    synonyms: ["members", "insured members", "covered members", "family members", "lives covered"],
  },
  {
    key: "notes",
    label: "Notes",
    group: "Policy",
    required: false,
    synonyms: ["notes", "remarks", "comments", "description"],
  },
];

export function fieldCatalogue(): ImportFieldInfo[] {
  return FIELDS.map((field) => ({
    key: field.key,
    label: field.label,
    group: field.group,
    required: field.required,
  }));
}

/** Header row plus data rows, already flattened to strings. */
export interface Sheet {
  headers: string[];
  rows: string[][];
  sheetNames: string[];
  sheet: string;
}

export function readSheet(file: string, sheet: string | null): Sheet {
  const extension = path.extname(file).replace(/^\./, "").toLowerCase();

  if (extension === "csv" || extension === "txt" || extension === "tsv") {
    return readDelimited(file, extension);
  }

  let book: XLSX.WorkBook;
  try {
    // Dates as `Date` objects rather than serial numbers, which is what the
    // `dates` feature buys calamine. The formatted text SheetJS can also produce
    // is deliberately left off: it would round a premium to the two decimals the
    // cell happens to display.
    book = XLSX.readFile(file, { cellDates: true, cellText: false, cellNF: false });
  } catch (error) {
    throw AppError.spreadsheet(`could not open the file: ${describe(error)}`);
  }

  const sheetNames = [...book.SheetNames];
  const chosen = sheet !== null && sheetNames.includes(sheet) ? sheet : sheetNames[0];
  if (chosen === undefined) throw AppError.spreadsheet("the workbook has no sheets");

  const worksheet = book.Sheets[chosen];
  if (worksheet === undefined) throw AppError.spreadsheet(`could not read sheet ${chosen}`);

  const grid = cellGrid(worksheet);
  const headers = grid.shift();
  if (headers === undefined) throw AppError.spreadsheet("the sheet is empty");

  return {
    headers,
    rows: grid.filter((row) => row.some((cell) => cell !== "")),
    sheetNames,
    sheet: chosen,
  };
}

/**
 * The cells of a worksheet as a rectangle of strings, bounded by the cells that
 * hold something — calamine's used range, rather than the dimension the file
 * declares, which can be larger than what anyone typed.
 */
function cellGrid(sheet: XLSX.WorkSheet): string[][] {
  const values = new Map<string, string>();
  let top = Infinity;
  let bottom = -Infinity;
  let left = Infinity;
  let right = -Infinity;

  for (const key of Object.keys(sheet)) {
    if (key.startsWith("!")) continue;
    const text = cellToString(sheet[key] as XLSX.CellObject);
    if (text === "") continue;

    const { r, c } = XLSX.utils.decode_cell(key);
    values.set(`${r}:${c}`, text);
    top = Math.min(top, r);
    bottom = Math.max(bottom, r);
    left = Math.min(left, c);
    right = Math.max(right, c);
  }

  if (values.size === 0) return [];

  const grid: string[][] = [];
  for (let r = top; r <= bottom; r += 1) {
    const row: string[] = [];
    for (let c = left; c <= right; c += 1) row.push(values.get(`${r}:${c}`) ?? "");
    grid.push(row);
  }
  return grid;
}

function cellToString(cell: XLSX.CellObject | undefined): string {
  if (cell === undefined || cell.v === undefined || cell.v === null) return "";
  switch (cell.t) {
    case "s":
      return String(cell.v).trim();
    case "n":
      return numberToString(cell.v as number);
    case "b":
      return cell.v ? "true" : "false";
    case "d":
      return dateToIso(cell.v as Date);
    default:
      // A formula error, or a stub with no value. Rust reads both as blank.
      return "";
  }
}

/**
 * A whole number keeps its digits and nothing else: a policy number typed into a
 * numeric cell must not come back as 9.18273e14, and a premium of 24500 must not
 * arrive as 24500.0 and fail to match the one already in the book.
 */
function numberToString(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return value.toFixed(0);
  return `${value}`;
}

/**
 * SheetJS builds a date cell from the serial with `Date.UTC`, so the calendar day
 * the spreadsheet holds is the one in the UTC fields. Reading the local ones would
 * move a 1 April expiry to 31 March for anyone west of Greenwich.
 */
function dateToIso(value: Date): string {
  if (Number.isNaN(value.getTime())) return "";
  const month = `${value.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${value.getUTCDate()}`.padStart(2, "0");
  return `${value.getUTCFullYear()}-${month}-${day}`;
}

function readDelimited(file: string, extension: string): Sheet {
  const delimiter = extension === "tsv" ? "\t" : ",";

  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw AppError.spreadsheet(describe(error));
  }

  const records = parseDelimited(text, delimiter);
  const headers = (records.shift() ?? []).map((field) => field.trim());
  const rows = records
    .map((record) => record.map((field) => field.trim()))
    .filter((row) => row.some((cell) => cell !== ""));

  return { headers, rows, sheetNames: ["Sheet1"], sheet: "Sheet1" };
}

/**
 * The `csv` crate's reader, in the shape this file needs it: quotes only count at
 * the start of a field, a doubled quote inside one is a literal quote, and a line
 * with nothing on it is not a record. Rows of differing lengths are kept, which is
 * `flexible(true)` on the Rust side and is what lets a half-filled export through.
 */
function parseDelimited(text: string, delimiter: string): string[][] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]!;

    if (quoted) {
      if (char !== '"') {
        field += char;
      } else if (body[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = false;
      }
      continue;
    }

    if (char === '"' && field === "") {
      quoted = true;
      started = true;
    } else if (char === delimiter) {
      record.push(field);
      field = "";
      started = true;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && body[index + 1] === "\n") index += 1;
      if (started || field !== "") {
        record.push(field);
        records.push(record);
      }
      record = [];
      field = "";
      started = false;
    } else {
      field += char;
    }
  }

  if (started || field !== "") {
    record.push(field);
    records.push(record);
  }
  return records;
}

function normaliseHeader(header: string): string {
  return Array.from(header)
    .map((char) => (/[\p{L}\p{N}]/u.test(char) ? char.toLowerCase() : " "))
    .join("")
    .split(/\s+/)
    .filter((word) => word !== "")
    .join(" ");
}

/**
 * Matches spreadsheet headers to fields: exact synonym first, then containment,
 * so "Policy Expiry Date (DD/MM/YYYY)" still lands on expiryDate.
 */
export function suggestMapping(headers: string[]): Record<string, string> {
  const normalised = headers.map(normaliseHeader);
  const mapping = new Map<string, string>();
  const taken = headers.map(() => false);

  for (let pass = 0; pass < 2; pass += 1) {
    for (const field of FIELDS) {
      if (mapping.has(field.key)) continue;
      for (let index = 0; index < normalised.length; index += 1) {
        const header = normalised[index]!;
        if (taken[index] || header === "") continue;
        const hit = field.synonyms.some((synonym) =>
          pass === 0 ? header === synonym : header.includes(synonym),
        );
        if (hit) {
          mapping.set(field.key, headers[index]!);
          taken[index] = true;
          break;
        }
      }
    }
  }

  return Object.fromEntries(mapping);
}

export function preview(file: string, sheet: string | null): ImportPreview {
  const data = readSheet(file, sheet);
  const suggested = suggestMapping(data.headers);
  const mapped = Object.values(suggested);

  return {
    fileName: path.basename(file),
    sheetNames: data.sheetNames,
    sheet: data.sheet,
    headers: data.headers,
    sampleRows: data.rows.slice(0, 8),
    totalRows: data.rows.length,
    suggestedMapping: suggested,
    unmappedHeaders: data.headers.filter((header) => header !== "" && !mapped.includes(header)),
  };
}

/**
 * The cell a row failed on, so the report can point at it rather than at the
 * row: "row 4, Expiry Date, `31-02-2026`" is fixable, "row 4" is a hunt.
 */
interface Blame {
  column: string;
  value: string | null;
}

/** Reads a mapped value out of a row. */
class RowReader {
  constructor(
    private readonly row: string[],
    private readonly headers: string[],
    private readonly indexes: Map<string, number>,
  ) {}

  get(field: string): string | null {
    const index = this.indexes.get(field);
    if (index === undefined) return null;
    const value = this.row[index]?.trim() ?? "";
    return value === "" ? null : value;
  }

  /**
   * Which column a field was read from, and what it held. A field that was never
   * mapped has no column to blame, and a blank cell has no value.
   */
  blame(field: string): Blame | null {
    const index = this.indexes.get(field);
    if (index === undefined) return null;
    const column = this.headers[index];
    if (column === undefined) return null;
    return { column, value: this.get(field) };
  }
}

/** Counters that must be wound back when a row is rolled back. */
type Counters = Pick<
  ImportReport,
  "policiesInserted" | "policiesUpdated" | "clientsCreated" | "clientsUpdated" | "insurersCreated"
>;

function counters(report: ImportReport): Counters {
  return {
    policiesInserted: report.policiesInserted,
    policiesUpdated: report.policiesUpdated,
    clientsCreated: report.clientsCreated,
    clientsUpdated: report.clientsUpdated,
    insurersCreated: report.insurersCreated,
  };
}

/**
 * Keeps the issue list bounded; a broken file should not produce a report with
 * fifty thousand lines in it.
 */
const ISSUE_CAP = 300;

function note(report: ImportReport, row: number, message: string, blame: Blame | null): void {
  if (report.issues.length >= ISSUE_CAP) return;
  report.issues.push({
    row,
    column: blame?.column ?? null,
    value: blame?.value ?? null,
    message,
  });
}

export function run(conn: Conn, options: ImportOptions): ImportReport {
  const data = readSheet(options.path, options.sheet ?? null);
  const dryRun = options.dryRun ?? false;
  const updateExisting = options.updateExisting ?? true;

  // Resolve the mapping to column positions once.
  const indexes = new Map<string, number>();
  for (const [field, header] of Object.entries(options.mapping)) {
    if (header.trim() === "") continue;
    const index = data.headers.indexOf(header);
    if (index === -1) throw AppError.validation(`The file has no column called "${header}"`);
    indexes.set(field, index);
  }

  for (const field of FIELDS) {
    if (field.required && !indexes.has(field.key)) {
      throw AppError.validation(`${field.label} still needs to be mapped to a column`);
    }
  }

  const report: ImportReport = {
    dryRun,
    totalRows: data.rows.length,
    policiesInserted: 0,
    policiesUpdated: 0,
    clientsCreated: 0,
    clientsUpdated: 0,
    insurersCreated: 0,
    skipped: 0,
    failed: 0,
    issues: [],
  };

  // Everything happens in one transaction: a dry run rolls it back, and a real
  // run either lands completely or not at all.
  conn.exec("BEGIN");
  try {
    importRows(conn, data, indexes, options, updateExisting, report);
  } catch (error) {
    conn.exec("ROLLBACK");
    throw error;
  }

  if (dryRun) {
    conn.exec("ROLLBACK");
  } else {
    recordBatch(conn, options.path, options, report);
    conn.exec("COMMIT");
  }

  return report;
}

function importRows(
  conn: Conn,
  data: Sheet,
  indexes: Map<string, number>,
  options: ImportOptions,
  updateExisting: boolean,
  report: ImportReport,
): void {
  const defaultCategory = options.defaultCategory ?? "other";

  for (let offset = 0; offset < data.rows.length; offset += 1) {
    // +2 because row 1 is the header and spreadsheets are 1-indexed.
    const rowNumber = offset + 2;
    const reader = new RowReader(data.rows[offset]!, data.headers, indexes);

    // Each row is its own savepoint. Without this, a row that creates a client
    // and then fails on the policy would leave the half-built client behind.
    const saved = counters(report);
    conn.exec("SAVEPOINT import_row");

    // The cell to blame, when the failure is about one in particular.
    const blamed: { field: string | null } = { field: null };

    try {
      const outcome = importRow(conn, reader, defaultCategory, updateExisting, report, blamed);
      conn.exec("RELEASE import_row");
      if (outcome.kind === "skipped") {
        report.skipped += 1;
        note(report, rowNumber, outcome.reason, blamed.field === null ? null : reader.blame(blamed.field));
      }
    } catch (error) {
      conn.exec("ROLLBACK TO import_row; RELEASE import_row");
      Object.assign(report, saved);
      report.failed += 1;
      note(
        report,
        rowNumber,
        describe(error),
        blamed.field === null ? null : reader.blame(blamed.field),
      );
    }
  }
}

type RowOutcome = { kind: "inserted" | "updated" } | { kind: "skipped"; reason: string };

function importRow(
  conn: Conn,
  reader: RowReader,
  defaultCategory: string,
  updateExisting: boolean,
  report: ImportReport,
  blamed: { field: string | null },
): RowOutcome {
  const name = reader.get("fullName");
  if (name === null) {
    blamed.field = "fullName";
    throw AppError.validation("Client name is blank");
  }

  const rawEmail = reader.get("email");
  // A malformed address should not sink the row; it is reported and dropped.
  const email = rawEmail !== null && looksLikeEmail(rawEmail) ? rawEmail : null;
  const rawPhone = reader.get("phone");
  const phone = rawPhone === null ? null : normalisePhone(rawPhone);
  const code = reader.get("clientCode");

  let clientId = clients.findMatch(conn, code, email, phone, name);
  if (clientId === null) {
    const rawGender = reader.get("gender");
    clientId = clients.create(conn, {
      clientCode: code,
      fullName: name,
      email,
      phone,
      altPhone: reader.get("altPhone"),
      dateOfBirth: reader.get("dateOfBirth"),
      gender: rawGender === null ? null : normaliseGender(rawGender),
      addressLine1: reader.get("addressLine1"),
      addressLine2: reader.get("addressLine2"),
      city: reader.get("city"),
      state: reader.get("state"),
      pincode: reader.get("pincode"),
      occupation: reader.get("occupation"),
      pan: reader.get("pan"),
    });
    report.clientsCreated += 1;
  } else if (updateExisting && fillClientGaps(conn, clientId, reader)) {
    report.clientsUpdated += 1;
  }

  const policyNumber = reader.get("policyNumber");
  if (policyNumber === null) {
    blamed.field = "policyNumber";
    throw AppError.validation("Policy number is blank");
  }
  const insurerName = reader.get("insurerName");
  if (insurerName === null) {
    blamed.field = "insurerName";
    throw AppError.validation("Insurer is blank");
  }

  const insurersBefore = insurerCount(conn);
  const insurerId = insurers.findOrCreate(conn, insurerName);
  if (insurerCount(conn) > insurersBefore) report.insurersCreated += 1;

  const productName = reader.get("productName");
  const categoryCell = reader.get("category");
  const category =
    categoryCell !== null
      ? normaliseCategory(categoryCell)
      : productName !== null
        ? normaliseCategory(productName)
        : defaultCategory;

  const productId =
    productName === null ? null : products.findOrCreate(conn, insurerId, productName, category);

  const rawExpiry = reader.get("expiryDate");
  const expiry = rawExpiry === null ? null : parseDate(rawExpiry);
  if (expiry === null) {
    blamed.field = "expiryDate";
    throw AppError.validation("Expiry date is missing or unreadable");
  }
  const rawStart = reader.get("startDate");
  const start = (rawStart === null ? null : parseDate(rawStart)) ?? backDateOneYear(expiry);

  const existing = conn
    .prepare("SELECT id FROM policies WHERE insurer_id = ? AND policy_number = ?")
    .get(insurerId, policyNumber) as { id: number } | undefined;

  const frequency = reader.get("premiumFrequency");
  const input: PolicyInput = {
    policyNumber,
    clientId,
    insurerId,
    productId,
    category,
    status: null,
    startDate: start,
    expiryDate: expiry,
    sumInsured: numberFrom(reader, "sumInsured"),
    premiumAmount: numberFrom(reader, "premiumAmount"),
    gstAmount: numberFrom(reader, "gstAmount"),
    premiumFrequency: frequency === null ? null : normaliseFrequency(frequency),
    paymentMode: reader.get("paymentMode"),
    nextDueDate: null,
    commissionRate: numberFrom(reader, "commissionRate"),
    commissionExpected: numberFrom(reader, "commissionExpected"),
    nomineeName: reader.get("nomineeName"),
    nomineeRelation: reader.get("nomineeRelation"),
    vehicleNumber: reader.get("vehicleNumber"),
    notes: reader.get("notes"),
    // Set after the policy exists, once the names have been resolved to clients:
    // attaching them needs a policy to check the holder against.
    insuredClientIds: null,
  };

  let policyId: number;
  if (existing !== undefined && updateExisting) {
    policies.update(conn, existing.id, input);
    report.policiesUpdated += 1;
    policyId = existing.id;
  } else if (existing !== undefined) {
    blamed.field = "policyNumber";
    return {
      kind: "skipped",
      reason: `Policy ${policyNumber} already exists and updates are switched off`,
    };
  } else {
    policyId = policies.create(conn, input);
    report.policiesInserted += 1;
  }

  // A cover list is a column of names, so each one is resolved to a client: the
  // holder themselves where the name is theirs, somebody already in the family, an
  // unambiguous client of that name, or a new client related to the holder.
  // Re-importing the same sheet finds the same people rather than opening second
  // copies of them.
  const list = reader.get("memberNames");
  if (list !== null) {
    const insuredClientIds = list
      .split(/[,;/|]/)
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .map((part) => relations.findOrCreateRelative(conn, clientId, part, null));
    if (insuredClientIds.length > 0) policies.setMembers(conn, policyId, insuredClientIds);
  }

  return { kind: existing === undefined ? "inserted" : "updated" };
}

function insurerCount(conn: Conn): number {
  const row = conn.prepare("SELECT COUNT(*) AS n FROM insurers").get() as { n: number };
  return row.n;
}

function numberFrom(reader: RowReader, field: string): number | null {
  const raw = reader.get(field);
  return raw === null ? null : parseNumber(raw);
}

/**
 * Fills blank client fields from the spreadsheet without overwriting anything
 * already recorded, so a partial import cannot erase better data.
 */
function fillClientGaps(conn: Conn, id: number, reader: RowReader): boolean {
  const email = reader.get("email");
  const altPhone = reader.get("altPhone");
  const dateOfBirth = reader.get("dateOfBirth");
  const gender = reader.get("gender");
  const phone = reader.get("phone");
  const pan = reader.get("pan");

  try {
    const result = conn
      .prepare(
        "UPDATE clients SET " +
          "email = COALESCE(NULLIF(email, ''), ?), " +
          "phone = COALESCE(NULLIF(phone, ''), ?), " +
          "alt_phone = COALESCE(NULLIF(alt_phone, ''), ?), " +
          "date_of_birth = COALESCE(date_of_birth, ?), " +
          "gender = COALESCE(gender, ?), " +
          "address_line1 = COALESCE(NULLIF(address_line1, ''), ?), " +
          "city = COALESCE(NULLIF(city, ''), ?), " +
          "state = COALESCE(NULLIF(state, ''), ?), " +
          "pincode = COALESCE(NULLIF(pincode, ''), ?), " +
          "occupation = COALESCE(NULLIF(occupation, ''), ?), " +
          "pan = COALESCE(NULLIF(pan, ''), ?) " +
          "WHERE id = ?",
      )
      .run(
        email !== null && looksLikeEmail(email) ? email : null,
        phone === null ? null : normalisePhone(phone),
        altPhone === null ? null : normalisePhone(altPhone),
        dateOfBirth === null ? null : parseDate(dateOfBirth),
        gender === null ? null : normaliseGender(gender),
        reader.get("addressLine1"),
        reader.get("city"),
        reader.get("state"),
        reader.get("pincode"),
        reader.get("occupation"),
        pan === null ? null : pan.toUpperCase(),
        id,
      );
    return result.changes > 0;
  } catch (error) {
    // The row's own issue line quotes this, so it has to read the way the Rust
    // core's does rather than as a bare SQLite string.
    throw AppError.database(error);
  }
}

function normaliseFrequency(raw: string): string {
  switch (raw.trim().toLowerCase()) {
    case "monthly":
    case "month":
    case "m":
      return "monthly";
    case "quarterly":
    case "quarter":
    case "q":
      return "quarterly";
    case "half yearly":
    case "half-yearly":
    case "semi annual":
    case "semi-annual":
    case "h":
      return "half_yearly";
    case "single":
    case "one time":
    case "single premium":
      return "single";
    default:
      return "annual";
  }
}

function backDateOneYear(expiry: string): string {
  return addDays(expiry, -364) ?? todayIso();
}

function recordBatch(conn: Conn, file: string, options: ImportOptions, report: ImportReport): void {
  const result = conn
    .prepare(
      "INSERT INTO import_batches (file_name, source_type, target, status, total_rows, inserted, " +
        "updated, skipped, failed, mapping_json, finished_at) " +
        "VALUES (?, ?, 'policies', 'completed', ?, ?, ?, ?, ?, ?, datetime('now'))",
    )
    .run(
      path.basename(file),
      path.extname(file).replace(/^\./, ""),
      report.totalRows,
      report.policiesInserted,
      report.policiesUpdated,
      report.skipped,
      report.failed,
      JSON.stringify(options.mapping),
    );

  const batchId = Number(result.lastInsertRowid);
  const insert = conn.prepare(
    "INSERT INTO import_errors (batch_id, row_number, column_name, value, message) VALUES (?, ?, ?, ?, ?)",
  );
  for (const issue of report.issues) {
    insert.run(batchId, issue.row, issue.column, issue.value, issue.message);
  }
}

/** The example row the template carries, so a blank file still shows the shape of one. */
const TEMPLATE_EXAMPLE: Record<string, string> = {
  fullName: "Rohit Sharma",
  clientCode: "CL-00001",
  email: "rohit@example.com",
  phone: "9876543210",
  dateOfBirth: "14/05/1985",
  gender: "Male",
  city: "Pune",
  state: "Maharashtra",
  pincode: "411001",
  policyNumber: "HS/2026/00918273",
  insurerName: "Star Health and Allied Insurance",
  productName: "Family Health Optima",
  category: "Health",
  startDate: "01/04/2026",
  expiryDate: "31/03/2027",
  sumInsured: "1000000",
  premiumAmount: "24500",
  gstAmount: "4410",
  premiumFrequency: "Annual",
  paymentMode: "UPI",
  commissionRate: "15",
  commissionExpected: "3675",
  nomineeName: "Anita Sharma",
  nomineeRelation: "Spouse",
  memberNames: "Rohit Sharma; Anita Sharma; Aarav Sharma",
  notes: "Floater cover for the family",
};

/**
 * Writes a spreadsheet with the expected headers and one example row, for
 * providers who have no existing file to import.
 *
 * The Rust template tints and bolds its header row. SheetJS writes no cell
 * formatting, so this one is plain: the same columns, the same example, without
 * the colour. What the file has to carry is what the importer reads back, and
 * `tests/importer.test.ts` holds it to that.
 */
export function writeTemplate(target: string): void {
  const headers = FIELDS.map((field) => field.label);
  // `null` leaves the cell out altogether, where an empty string would write one.
  const example = FIELDS.map((field) => TEMPLATE_EXAMPLE[field.key] ?? null);

  const sheet = XLSX.utils.aoa_to_sheet([headers, example]);
  sheet["!cols"] = FIELDS.map(() => ({ wch: 18 }));

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Policies");

  try {
    // The format is named rather than inferred, because the file has to be a
    // workbook whatever the operator called it in the save dialog.
    XLSX.writeFile(book, target, { bookType: "xlsx" });
  } catch (error) {
    throw AppError.spreadsheet(describe(error));
  }
}
