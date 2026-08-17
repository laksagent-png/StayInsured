/**
 * Ported from `spreadsheet_import_maps_headers_and_is_idempotent`,
 * `import_refuses_an_unmapped_required_field`,
 * `a_header_finds_its_field_by_name_and_then_by_resemblance` and
 * `the_blank_template_is_a_file_the_importer_can_read`.
 *
 * The last suite has no Rust test behind it. calamine needed none: it hands back
 * a date as a date and a number as a number, and the `csv` crate hands back text.
 * SheetJS decides for itself what a cell means, so the two cases that would be
 * silent if it decided differently — a date landing a day out, a whole number
 * coming back in exponent form — are pinned here instead.
 */

import fs from "node:fs";
import path from "node:path";

import * as XLSX from "xlsx";

import { dispatch } from "../core/commands";
import * as importer from "../core/importer";
import * as clients from "../core/repo/clients";
import * as members from "../core/repo/members";
import * as policies from "../core/repo/policies";
import type { ImportFieldInfo, ImportOptions, ImportPreview } from "../core/types";
import { expect, suite, test, throwsKind } from "./harness";
import { daysFromToday, scalar, tempDb, tempDir, unlockedSession } from "./support";

/**
 * Deliberately messy: agency-style headers, day-first dates, currency symbols,
 * and a last row with nothing on it but a name.
 */
const MESSY_BOOK =
  "Customer Name,Mobile No,Email ID,Policy No,Insurance Company,Plan Name,Policy Type," +
  "Risk Start,Valid Till,Sum Insured,Gross Premium,City,Members\n" +
  "Rohit Sharma,98765 43210,rohit@example.com,HS/2026/1,Star Health,Family Health Optima,Mediclaim," +
  '01/04/2026,31/03/2027,"₹10,00,000","Rs. 24,500",Pune,Rohit Sharma; Anita Sharma\n' +
  "Vikram Rao,9812345678,vikram@example.com,MOT/2026/9,ICICI Lombard,Private Car Package,Motor," +
  "15/06/2026,14/06/2027,300000,8750,Nashik,\n" +
  "Broken Row,,,,,,,,,,,,\n";

function fileWith(label: string, name: string, contents: string): string {
  const file = path.join(tempDir(label), name);
  fs.writeFileSync(file, contents);
  return file;
}

function options(file: string, mapping: Record<string, string>, dryRun: boolean): ImportOptions {
  return {
    path: file,
    sheet: null,
    mapping,
    defaultCategory: "other",
    updateExisting: true,
    dryRun,
  };
}

suite("matching a header to a field", () => {
  test("finds it by name, and then by resemblance", () => {
    const mapping = importer.suggestMapping([
      "Client Name",
      "Policy No",
      "Policy Expiry Date (DD/MM/YYYY)",
      "Something we do not have a field for",
    ]);

    expect.equal(mapping["fullName"], "Client Name");
    expect.equal(mapping["policyNumber"], "Policy No");
    expect.equal(
      mapping["expiryDate"],
      "Policy Expiry Date (DD/MM/YYYY)",
      "a header nobody would spell the same way twice still lands, on resemblance",
    );
    expect.ok(
      !Object.values(mapping).includes("Something we do not have a field for"),
      "a column with no field is left for the operator rather than guessed at",
    );

    // Every column is claimed by at most one field, or a mapping would quietly
    // read one column into two.
    const claimed = Object.values(mapping);
    expect.equal(new Set(claimed).size, claimed.length);
  });
});

suite("a book the agency already keeps", () => {
  test("maps the headers a spreadsheet actually arrives with", () => {
    const file = fileWith("import", "book.csv", MESSY_BOOK);

    const preview = importer.preview(file, null);

    expect.equal(preview.fileName, "book.csv");
    expect.equal(preview.totalRows, 3);
    expect.deepEqual(preview.sheetNames, ["Sheet1"]);
    expect.equal(preview.suggestedMapping["fullName"], "Customer Name");
    expect.equal(preview.suggestedMapping["policyNumber"], "Policy No");
    expect.equal(preview.suggestedMapping["insurerName"], "Insurance Company");
    expect.equal(preview.suggestedMapping["expiryDate"], "Valid Till");
    expect.equal(preview.suggestedMapping["premiumAmount"], "Gross Premium");
  });

  test("reports the row it cannot read, and keeps nothing from a dry run", () => {
    const file = fileWith("import", "book.csv", MESSY_BOOK);
    const mapping = importer.preview(file, null).suggestedMapping;
    const db = tempDb("import");

    const dry = db.with((conn) => importer.run(conn, options(file, mapping, true)));

    expect.equal(dry.policiesInserted, 2);
    expect.equal(dry.failed, 1, "the blank row should be reported, not imported");

    // The report names the cell, so the agent knows which one to correct.
    const issue = dry.issues[0]!;
    expect.equal(issue.row, 4, "row 1 is the header and rows count from 1");
    expect.equal(
      issue.column,
      "Policy No",
      "the row has a name and no policy number, so that is the cell at fault",
    );
    expect.equal(issue.value, null, "an empty cell has no value worth quoting back");

    db.with((conn) => {
      expect.equal(
        scalar<number>(conn, "SELECT COUNT(*) AS n FROM policies"),
        0,
        "a dry run must leave the database untouched",
      );
      expect.equal(scalar<number>(conn, "SELECT COUNT(*) AS n FROM clients"), 0);
    });
    db.close();
  });

  test("brings the rows in the way the app reads them", () => {
    const file = fileWith("import", "book.csv", MESSY_BOOK);
    const mapping = importer.preview(file, null).suggestedMapping;
    const db = tempDb("import");

    const report = db.with((conn) => importer.run(conn, options(file, mapping, false)));
    expect.equal(report.policiesInserted, 2);
    expect.equal(report.clientsCreated, 2);

    db.with((conn) => {
      const found = policies.list(conn, { search: "HS/2026/1" });
      const row = found.rows[0]!;
      expect.equal(row.category, "health", '"Mediclaim" should map to health');
      expect.equal(row.startDate, "2026-04-01", "day-first dates are honoured");
      expect.equal(row.expiryDate, "2027-03-31");
      expect.equal(row.sumInsured, 1_000_000, "currency formatting is stripped");
      expect.equal(row.premiumAmount, 24_500);
      expect.equal(row.productName, "Family Health Optima");

      expect.equal(policies.list(conn, { categories: ["motor"] }).total, 1);
      expect.equal(members.listForClient(conn, row.clientId).length, 2);
    });
    db.close();
  });

  test("updates in place when the same file arrives again", () => {
    const file = fileWith("import", "book.csv", MESSY_BOOK);
    const mapping = importer.preview(file, null).suggestedMapping;
    const db = tempDb("import");

    db.with((conn) => importer.run(conn, options(file, mapping, false)));
    const again = db.with((conn) => importer.run(conn, options(file, mapping, false)));

    expect.equal(again.policiesInserted, 0);
    expect.equal(again.policiesUpdated, 2);
    expect.equal(again.clientsCreated, 0);

    db.with((conn) => {
      expect.deepEqual(
        [
          scalar<number>(conn, "SELECT COUNT(*) AS n FROM clients"),
          scalar<number>(conn, "SELECT COUNT(*) AS n FROM policies"),
        ],
        [2, 2],
      );
    });
    db.close();
  });

  test("records the batch and its issues once the import is real", () => {
    const file = fileWith("import", "book.csv", MESSY_BOOK);
    const mapping = importer.preview(file, null).suggestedMapping;
    const db = tempDb("import");

    db.with((conn) => importer.run(conn, options(file, mapping, false)));

    db.with((conn) => {
      expect.equal(scalar<string>(conn, "SELECT file_name FROM import_batches"), "book.csv");
      expect.equal(scalar<string>(conn, "SELECT source_type FROM import_batches"), "csv");
      expect.equal(scalar<number>(conn, "SELECT failed FROM import_batches"), 1);
      expect.equal(scalar<number>(conn, "SELECT COUNT(*) AS n FROM import_errors"), 1);
    });
    db.close();
  });
});

suite("an import that cannot go ahead", () => {
  test("refuses an unmapped required field", async () => {
    const file = fileWith("import-guard", "thin.csv", "Name,Policy\nSomeone,P-1\n");
    const db = tempDb("import-guard");

    await db.with(async (conn) => {
      await throwsKind("validation", () =>
        importer.run(conn, {
          path: file,
          sheet: null,
          mapping: { fullName: "Name" },
          defaultCategory: null,
          updateExisting: true,
          dryRun: true,
        }),
      );
    });
    db.close();
  });

  test("refuses a mapping that names a column the file does not have", async () => {
    const file = fileWith("import-guard", "thin.csv", "Name,Policy\nSomeone,P-1\n");
    const db = tempDb("import-guard");

    await db.with(async (conn) => {
      const error = await throwsKind("validation", () =>
        importer.run(conn, {
          path: file,
          sheet: null,
          mapping: {
            fullName: "Name",
            policyNumber: "Policy",
            insurerName: "Insurer",
            expiryDate: "Expiry",
          },
          defaultCategory: null,
          updateExisting: true,
          dryRun: true,
        }),
      );
      expect.ok(error.message.includes('"Insurer"'), `the refusal names the column: ${error.message}`);
    });
    db.close();
  });
});

suite("the blank template", () => {
  test("is a file the importer can read", () => {
    const file = path.join(tempDir("template"), "template.xlsx");
    importer.writeTemplate(file);

    const sheet = importer.readSheet(file, null);
    expect.equal(sheet.sheet, "Policies");
    expect.equal(sheet.rows.length, 1, "one filled-in example, showing the shape of a row");

    // The point of handing someone this file is that filling it in and sending it
    // back needs no mapping work, so its own headers must map themselves.
    const mapping = importer.suggestMapping(sheet.headers);
    for (const field of ["fullName", "policyNumber", "insurerName", "expiryDate"]) {
      expect.ok(mapping[field] !== undefined, `the template's own headers do not offer ${field}`);
    }

    // And the example row has to survive the importer, or the file teaches a
    // format the app then refuses.
    const db = tempDb("template");
    const report = db.with((conn) =>
      importer.run(conn, {
        path: file,
        sheet: null,
        mapping,
        defaultCategory: null,
        updateExisting: true,
        dryRun: true,
      }),
    );
    expect.equal(report.policiesInserted, 1);
    expect.equal(report.clientsCreated, 1);
    expect.equal(report.failed, 0);
    expect.deepEqual(report.issues, [], "the example row was not read cleanly");
    db.close();
  });
});

suite("cells as the importer reads them", () => {
  /** A workbook written the way one arriving from an office would be typed. */
  function workbook(label: string, rows: unknown[][]): string {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Policies");
    const file = path.join(tempDir(label), "book.xlsx");
    XLSX.writeFile(book, file, { bookType: "xlsx" });
    return file;
  }

  test("reads a date cell as the day the spreadsheet shows", () => {
    const file = workbook("cells", [
      ["Client Name", "Policy No", "Insurer", "Valid Till"],
      ["Rohit Sharma", "HS/2026/1", "Star Health", new Date(2027, 2, 31)],
    ]);

    const sheet = importer.readSheet(file, null);

    expect.equal(
      sheet.rows[0]![3],
      "2027-03-31",
      "a real date cell must not slip to the day before or after",
    );
  });

  test("keeps a whole number whole", () => {
    const file = workbook("cells", [
      ["Sum Insured", "Premium", "Policy No", "Commission %"],
      [1_000_000, 24_500.0, 918_273_645_000, 12.5],
    ]);

    const row = importer.readSheet(file, null).rows[0]!;

    expect.deepEqual(
      row,
      ["1000000", "24500", "918273645000", "12.5"],
      "no trailing zero, no exponent, and nothing rounded to what the cell displays",
    );
  });

  test("takes the sheet it is asked for, and the first one otherwise", () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Health"], ["one"]]), "Health");
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Motor"], ["two"]]), "Motor");
    const file = path.join(tempDir("sheets"), "two.xlsx");
    XLSX.writeFile(book, file, { bookType: "xlsx" });

    expect.equal(importer.readSheet(file, null).sheet, "Health");
    expect.equal(importer.readSheet(file, "Motor").headers[0], "Motor");
    expect.equal(
      importer.readSheet(file, "Nowhere").sheet,
      "Health",
      "a sheet the workbook does not have falls back rather than failing",
    );
    expect.deepEqual(importer.preview(file, "Motor").sheetNames, ["Health", "Motor"]);
  });
});

suite("the commands the import screen calls", () => {
  test("answer while the book is locked, except the import itself", async () => {
    const { session } = await unlockedSession("import-commands");
    session.lock();

    const fields = (await dispatch(session, "import_fields", {})) as ImportFieldInfo[];
    expect.deepEqual(
      fields.filter((field) => field.required).map((field) => field.key),
      ["fullName", "policyNumber", "insurerName", "expiryDate"],
      "these four are what the screen refuses to run without",
    );

    const file = fileWith("import-commands", "book.csv", MESSY_BOOK);
    const preview = (await dispatch(session, "preview_import", {
      path: file,
      sheet: null,
    })) as ImportPreview;
    expect.equal(preview.fileName, "book.csv");
    expect.equal(preview.totalRows, 3);

    const target = path.join(tempDir("import-commands"), "template.xlsx");
    expect.equal(
      await dispatch(session, "write_import_template", { path: target }),
      target,
      "the screen shows the operator where the file went",
    );
    expect.ok(fs.existsSync(target));

    await throwsKind("locked", () =>
      dispatch(session, "run_import", { options: options(file, preview.suggestedMapping, true) }),
    );
  });

  test("bring the statuses up to date after a real import", async () => {
    const { session } = await unlockedSession("import-sweep");
    const file = fileWith(
      "import-sweep",
      "old.csv",
      "Customer Name,Policy No,Insurance Company,Valid Till\n" +
        `Ravi Kumar,HS/2025/7,Star Health,${daysFromToday(-5)}\n`,
    );
    const preview = (await dispatch(session, "preview_import", {
      path: file,
      sheet: null,
    })) as ImportPreview;

    await dispatch(session, "run_import", {
      options: options(file, preview.suggestedMapping, false),
    });

    expect.equal(
      session.db().with((conn) => scalar<string>(conn, "SELECT status FROM policies")),
      "expired",
      "a year that ended before the file arrived must not land on the desk as current",
    );
  });
});

suite("a client the book already has", () => {
  test("gains what the spreadsheet knows and loses nothing it already held", () => {
    const file = fileWith(
      "import-gaps",
      "book.csv",
      "Customer Name,Email ID,Mobile No,City,State,Occupation,Policy No,Insurance Company,Valid Till\n" +
        "Rohit Sharma,rohit@example.com,9876543210,Nagpur,Maharashtra,Teacher," +
        "HS/2026/1,Star Health,31/03/2027\n",
    );
    const mapping = importer.preview(file, null).suggestedMapping;
    const db = tempDb("import-gaps");

    const id = db.withTx((conn) =>
      clients.create(conn, {
        fullName: "Rohit Sharma",
        email: "rohit@example.com",
        phone: "9876543210",
        city: "Pune",
      }),
    );

    const report = db.with((conn) => importer.run(conn, options(file, mapping, false)));
    expect.equal(report.clientsCreated, 0, "the email matched a client already in the book");
    expect.equal(report.clientsUpdated, 1);

    db.with((conn) => {
      const client = clients.get(conn, id);
      expect.equal(client.city, "Pune", "a city already recorded is not overwritten");
      expect.equal(client.occupation, "Teacher", "and a blank field is filled in");
      expect.equal(client.state, "Maharashtra");
    });
    db.close();
  });

  test("is given the email it did not have, and keeps their policy too", () => {
    const file = fileWith(
      "import-fts",
      "book.csv",
      "Customer Name,Email ID,PAN,Policy No,Insurance Company,Valid Till\n" +
        "Rohit Sharma,rohit@example.com,ABCDE1234F,HS/2026/1,Star Health,31/03/2027\n",
    );
    const mapping = importer.preview(file, null).suggestedMapping;
    const db = tempDb("import-fts");

    const id = db.withTx((conn) => clients.create(conn, { fullName: "Rohit Sharma" }));

    const report = db.with((conn) => importer.run(conn, options(file, mapping, false)));

    // This case used to record the fault rather than the promise: an email or a
    // PAN arriving for a client who had neither is exactly the edit the old update
    // trigger refused, and it took the row's policy down with it. Filling those
    // gaps is a good part of what an agency runs an import for, and 004 is what
    // lets it happen.
    expect.equal(report.failed, 0);
    expect.deepEqual(report.issues, []);
    expect.equal(report.clientsUpdated, 1);
    expect.equal(report.clientsCreated, 0, "the name matched the client already in the book");

    db.with((conn) => {
      const client = clients.get(conn, id);
      expect.equal(client.email, "rohit@example.com");
      expect.equal(client.pan, "ABCDE1234F");
      expect.equal(scalar<number>(conn, "SELECT COUNT(*) AS n FROM policies"), 1);
      expect.equal(
        clients.list(conn, { search: "ABCDE1234F" }).total,
        1,
        "and the search knows what the import filled in",
      );
    });
    db.close();
  });
});
