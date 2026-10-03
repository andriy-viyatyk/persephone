# US-1609: Remove the legacy (undeclared) board permission fallback

**Status:** Scheduled — due **2027-01-03** (three months after the US-1608 deprecation notice shipped).
**Follows:** [EPIC-119](../../epics/EPIC-119.md), US-1608 (commit `94cd6b12`; its task folder was deleted at epic close).

> This is a scheduled stub, not an investigated plan. When it becomes due, move it to **Active**
> and run the normal task-document investigation before implementing.

## Goal

Stop treating a board whose `board-manifest.json` has no `permissions` object as unrestricted.
Since EPIC-119, a missing declaration means "legacy": everything allowed except `service`. That
fallback was kept only so existing boards kept working while their authors migrated. US-1608 warns
users and agents on every board open. After the warning period, the fallback must go, or an
undeclared manifest stays the easiest way to get full access.

## Background (as of 2026-10-03)

- `NormalizedBoardPermissions` is `{kind:"flags"; flags}` | `{kind:"legacy"; service}`
  (`src/shared/board-manifest-utils.ts`).
- The legacy branches enforce "everything allowed". Known sites:
  - `src/main/board-file-access.ts` (`effectiveFileSystem`);
  - `src/main/session-src-protocol.ts` (network and app scripting);
  - `src/main/permission-policy-service.ts` (device permissions → `APP_ALLOW`);
  - `src/main/board-trust-service.ts` (flag checks, trust records, `canStartService`);
  - `src/renderer/editors/board/request-board-trust.ts` (legacy → object-form transition prompt);
  - `board-permission-copy.ts` ("Unrestricted" copy).
- The trust records in `trustedBoards.json` hold `kind: "legacy"` grants. These came from the
  `trustedBoards.txt` migration, or from trusting an undeclared board.
- `board://` root confinement applies only to object-form boards.
- US-1608 added the deprecation notices: the trust dialog, a toast on every board open, Board
  Info, and the agent-facing board info and guides. This task removes or replaces them.

## Implementation outline (to be investigated)

1. Decide what an undeclared manifest becomes. Two options:
   - **Refuse to run it:** show an "update the manifest" view with instructions for the agent.
   - **Treat it as all-`false` object form:** the board opens, but gated calls fail.

   The recommended starting point is the first: it fails loudly instead of breaking quietly at
   the first gated call.
2. Remove `kind: "legacy"` from the normalized type and from every enforcement site above.
3. Migrate stored `legacy` trust records: drop them, so the board is re-trusted against its
   declared set once its manifest is updated.
4. Apply `board://` confinement to every board.
5. Remove the whole US-1608 deprecation implementation. When this task is investigated, take the
   exact file list from US-1608's commit `94cd6b12` (`git show --stat 94cd6b12`; its task folder
   was deleted at epic close). That commit also added the general `ui.notify(..., { persistent: true })`
   option (`api/ui.ts`, `uikit/Notification/*`); keep it, since it is not part of the deprecation. The
   pieces to remove are:
   - the deprecation wording in `board-permission-copy.ts`;
   - the warning in the trust dialog;
   - the toast on every board open, including the combined toast for boards restored at startup,
     and whatever tracking logic it added;
   - the warning in Board Info;
   - the deprecation note in the board information returned to agents over MCP;
   - the deprecation sentence in the agent guides under `assets/guides/agents/`.

   Nothing deprecation-related should remain; grep for the shared wording to confirm.
6. Update the user guides (via `/userdoc`) and `whats-new.md` to say undeclared manifests are no
   longer supported.
7. Before shipping, check that the `persephone-boards` catalog (US-1600) and the bundled and demo
   boards all declare permissions.

## Concerns / open questions

- Users who ignored the notice: their boards stop running. The refusal view must say exactly what
  to do.
- Should a bridge version change accompany this (for example, raising the minimum accepted
  `minBridgeVersion`)?

## Acceptance criteria

- No code path grants unrestricted access because `permissions` is missing.
- Opening an undeclared board shows clear remediation, not a silent failure.
- Existing legacy trust records do not carry unrestricted access forward.
