/**
 * Ported from `export_writes_both_formats`,
 * `an_export_carries_every_column_and_reads_like_the_screen` and
 * `an_export_refuses_a_format_it_cannot_write`.
 *
 * An export is the one thing the agency hands to someone else — an insurer asking
 * for a book, an accountant asking for the commission. So the columns, their order
 * and the words in them are a promise made by the interface, and a spreadsheet
 * exported on Windows 7 has to be the same spreadsheet.
 */

import fs from "node:fs";
import path from "node:path";

import * as XLSX from "xlsx";

import { dispatch } from "../core/commands";
import * as exporter from "../core/exporter";
import * as clients from "../core/repo/clients";
import * as insurers from "../core/repo/insurers";
import * as policies from "../core/repo/policies";
import * as products from "../core/repo/products";
import { expect, suite, test, throwsKind } from "./harness";
import { sampleClient, samplePolicy, tempDb, tempDir, unlockedSession } from "./support";

/** The value of one column of the first exported row, found by its header. */
function cellUnder(sheet: XLSX.WorkSheet, header: string): XLSX.CellObject | undefined {
  const range = XLSX.utils.decode_range(sheet["!ref"] as string);
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    const heading = sheet[XLSX.utils.encode_cell({ r: 0, c: column })] as XLSX.CellObject | undefined;
    if (heading?.v === header) {
      return sheet[XLSX.utils.encode_cell({ r: 1, c: column })] as XLSX.CellObject | undefined;
    }
  }
  return undefined;
}

function workbook(file: string): XLSX.WorkBook {
  return XLSX.read(fs.readFileSync(file), { type: "buffer" });
}

suite("an export", () => {
  test("writes both formats", async () => {
    const dir = tempDir("export");
    const db = tempDb("export");
    const rows = db.with((conn) => {
      const client = clients.create(conn, sampleClient("Export Target"));
      const insurer = insurers.findOrCreate(conn, "Tata AIG");
      products.findOrCreate(conn, insurer, "Medicare Premier", "health");
      policies.create(conn, samplePolicy(client, insurer, "EX-1", "2027-12-31"));
      return policies.listAll(conn, {});
    });
    expect.equal(rows.length, 1);

    for (const name of ["out.xlsx", "out.csv"]) {
      const file = path.join(dir, name);
      expect.equal(exporter.exportPolicies(rows, file), 1);
      expect.ok(fs.existsSync(file));
      expect.ok(fs.statSync(file).size > 0);
    }

    // The workbook is the format the interface offers first, so what is in its
    // cells is checked rather than only that bytes were written.
    const book = workbook(path.join(dir, "out.xlsx"));
    expect.deepEqual(book.SheetNames, ["Policies"]);
    const sheet = book.Sheets["Policies"] as XLSX.WorkSheet;

    expect.equal((sheet.A1 as XLSX.CellObject).v, "Client code");
    expect.equal(cellUnder(sheet, "Policy number")?.v, "EX-1");
    // The seeded insurer the name resolved to, spelled as the policy list spells it.
    expect.equal(cellUnder(sheet, "Insurer")?.v, rows[0]!.insurerName);
    expect.equal(cellUnder(sheet, "Category")?.v, "Health", "the label, not the stored key");
    expect.equal(cellUnder(sheet, "Status")?.v, "Active");
    expect.equal(cellUnder(sheet, "Expiry date")?.v, "2027-12-31");

    // Money is a number so that Excel can total a column of it, which is the first
    // thing anyone does with an export.
    expect.equal(cellUnder(sheet, "Premium")?.t, "n");
    expect.equal(cellUnder(sheet, "Premium")?.v, 24_500);
    expect.equal(cellUnder(sheet, "Sum insured")?.v, 1_000_000);
    expect.equal(cellUnder(sheet, "GST")?.v, "", "nothing recorded stays blank rather than zero");

    // A phone made only of digits is read as a number by the same rule, in this
    // edition and in the app's. It reads oddly and it matches.
    expect.equal(cellUnder(sheet, "Phone")?.t, "n");

    await throwsKind(
      "validation",
      () => exporter.exportPolicies(rows, path.join(dir, "out.pdf")),
      "unsupported formats should be refused clearly",
    );
    db.close();
  });

  test("carries every column and reads like the screen", () => {
    const dir = tempDir("export-clients");
    const db = tempDb("export-clients");
    db.with((conn) => {
      clients.create(conn, {
        ...sampleClient("Ananya Sharma"),
        email: "ananya@example.com",
        city: "Pune",
      });

      const rows = clients.list(conn, {}).rows;
      const file = path.join(dir, "clients.csv");
      expect.equal(exporter.exportClients(rows, file), 1);

      const text = fs.readFileSync(file, "utf8");
      expect.ok(text.includes("\r\n"), "the `csv` crate ends a record with CRLF, so this does too");

      const lines = text.split("\r\n").filter((line) => line !== "");
      const headers = lines[0]!.split(",");
      expect.equal(headers[0], "Client code");
      expect.equal(headers[headers.length - 1], "Notes");
      expect.equal(headers.length, 18, "a column added to the export needs a line in the guide too");

      const row = lines[1]!;
      expect.ok(row.includes("Ananya Sharma"));
      expect.ok(row.includes("ananya@example.com"));
      expect.ok(row.includes("Pune"));
      expect.ok(row.includes(",On"), "an opt-out reads as words, not as 0 or 1");
      expect.equal(lines.length, 2, "one client, one row");
    });
    db.close();
  });

  test("refuses a format it cannot write", async () => {
    const dir = tempDir("export-format");
    const db = tempDb("export-format");
    await db.with(async (conn) => {
      const rows = clients.list(conn, {}).rows;

      const refused = await throwsKind("validation", () =>
        exporter.exportClients(rows, path.join(dir, "book.pdf")),
      );
      expect.ok(
        refused.message.includes(".xlsx") && refused.message.includes(".csv"),
        `the refusal says what would work instead: ${refused.message}`,
      );

      // A spreadsheet is the default, including when the name carries no extension
      // at all.
      const named = path.join(dir, "book.xlsx");
      exporter.exportClients(rows, named);
      expect.ok(fs.statSync(named).size > 0);

      const unnamed = path.join(dir, "book");
      exporter.exportClients(rows, unnamed);
      expect.deepEqual(workbook(unnamed).SheetNames, ["Clients"], "a workbook, whatever it is called");
    });
    db.close();
  });

  test("is the whole book rather than the first page of it", async () => {
    const { session } = await unlockedSession("export-paging");
    const dir = tempDir("export-paging");
    const file = path.join(dir, "everyone.csv");

    // One more than a page, because the clients list is clamped to 500 a page and
    // the command has to keep asking until it has them all.
    session.db().withTx((conn) => {
      for (let index = 0; index < 501; index += 1) {
        clients.create(conn, sampleClient(`Client Number ${index}`));
      }
    });

    expect.equal(await dispatch(session, "export_clients", { filter: {}, path: file }), 501);
    const written = fs.readFileSync(file, "utf8").split("\r\n").filter((line) => line !== "");
    expect.equal(written.length, 502, "a header and every client under it");
    session.lock();
  });
});
