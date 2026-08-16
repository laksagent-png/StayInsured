/**
 * Ported from `documents_are_copied_into_the_book_and_survive_the_policy` and
 * `deleting_a_client_takes_their_documents`, with one case of this edition's own
 * for the bytes on their way to the shared viewer.
 *
 * Attaching is a copy in, not a move: the file the agent picked stays where it was
 * and the book keeps its own copy. That is the promise the screen makes when it
 * says a backup carries the paperwork with it, and it is the reason a deletion here
 * can never take somebody's only copy of a policy schedule.
 */

import fs from "node:fs";
import path from "node:path";

import { dispatch } from "../core/commands";
import * as clients from "../core/repo/clients";
import * as documents from "../core/repo/documents";
import * as insurers from "../core/repo/insurers";
import * as policies from "../core/repo/policies";
import { expect, suite, test, throwsKind } from "./harness";
import { sampleClient, samplePolicy, scalar, tempDb, tempDir, unlockedSession } from "./support";

suite("documents", () => {
  test("are copied into the book and survive the policy", async () => {
    const dir = tempDir("documents");
    const source = path.join(dir, "schedule.pdf");
    const bytes = Buffer.from("%PDF-1.7 not really a pdf, but the bytes must come back exactly");
    fs.writeFileSync(source, bytes);

    const db = tempDb("documents");
    await db.with(async (conn) => {
      const clientId = clients.create(conn, sampleClient("Ananya Rao"));
      const insurerId = insurers.findOrCreate(conn, "Star Health");
      const policyId = policies.create(
        conn,
        samplePolicy(clientId, insurerId, "SH/2026/9", "2027-03-31"),
      );

      const id = documents.attach(conn, { clientId, policyId, path: source });

      const listed = documents.listForClient(conn, clientId);
      expect.equal(listed.length, 1);
      expect.equal(listed[0]!.title, "schedule", "the file name becomes the title");
      expect.equal(listed[0]!.mimeType, "application/pdf");
      expect.equal(listed[0]!.sizeBytes, bytes.length);
      expect.equal(listed[0]!.policyNumber, "SH/2026/9");

      expect.deepEqual(documents.content(conn, id), bytes, "bytes must round trip");

      // The agent's own copy is untouched: this is a copy in, not a move.
      expect.ok(fs.existsSync(source));

      await throwsKind(
        "conflict",
        () => documents.attach(conn, { clientId, title: "Second go", path: source }),
        "the same file twice on one client is a mis-click",
      );

      const text = path.join(dir, "notes.txt");
      fs.writeFileSync(text, "not a scan");
      await throwsKind("validation", () => documents.attach(conn, { clientId, path: text }));

      // Deleting the policy keeps the paperwork on the client.
      policies.remove(conn, policyId);
      const orphaned = documents.listForClient(conn, clientId);
      expect.equal(orphaned.length, 1);
      expect.equal(orphaned[0]!.policyId, null);

      documents.remove(conn, id);
      expect.equal(documents.listForClient(conn, clientId).length, 0);
      expect.equal(
        scalar<number>(conn, "SELECT COUNT(*) AS n FROM document_contents"),
        0,
        "the bytes go with the row",
      );
    });
    db.close();
  });

  test("go when the client they belong to is deleted", () => {
    const dir = tempDir("documents-cascade");
    const source = path.join(dir, "proposal.png");
    fs.writeFileSync(source, Buffer.from("\x89PNG\r\n\x1a\n pretend image", "binary"));

    const db = tempDb("documents-cascade");
    db.with((conn) => {
      const clientId = clients.create(conn, sampleClient("Vikram Nair"));
      documents.attach(conn, { clientId, title: "Proposal form", path: source });

      clients.remove(conn, clientId);

      expect.deepEqual(
        [
          scalar<number>(conn, "SELECT COUNT(*) AS n FROM documents"),
          scalar<number>(conn, "SELECT COUNT(*) AS n FROM document_contents"),
        ],
        [0, 0],
      );
    });
    db.close();
  });

  test("reach the interface as bytes it can put in front of the operator", async () => {
    const { session } = await unlockedSession("document-bridge");
    const dir = tempDir("document-bridge");
    const source = path.join(dir, "id-proof.jpg");
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    fs.writeFileSync(source, bytes);

    const clientId = session.db().withTx((conn) => clients.create(conn, sampleClient("Meera Iyer")));
    const id = await dispatch(session, "attach_document", { input: { clientId, path: source } });

    const content = await dispatch(session, "document_content", { id });
    expect.ok(
      content instanceof ArrayBuffer,
      "the app's own command answers with raw bytes, which reach the renderer as an ArrayBuffer",
    );
    expect.deepEqual(Buffer.from(content as ArrayBuffer), bytes);

    const copy = path.join(dir, "saved-copy.jpg");
    await dispatch(session, "save_document_copy", { id, path: copy });
    expect.deepEqual(fs.readFileSync(copy), bytes, "a saved copy is the file that came in");

    session.lock();
    await throwsKind(
      "locked",
      () => dispatch(session, "list_documents", { clientId }),
      "paperwork is behind the password like everything else",
    );
  });
});
