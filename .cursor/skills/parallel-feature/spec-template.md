# <Feature name>

One paragraph, in the words of an agent running their book: what they can do
after this change that they could not do before, and why it matters. Everything
below serves this paragraph.

## Rules

Numbered, testable, and stated with their edges. Both cores implement these and
both test suites cite them, so an ambiguity here becomes two editions that
disagree with no test able to see it.

Write each one so it can be checked by reading code, and say what happens at the
boundary — the empty case, the duplicate, the value already set, the row that no
longer exists.

| # | Rule | Edge |
| --- | --- | --- |
| R1 | | |
| R2 | | |

## Commands

Only if the command surface changes. `generate_handler!` in `lib.rs` and
`COMMANDS` in `core/commands.ts` must end up with identical name lists.

| Command | Arguments | Returns | Errors | Works while locked |
| --- | --- | --- | --- | --- |
| | | | | |

## Wire shapes

Field names exactly as they cross the boundary, which is camelCase. Mirrored in
three files: `src-tauri/src/models.rs`, `legacy-windows/src/core/types.ts`,
`src/lib/types.ts`.

```ts
interface Example {
  id: number;
  someField: string | null;   // optional in Rust: Option<String>
}
```

State which fields are nullable, which are omitted entirely when absent, and any
enum's full set of values.

## Schema

Written by the lead before the lanes start, because both editions read the same
file. The lanes only register it.

- File: `src-tauri/src/db/schema/00N_<name>.sql`
- New `user_version`: N
- Registered in: `src-tauri/src/db/migrations.rs` (Rust lane), the `MIGRATIONS`
  list in `legacy-windows/src/core/schema.ts` (Electron lane)

Note anything that rests on SQLite behaviour rather than on what SQLite
promises — the edition bundles an older SQLite, so it can hold in one and not the
other.

## Interface

- Screens or components changed:
- New controls and their exact labels:
- New route, if any:
- Which `docs/guide/` page owns this, and which screenshots go stale:

## Tests

One list. `tests.rs` and `legacy-windows/src/tests/*.test.ts` both use these
names verbatim, so the two suites pair case by case.

| Test name | Rule | Asserts |
| --- | --- | --- |
| | R1 | |

## Deliberately different between editions

Only where the two must diverge, with the reason. If this section is empty, say
so — an empty section is a claim, and the audit checks it.

## Out of scope

What this change does not do, so no lane invents it.
