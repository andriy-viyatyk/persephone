# EPIC-105: Platform seams — registries before boards use them

## Status

**Status:** Completed
**Created:** 2026-09-19
**Completed:** 2026-09-20
**Roadmap phase:** [Platform roadmap](../platform-roadmap.md) — **Phase A, Refactor the seams**

## Overview

The first epic of the platform roadmap, and the only one with **no new user-visible behavior**.
Every later phase plugs modules into registries that do not exist yet: a URL scheme registry, a
capability registry, and an exported provider surface. This epic builds those three with the
**built-ins as the only registrants**, so the abstractions are exercised by code we can change
before any board depends on them.

The test of success is negative: after this epic every scheme opens the same editor on the same
page with the same title as before, every restore fixture restores, and `parsers.ts` /
`resolvers.ts` are smaller. Nothing a user can see moves.

## Why this first

Adding one URL scheme today touches 3-5 core files; integrating Mneme touched ~45. The roadmap's
whole premise is that a module must be able to contribute a scheme, a provider and a handler
without editing the core — and none of Phases B-F can be written against seams that are still
closed lists. Doing this with built-ins first also means the one risky part (rewriting live call
sites) happens while both sides of every handoff are ours.

## What already exists

Verified against the source on 2026-09-19:

- **A provider registry, already open.** `content/registry.ts:21-27` exports `registerProvider`
  and `registerTransformer`, and the seven built-ins register through it at the bottom of the same
  file. It has no caller outside that file and is not on the script `io` surface. Both use
  `Map.set`, so a duplicate registration silently replaces.
- **Three closed lists for schemes.** Layer 1 lives in `content/parsers.ts` (232 lines,
  `registerRawLinkParsers()` subscribing in LIFO order), Layer 2 in `content/resolvers.ts` (392
  lines, seven `openLink` subscribers keyed on `data.url.startsWith(...)`), and the accept list in
  `api/pages/open-url-validation.ts:1-10` (`PIPELINE_SCHEMES`, nine entries, hand-maintained). A
  new scheme means editing all three, in the right order, with nothing checking that they agree.
- **Only the pipeline itself subscribes.** Outside `parsers.ts` / `resolvers.ts`, the sole
  internal subscriber is `content/open-handler.ts:16` on `openContent`. Scripts may still
  subscribe through `app.events`, so the channels stay — the registry is a façade over them, not a
  replacement (D1).
- **`pipeFromSourcePath` guesses.** `content/rebuild-pipe.ts` recognises three shapes by string
  prefix (`http(s)://`, `archive!entry`, else a file path) and consults no registry, so a restored
  page whose source carries a foreign scheme silently becomes a `FileProvider` over a path that
  does not exist.
- **The editor table has no capability column.** `EditorRow` in
  `editors/register-editors.ts:129-139` carries `id`, `name`, `guidePath`, `hasContentHost`,
  `mcpHint`, `folderIcon`, `accepts`, `load`.
- **`App` grows a service in three places.** `api/app.ts:150-179` (the `initServices()` import
  tuple and its assignments), `api/types/app.d.ts`, `scripting/api-wrapper/AppWrapper.ts`.
  `AppWrapper` already carries a compile-time member-name check against `IApp` — added after
  `app.boardVars` shipped a release as `undefined` for every script — but that check cannot see a
  member left `undefined` because its load failed inside `initServices()`
  (`tasks/backlog.md:353-364`).

## Goals

- One registration call adds a URL scheme: its Layer 1 parse, its Layer 2 resolve, and its
  presence in the accept list. `PIPELINE_SCHEMES` is derived, not typed by hand.
- `pipeFromSourcePath` asks the registry before it guesses.
- Duplicate registration in every registry touched here **reports** instead of silently replacing.
- A written inventory of every call site that names a concrete editor id, split into the ones that
  are capability handoffs and the ones that are not — the inventory is a deliverable in its own
  right, because Phases D and F are scoped from it.
- `app.capabilities` exists, is seeded from the editor table, and every capability handoff goes
  through `invoke()` — each one delegating to the same function it called before.
- `registerProvider` and `registerScheme` are reachable from a script through `io`.
- Adding a service to `App` is one edit, or — if one edit proves invasive — one edit plus a check
  that fails loudly at startup instead of silently at first use.
- Zero user-visible change. Same editor, same page, same title, same restores.

## Decisions

**D1 — The scheme registry is a façade over the event channels, not a replacement.** The three
`EventChannel` layers stay exactly as they are, including LIFO ordering and `handled` semantics,
because scripts can subscribe to them and because Layer 3 depends on being able to intercept late.
`registerScheme(scheme, { parse, resolve })` registers one entry in a map and installs the
subscribers on the caller's behalf. What changes is that a scheme dispatches **by scheme**, not by
its position in a subscription list — which is what makes two independently installed boards safe
in Phase C.

**D2 — Unknown provider types still throw in this epic.** `createPipeFromDescriptor` keeps its
current behavior. The *provider missing* placeholder and the `PendingProvider` that starts a
board's service on demand are Phase C, and pulling them forward would put user-visible behavior in
a phase whose exit criterion is that nothing changed. The roadmap says this explicitly; it is
repeated here because it is the easiest thing to helpfully over-deliver.

**D3 — The file/path fallback keeps its privileged position.** The plain-file parser is the
fallback of last resort and the archive parser must beat it; neither is a scheme. They keep their
current relationship and are not expressed as registry entries, so the LIFO ordering that makes
them work is not quietly re-created as an ordering rule between registry entries.

**D4 — Capability ids in this epic are the built-in seed only.** `image.edit`, `image.view`,
`content.view` and whatever else the inventory justifies. The open id space, board registration,
priority resolution across modules, request lifecycle and the in-memory payload channel are all
Phase D. Here, `invoke()` is a lookup in a table populated from `EditorRow` plus a call — a seam,
deliberately thin.

**D5 — A handoff moves the payload, not the target format.** This is the finding that scopes the
rewrite, and it is why the call sites cannot simply become `invoke("image.edit", { editorId })`.
Today `ImageEditor.ts:296`, `SvgEditor.ts:69` and `MermaidEditor.ts:208,235` each call
`buildExcalidrawJsonWithImage(...)` — imported from `editors/draw/drawExport.ts` — and hand
`addEditorPage("draw-view", "json", ...)` a finished Excalidraw document. The caller knows the
handler's file format, and imports it from the handler's own folder. That survives renaming
`draw-view`; it does **not** survive Phase F, which deletes `editors/draw` entirely.

So `image.edit` takes an image (data URL or bytes, plus dimensions and a suggested name) and the
**handler** builds its own document. After the rewrite the three callers no longer import from
`editors/draw`, and the Excalidraw-specific construction lives behind the capability, where Phase F
can move it into the board. Checking that `editors/draw` has no importers outside itself is part of
this epic's exit, because it is the cheapest possible proof that the seam is real.

**D6 — Not every literal editor id is a capability.** The first audit said "at least nine"; the
real list is larger and mixed. `ui/sidebar/tools-editors-registry.ts` (the New File menu, eight
rows) names editor ids to create an empty document of a type — that is a file-type registry, not a
handoff, and it is out of scope. `scripting/api-wrapper/{Grid,Markdown,Mermaid,Text}.ts` and the
four `log-view/items/*OutputView.ts` name an editor to *view* content already in hand; those are
genuine `content.view`-shaped handoffs. `PagesLifecycleModel.ts:377` and
`api/internal/clipboard-image.ts:92` need judging individually. Producing that split with a reason
per row is US-1457's actual work; the rewrite task takes it as input.

**D9 — `ILinkData.target` is the pipeline's seam, not a capability call.** US-1457's audit found
that 15 of the call sites naming an editor id do not create a page at all: they set `target` on an
`ILinkData` — beside `pageId`, `sourceId`, `diffFrom`/`diffTo`, `envNamespace` — and send it
through `openRawLink`. Routing those through `invoke()` would bypass Layers 2 and 3 and lose pipe
construction, page reuse and `sourceLink` persistence, which is a behavior change in a phase whose
exit criterion is that nothing changed. One of them (`src/board-context-menu.ts:59`) is board-shim
code crossing the bridge, which is Phase B by definition.

So US-1460 rewrites only the page-creating sites (`addEditorPage` / `addDrawPage`), 23 of them.
Editor selection carried on a link stays with the pipeline, where US-1458's registry already
touches it; whether a link may name a *capability* instead of an editor id is a Phase D question.
The seed set is therefore three ids — `content.view`, `image.edit`, `diagram.edit` — not the eight
a first pass proposed. That shrink is D4 applied honestly, not lost coverage.

**D10 — Bootstrap order is not touched.** Deriving `PIPELINE_SCHEMES` from the registry makes
validation order-dependent, because `pages.init()` runs inside `initPages()` while the parsers and
resolvers register later in `initEvents()`. The fix is to register scheme **declarations** at
module load — the pattern `content/registry.ts` already uses for the built-in providers — while
dispatcher installation stays exactly where it is. Moving pipeline bootstrap earlier would have
been the larger change and would have altered startup behavior in a zero-change epic.

Investigating this surfaced a genuine latent bug: `getFileToOpen()`
(`src/ipc/main/window-handlers.ts:25-32`) consumes `argFile` before returning it, and
`EventChannel` has no replay, so a cold start with a file argument fires `openRawLink` into an
empty subscriber list and drops the path unrecoverably. That is user-visible and belongs in its
own task (US-1463) with a runtime reproduction, not folded into a refactor.

**D7 — No test framework.** The backlog entry asking for a smoke check of the `app` surface
proposes adopting Vitest; this project does not use unit tests, and that part of the entry is not
adopted. The same failure is covered by a startup assertion in dev builds (US-1462) and by the QA
surface set.

**D8 — Verification is the QA surface set plus a scheme-by-scheme walk.** There is no automated
regression net, so the exit criteria below are written as observations someone can actually make:
each scheme in the content-pipeline doc table opened once, each rewritten handoff exercised once,
each restore fixture restored once. Budget it as real work, not as a checkbox after the diff.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| [US-1457](../tasks/US-1457-editor-handoff-inventory/README.md) | Editor-handoff inventory: every literal editor id, classified | Planned |
| US-1458 | [Scheme registry: `registerScheme`, migrated built-ins, derived `PIPELINE_SCHEMES`](../tasks/US-1458-scheme-registry/README.md) | Done |
| US-1459 | [Registry-aware `pipeFromSourcePath`](../tasks/US-1459-registry-aware-pipe-from-source-path/README.md) | Done |
| US-1460 | [`app.capabilities` from `EditorRow`, and the handoff call sites rewritten to `invoke()`](../tasks/US-1460-app-capabilities/README.md) | Done |
| US-1461 | [Script `io` exports for `registerProvider` / `registerScheme`](../tasks/US-1461-io-registry-exports/README.md) | Done |
| US-1462 | [Adding an `App` service in one place](../tasks/US-1462-app-service-registration/README.md) | Done |

Order: US-1457 first — it is investigation, it is cheap, and US-1460 cannot be scoped without it.
US-1458 and US-1459 then run as a pair (1459 depends on the registry existing). US-1460 is the
largest and riskiest task and should not start until 1457 is reviewed. US-1461 and US-1462 are
independent of everything else and can land at any point.

## Exit criteria

1. Every scheme in the content-pipeline documentation table opens the same editor id, on the same
   page, with the same title as before the epic — walked by hand, one by one.
2. `PIPELINE_SCHEMES` is derived from the registry; removing a scheme's registration removes it
   from the accept list with no second edit.
3. Every restore fixture in the QA surface set restores as before, including the archive and
   `mneme://` cases.
4. `parsers.ts` and `resolvers.ts` are measurably smaller, and adding a scheme touches one file.
5. `grep` finds no import of `editors/draw/drawExport` from outside `editors/draw/**` — no
   Excalidraw *document construction* outside the draw editor. The remaining outside importers
   (the `EditorRow.load` dynamic import in `register-editors.ts`, which is the registration
   pattern every editor row uses, and the `DrawEditorFacade` / `PageWrapper` scripting facade,
   which Phase F re-provides through the board's exposed model) are explicitly **not** cleared by
   this epic. Narrowed 2026-09-19 from "no import of `editors/draw/**`", which would have pulled
   Phase F work into Phase A — see US-1457.
6. Every capability handoff the US-1457 inventory marks *in scope* runs through `invoke()`, and
   each produces the same page it did before.
7. A script can call `io.registerScheme(...)` and `io.registerProvider(...)`, and a page opened on
   the scheme it registers works for the session.
8. A duplicate scheme, provider or capability registration reports rather than replacing.

## Concerns

- **The rewrite is the risk, and it is spread thin.** A dozen small call sites in a dozen files,
  each trivially correct in isolation, with no test net. Mitigation: US-1457's inventory becomes the
  literal checklist for US-1460, one row per site, each checked by opening the page.
- **D5 enlarges US-1460 beyond a mechanical substitution.** Moving Excalidraw-document construction
  behind `image.edit` is a real refactor of `drawExport.ts`'s public surface, not a call-site edit.
  If it proves larger than expected it can split off as its own task — but it must not be dropped,
  because Phase F assumes it.
- **Capability ids chosen now become names later.** They are internal in this epic and public the
  moment Phase D opens the id space. Follow the roadmap's `noun.verb` convention and resist
  inventing ids the inventory does not justify.
- **`app.capabilities` is a new service, so US-1462 collides with US-1460.** Whichever lands second
  uses the other's mechanism. Sequence them rather than running them in parallel.
- **Startup order.** `registerScheme` is called during bootstrap by the same code that calls
  `registerRawLinkParsers()` today; a registry read before that point sees an empty map. Anything
  that reads the accept list early — validation on a startup-restored page — must be checked.

## Notes

### 2026-09-19

- Epic created as Phase A of the platform roadmap, per the one-epic-at-a-time rule in
  [active-work.md](../active-work.md).
- Scoped as a single epic: the phase's four items are small individually and share one exit
  criterion (nothing changed).
- D5 and D6 are findings from this epic's own source audit, not from the roadmap. The roadmap's
  "at least nine call sites" is an undercount, and its implied `invoke("image.edit", target)` shape
  would have left every caller importing from `editors/draw` — which Phase F deletes.

### 2026-09-20

- All six tasks implemented and reviewed; `/review`, `/document` and `/userdoc` run at epic close.
- **`/review` found two defects, both fixed before close.** The important one: `app.capabilities`
  was reachable at runtime but had never been declared on `IApp`, so it was not in US-1462's
  service descriptor table either. This is a **residual gap in the mechanism** and is worth
  recording: the exhaustiveness check catches a member that is in `IApp` but missing from the
  table, and cannot catch a service that was declared in *neither*. `AppWrapper`'s check has the
  same blind spot. A new service still depends on someone remembering to declare it once.
- The second fix aligned `schemeFromValue()` with `normalizeScheme()` in `scheme-registry.ts`, so
  lookup and registration cannot disagree about a scheme key.
- **Verified in the running app**, not only by build: all eleven registered schemes accepted by
  the derived validation and `bogus://` rejected; `file`, `data:`, `persephone-guide://` and
  `persephone-board://` opened end to end into their expected editors; `mneme://` and
  `persephone-guide://` resolved to `MnemeProvider` / `GuideProvider` through
  `pipeFromSourcePath` where both previously became a `FileProvider` over a path that does not
  exist; all four capabilities invoked and landing on the right editor, including the
  `content.view`/`svg` versus `text.open` pair that motivated the four-id seed set; and a script
  registering its own provider and scheme opened a page through them.
- **Not verified at runtime:** US-1462's missing-service `console.error`. Its compile-time half is
  proven (`TS2344` when a table entry is absent); the runtime half needs a deliberately broken
  service load and a restart.
- Task folders kept; not deleted at close.
