# US-501: RestClient editor — UIKit migration

## Status

**Placeholder** — pickup after sidebar arc closes. Part of
[EPIC-025](../../epics/EPIC-025.md) Phase 4 per-screen migration.

## Goal

Migrate the Rest Client editor surface to UIKit primitives. After this task,
no file under `src/renderer/editors/rest-client/` imports from
`components/basic|form|layout|overlay/`.

## Scope

Four rendering files (model + helper files need no changes):

- `src/renderer/editors/rest-client/RestClientEditor.tsx`
- `src/renderer/editors/rest-client/RequestBuilder.tsx`
- `src/renderer/editors/rest-client/ResponseViewer.tsx`
- `src/renderer/editors/rest-client/KeyValueEditor.tsx`

## Old → UIKit primitives

| Old | New |
|---|---|
| `components/basic/Button` | UIKit `Button` / `IconButton` |
| `components/basic/Checkbox` | UIKit `Checkbox` |
| `components/basic/TextAreaField` | UIKit `Textarea` |
| `components/layout/Splitter` | UIKit `Splitter` (prop mapping per US-492) |
| `components/layout/Elements.FlexSpace` | UIKit `Spacer` |
| `components/form/ComboSelect` | UIKit `Select` |
| `components/overlay/WithPopupMenu` | UIKit `WithMenu` |
| `components/overlay/PopupMenu.MenuItem` (type) | UIKit `Menu.MenuItem` |

## Notes

- `RequestBuilder` has the URL bar + method picker + headers/body tabs — likely the densest UIKit-prop call site. Plan to use `Panel` for the row containers.
- `KeyValueEditor` is the headers/params/cookies grid. It uses Checkbox + TextAreaField + ComboSelect per row — verify ComboSelect → Select migration preserves "open on focus" / autocomplete behavior used for header-name suggestions.
- `ResponseViewer` shows status/time/size + body preview. Body preview likely uses Monaco — keep that intact.
- `RestClientEditor` outer Splitter splits request and response panes — use UIKit Splitter with controlled `value`.

## Test surface (manual smoke)

- Open a `.rest.json` file: collection renders.
- Pick a request: request builder populates URL/method/headers/body.
- Send: response viewer shows status/headers/body.
- Add/remove rows in headers, params, cookies grids.
- Resize via Splitter between request and response.
- Right-click context menus on rows / response / etc. work.
- Method dropdown filters as you type.

## Acceptance criteria

- [ ] No imports from `components/basic|form|layout|overlay/` in `editors/rest-client/`.
- [ ] `npm run lint` clean; `npx tsc --noEmit` reports no new errors.
- [ ] Round-trip test: load a `.rest.json`, edit a request, send, save — file persists changes.

This task does NOT run `/review`, `/document`, or `/userdoc` — those run at
EPIC-025 close per the epic's deferred review model.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
