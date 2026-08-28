/**
 * The Rust core, in TypeScript, for the tests.
 *
 * Every `invoke` a screen makes lands here. The answers come from a book held
 * in memory ({@link Book}) that filters, sorts, paginates and writes the way the
 * real core does, so a test drives the same code paths the app does — only the
 * database is missing.
 *
 * A fresh backend is installed before each test by `src/test/setup.ts`; reach it
 * with {@link backend}.
 */

import { vi } from "vitest";

import type {
  Client,
  ClientFilter,
  ClientInput,
  Dashboard,
  Document,
  DocumentInput,
  DeleteScope,
  EmailTemplate,
  EmailTemplateInput,
  Family,
  FamilyEdge,
  FamilyMember,
  Group,
  GroupFilter,
  GroupInput,
  Insurer,
  InsurerInput,
  Notification,
  NotificationFilter,
  Page,
  PlannedReminder,
  Policy,
  PolicyFilter,
  PolicyInput,
  Product,
  ProductInput,
  RelationInput,
  Relationship,
  Relative,
  ReminderOverview,
  ReminderRule,
  ReminderRuleInput,
  RenewalInput,
} from "@/lib/types";
import type { ErrorKind } from "@/lib/api";

import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  TODAY,
  createBook,
  daysUntil,
  recountCatalogue,
  recountClients,
  recountGroups,
  showDate,
  type Book,
} from "./fixtures";

/** The only password the fake core accepts; anything else is a bad password. */
export const CORRECT_PASSWORD = "correct-horse";

export interface RecordedCall {
  command: string;
  args: Record<string, unknown>;
}

/** The `{ kind, message }` shape errors cross the bridge in. */
export interface BridgeError {
  kind: ErrorKind;
  message: string;
}

type Handler = (args: Record<string, unknown>) => unknown;

/** A command held open, so a test can look at the screen while it waits. */
export interface Gate {
  /** Let the held call finish with the answer it would have given. */
  release: () => void;
  /** Let the held call fail instead. */
  reject: (error: BridgeError) => void;
}

interface HeldCall {
  promise: Promise<BridgeError | null>;
  match?: (args: Record<string, unknown>) => boolean;
}

const lower = (value: unknown) => String(value ?? "").toLowerCase();

/** The words a relationship may be, as `util.rs` has them. */
const RELATIONSHIPS: Relationship[] = [
  "spouse",
  "son",
  "daughter",
  "father",
  "mother",
  "brother",
  "sister",
  "other",
];

/** How far a family is walked, as the core walks it. */
const FAMILY_MAX_DEPTH = 12;

// ---------------------------------------------------------------- normalising
// The real core tidies what it is given before it writes. A test that does not
// see the same tidying would let a screen send rubbish and still look healthy,
// so these mirror `src-tauri/src/util.rs`.

/** An empty or whitespace-only string is nothing at all, as in `blank_to_none`. */
function blankToNone(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

/** Names are stored title-cased, initials and short capitals left alone. */
function tidyName(raw: string): string {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      word.length <= 3 && word === word.toUpperCase()
        ? word
        : word[0].toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join(" ");
}

/** A phone keeps its digits and its leading plus; anything else is nothing. */
function normalisePhone(raw: string | null | undefined): string | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

/** ISO or the day-first forms a spreadsheet uses; null when it is not a date. */
function parseDate(raw: string | null | undefined): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;

  const head = text.split(/[T ]/)[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(head)) {
    const [y, m, d] = head.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    const real = date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
    return real ? head : null;
  }

  const dayFirst = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (!dayFirst) return null;
  const [, d, m, rawYear] = dayFirst;
  const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
  const date = new Date(Date.UTC(year, Number(m) - 1, Number(d)));
  if (date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) return null;
  return date.toISOString().slice(0, 10);
}

function looksLikeEmail(value: string): boolean {
  const [local, domain, extra] = value.trim().split("@");
  if (extra !== undefined || !local || !domain) return false;
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".");
}

/** A year less a day from the start, the way a renewal dates itself. */
function defaultExpiry(startIso: string): string {
  const [y, m, d] = startIso.split("-").map(Number);
  return new Date(Date.UTC(y + 1, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** The day after an expiry, where the next policy year starts. */
function dayAfter(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function paginate<T>(rows: T[], filter: { page?: number; pageSize?: number }): Page<T> {
  const pageSize = filter.pageSize ?? 25;
  const page = filter.page ?? 1;
  return {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    page,
    pageSize,
  };
}

export class FakeBackend {
  book: Book;

  /** Every call the app has made, in order. */
  calls: RecordedCall[] = [];

  private overrides = new Map<string, Handler>();
  private failures = new Map<string, { error: BridgeError; once: boolean }>();
  private gates = new Map<string, Array<HeldCall>>();
  private nextId = 1000;

  constructor(book: Book = createBook()) {
    this.book = book;
  }

  // ------------------------------------------------------------ test controls

  /** Answer a command yourself, instead of from the book. */
  on(command: string, handler: Handler): this {
    this.overrides.set(command, handler);
    return this;
  }

  /** Make a command fail every time until it is cleared. */
  fail(command: string, error: Partial<BridgeError> = {}): this {
    this.failures.set(command, {
      error: { kind: error.kind ?? "internal", message: error.message ?? "Something went wrong" },
      once: false,
    });
    return this;
  }

  /** Make a command fail once, then behave again. */
  failOnce(command: string, error: Partial<BridgeError> = {}): this {
    this.failures.set(command, {
      error: { kind: error.kind ?? "internal", message: error.message ?? "Something went wrong" },
      once: true,
    });
    return this;
  }

  /** Stop a command failing. */
  succeed(command: string): this {
    this.failures.delete(command);
    return this;
  }

  /**
   * Hold the next call to a command open, so the screen can be inspected while
   * it is still waiting. Release or reject it to let the screen move on.
   *
   * A screen that asks the same question twice — a list behind a debounced
   * search box asks on mount and again when the debounce lands — will spend the
   * gate on the first, uninteresting call. Pass a predicate to hold only the
   * call you mean: `hold("list_policies", (args) => args.filter.search === "an")`.
   */
  hold(command: string, match?: (args: Record<string, unknown>) => boolean): Gate {
    let settle: (error: BridgeError | null) => void = () => {};
    const promise = new Promise<BridgeError | null>((resolve) => {
      settle = resolve;
    });
    const queue = this.gates.get(command) ?? [];
    queue.push({ promise, match });
    this.gates.set(command, queue);
    return {
      release: () => settle(null),
      reject: (error: BridgeError) => settle(error),
    };
  }

  /** Every call made to one command. */
  callsTo(command: string): RecordedCall[] {
    return this.calls.filter((call) => call.command === command);
  }

  /** How many times a command was called. */
  countOf(command: string): number {
    return this.callsTo(command).length;
  }

  /** The arguments of the most recent call to a command, or undefined. */
  lastCall(command: string): Record<string, unknown> | undefined {
    return this.callsTo(command).at(-1)?.args;
  }

  /** Forget the calls made so far, leaving the book alone. */
  clearCalls(): void {
    this.calls = [];
  }

  // ------------------------------------------------------------ the bridge

  async invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ command, args: args ?? {} });

    const queue = this.gates.get(command);
    const waiting = queue?.findIndex((gate) => !gate.match || gate.match(args ?? {})) ?? -1;
    if (queue && waiting >= 0) {
      const [gate] = queue.splice(waiting, 1);
      const held = await gate.promise;
      if (held) throw held;
    }

    const failure = this.failures.get(command);
    if (failure) {
      if (failure.once) this.failures.delete(command);
      throw failure.error;
    }

    const override = this.overrides.get(command);
    if (override) return (await override(args ?? {})) as T;

    const handler = this.handlers[command];
    if (!handler) {
      if (command.startsWith("plugin:")) return null as T;
      throw { kind: "internal", message: `No test answer for "${command}"` } satisfies BridgeError;
    }
    return handler(args ?? {}) as T;
  }

  // ------------------------------------------------------------ the book

  private id(): number {
    this.nextId += 1;
    return this.nextId;
  }

  private notFound(what: string): never {
    throw { kind: "not_found", message: `${what} was not found` } satisfies BridgeError;
  }

  private invalid(message: string): never {
    throw { kind: "validation", message } satisfies BridgeError;
  }

  private nextClientCode(): string {
    const highest = this.book.clients
      .map((row) => Number(/^CL-(\d+)$/.exec(row.clientCode)?.[1] ?? 0))
      .reduce((best, value) => Math.max(best, value), 0);
    return `CL-${String(highest + 1).padStart(5, "0")}`;
  }

  private validateClient(input: ClientInput): void {
    if (!input?.fullName?.trim()) this.invalid("Client name is required");
    const email = blankToNone(input.email);
    if (email && !looksLikeEmail(email)) this.invalid(`"${email}" is not a valid email address`);
    const dob = blankToNone(input.dateOfBirth);
    if (dob && !parseDate(dob)) this.invalid("Date of birth is not a valid date");
  }

  /** Every stored column of a client, tidied the way the core tidies it. */
  private clientColumns(input: ClientInput) {
    return {
      fullName: tidyName(input.fullName),
      email: blankToNone(input.email),
      phone: normalisePhone(input.phone),
      altPhone: normalisePhone(input.altPhone),
      dateOfBirth: parseDate(input.dateOfBirth),
      gender: blankToNone(input.gender),
      addressLine1: blankToNone(input.addressLine1),
      addressLine2: blankToNone(input.addressLine2),
      city: blankToNone(input.city),
      state: blankToNone(input.state),
      pincode: blankToNone(input.pincode),
      occupation: blankToNone(input.occupation),
      pan: blankToNone(input.pan)?.toUpperCase() ?? null,
      gstin: blankToNone(input.gstin)?.toUpperCase() ?? null,
      preferredLanguage: input.preferredLanguage ?? "en",
      remindersOptedOut: input.remindersOptedOut ?? false,
      notes: blankToNone(input.notes),
      kind: input.kind ?? "individual",
      contactPerson: blankToNone(input.contactPerson),
      contactDesignation: blankToNone(input.contactDesignation),
      registrationNo: blankToNone(input.registrationNo)?.toUpperCase() ?? null,
    };
  }

  private validateTemplate(input: EmailTemplateInput): void {
    if (!input?.name?.trim()) this.invalid("Template name is required");
    if (!input?.subject?.trim()) this.invalid("Subject is required");
  }

  private validateRule(input: ReminderRuleInput): void {
    if (!input?.name?.trim()) this.invalid("Rule name is required");
    if (input.offsetDays < -365 || input.offsetDays > 365) {
      this.invalid("Timing must be within a year either side of expiry");
    }
    if (!["client", "provider"].includes(input.audience)) {
      this.invalid("Audience must be client or provider");
    }
    if (!["email", "desktop", "both"].includes(input.channel)) {
      this.invalid("Channel must be email, desktop or both");
    }
    if (input.category && !CATEGORY_ORDER.includes(input.category as (typeof CATEGORY_ORDER)[number])) {
      this.invalid(`\`${input.category}\` is not a policy category`);
    }
    if (input.templateId != null) {
      if (!this.book.templates.some((row) => row.id === input.templateId)) {
        this.notFound("That template");
      }
    } else if (input.audience === "client") {
      // A rule that writes to a client with no message has nothing to say.
      this.invalid("Choose the message this rule sends to the client");
    }
  }

  private validatePolicy(input: PolicyInput): void {
    if (!input?.policyNumber?.trim()) this.invalid("Policy number is required");
    if (!CATEGORY_ORDER.includes(input.category as (typeof CATEGORY_ORDER)[number])) {
      this.invalid(`"${input.category}" is not a known policy category`);
    }
    const start = parseDate(input.startDate);
    if (!start) this.invalid("Start date is not a valid date");
    const expiry = parseDate(input.expiryDate);
    if (!expiry) this.invalid("Expiry date is not a valid date");
    if (expiry! <= start!) this.invalid("Expiry date must be after the start date");
  }

  private client(id: number): Client {
    return this.book.clients.find((row) => row.id === id) ?? this.notFound("That client");
  }

  private policy(id: number): Policy {
    return this.book.policies.find((row) => row.id === id) ?? this.notFound("That policy");
  }

  /** Fills in the joined columns a policy row carries. */
  private decorate(policy: Policy): Policy {
    const client = this.book.clients.find((row) => row.id === policy.clientId);
    const insurer = this.book.insurers.find((row) => row.id === policy.insurerId);
    const product = this.book.products.find((row) => row.id === policy.productId);
    policy.clientCode = client?.clientCode ?? policy.clientCode;
    policy.clientName = client?.fullName ?? policy.clientName;
    policy.clientEmail = client?.email ?? null;
    policy.clientPhone = client?.phone ?? null;
    policy.clientCity = client?.city ?? null;
    policy.remindersOptedOut = client?.remindersOptedOut ?? false;
    policy.insurerName = insurer?.name ?? policy.insurerName;
    policy.productName = product?.name ?? null;
    policy.daysToExpiry = daysUntil(policy.expiryDate);
    // The expected commission is stored, never recomputed: a renewal that
    // carries last year's figure forward has to stay visible as such.
    return policy;
  }

  private filterPolicies(filter: PolicyFilter = {}): Policy[] {
    let rows = this.book.policies.map((row) => this.decorate({ ...row }));

    if (filter.search) {
      const needle = lower(filter.search);
      rows = rows.filter((row) =>
        [
          row.policyNumber,
          row.clientName,
          row.vehicleNumber,
          row.clientCode,
          row.engineNumber,
          row.chassisNumber,
        ].some((value) =>
          lower(value).includes(needle),
        ),
      );
    }
    if (filter.clientId) rows = rows.filter((row) => row.clientId === filter.clientId);
    if (filter.insurerId) rows = rows.filter((row) => row.insurerId === filter.insurerId);
    if (filter.productId) rows = rows.filter((row) => row.productId === filter.productId);
    if (filter.categories?.length) rows = rows.filter((row) => filter.categories!.includes(row.category));
    if (filter.statuses?.length) rows = rows.filter((row) => filter.statuses!.includes(row.status));
    if (filter.city) rows = rows.filter((row) => row.clientCity === filter.city);
    if (filter.expiryFrom) rows = rows.filter((row) => row.expiryDate >= filter.expiryFrom!);
    if (filter.expiryTo) rows = rows.filter((row) => row.expiryDate <= filter.expiryTo!);
    if (filter.minPremium != null) rows = rows.filter((row) => (row.premiumAmount ?? 0) >= filter.minPremium!);
    if (filter.maxPremium != null) rows = rows.filter((row) => (row.premiumAmount ?? 0) <= filter.maxPremium!);
    if (filter.expiringWithinDays != null) {
      rows = rows.filter((row) => row.daysToExpiry >= 0 && row.daysToExpiry <= filter.expiringWithinDays!);
    }
    if (filter.unrenewedOnly) {
      rows = rows.filter((row) => !row.isRenewed && row.status !== "cancelled" && row.daysToExpiry < 0);
    }
    if (filter.latestOnly) {
      const best = new Map<string, Policy>();
      for (const row of rows) {
        const current = best.get(row.chainId);
        if (!current || row.policyYear > current.policyYear) best.set(row.chainId, row);
      }
      rows = Array.from(best.values());
    }

    const keys: Record<string, (row: Policy) => string | number> = {
      expiry: (row) => row.expiryDate,
      client: (row) => lower(row.clientName),
      policyNumber: (row) => lower(row.policyNumber),
      category: (row) => row.category,
      premium: (row) => row.premiumAmount ?? 0,
    };
    const key = keys[filter.sort ?? "expiry"] ?? keys.expiry;
    rows.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0));
    if (filter.descending) rows.reverse();

    return rows;
  }

  private filterClients(filter: ClientFilter = {}): Client[] {
    let rows = this.book.clients.map((row) => ({ ...row }));

    if (!filter.includeArchived) rows = rows.filter((row) => !row.isArchived);
    // Browsing shows the policyholders; searching reaches everybody, because a
    // child the book holds must answer to their own name.
    if (!filter.includeFamily && !filter.search?.trim()) {
      rows = rows.filter((row) => !row.isDependent);
    }
    if (filter.missingEmail) rows = rows.filter((row) => !row.email);
    if (filter.kind) rows = rows.filter((row) => row.kind === filter.kind);
    if (filter.groupId != null) rows = rows.filter((row) => row.groupId === filter.groupId);
    if (filter.city) rows = rows.filter((row) => row.city === filter.city);
    if (filter.state) rows = rows.filter((row) => row.state === filter.state);
    if (filter.category) {
      rows = rows.filter((row) =>
        this.book.policies.some(
          (policy) => policy.clientId === row.id && policy.category === filter.category,
        ),
      );
    }
    if (filter.search) {
      const needle = lower(filter.search);
      rows = rows.filter((row) =>
        [row.fullName, row.phone, row.email, row.clientCode, row.pan].some((value) =>
          lower(value).includes(needle),
        ),
      );
    }

    const keys: Record<string, (row: Client) => string | number> = {
      name: (row) => lower(row.fullName),
      policies: (row) => row.activePolicies,
      nextExpiry: (row) => row.nextExpiry ?? "9999-12-31",
      created: (row) => row.createdAt,
      // Ungrouped clients sort last rather than first, so the column reads as
      // the groups it has rather than the blanks it does not.
      group: (row) => lower(row.groupName ?? "zzzz"),
    };
    const key = keys[filter.sort ?? "name"] ?? keys.name;
    rows.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0));
    if (filter.descending) rows.reverse();

    return rows;
  }

  // ------------------------------------------------------------ groups
  // A group is a row with members pointing at it, which is why it can be listed,
  // archived and deleted as itself. These mirror `src-tauri/src/repo/groups.rs`.

  private group(id: number): Group {
    return this.book.groups.find((row) => row.id === id) ?? this.notFound("That group");
  }

  private nextGroupCode(): string {
    const highest = this.book.groups
      .map((row) => Number(/^GR-(\d+)$/.exec(row.groupCode)?.[1] ?? 0))
      .reduce((best, value) => Math.max(best, value), 0);
    return `GR-${String(highest + 1).padStart(5, "0")}`;
  }

  /** The rollups a group derives, and the group name each client reads. */
  private regroup(): void {
    recountGroups(this.book.groups, this.book.clients, this.book.policies);
  }

  /**
   * The head as it is stored: whitespace is nothing at all, and the name and
   * phone go through the same tidying a client's name and phone get.
   */
  private headColumns(input: GroupInput) {
    const name = blankToNone(input.headName);
    return {
      headName: name === null ? null : tidyName(name),
      headDesignation: blankToNone(input.headDesignation),
      headPhone: normalisePhone(input.headPhone),
      headEmail: blankToNone(input.headEmail),
    };
  }

  private validateGroup(input: GroupInput, self?: number): void {
    const name = blankToNone(input?.name);
    if (!name) this.invalid("Group name is required");
    // The head is optional in every part: a group may be opened before anybody
    // knows who referred it. What is checked is the shape of what was given.
    const email = blankToNone(input.headEmail);
    if (email && !looksLikeEmail(email)) this.invalid("The group head's email is not an address");

    const code = blankToNone(input.groupCode);
    const clash = this.book.groups.find(
      (row) =>
        row.id !== self && (lower(row.name) === lower(name) || (code && row.groupCode === code)),
    );
    if (clash) {
      throw {
        kind: "conflict",
        message: "A group with that name or code already exists",
      } satisfies BridgeError;
    }
  }

  private filterGroups(filter: GroupFilter = {}): Group[] {
    let rows = this.book.groups.map((row) => ({ ...row }));

    if (!filter.includeArchived) rows = rows.filter((row) => !row.isArchived);
    if (filter.search) {
      const needle = lower(filter.search);
      rows = rows.filter((row) =>
        [row.name, row.groupCode, row.headName].some((value) => lower(value).includes(needle)),
      );
    }

    const keys: Record<string, (row: Group) => string | number> = {
      name: (row) => lower(row.name),
      code: (row) => row.groupCode,
      members: (row) => row.members,
      policies: (row) => row.activePolicies,
      premium: (row) => row.premiumUnderManagement,
      nextExpiry: (row) => row.nextExpiry ?? "9999-12-31",
      created: (row) => row.createdAt,
    };
    const key = keys[filter.sort ?? "name"] ?? keys.name;
    rows.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0));
    if (filter.descending) rows.reverse();

    return rows;
  }

  // ------------------------------------------------------------ family
  // A family is what the edges reach, in either direction, with no family id
  // anywhere. These mirror `src-tauri/src/repo/relations.rs`.

  private samePair(edge: FamilyEdge, a: number, b: number): boolean {
    return (
      (edge.clientId === a && edge.relatedClientId === b) ||
      (edge.clientId === b && edge.relatedClientId === a)
    );
  }

  /** The ids one step out, either direction. What archive and family delete act on. */
  private immediateIds(id: number): number[] {
    const found = new Set<number>();
    for (const edge of this.book.relations) {
      if (edge.clientId === id) found.add(edge.relatedClientId);
      if (edge.relatedClientId === id) found.add(edge.clientId);
    }
    return [...found];
  }

  /**
   * Everyone directly related, spouse first and children before parents, with
   * `outgoing` saying which way the edge is stored so the page can read the
   * stored word aloud instead of guessing its opposite.
   */
  private relativesOf(id: number): Relative[] {
    this.client(id);
    const rows: Relative[] = [];
    for (const edge of this.book.relations) {
      const outgoing = edge.clientId === id;
      if (!outgoing && edge.relatedClientId !== id) continue;
      const other = this.client(outgoing ? edge.relatedClientId : edge.clientId);
      rows.push({
        clientId: other.id,
        clientCode: other.clientCode,
        fullName: other.fullName,
        relationship: edge.relationship,
        outgoing,
        dateOfBirth: other.dateOfBirth,
        gender: other.gender,
        isArchived: other.isArchived,
        ownPolicies: other.totalPolicies,
        notes: other.notes,
      });
    }
    const rank = (relationship: Relationship) =>
      relationship === "spouse"
        ? 0
        : relationship === "son" || relationship === "daughter"
          ? 1
          : relationship === "father" || relationship === "mother"
            ? 2
            : 3;
    return rows.sort(
      (a, b) =>
        rank(a.relationship) - rank(b.relationship) || a.fullName.localeCompare(b.fullName),
    );
  }

  /** Everybody reachable, with the shortest walk to each and the edges between them. */
  private family(id: number): Family {
    this.client(id);
    const steps = new Map<number, number>([[id, 0]]);
    let frontier = [id];
    for (let depth = 1; depth <= FAMILY_MAX_DEPTH && frontier.length; depth += 1) {
      const next: number[] = [];
      for (const person of frontier) {
        for (const neighbour of this.immediateIds(person)) {
          if (steps.has(neighbour)) continue;
          steps.set(neighbour, depth);
          next.push(neighbour);
        }
      }
      frontier = next;
    }

    const members: FamilyMember[] = [...steps.entries()]
      .map(([person, walked]) => {
        const client = this.client(person);
        return {
          clientId: client.id,
          clientCode: client.clientCode,
          fullName: client.fullName,
          dateOfBirth: client.dateOfBirth,
          gender: client.gender,
          isArchived: client.isArchived,
          ownPolicies: client.totalPolicies,
          steps: walked,
        };
      })
      .sort((a, b) => a.steps - b.steps || a.fullName.localeCompare(b.fullName));

    return {
      members,
      edges: this.book.relations
        .filter((edge) => steps.has(edge.clientId) && steps.has(edge.relatedClientId))
        .map((edge) => ({ ...edge })),
    };
  }

  /**
   * Refuses an edge that would make somebody their own ancestor. Only parent and
   * child edges point up and down a family, so only they can contradict
   * themselves; a spouse edge that closes a loop is a family with two ways
   * through it.
   */
  private rejectAncestryLoop(clientId: number, relatedId: number, relationship: Relationship): void {
    const pair =
      relationship === "son" || relationship === "daughter"
        ? { ancestor: clientId, descendant: relatedId }
        : relationship === "father" || relationship === "mother"
          ? { ancestor: relatedId, descendant: clientId }
          : null;
    if (!pair) return;

    const parentsOf = (person: number) =>
      this.book.relations
        .filter(
          (edge) =>
            (edge.relatedClientId === person &&
              (edge.relationship === "son" || edge.relationship === "daughter")) ||
            (edge.clientId === person &&
              (edge.relationship === "father" || edge.relationship === "mother")),
        )
        .map((edge) => (edge.relatedClientId === person ? edge.clientId : edge.relatedClientId));

    const seen = new Set([pair.ancestor]);
    let frontier = [pair.ancestor];
    for (let depth = 0; depth < FAMILY_MAX_DEPTH && frontier.length; depth += 1) {
      const next: number[] = [];
      for (const person of frontier) {
        for (const parent of parentsOf(person)) {
          if (parent === pair.descendant) {
            this.invalid(
              "That would make somebody their own ancestor. Check which way round the relationship goes.",
            );
          }
          if (!seen.has(parent)) {
            seen.add(parent);
            next.push(parent);
          }
        }
      }
      frontier = next;
    }
  }

  /**
   * Writes the lives a policy covers. Left out of the payload, the cover list is
   * left alone; sent, it is replaced — and only the holder or someone related to
   * them can be on it, which is the rule the core's INSERT ... WHERE enforces.
   */
  private setCover(policyId: number, input: PolicyInput): void {
    if (!input.insuredClientIds) return;
    const policy = this.policy(policyId);
    const allowed = new Set([policy.clientId, ...this.immediateIds(policy.clientId)]);
    this.book.cover = this.book.cover.filter((row) => row.policyId !== policyId);
    for (const clientId of new Set(input.insuredClientIds)) {
      if (allowed.has(clientId)) this.book.cover.push({ policyId, clientId });
    }
  }

  /** The derived client columns, after policies or relationships change. */
  private recount(): void {
    recountClients(this.book.clients, this.book.policies, this.book.relations);
    // A group's totals are its members' policies added up, so anything that
    // moves a policy moves them.
    this.regroup();
  }

  private dashboard(): Dashboard {
    const all = this.book.policies.map((row) => this.decorate({ ...row }));
    const active = all.filter((row) => row.status === "active");
    const overdue = all.filter(
      (row) => !row.isRenewed && row.status !== "cancelled" && row.daysToExpiry < 0,
    );
    const within = (from: number, to: number) =>
      active.filter((row) => row.daysToExpiry >= from && row.daysToExpiry <= to);
    const sum = (rows: Policy[], key: "premiumAmount" | "sumInsured" | "commissionExpected") =>
      rows.reduce((total, row) => total + (row[key] ?? 0), 0);

    // The counts of people are counts of policyholders. Counting the family
    // members as well would say the book holds half again as many clients as it
    // has cover for, and would report every child as a client with no email.
    const holders = this.book.clients.filter((row) => !row.isDependent);

    return {
      totalClients: holders.length,
      activeClients: holders.filter((row) => !row.isArchived).length,
      activePolicies: active.length,
      expiringThisWeek: within(0, 7).length,
      expiringThisMonth: within(0, 30).length,
      expiredUnrenewed: overdue.length,
      premiumUnderManagement: sum(active, "premiumAmount"),
      commissionExpected: sum(active, "commissionExpected"),
      clientsWithoutEmail: holders.filter((row) => !row.isArchived && !row.email).length,
      buckets: [
        { label: "Overdue", rows: overdue },
        { label: "0-7 days", rows: within(0, 7) },
        { label: "8-15 days", rows: within(8, 15) },
        { label: "16-30 days", rows: within(16, 30) },
        { label: "31-60 days", rows: within(31, 60) },
        { label: "61-90 days", rows: within(61, 90) },
      ].map(({ label, rows }) => ({
        label,
        count: rows.length,
        premiumTotal: sum(rows, "premiumAmount"),
      })),
      byCategory: CATEGORY_ORDER.map((category) => {
        const rows = active.filter((row) => row.category === category);
        return {
          category,
          policyCount: rows.length,
          premiumTotal: sum(rows, "premiumAmount"),
          sumInsuredTotal: sum(rows, "sumInsured"),
        };
      }).filter((entry) => entry.policyCount > 0),
      upcoming: within(0, 45).sort((a, b) => a.daysToExpiry - b.daysToExpiry),
      recentlyLapsed: overdue.sort((a, b) => b.daysToExpiry - a.daysToExpiry),
    };
  }

  private planned(): PlannedReminder[] {
    const active = this.book.policies
      .map((row) => this.decorate({ ...row }))
      .filter((row) => row.status === "active");
    return this.book.rules
      .filter((rule) => rule.isActive)
      .flatMap((rule) =>
        active
          .filter((policy) => policy.daysToExpiry === rule.offsetDays)
          .map((policy) => ({
            ruleId: rule.id,
            ruleName: rule.name,
            policyId: policy.id,
            policyNumber: policy.policyNumber,
            clientId: policy.clientId,
            clientName: policy.clientName,
            toAddress: policy.clientEmail,
            expiryDate: policy.expiryDate,
            daysToExpiry: rule.offsetDays,
            channel: rule.channel,
            subject: `Your ${CATEGORY_LABELS[policy.category]} policy expires on ${showDate(
              policy.expiryDate,
            )}`,
            blockedReason: policy.clientEmail ? null : "No email address on the client",
          })),
      );
  }

  private overview(): ReminderOverview {
    const settings = this.book.settings;
    const active = this.book.policies
      .map((row) => this.decorate({ ...row }))
      .filter((row) => row.status === "active");
    return {
      enabled: settings.reminders_enabled === "true",
      dryRun: settings.dry_run === "true",
      smtpConfigured: Boolean(settings.smtp_host && settings.smtp_username),
      smtpPasswordSet: this.book.smtpPasswordSet,
      fromEmail: settings.smtp_from_email ?? "",
      sendTime: settings.reminder_send_time ?? "09:00",
      dailyCap: Number(settings.daily_send_cap ?? 0),
      digestEnabled: settings.digest_enabled === "true",
      desktopAlerts: settings.desktop_alerts === "true",
      activeRules: this.book.rules.filter((rule) => rule.isActive).length,
      dueToday: this.planned().length,
      queued: this.book.notifications.filter((row) => row.status === "queued").length,
      failed: this.book.notifications.filter((row) => row.status === "failed").length,
      sentToday: this.book.notifications.filter((row) => row.status === "sent").length,
      lastSweep: `${TODAY}T03:30:00Z`,
      clientsOptedOut: this.book.clients.filter((row) => row.remindersOptedOut).length,
      expiringWithoutEmail: active.filter((row) => row.daysToExpiry <= 30 && !row.clientEmail).length,
    };
  }

  private fillTemplate(text: string): string {
    const policy = this.book.policies[0];
    const settings = this.book.settings;
    const sample: Record<string, string> = {
      client_name: policy?.clientName ?? "",
      client_code: policy?.clientCode ?? "",
      client_email: policy?.clientEmail ?? "",
      client_phone: policy?.clientPhone ?? "",
      policy_number: policy?.policyNumber ?? "",
      category_label: CATEGORY_LABELS[policy?.category ?? "other"],
      insurer_name: policy?.insurerName ?? "",
      product_name: policy?.productName ?? "",
      start_date: showDate(policy?.startDate ?? TODAY),
      expiry_date: showDate(policy?.expiryDate ?? TODAY),
      days_to_expiry: String(policy?.daysToExpiry ?? 0),
      policy_year: String(policy?.policyYear ?? 1),
      sum_insured: `₹${(policy?.sumInsured ?? 0).toLocaleString("en-IN")}`,
      premium_amount: `₹${(policy?.premiumAmount ?? 0).toLocaleString("en-IN")}`,
      nominee_name: policy?.nomineeName ?? "",
      vehicle_number: policy?.vehicleNumber ?? "",
      provider_name: settings.provider_name ?? "",
      provider_email: settings.provider_email ?? "",
      provider_phone: settings.provider_phone ?? "",
      provider_address: settings.provider_address ?? "",
      today: showDate(TODAY),
      expiring_count: "12",
      digest_table: "<table><tr><td>Ananya Sharma</td><td>Expires in 7 days</td></tr></table>",
    };
    return String(text ?? "").replace(
      /\{\{\{?\s*([a-z_]+)\s*\}?\}\}/g,
      (_, name: string) => sample[name] ?? "",
    );
  }

  private knownPlaceholder(name: string): boolean {
    return this.book.placeholders.some((entry) => entry.name === name);
  }

  private handlers: Record<string, Handler> = {
    // ------------------------------------------------------------ session
    session_state: () => ({ ...this.book.session }),
    setup: (args) => {
      const password = String(args.password ?? "");
      if (password.length < 8) this.invalid("The password needs at least 8 characters");
      this.book.session = { ...this.book.session, initialised: true, unlocked: true };
      return { ...this.book.session };
    },
    unlock: (args) => {
      if (args.password !== CORRECT_PASSWORD) {
        throw { kind: "bad_password", message: "That password does not open this book" } satisfies BridgeError;
      }
      this.book.session = { ...this.book.session, unlocked: true };
      return { ...this.book.session };
    },
    unlock_with_keychain: () => {
      if (!this.book.session.canUseKeychain) {
        throw { kind: "locked", message: "This device is not remembered" } satisfies BridgeError;
      }
      this.book.session = { ...this.book.session, unlocked: true };
      return { ...this.book.session };
    },
    lock: () => {
      this.book.session = { ...this.book.session, unlocked: false };
      return { ...this.book.session };
    },
    forget_device: () => {
      this.book.session = { ...this.book.session, canUseKeychain: false };
      return { ...this.book.session };
    },
    change_password: (args) => {
      if (args.current !== CORRECT_PASSWORD) {
        throw { kind: "bad_password", message: "The current password is wrong" } satisfies BridgeError;
      }
      return null;
    },

    // ------------------------------------------------------------ dashboard
    load_dashboard: () => this.dashboard(),
    category_options: () =>
      CATEGORY_ORDER.map((key, index) => ({
        id: index,
        label: CATEGORY_LABELS[key],
        secondary: key,
      })),
    client_cities: () =>
      Array.from(new Set(this.book.clients.map((row) => row.city).filter(Boolean))).sort() as string[],

    // ------------------------------------------------------------ clients
    list_clients: (args) => paginate(this.filterClients(args.filter as ClientFilter), (args.filter ?? {}) as ClientFilter),
    get_client: (args) => ({ ...this.client(Number(args.id)) }),
    create_client: (args) => {
      const input = args.input as ClientInput;
      this.validateClient(input);
      const id = this.id();
      this.book.clients.push({
        id,
        clientCode: blankToNone(input.clientCode) ?? this.nextClientCode(),
        ...this.clientColumns(input),
        groupId: input.groupId ?? null,
        isArchived: false,
        createdAt: `${TODAY}T04:30:00Z`,
        updatedAt: `${TODAY}T04:30:00Z`,
        activePolicies: 0,
        totalPolicies: 0,
        nextExpiry: null,
        relatives: 0,
        isDependent: false,
        groupName: null,
      });
      this.regroup();
      return id;
    },
    update_client: (args) => {
      const client = this.client(Number(args.id));
      const input = args.input as ClientInput;
      this.validateClient(input);
      // Every column is written from the payload, so a field the form does not
      // carry is emptied rather than left alone — as the UPDATE statement does.
      // Group membership is the exception the core makes for the same reason:
      // the client form draws no group, and saving a name change must not tip a
      // client out of one.
      Object.assign(client, this.clientColumns(input), {
        clientCode: blankToNone(input.clientCode) ?? client.clientCode,
        groupId: input.groupId ?? client.groupId,
        updatedAt: `${TODAY}T04:30:00Z`,
      });
      for (const policy of this.book.policies) this.decorate(policy);
      this.regroup();
      return null;
    },
    set_client_archived: (args) => {
      this.client(Number(args.id)).isArchived = Boolean(args.archived);
      return null;
    },
    delete_client: (args) => {
      // Two scopes, as the core has them: the client alone, whose relationship
      // edges go but whose relatives stay, or the client with the people one
      // step out from them.
      const id = Number(args.id);
      this.client(id);
      const scope = (args.scope ?? "linksOnly") as DeleteScope;
      const going = scope === "immediateFamily" ? [id, ...this.immediateIds(id)] : [id];

      this.book.clients = this.book.clients.filter((row) => !going.includes(row.id));
      this.book.policies = this.book.policies.filter((row) => !going.includes(row.clientId));
      this.book.relations = this.book.relations.filter(
        (row) => !going.includes(row.clientId) && !going.includes(row.relatedClientId),
      );
      this.book.cover = this.book.cover.filter((row) => !going.includes(row.clientId));
      this.book.documents = this.book.documents.filter((row) => !going.includes(row.clientId));
      this.recount();
      recountCatalogue(this.book.insurers, this.book.products, this.book.policies);
      return going;
    },
    next_client_code: () => `CL-${String(this.book.clients.length + 1).padStart(5, "0")}`,

    // ------------------------------------------------------------ groups
    list_groups: (args) =>
      paginate(this.filterGroups(args.filter as GroupFilter), (args.filter ?? {}) as GroupFilter),
    get_group: (args) => ({ ...this.group(Number(args.id)) }),
    next_group_code: () => this.nextGroupCode(),
    create_group: (args) => {
      const input = args.input as GroupInput;
      this.validateGroup(input);
      const id = this.id();
      this.book.groups.push({
        id,
        groupCode: blankToNone(input.groupCode) ?? this.nextGroupCode(),
        name: input.name.trim(),
        ...this.headColumns(input),
        notes: blankToNone(input.notes),
        isArchived: false,
        createdAt: `${TODAY}T04:30:00Z`,
        updatedAt: `${TODAY}T04:30:00Z`,
        members: 0,
        activePolicies: 0,
        totalPolicies: 0,
        premiumUnderManagement: 0,
        nextExpiry: null,
      });
      this.regroup();
      return id;
    },
    update_group: (args) => {
      const group = this.group(Number(args.id));
      const input = args.input as GroupInput;
      this.validateGroup(input, group.id);
      Object.assign(group, {
        name: input.name.trim(),
        groupCode: blankToNone(input.groupCode) ?? group.groupCode,
        ...this.headColumns(input),
        notes: blankToNone(input.notes),
        updatedAt: `${TODAY}T04:30:00Z`,
      });
      this.regroup();
      return null;
    },
    set_group_archived: (args) => {
      // The members go with it and the referrer does not, because they were
      // never in it: archiving a folder puts away what is filed in it.
      const group = this.group(Number(args.id));
      const archived = Boolean(args.archived);
      group.isArchived = archived;
      let moved = 0;
      for (const client of this.book.clients) {
        if (client.groupId === group.id && client.isArchived !== archived) {
          client.isArchived = archived;
          moved += 1;
        }
      }
      return moved;
    },
    delete_group: (args) => {
      // A group is a filing arrangement, not an owner. Deleting the folder
      // releases the companies rather than taking them with it.
      const group = this.group(Number(args.id));
      let released = 0;
      for (const client of this.book.clients) {
        if (client.groupId === group.id) {
          client.groupId = null;
          released += 1;
        }
      }
      this.book.groups = this.book.groups.filter((row) => row.id !== group.id);
      this.regroup();
      return released;
    },
    set_client_group: (args) => {
      const client = this.client(Number(args.clientId));
      const groupId = args.groupId == null ? null : Number(args.groupId);
      // A client sits in one group at a time, so joining one is how they leave
      // the last.
      if (groupId != null) this.group(groupId);
      client.groupId = groupId;
      client.updatedAt = `${TODAY}T04:30:00Z`;
      this.regroup();
      return null;
    },

    // ------------------------------------------------------------ family
    list_relatives: (args) => this.relativesOf(Number(args.clientId)),
    client_family: (args) => this.family(Number(args.clientId)),
    link_clients: (args) => {
      const input = args.input as RelationInput;
      if (input.clientId === input.relatedClientId) {
        this.invalid("A client cannot be related to themselves");
      }
      const relationship = String(input.relationship ?? "").trim().toLowerCase();
      if (!RELATIONSHIPS.includes(relationship as Relationship)) {
        this.invalid(`"${String(input.relationship).trim()}" is not a relationship this book records`);
      }
      this.client(input.clientId);
      this.client(input.relatedClientId);
      this.rejectAncestryLoop(input.clientId, input.relatedClientId, relationship as Relationship);

      // The pair is unique, not the direction: correcting the word from either
      // page rewrites the one edge rather than adding its opposite.
      this.book.relations = this.book.relations.filter(
        (row) => !this.samePair(row, input.clientId, input.relatedClientId),
      );
      this.book.relations.push({
        clientId: input.clientId,
        relatedClientId: input.relatedClientId,
        relationship: relationship as Relationship,
      });
      this.recount();
      return null;
    },
    unlink_clients: (args) => {
      const clientId = Number(args.clientId);
      const relatedId = Number(args.relatedClientId);
      const before = this.book.relations.length;
      this.book.relations = this.book.relations.filter((row) => !this.samePair(row, clientId, relatedId));
      if (this.book.relations.length === before) this.notFound("Relationship");
      // The people stay; only the edge goes.
      this.recount();
      return null;
    },
    set_family_archived: (args) => {
      const id = Number(args.id);
      this.client(id);
      const archived = Boolean(args.archived);
      const household = [id, ...this.immediateIds(id)];
      let moved = 0;
      for (const person of household) {
        const client = this.client(person);
        if (client.isArchived !== archived) {
          client.isArchived = archived;
          moved += 1;
        }
      }
      return moved;
    },

    // ------------------------------------------------------------ documents
    list_documents: (args) =>
      this.book.documents
        .filter((row) => row.clientId === Number(args.clientId))
        .sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1))
        .map((row) => ({ ...row })),
    attach_document: (args) => {
      const input = args.input as DocumentInput;
      const id = this.id();
      const fileName = String(input.path).split("/").pop() ?? "document";
      const document: Document = {
        id,
        clientId: input.clientId,
        policyId: input.policyId ?? null,
        policyNumber:
          this.book.policies.find((row) => row.id === input.policyId)?.policyNumber ?? null,
        // An untitled document is filed under its file name without the
        // extension, as `path.file_stem()` does in documents.rs.
        title: blankToNone(input.title) ?? fileName.replace(/\.[^.]+$/, ""),
        fileName,
        mimeType: fileName.endsWith(".pdf") ? "application/pdf" : "image/png",
        sizeBytes: 123_456,
        uploadedAt: `${TODAY} 10:00:00`,
      };
      this.book.documents.push(document);
      return id;
    },
    // Bytes derived from the id, so a test can prove the viewer opened the
    // document that was clicked rather than merely opening something.
    document_content: (args) => new Uint8Array([Number(args.id) & 0xff, 0x50, 0x44, 0x46]).buffer,
    save_document_copy: () => null,
    delete_document: (args) => {
      this.book.documents = this.book.documents.filter((row) => row.id !== Number(args.id));
      return null;
    },

    // ------------------------------------------------------------ catalogue
    list_insurers: (args) =>
      this.book.insurers.filter((row) => args.includeInactive || row.isActive).map((row) => ({ ...row })),
    insurer_options: () =>
      this.book.insurers
        .filter((row) => row.isActive)
        .map((row) => ({ id: row.id, label: row.name, secondary: row.shortCode })),
    create_insurer: (args) => {
      const input = args.input as InsurerInput;
      if (!input?.name?.trim()) this.invalid("An insurer needs a name");
      if (this.book.insurers.some((row) => lower(row.name) === lower(input.name))) {
        throw { kind: "conflict", message: "An insurer with that name already exists" } satisfies BridgeError;
      }
      const id = this.id();
      const insurer: Insurer = {
        id,
        name: input.name,
        shortCode: input.shortCode ?? null,
        website: input.website ?? null,
        claimHelpline: input.claimHelpline ?? null,
        supportEmail: input.supportEmail ?? null,
        notes: input.notes ?? null,
        isActive: input.isActive ?? true,
        policyCount: 0,
      };
      this.book.insurers.push(insurer);
      return id;
    },
    update_insurer: (args) => {
      const insurer =
        this.book.insurers.find((row) => row.id === Number(args.id)) ?? this.notFound("That insurer");
      Object.assign(insurer, args.input);
      // A plan reads its company's name through a join, so a rename shows on
      // every plan the moment it is written.
      for (const product of this.book.products) {
        if (product.insurerId === insurer.id) product.insurerName = insurer.name;
      }
      return null;
    },
    delete_insurer: (args) => {
      const id = Number(args.id);
      if (this.book.policies.some((policy) => policy.insurerId === id)) {
        throw {
          kind: "conflict",
          message: "This insurer is on policies, so it cannot be deleted",
        } satisfies BridgeError;
      }
      this.book.insurers = this.book.insurers.filter((row) => row.id !== id);
      // `products.insurer_id` is declared ON DELETE CASCADE, so a company that
      // goes takes its plans with it.
      this.book.products = this.book.products.filter((row) => row.insurerId !== id);
      return null;
    },
    list_products: (args) =>
      this.book.products
        .filter(
          (row) =>
            (!args.insurerId || row.insurerId === Number(args.insurerId)) &&
            (args.includeInactive || row.isActive),
        )
        .map((row) => ({ ...row })),
    create_product: (args) => {
      const input = args.input as ProductInput;
      if (!input?.name?.trim()) this.invalid("A plan needs a name");
      // The schema's foreign key refuses a plan that belongs to nobody.
      if (!this.book.insurers.some((row) => row.id === input.insurerId)) {
        this.invalid("A plan needs an insurer");
      }
      const id = this.id();
      const product: Product = {
        id,
        insurerId: input.insurerId,
        insurerName: this.book.insurers.find((row) => row.id === input.insurerId)?.name ?? "",
        name: input.name,
        category: input.category as Product["category"],
        code: input.code ?? null,
        notes: input.notes ?? null,
        isActive: input.isActive ?? true,
        policyCount: 0,
      };
      this.book.products.push(product);
      return id;
    },
    update_product: (args) => {
      const product =
        this.book.products.find((row) => row.id === Number(args.id)) ?? this.notFound("That plan");
      Object.assign(product, args.input);
      return null;
    },
    delete_product: (args) => {
      const id = Number(args.id);
      if (!this.book.products.some((row) => row.id === id)) this.notFound("That plan");
      this.book.products = this.book.products.filter((row) => row.id !== id);
      // `policies.product_id` is ON DELETE SET NULL, so a plan that goes leaves
      // its policies standing with no plan named — it does not take them, and
      // unlike an insurer it is not refused for being in use.
      for (const policy of this.book.policies) {
        if (policy.productId === id) {
          policy.productId = null;
          policy.productName = null;
        }
      }
      return null;
    },

    // ------------------------------------------------------------ policies
    list_policies: (args) =>
      paginate(this.filterPolicies(args.filter as PolicyFilter), (args.filter ?? {}) as PolicyFilter),
    get_policy: (args) => this.decorate({ ...this.policy(Number(args.id)) }),
    policy_chain: (args) => {
      const policy = this.policy(Number(args.id));
      return this.book.policies
        .filter((row) => row.chainId === policy.chainId)
        .sort((a, b) => a.policyYear - b.policyYear)
        .map((row) => this.decorate({ ...row }));
    },
    policy_insured_ids: (args) => {
      const id = Number(args.id);
      this.policy(id);
      return this.book.cover.filter((row) => row.policyId === id).map((row) => row.clientId);
    },
    create_policy: (args) => {
      const input = args.input as PolicyInput;
      this.validatePolicy(input);
      if (this.book.policies.some((row) => row.policyNumber === input.policyNumber)) {
        throw { kind: "conflict", message: "That policy number is already in the book" } satisfies BridgeError;
      }
      const id = this.id();
      const policy = this.decorate({
        id,
        chainId: `chain-${id}`,
        policyYear: 1,
        previousPolicyId: null,
        policyNumber: input.policyNumber,
        clientId: input.clientId,
        clientCode: "",
        clientName: "",
        clientEmail: null,
        clientPhone: null,
        clientCity: null,
        remindersOptedOut: false,
        insurerId: input.insurerId,
        insurerName: "",
        productId: input.productId ?? null,
        productName: null,
        category: input.category as Policy["category"],
        status: (input.status ?? "active") as Policy["status"],
        startDate: input.startDate,
        expiryDate: input.expiryDate,
        sumInsured: input.sumInsured ?? null,
        premiumAmount: input.premiumAmount ?? null,
        gstAmount: input.gstAmount ?? null,
        premiumFrequency: input.premiumFrequency ?? "annual",
        paymentMode: input.paymentMode ?? null,
        nextDueDate: input.nextDueDate ?? null,
        commissionRate: input.commissionRate ?? null,
        commissionExpected: input.commissionExpected ?? null,
        nomineeName: input.nomineeName ?? null,
        nomineeRelation: input.nomineeRelation ?? null,
        vehicleNumber: input.vehicleNumber ?? null,
        variant: input.variant ?? null,
        riders: input.riders ?? [],
        planType: input.planType ?? null,
        term: input.term ?? null,
        policyType: input.policyType ?? null,
        broker: input.broker ?? null,
        inbuiltRider: input.inbuiltRider ?? null,
        vehicleType: input.vehicleType ?? null,
        grossVehicleWeight: input.grossVehicleWeight ?? null,
        passengerCapacity: input.passengerCapacity ?? null,
        vehicleManufacturer: input.vehicleManufacturer ?? null,
        vehicleModel: input.vehicleModel ?? null,
        manufactureYear: input.manufactureYear ?? null,
        engineNumber: input.engineNumber ?? null,
        chassisNumber: input.chassisNumber ?? null,
        coverType: input.coverType ?? null,
        odStartDate: input.odStartDate ?? null,
        odEndDate: input.odEndDate ?? null,
        tpStartDate: input.tpStartDate ?? null,
        tpEndDate: input.tpEndDate ?? null,
        odPremium: input.odPremium ?? null,
        tpPremium: input.tpPremium ?? null,
        notes: input.notes ?? null,
        createdAt: `${TODAY}T04:30:00Z`,
        updatedAt: `${TODAY}T04:30:00Z`,
        daysToExpiry: daysUntil(input.expiryDate),
        isRenewed: false,
      });
      this.book.policies.push(policy);
      this.setCover(id, input);
      this.recount();
      recountCatalogue(this.book.insurers, this.book.products, this.book.policies);
      return id;
    },
    update_policy: (args) => {
      const policy = this.policy(Number(args.id));
      const input = args.input as PolicyInput;
      this.validatePolicy(input);
      Object.assign(policy, input, { updatedAt: `${TODAY}T04:30:00Z` });
      this.decorate(policy);
      this.setCover(policy.id, input);
      this.recount();
      recountCatalogue(this.book.insurers, this.book.products, this.book.policies);
      return null;
    },
    renew_policy: (args) => {
      const input = args.input as RenewalInput;
      const previous = this.policy(input.policyId);
      if (previous.isRenewed) {
        throw {
          kind: "conflict",
          message: "That year has already been renewed. Renew the latest year instead.",
        } satisfies BridgeError;
      }
      // Left empty, the new year starts the day the old one ends and runs a
      // year less a day; anything supplied has to be a real date in order.
      const start = parseDate(input.startDate) ?? dayAfter(previous.expiryDate);
      const expiry = parseDate(input.expiryDate) ?? defaultExpiry(start);
      if (expiry <= start) this.invalid("Expiry date must be after the start date");
      const id = this.id();
      const renewed = this.decorate({
        ...previous,
        id,
        policyYear: previous.policyYear + 1,
        previousPolicyId: previous.id,
        policyNumber: blankToNone(input.policyNumber) ?? previous.policyNumber,
        startDate: start,
        expiryDate: expiry,
        sumInsured: input.sumInsured ?? previous.sumInsured,
        premiumAmount: input.premiumAmount ?? previous.premiumAmount,
        gstAmount: input.gstAmount ?? previous.gstAmount,
        commissionRate: input.commissionRate ?? previous.commissionRate,
        commissionExpected: input.commissionExpected ?? previous.commissionExpected,
        notes: blankToNone(input.notes),
        status: "active",
        isRenewed: false,
        createdAt: `${TODAY}T04:30:00Z`,
        updatedAt: `${TODAY}T04:30:00Z`,
        // The vehicle comes forward with the policy, but the risk it ran and
        // what that cost belong to the year being renewed.
        odStartDate: null,
        odEndDate: null,
        tpStartDate: null,
        tpEndDate: null,
        odPremium: null,
        tpPremium: null,
      });
      // A cancelled year keeps saying so; every other one is now renewed.
      if (previous.status !== "cancelled") previous.status = "renewed";
      previous.isRenewed = true;
      this.book.policies.push(renewed);
      // The new year covers the same lives as the old one, as the core carries
      // them forward.
      for (const row of this.book.cover.filter((entry) => entry.policyId === previous.id)) {
        this.book.cover.push({ policyId: id, clientId: row.clientId });
      }
      this.recount();
      return id;
    },
    set_policy_status: (args) => {
      const policy = this.policy(Number(args.id));
      policy.status = String(args.status) as Policy["status"];
      this.recount();
      return null;
    },
    delete_policy: (args) => {
      const id = Number(args.id);
      this.book.policies = this.book.policies.filter((row) => row.id !== id);
      this.book.cover = this.book.cover.filter((row) => row.policyId !== id);
      this.recount();
      recountCatalogue(this.book.insurers, this.book.products, this.book.policies);
      return null;
    },
    refresh_statuses: () => {
      let changed = 0;
      for (const policy of this.book.policies) {
        if (policy.status === "active" && daysUntil(policy.expiryDate) < 0) {
          policy.status = "expired";
          changed += 1;
        }
      }
      return changed;
    },

    // ------------------------------------------------------------ import & export
    import_fields: () => this.book.importFields.map((row) => ({ ...row })),
    preview_import: (args) => ({
      ...structuredClone(this.book.importPreview),
      sheet: (args.sheet as string) ?? this.book.importPreview.sheet,
    }),
    run_import: (args) => {
      const options = args.options as { dryRun?: boolean };
      return { ...structuredClone(this.book.importReport), dryRun: Boolean(options?.dryRun) };
    },
    write_import_template: (args) => String(args.path),
    export_policies: (args) => this.filterPolicies(args.filter as PolicyFilter).length,
    export_clients: (args) => this.filterClients(args.filter as ClientFilter).length,

    // ------------------------------------------------------------ templates
    list_templates: () => this.book.templates.map((row) => ({ ...row })),
    create_template: (args) => {
      const input = args.input as EmailTemplateInput;
      this.validateTemplate(input);
      const id = this.id();
      const template: EmailTemplate = {
        id,
        name: input.name,
        trigger: input.trigger,
        subject: input.subject,
        bodyHtml: input.bodyHtml,
        isActive: input.isActive ?? true,
        createdAt: `${TODAY}T04:30:00Z`,
        updatedAt: `${TODAY}T04:30:00Z`,
        usedByRules: 0,
      };
      this.book.templates.push(template);
      return id;
    },
    update_template: (args) => {
      const template =
        this.book.templates.find((row) => row.id === Number(args.id)) ?? this.notFound("That template");
      this.validateTemplate(args.input as EmailTemplateInput);
      Object.assign(template, args.input, { updatedAt: `${TODAY}T04:30:00Z` });
      return null;
    },
    delete_template: (args) => {
      const id = Number(args.id);
      const template = this.book.templates.find((row) => row.id === id) ?? this.notFound("That template");
      if (template.usedByRules > 0) {
        throw {
          kind: "conflict",
          message: "This template is used by a rule, so it cannot be deleted",
        } satisfies BridgeError;
      }
      this.book.templates = this.book.templates.filter((row) => row.id !== id);
      return null;
    },
    template_placeholders: () => this.book.placeholders.map((row) => ({ ...row })),
    preview_template: (args) => {
      const subject = String(args.subject ?? "");
      const bodyHtml = String(args.bodyHtml ?? "");
      const policy = this.book.policies[0];
      const used = `${subject} ${bodyHtml}`.match(/\{\{\{?\s*([a-z_]+)\s*\}?\}\}/g) ?? [];
      return {
        subject: this.fillTemplate(subject),
        html: this.fillTemplate(bodyHtml),
        text: this.fillTemplate(bodyHtml)
          .replace(/<[^>]+>/g, "\n")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .join("\n"),
        unknownPlaceholders: used
          .map((token) => token.replace(/[{}]/g, "").trim())
          .filter((name, index, all) => all.indexOf(name) === index)
          .filter((name) => !this.knownPlaceholder(name)),
        samplePolicy: policy ? `${policy.policyNumber} · ${policy.clientName}` : null,
      };
    },

    // ------------------------------------------------------------ reminders
    list_rules: () =>
      this.book.rules
        .map((row) => ({
          ...row,
          templateName: this.book.templates.find((t) => t.id === row.templateId)?.name ?? null,
        }))
        // The ladder reads from furthest ahead of expiry to nearest, and only
        // then by the place the rule was given: `ORDER BY r.offset_days DESC,
        // r.sort_order, r.name` in rules.rs.
        .sort(
          (a, b) =>
            b.offsetDays - a.offsetDays ||
            a.sortOrder - b.sortOrder ||
            a.name.localeCompare(b.name),
        ),
    create_rule: (args) => {
      const input = args.input as ReminderRuleInput;
      this.validateRule(input);
      const id = this.id();
      const rule: ReminderRule = {
        id,
        name: input.name,
        offsetDays: input.offsetDays,
        category: input.category ?? null,
        audience: input.audience,
        channel: input.channel,
        templateId: input.templateId ?? null,
        templateName: this.book.templates.find((t) => t.id === input.templateId)?.name ?? null,
        isActive: input.isActive ?? true,
        sortOrder:
          input.sortOrder ?? Math.max(0, ...this.book.rules.map((row) => row.sortOrder)) + 1,
      };
      this.book.rules.push(rule);
      return id;
    },
    update_rule: (args) => {
      const rule = this.book.rules.find((row) => row.id === Number(args.id)) ?? this.notFound("That rule");
      this.validateRule(args.input as ReminderRuleInput);
      Object.assign(rule, args.input);
      rule.templateName = this.book.templates.find((t) => t.id === rule.templateId)?.name ?? null;
      return null;
    },
    delete_rule: (args) => {
      this.book.rules = this.book.rules.filter((row) => row.id !== Number(args.id));
      return null;
    },
    reminder_overview: () => this.overview(),
    plan_reminders: () => this.planned(),
    run_reminders: (args) => {
      const dryRun = args.dryRun === true;
      const planned = this.planned();
      return {
        dryRun,
        queued: planned.length,
        sent: dryRun ? 0 : planned.filter((row) => !row.blockedReason).length,
        failed: 0,
        skipped: planned.filter((row) => row.blockedReason).length,
        heldByCap: 0,
        desktopAlerts: dryRun ? 0 : 1,
        digestSent: !dryRun && this.book.settings.digest_enabled === "true",
        issues: [],
      };
    },
    list_notifications: (args) => {
      const filter = (args.filter ?? {}) as NotificationFilter;
      let rows: Notification[] = this.book.notifications.map((row) => ({ ...row }));
      if (filter.statuses?.length) rows = rows.filter((row) => filter.statuses!.includes(row.status));
      if (filter.clientId) rows = rows.filter((row) => row.clientId === filter.clientId);
      if (filter.policyId) rows = rows.filter((row) => row.policyId === filter.policyId);
      if (filter.search) {
        const needle = lower(filter.search);
        rows = rows.filter((row) =>
          [row.clientName, row.policyNumber, row.toAddress, row.subject].some((value) =>
            lower(value).includes(needle),
          ),
        );
      }
      rows.sort((a, b) => (a.scheduledFor > b.scheduledFor ? -1 : 1));
      if (filter.descending === false) rows.reverse();
      return paginate(rows, filter);
    },
    retry_notification: (args) => {
      const row =
        this.book.notifications.find((entry) => entry.id === Number(args.id)) ??
        this.notFound("That message");
      row.status = "queued";
      row.lastError = null;
      return null;
    },
    cancel_notification: (args) => {
      const row =
        this.book.notifications.find((entry) => entry.id === Number(args.id)) ??
        this.notFound("That message");
      row.status = "cancelled";
      return null;
    },
    set_smtp_password: (args) => {
      this.book.smtpPasswordSet = args.password != null;
      return null;
    },
    send_test_email: (args) => {
      if (!String(args.to ?? "").includes("@")) this.invalid("That is not an email address");
      return null;
    },

    // ------------------------------------------------------------ settings
    get_settings: () => ({ ...this.book.settings }),
    save_settings: (args) => {
      Object.assign(this.book.settings, args.values as Record<string, string>);
      return null;
    },
    backup_now: () => `${this.book.session.dataDir}/backups/stayinsured-${TODAY}.db`,
    reveal_data_dir: () => null,
  };
}

let current = new FakeBackend();

/** The backend the current test is talking to. */
export function backend(): FakeBackend {
  return current;
}

/** Puts a fresh backend behind the bridge. Called for you before each test. */
export function installBackend(book?: Book): FakeBackend {
  current = new FakeBackend(book);
  return current;
}

/** Where the mocked `invoke` lands. */
export function dispatchInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return current.invoke<T>(command, args ?? {});
}

/** A spy wrapping the bridge, for the rare test that wants call assertions on it. */
export const invokeSpy = vi.fn(dispatchInvoke);
