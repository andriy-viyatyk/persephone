# US-2021: TypeScript 6

**Epic:** [EPIC-179](../../epics/EPIC-179.md) — Dependency refresh
**Status:** Implemented 2026-11-15 (unreviewed)

## Goal

Move from TypeScript 5.9 to 6.0, the bridge release towards TypeScript 7, so the deprecations 7 will
remove are dealt with now. TypeScript 7 itself stays blocked (see US-2019's Watch list).

## Background

- `typescript` was `^5.4.0` (installed 5.9.3). TypeScript 6.0.3 is inside typescript-eslint 8.72.2's
  peer range (`>=4.8.4 <6.1.0`); 7.0.2 is not.
- TypeScript is used at **build time only**: `tsc --noEmit` in `npm run typecheck`, typescript-eslint
  in `npm run lint`, and the compiler API in `scripts/typecheck-strict.mjs`. Nothing in `src/` imports
  it: Monaco ships its own TypeScript, and scripts are transpiled by esbuild.
- The project is **not** strict: `strictNullChecks` is enforced per folder by
  `scripts/typecheck-strict.mjs`. `tsconfig.json` never set `strict`.

## What TypeScript 6 broke, and the fixes

1. **`baseUrl` is deprecated** (TS5101, removed in 7). Nothing relies on `baseUrl`-rooted imports
   (there are no `paths`; every import is relative or a package), so the option is removed from
   `tsconfig.json` rather than silenced with `ignoreDeprecations`.
2. **`strict` now defaults to `true`.** That turned on `strictNullChecks`, `strictFunctionTypes` and the
   rest project-wide. To keep today's behavior, `tsconfig.json` now states `"strict": false` with a
   comment pointing at `typecheck-strict.mjs`.
3. **DOM lib: `HTMLElement.hidden` is `boolean | "until-found"`.** Three type errors:
   - `HeaderStatusIndicatorsView.ts` and `RecordingControlsView.ts` save an element's `hidden` and
     restore it later. The saved type is now `HTMLElement["hidden"]`, so it round-trips exactly.
   - `HeaderQuickSettingsPopover.ts` passed `hidden ?? false` to `toggleAttribute(…, force)`, which
     needs a boolean. It is now `Boolean(hidden)`: the same truthiness, since any hidden state means
     the choices are closed.

## Acceptance Criteria

- [x] `typescript` is `^6.0.3` and 6.0.3 is installed.
- [x] `npm run typecheck` passes (18 strict folders, 0 errors) with no `ignoreDeprecations`.
- [x] `npm run lint` and `npm run build-prod` pass.
- [x] No runtime behavior change (type-only edits plus one equivalent `Boolean()`).

## Files Changed Summary

| File | Change |
|------|--------|
| `package.json`, `package-lock.json` | `typescript` `^5.4.0` → `^6.0.3` |
| `tsconfig.json` | Remove deprecated `baseUrl`; state `"strict": false` explicitly |
| `src/renderer/ui/app/HeaderStatusIndicatorsView.ts` | Saved `hidden` typed `HTMLElement["hidden"]` |
| `src/renderer/ui/app/RecordingControlsView.ts` | Same |
| `src/renderer/ui/app/HeaderQuickSettingsPopover.ts` | `Boolean(hidden)` for `toggleAttribute` |

Files with no change needed: `scripts/typecheck-strict.mjs` (the compiler API calls it uses work
unchanged in 6.0), `eslint.config.mjs`, the Vite configs.
