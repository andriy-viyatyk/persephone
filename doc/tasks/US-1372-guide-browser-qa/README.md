# US-1372: About / guide-browser QA remediation

## Goal

Make the `guides` call surface teach an agent how to put a real guide on the user's screen, either
in an ordinary Markdown tab or in the About page's guide browser, so the QA gate's “show me” request
does not produce a copied, dead page.

## Background

[EPIC-093](../../epics/EPIC-093.md)'s `mcp-test-agent-call` gate was run with Haiku, with `call` as
its only tool and no prior knowledge of Persephone. For “Show me the guide for the grid editor,” the agent discovered
`guides.editors`, read `guides.editors.grid`, and then called
`pages.addEditorPage("md-view", "markdown", "Grid Editor Guide", "<the entire guide text>")`.
The result was a frozen clone with no guide identity, breadcrumbs, working guide links, or *Open in
tab* behavior, even though EPIC-093 had shipped the ability to open the real guide.

The failure was caused by the advertised surface: the guides node summary, `$help`, page entries,
root overview, and server instruction described reading guide text but did not say that showing a
guide means opening `persephone-guide://<path>`. The existing tree projection in
`src/main/mcp/ai-vision/guides.ts` already adds a parser-valid `call` field to each projected node;
the remediation extends that same page projection with the openable guide identity while keeping
folder projections free of page URLs.

The first remediation passed the headline gate. On the second gate run, the agent again reached the
real guide through `pages.openUrl("persephone-guide://editors/grid")` and named the `open` field,
but two more invisible identities appeared on more likely routes: `guides.search()` returned hits
with only `pagePath`, and a direct `GuidePage` `$help` still described only reading. This follow-up
adds `call` and `open` to search hits and the page's own open/read guidance.

## Implementation Plan

1. In `src/main/mcp/ai-vision/guides.ts`, extend the page branch of `projectNode()` with an `open`
   field containing `persephone-guide://<path>`. Keep the folder branch unchanged apart from its
   existing `call` and recursive children projection. Update the `Guides` summary and `$help` to
   state that reading returns text for the agent's use, while showing the user means opening—not
   copying—the guide, and name both the Markdown-tab and About-browser calls.
2. In `src/renderer/scripting/ai-vision/root.ts`, extend the `guides` line in `ROOT_OVERVIEW` with
   the two guide-opening forms, keeping the overview to one compact clause.
3. In `src/main/mcp/manifest.ts`, update the editor-guide server instruction with the same
   read-versus-open distinction and both hosts.
4. Leave guide prose, the About views/facade, the content pipeline, `guides.whatsNew`, existing
   guide paths, the QA surface, epic documents, and dashboard unchanged; preserve `guides.search`
   ranking and all existing hit fields while adding only the advertised identities.
5. In `src/main/mcp/ai-vision/guides.ts`, preserve every existing search-hit field while adding
   `call: callPath(pagePath)` and `open: guideUrl(pagePath)`, and add the same read-versus-show
   distinction to each `GuidePage` descriptor's `$help`.

Before:

```ts
return { ...node, call: callPath(node.path) } as GuideTreePage & { readonly call: string };
```

After:

```ts
return { ...node, call: callPath(node.path), open: guideUrl(node.path) }
    as GuideTreePage & { readonly call: string; readonly open: string };
```

## Implementation

The page projection now exposes `open: "persephone-guide://<path>"`; folder entries do not receive
that field. The guides descriptor, renderer root overview, and server instructions now distinguish
reading a guide's returned text from showing it by opening the real guide in either supported host,
and explicitly warn against copying the text into a new page. Search hits now retain `pagePath` and
also expose parser-valid `call` plus the same `open` URL; direct page `$help` names both ways to show
the page.

### Live verification through `call`

The first live gate passed through Persephone MCP `call`: overview → `guides.editors` →
`pages.openUrl("persephone-guide://editors/grid")`, with the agent naming the `open` field and
opening the real guide. The second run found the search-hit and direct-page-help gaps above; after
this patch, verify through `call` that a search hit carries parser-valid `call` and `open` fields,
and that `guides.editors.grid.$help` names both opening hosts without changing its text result.

## Concerns

- The `open` field is deliberately added only in the main-process projection, not to the shared
  corpus model: it is an advertised call-surface identity, not guide metadata.
- The QA run itself is intentionally deferred to the user after this remediation. No automated test,
  harness, guide-content edit, QA-file edit, or commit is part of this task.
- `doc/active-work.md` is already owned by the epic workflow and is intentionally not changed for
  this user-requested gate remediation.

## Acceptance Criteria

- [x] Projected guide pages expose `open: "persephone-guide://<path>"` beside their `path` and
      parser-valid `call` fields.
- [x] Projected folders do not claim an `open` page URL.
- [x] The guides summary and `$help` explain that reading returns text for agent use, while showing
      the user means opening the guide, not copying its text into a new page; both supported hosts
      are named.
- [x] The root overview and `SERVER_INSTRUCTIONS` advertise the same opening distinction.
- [x] The first live EPIC-093 gate passes through `call`: overview → `guides.editors` →
      `pages.openUrl("persephone-guide://editors/grid")`, opening the real guide rather than
      creating a copied page.
- [ ] A follow-up live `call` confirms each `guides.search()` hit preserves `pagePath` and adds
      parser-valid `call` plus `open`, and that a direct GuidePage `$help` names both hosts.
- [x] `npm run typecheck`, `npm run lint`, and `npm run build-prod` complete successfully.

Files intentionally not changed: `src/shared/guides/index.ts`, `guides.whatsNew`,
all guide corpus files under `assets/guides/`, the About views and facade, the content pipeline,
`qa/`, `doc/active-work.md`, `doc/epics/EPIC-093.md`, `doc/in-app-guides-roadmap.md`, tests, and
the MCP call harness.

## Files Changed

| File | Change |
|---|---|
| `src/main/mcp/ai-vision/guides.ts` | Add page-only `open` projection, search-hit `call`/`open` fields, and per-page read-versus-show `$help`. |
| `src/renderer/scripting/ai-vision/root.ts` | Add guide-opening discovery to the root overview line. |
| `src/main/mcp/manifest.ts` | Add the read-versus-open distinction and both hosts to the editor-guide server instruction. |
| `doc/tasks/US-1372-guide-browser-qa/README.md` | Record the QA finding, implementation, concerns, and live verification plan. |
