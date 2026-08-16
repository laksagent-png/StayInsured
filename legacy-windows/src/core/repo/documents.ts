/**
 * A port of `src-tauri/src/repo/documents.rs`.
 *
 * The file bytes live in the book rather than beside it, as `003_documents.sql`
 * explains, so a backup of the database carries the paperwork with it. That
 * reasoning is written for an encrypted book and holds here for the other half of
 * itself: this edition's file is plain, but a scan left in a folder somewhere is
 * still the part of a client's record a backup would silently leave behind.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { Conn } from "../db";
import { AppError, describe } from "../errors";
import { blankToNull, toModels } from "../rows";
import type { Document, DocumentInput } from "../types";
import { isConstraintViolation } from "./shared";

const COLUMNS =
  "d.id, d.client_id, d.policy_id, p.policy_number, d.title, " +
  "d.file_name, d.mime_type, d.size_bytes, d.uploaded_at";

/**
 * Largest single file accepted. A scanned policy schedule runs to two or three
 * megabytes; the ceiling is well clear of that while keeping the book a size that
 * can still be copied to a backup folder on every save.
 */
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/**
 * What an agent actually receives from an insurer, and nothing else. The list
 * doubles as the extension-to-type map, since the type is what the viewer
 * dispatches on.
 */
const ACCEPTED: [string, string][] = [
  ["pdf", "application/pdf"],
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["webp", "image/webp"],
];

export function listForClient(conn: Conn, clientId: number): Document[] {
  const rows = conn
    .prepare(
      `SELECT ${COLUMNS} FROM documents d ` +
        "LEFT JOIN policies p ON p.id = d.policy_id " +
        "WHERE d.client_id = ? ORDER BY d.uploaded_at DESC, d.id DESC",
    )
    .all(clientId) as Record<string, unknown>[];
  return toModels<Document>(rows);
}

/**
 * Copies a file into the book. The original is left where it is: this is a copy
 * in, not a move, so deleting the attachment never touches the agent's own file.
 */
export function attach(conn: Conn, input: DocumentInput): number {
  const fileName = path.basename(input.path);
  if (fileName === "") throw AppError.validation("That file has no name");

  const extension = path.extname(input.path).replace(/^\./, "").toLowerCase();
  const accepted = ACCEPTED.find(([ext]) => ext === extension);
  if (!accepted) {
    throw AppError.validation("Attach a PDF or an image (PDF, PNG, JPG or WEBP)");
  }
  const mimeType = accepted[1];

  let size: number;
  try {
    size = fs.statSync(input.path).size;
  } catch (error) {
    throw AppError.file(error);
  }
  if (size === 0) throw AppError.validation("That file is empty");
  if (size > MAX_DOCUMENT_BYTES) {
    throw AppError.validation(
      `That file is ${humanSize(size)} and the limit is ${humanSize(MAX_DOCUMENT_BYTES)}`,
    );
  }

  let content: Buffer;
  try {
    content = fs.readFileSync(input.path);
  } catch (error) {
    throw AppError.file(error);
  }
  const sha256 = crypto.createHash("sha256").update(content).digest("hex");

  const title = blankToNull(input.title) ?? path.basename(input.path, path.extname(input.path));

  let id: number;
  try {
    const result = conn
      .prepare(
        "INSERT INTO documents (client_id, policy_id, title, file_name, mime_type, size_bytes, sha256) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(input.clientId, input.policyId ?? null, title, fileName, mimeType, content.length, sha256);
    id = Number(result.lastInsertRowid);
  } catch (error) {
    throw mapConstraintError(error);
  }

  conn
    .prepare("INSERT INTO document_contents (document_id, content) VALUES (?, ?)")
    .run(id, content);

  return id;
}

/** The stored bytes, for viewing in the app or writing a copy back out. */
export function content(conn: Conn, id: number): Buffer {
  const row = conn
    .prepare("SELECT content FROM document_contents WHERE document_id = ?")
    .get(id) as { content: Buffer } | undefined;
  if (!row) throw AppError.notFound("Document");
  return row.content;
}

/**
 * The same bytes in the shape the interface is typed for. The Rust command answers
 * with `tauri::ipc::Response`, which reaches the renderer as an `ArrayBuffer`, and
 * an `ArrayBuffer` is what crosses Electron's bridge unchanged — a `Buffer` would
 * arrive as a `Uint8Array` instead. The copy is not waste: a `Buffer` can be a
 * window onto a larger pooled allocation, and the response has to be this document
 * and nothing that happened to be next to it in memory.
 */
export function contentForInterface(conn: Conn, id: number): ArrayBuffer {
  return new Uint8Array(content(conn, id)).buffer;
}

/**
 * Writes the stored bytes out to a file the operator named. `save_document_copy`
 * does this in the command itself in `commands.rs`; it lives here so that the
 * command table stays a table.
 */
export function writeCopy(bytes: Buffer, target: string): void {
  try {
    fs.writeFileSync(target, bytes);
  } catch (error) {
    throw AppError.file(error);
  }
}

export function remove(conn: Conn, id: number): void {
  const result = conn.prepare("DELETE FROM documents WHERE id = ?").run(id);
  if (result.changes === 0) throw AppError.notFound("Document");
}

/** Bytes as a person reads them, used in the messages about the size limit. */
function humanSize(bytes: number): string {
  const mb = 1024 * 1024;
  if (bytes >= mb) return `${(bytes / mb).toFixed(1)} MB`;
  return `${Math.max(bytes / 1024, 1).toFixed(0)} KB`;
}

function mapConstraintError(error: unknown): AppError {
  if (!isConstraintViolation(error)) return AppError.database(error);
  const message = describe(error);
  if (message.includes("client_id, sha256")) {
    return AppError.conflict("That file is already attached to this client.");
  }
  if (message.includes("FOREIGN KEY")) {
    return AppError.validation("Attach the document to an existing client and policy");
  }
  return AppError.conflict(message);
}
