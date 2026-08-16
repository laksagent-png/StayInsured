/**
 * The error shape the interface already understands.
 *
 * `src/lib/api.ts` rebuilds an `ApiError` from `{ kind, message }` and screens
 * switch on the kind — a `locked` sends the user to the lock screen, a
 * `conflict` becomes advice about renewing rather than duplicating. So these
 * strings are a contract with a UI this edition does not own, and the messages
 * are the ones `error.rs` writes, down to the full stops.
 */

export type ErrorKind =
  | "locked"
  | "bad_password"
  | "already_initialised"
  | "validation"
  | "not_found"
  | "conflict"
  | "mail"
  | "internal";

export interface WireError {
  kind: ErrorKind;
  message: string;
}

export class AppError extends Error {
  readonly kind: ErrorKind;

  constructor(kind: ErrorKind, message: string) {
    super(message);
    this.name = "AppError";
    this.kind = kind;
  }

  static locked(): AppError {
    return new AppError("locked", "The database is locked. Sign in to continue.");
  }

  static badPassword(): AppError {
    return new AppError("bad_password", "Incorrect password.");
  }

  static alreadyInitialised(): AppError {
    return new AppError("already_initialised", "This installation is already set up.");
  }

  static validation(message: string): AppError {
    return new AppError("validation", message);
  }

  /** `what` names the thing, and the sentence is completed here. */
  static notFound(what: string): AppError {
    return new AppError("not_found", `${what} was not found.`);
  }

  static conflict(message: string): AppError {
    return new AppError("conflict", message);
  }

  static mail(message: string): AppError {
    return new AppError("mail", `Mail error: ${message}`);
  }

  static database(cause: unknown): AppError {
    return new AppError("internal", `Database error: ${describe(cause)}`);
  }

  static file(cause: unknown): AppError {
    return new AppError("internal", `File error: ${describe(cause)}`);
  }

  static spreadsheet(cause: unknown): AppError {
    return new AppError("internal", `Spreadsheet error: ${describe(cause)}`);
  }

  static other(message: string): AppError {
    return new AppError("internal", message);
  }
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Anything thrown on the way to the interface, in the shape the interface
 * expects. A bug in this edition arrives as an `internal` carrying its own
 * words, because "Something went wrong" tells the operator nothing.
 */
export function toWire(error: unknown): WireError {
  if (error instanceof AppError) return { kind: error.kind, message: error.message };
  return { kind: "internal", message: describe(error) };
}
