# How the interface is tested

Every screen is driven the way an agent drives it: render it, click the
controls, and read what comes back. The Rust core is replaced by a book held in
memory that filters, sorts and writes the way the real one does, so a test
exercises the app's own code and never touches a database.

```bash
npm test                       # the whole suite
npx vitest run src/pages/__tests__/Clients.test.tsx   # one file
npx vitest                     # watch while you work
```

## Writing a test

Tests live beside the code they cover, in `__tests__/<Component>.test.tsx`. One
import brings in everything.

```tsx
import { backend, renderWithProviders, screen, waitFor } from "@/test";
import { ClientsPage } from "@/pages/Clients";

it("filters the list by search", async () => {
  const { user } = renderWithProviders(<ClientsPage />);

  await user.type(await screen.findByPlaceholderText(/Search/), "Anita");

  await waitFor(() => {
    expect(backend().lastCall("list_clients")?.filter).toMatchObject({ search: "Anita" });
  });
  expect(await screen.findByText("Anita Desai")).toBeInTheDocument();
});
```

Import `describe`, `it` and `expect` from `"vitest"`. They are global at run
time, but `tsconfig.json` does not carry the globals types, so `npm run
typecheck` fails without the import.

`renderWithProviders` puts the component inside the same query client, toaster
and router the app runs with. Pass `path` when the screen reads route
parameters, and `route` for where the router starts:

```tsx
renderWithProviders(<ClientDetailPage />, { route: "/clients/1", path: "/clients/:id" });
```

`renderApp()` renders the whole application — sidebar, routes and all — which is
what you want for navigation and locking.

## The book

`createBook()` in `fixtures.ts` is the same demo book the guide screenshots use:
8 clients, 17 policies across 8 insurers, 5 templates, 6 reminder rules. The
clock is frozen to **14 August 2026, 10:00 IST**, and the timezone is pinned to
`Asia/Kolkata`, so `daysToExpiry` is stable, a policy described as "expiring this
week" always is, and a date read out of a timestamp says the same thing on every
machine.

A fresh book is installed before every test. Change it before rendering:

```ts
backend().book.clients = [];                       // empty state
backend().book.policies[0].status = "cancelled";   // one awkward row
```

Useful landmarks: client 1 is Rohit Sharma, with a wife and son of his own
(clients 9 and 10, related to him by `book.relations`) and four documents;
client 3 has no email; policy 1 (`SH/2025/0091823`) expires in 7 days and covers
all three of them through `book.cover`; policies 5 and 12 are expired and
unrenewed; chain `chain-c` has three years of history. Clients 9, 10 and 11 hold
no cover of their own, so they are dependents: browsing the list passes over
them, and searching by name finds them.

For a row the book does not hold, build one — `daysToExpiry` and the expected
commission are derived for you:

```ts
backend().book.policies = [makePolicy({ status: "cancelled", expiryDate: isoDaysFromToday(-3) })];
```

The lists show 25 rows a page, so a pager needs a bigger book:

```ts
padPolicies(backend().book, 30);   // copies of policy 1 with fresh numbers
manyClients(backend().book, 30);   // "Padded Client 009", in order
```

Destructive actions ask through `window.confirm`. It is stubbed for every test
and answers **Cancel**, so nothing is deleted by accident; a test that means to
delete says `acceptConfirm()` first. (`dismissConfirm()` is the explicit form of
the default, worth writing when refusing is the point of the test.)

## What the core does to what it is given

The fake writes the way `src-tauri/src/repo/` writes, so a test sees the same
tidying an agent would: names are title-cased (`tidy_name`), phones keep their
digits and a leading plus, empty strings are stored as null, PAN and GSTIN are
upper-cased, and dates are parsed from ISO or day-first. Saving a client
**overwrites every column** — a field the form does not send is emptied, which
is how the data-loss bugs in the client form show up. Invalid input is refused
with the core's own wording: "Client name is required", "Expiry date must be
after the start date", "Choose the message this rule sends to the client",
"Subject is required".

Deletes cascade the way the schema does: a client takes their policies,
relationship links and documents — but not the people on the other end of those
links, unless the delete was asked to reach the immediate family — and an insurer
takes its plans. A rule saved without a place on
the ladder is appended, as `rules::create` appends it, and the ladder reads
furthest-ahead first. If a screen passes here and fails in the app, suspect the
fake before the screen and say so — the two are meant to agree.

## Steering the core

```ts
backend().fail("create_client", { kind: "conflict", message: "Already there" });
backend().failOnce("save_settings");            // fails once, then works
backend().on("next_client_code", () => "CL-00042");

const gate = backend().hold("list_policies");   // freeze mid-load
gate.release();                                 // or gate.reject({ kind, message })

backend().lastCall("list_policies")?.filter;    // what the screen asked for
backend().countOf("load_dashboard");            // how many times
backend().calls;                                // everything, in order
```

Error kinds are the ones in `src/lib/api.ts`: `locked`, `bad_password`,
`already_initialised`, `validation`, `not_found`, `conflict`, `mail`,
`internal`.

## Two things that will catch you out on a list screen

**The search box is debounced by 250 ms.** A list no longer asks twice on
arrival — `useListFilter` holds its last question and does not repeat it — but
anything typed lands a quarter of a second later, and a test that clicks on
through can outrun it. When the order of the calls matters, put the screen at
rest first:

```ts
await screen.findByText("Rohit Sharma");
await settle();                       // the screen has stopped asking
```

`hold` takes a predicate so the gate is spent on the call you mean rather than
whichever arrives first:

```ts
const gate = backend().hold("list_policies", (args) => args.filter.search === "Anita");
```

**A question the screen has already asked is answered from cache.** Clearing a
filter usually returns the query key to what it was on mount, so React Query
answers without calling the core and nothing is recorded. Start such a test from
a different state — mount at `?q=Anita` and clear from there — rather than
asserting on a call that will never come.

Typing into `input[type="date"]` works inside a form, but a filter box that
re-queries on every keystroke sees partial dates; set those in one go with
`fireEvent.change`.

## The native side

The file picker, the tray events and the updater are spies in `tauri.ts`:

```ts
tauriDialog.save.mockResolvedValue("/tmp/export.xlsx");   // a chosen path
tauriDialog.open.mockResolvedValue(null);                 // cancelled
tauriUpdater.check.mockResolvedValue(fakeUpdate("1.0.0"));
emitTauriEvent("session:locked", { ...session, unlocked: false });
expect(tauriProcess.relaunch).toHaveBeenCalled();
```

The unlock password the fake core accepts is the exported `CORRECT_PASSWORD`
(`"correct-horse"`); anything else comes back as `bad_password`.

## What a good test looks like

- Drive the interface, not the internals: click the button an agent would click,
  and assert on what they would see.
- Find things the way a person does — role, label, visible text — before
  reaching for a test id.
- Prefer `findBy*` and `waitFor` over sleeping. Nothing in the suite waits on a
  timer.
- Assert on the command the screen sent as well as what it drew: a filter that
  reads correctly but sends `undefined` is exactly the sort of bug worth
  catching.
- Cover the awkward paths: empty book, a command that fails, a slow command, a
  form submitted blank, a list of one page.
- When a test proves the app misbehaves, mark it `it.fails(...)` with a comment
  naming the bug rather than writing the wrong expectation, so the suite stays
  green and the fix flips it back.
