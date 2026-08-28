---
name: parallel-feature
description: Builds a feature across both editions at once by writing a parity spec first, then dispatching the Rust core, the Electron core and the interface to subagents in parallel. Use when a change touches src-tauri/ and legacy-windows/ together, or any time work would otherwise be done in one edition and then ported to the other.
---

# Building a feature in both editions at once

## The bottleneck this removes

The slow loop is not typing. It is that the second edition is written by reading
the first, so nothing on the Electron side can start until the Rust side is
finished and understood. One feature costs two serial implementations plus a
comprehension pass over code that was just written, and the checks run last, one
after another.

None of that is required. The two cores live in disjoint files —
`src-tauri/src/repo/policies.rs` and `legacy-windows/src/core/repo/policies.ts`
are different paths — so they can be written at the same moment in the same
checkout with no chance of collision. What forces the sequence is only that the
Rust source is the specification.

So write the specification down instead. Then both cores are built from it, in
parallel, and the reading pass disappears.

## When not to use this

Fanning out costs a spec and three round trips. Do not pay it for:

- A change in one edition only — Tauri's `vault.rs`, or the edition's
  `electron-builder.yml`. Dispatch that single lane, or just do it.
- A screen with no backend change. `src/` is shared; edit it once.
- A one-line fix, a typo, a rename.

Use it when a rule, a command, a type or a migration changes — anything where
`.cursor/rules/edition-parity.mdc` says both editions or neither.

---

## Phase 1 — Write the spec. Alone, and first.

This is the only serial phase, and everything else depends on how honest it is.
Do not delegate it.

Write `.cursor/specs/<slug>.md` from [spec-template.md](spec-template.md). It has
to be complete enough that an agent who never reads the other edition's source
builds the identical behaviour. Three things make that true:

- **Numbered rules.** Every behaviour gets an identifier — `R1`, `R2` — with its
  edge cases stated. Both lanes cite these, and the audit matches the two
  implementations through them rather than by diffing two languages.
- **Wire shapes.** Exact field names in camelCase, exact optionality. Three files
  mirror them: `models.rs`, `core/types.ts`, `src/lib/types.ts`.
- **Test names.** One list, used verbatim by `tests.rs` and by
  `legacy-windows/src/tests/*.test.ts`. Cases that pair by name are cases the
  audit can compare.

**Write the migration yourself, in this phase.** `src-tauri/src/db/schema/*.sql`
is read by both editions, so it is the one file two lanes would fight over.
Writing it now leaves each lane only registering it — `db/migrations.rs` on one
side, the `MIGRATIONS` list in `core/schema.ts` on the other.

Remember the edition bundles an older SQLite. SQL resting on a version's
behaviour rather than on what SQLite promises can hold in one edition and not the
other.

Then read the spec back and ask what an implementer would still have to guess.
Every guess is a place the two editions diverge with no test able to see it.

## Phase 2 — Dispatch the lanes together

All three in **one message**, each `run_in_background: true`. Sent in separate
messages they run one after another and nothing has been gained.

| Subagent | Owns | Proves it with |
| --- | --- | --- |
| `rust-core` | `src-tauri/` except `db/schema/*.sql` | `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test --lib` |
| `electron-core` | `legacy-windows/` | `cd legacy-windows && npm test` |
| `interface` | `src/` | `npm run typecheck && npm test` |

Give each one the **path to the spec** rather than its contents — they read it
themselves, and they read the same bytes. Restate the paths it owns and the paths
it must not touch. Each subagent's own instructions cover the rest.

Do not skip the interface lane because "it is only types". Its
`src/lib/types.ts` is the third mirror of the same shapes, and it is what
actually breaks when the two cores disagree.

While they work: do not poll them. Take the phase 4 work that needs no code —
reading the guide page that will go stale, checking which `docs/technical/`
tables the spec's commands land in.

### The failure to expect

`parity.test.ts` reads the command list out of `src-tauri/src/lib.rs`. The
Electron lane will report it failing on any command the spec adds, because the
Rust lane had not registered it yet. That is expected for names the spec lists,
and it resolves itself in phase 3. Anything else it reports is real.

## Phase 3 — Check everything at once

```bash
npm run check:all
```

Three lanes concurrently; the slowest one sets the wall clock rather than the
sum. Name lanes to narrow it: `node scripts/check-all.mjs rust edition`.

Route each failure back to the lane that owns the file. Do not fix another lane's
code yourself — you will be editing a tree while its owner may still be writing
to it, and the later write wins silently.

## Phase 4 — Audit and document, in parallel

Two more subagents, again in one message:

- `parity-auditor` — reads both halves against the spec and reports where they
  diverged. Read-only; its findings come back to you to route.
- `docs-scribe` — walks the `documentation-upkeep` table against the diff.

They do not conflict: one only reads, the other only writes `docs/`, `README.md`,
`DEVELOPER.md` and `CHANGELOG.md`.

Take the auditor's findings seriously even when the checks are green. Its whole
subject is the drift no test can see — `parity.test.ts` catches a command name
present on one side and absent on the other, and nothing catches a rule
implemented differently.

## Phase 5 — Close it out

Serial, and only now:

1. If a screen, control or label changed: add the shot to the `shots` array in
   `scripts/docs/capture.mjs`, then `npm run docs:screenshots && npm run docs:check`.
2. `npm run check:all` once more, on the final tree.
3. Commit both editions together. Half a parity change on trunk is the state
   `edition-parity.mdc` exists to prevent.

---

## Why no worktrees

Because the lanes never touch the same file. A worktree per lane would mean a
cold `src-tauri/target`, another `node_modules`, and a merge at the end — paying
setup and integration to solve a collision that cannot happen. Keep one checkout
and enforce ownership through the table above.

The exceptions are already handled: the schema SQL is written by you in phase 1,
and `src/` belongs to exactly one lane.

## Checklist

```
- [ ] Spec written, with numbered rules, wire shapes and shared test names
- [ ] Migration SQL written by me, not by a lane
- [ ] rust-core, electron-core, interface dispatched in ONE message
- [ ] npm run check:all green
- [ ] parity-auditor reports clear, or its findings routed and fixed
- [ ] docs-scribe done; screenshots retaken if the interface moved
- [ ] Both editions in one commit
```
