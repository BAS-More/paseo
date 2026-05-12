# tech-debt: zod 3 → 4 migration to unblock claude-agent-sdk 0.2.139 + green CI

**Status:** open · **Estimate:** 1-2 days · **Filed:** 2026-05-12

## Why

Two persistent CI failures share one root cause:

1. **`cli-tests (shard 3/3)` — `31-loop-schedule`** fails because
   `@anthropic-ai/claude-agent-sdk@0.2.138`'s libc detection picks
   `linux-x64-musl/claude` on a glibc runner. Fix shipped in **SDK
   0.2.139**.
2. **`Nix Build`** fails when `nix/package.nix` `npmDepsHash` drifts
   from the lockfile. The `fix-nix-hash` bot only runs on
   `package.json` / `package-lock.json` changes. Real dep churn (this
   migration) triggers the bot and resolves the hash as a side effect.

SDK 0.2.139 declares `peer zod@^4.0.0`. Bumping it forces a zod 3 → 4
migration across `packages/{app, desktop, server}`. The current root
override `"zod": "3.25.76"` pins it.

## What's mapped (already explored locally)

Tractable mechanical transforms:

| Pattern | Sites | Fix |
|---|---|---|
| `z.record(z.X())` (one arg) | 59 in 9 files | regex → `z.record(z.string(), z.X())`. Validated with sed; 16 files patched cleanly |
| `z.ZodType<T, z.ZodTypeDef, U>` annotations | 5 sites | drop second & third args → `z.ZodType<T>` |
| `z.coerce.number().pipe(...)` after a string-or-number union | 4 sites | replace with `.transform((v) => Number(v)).pipe(z.number()...)` |
| `.default({})` on an object schema | 1 site | provide explicit factory `.default(() => ({...}))` |
| `{ message: "..." }` on a validator | 1 site | rename `message` → `error` |

The hard part — what blocked the autonomous attempt — is below.

## What's hard

`Extract<SessionOutboundMessage, { type: "X" }>["payload"]` returns
`never` after the bump. v4 changed how discriminated-union narrowing
interacts with nullable fields and chained `.optional()` / `.nullable()`,
breaking the type chain `messages.ts → daemon-client.ts → cli`.

Symptom in `packages/cli`: every command that uses a daemon-client
method (worktree create/ls/archive, permit ls/deny, provider ls,
timeline utils) gets `Property 'X' does not exist on type 'never'` —
about 15 sites across 6 files.

The fix is **not** more casts at call sites. The clean fix is to
**decouple** the `SessionOutboundMessage` union from `z.infer<...>` and
declare it as an explicit discriminated union of plain TypeScript
interfaces, with the zod schemas only used for runtime parsing. This
removes the inference cascade entirely.

## Proposed plan

### Step 1 — Bump deps + root override (5 min)

```diff
- "zod": "3.25.76"
+ "zod": "^4.0.0"
```

All workspace pins to `^4.0.0`. SDK to `0.2.139`. Regen lockfile.

### Step 2 — Type-level decoupling in `packages/server/src/shared/messages.ts` (4-6 h)

- Replace `z.infer<typeof FooSchema>` payload-type extractions with
  plain TS interfaces for every response message in the
  `SessionOutboundMessage` union (~30 messages).
- Schemas remain for runtime validation (`parseFooResponse`) but don't
  drive the static type tree.
- The `Extract<SessionOutboundMessage, { type: "X" }>["payload"]`
  pattern in `daemon-client.ts` then narrows correctly.

### Step 3 — Mechanical transforms (1-2 h)

Apply the 5 patterns from the table above (regex + targeted edits).
File-set already identified.

### Step 4 — Run full test suite + fix breakages (2-4 h)

- Most parse error messages change from `"Expected X, received Y"` →
  `"Invalid input: expected X, received Y"`. Update test fixtures.
- `ZodError.issues[].code` enum values change slightly — update any
  test that asserts on `code === "invalid_type"` etc.

### Step 5 — Verify

- All workspaces typecheck.
- `cli-tests (shard 3/3)` passes locally with `npx -p node@22 npm ci`
  installing 0.2.139.
- `Nix Build` re-runs `fix-nix-hash` bot; hash updates; passes.

## Acceptance

- All CI jobs green on the migration PR
- `npm audit --omit=dev` reports no high/critical
- No new `@ts-ignore` / `as any` introduced (allowed in test files only)

## References

- zod 4 changelog: https://zod.dev/v4/changelog
- SDK 0.2.139 peer change: `npm view @anthropic-ai/claude-agent-sdk@0.2.139 peerDependencies`
- Original audit context: `docs/compliance/HARDENING_AUDIT_2026-05-11.md`
- PRs that ate the same CI failures: #18, #19

## Out of scope

- Replacing `react-native-markdown-display` (DEP-04, separate)
- `ARCH-010` per-provider breaker refactor (separate)
- Live staging drill execution (`docs/deployment/STAGING_DRILL.md`)
