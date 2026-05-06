# US-502: MCP Inspector — UIKit migration

## Status

**Placeholder** — pickup after sidebar arc closes. Part of
[EPIC-025](../../epics/EPIC-025.md) Phase 4 per-screen migration.

## Goal

Migrate the MCP Inspector editor surface to UIKit primitives. After this task,
no file under `src/renderer/editors/mcp-inspector/` imports from
`components/basic|form|layout|overlay/`.

## Scope

Five rendering files (model + connection-store files need no changes):

- `src/renderer/editors/mcp-inspector/McpInspectorView.tsx` — outer chrome (server picker + tabs)
- `src/renderer/editors/mcp-inspector/ToolsPanel.tsx`
- `src/renderer/editors/mcp-inspector/ResourcesPanel.tsx`
- `src/renderer/editors/mcp-inspector/PromptsPanel.tsx`
- `src/renderer/editors/mcp-inspector/ToolArgForm.tsx` — dynamic form for invoking tools

## Old → UIKit primitives

| Old | New |
|---|---|
| `components/basic/Button` | UIKit `Button` / `IconButton` |
| `components/basic/TextField` | UIKit `Input` |
| `components/basic/TextAreaField` | UIKit `Textarea` |
| `components/layout/Splitter` | UIKit `Splitter` (prop mapping per US-492) |

## Notes

- The three panels (Tools / Resources / Prompts) share a common shape: list on the left, detail on the right, Splitter between. After migration the three layout shells will look very similar — flag any opportunity to extract a shared `<TwoPaneLayout>` helper but **don't** introduce one in this task; just match each to UIKit primitives.
- `ToolArgForm` builds inputs dynamically from JSON-Schema-ish tool argument definitions. Verify the form supports all the input shapes currently rendered: string, number, boolean (Checkbox), enum (Select), object/array (Textarea/JSON). Today it only uses TextField + TextAreaField — UIKit equivalents are direct.
- The list panes likely render a custom item list, not yet a `ListBox`. Decide at pickup whether to move the list to `ListBox` (probably yes — gets keyboard nav + selection model for free) or leave the existing custom rendering and only swap chrome primitives. Recommend moving to `ListBox` to be consistent with the sidebar arc.

## Test surface (manual smoke)

- Open MCP Inspector tab: server picker shows configured MCP servers.
- Pick a server: Tools / Resources / Prompts tabs each load their list.
- Click an item: detail pane populates.
- ToolArgForm: enter args, invoke tool, response renders below.
- Resources: select a resource, content view loads.
- Prompts: select a prompt, render the rendered prompt body.
- Splitter resize between list and detail in each panel.

## Acceptance criteria

- [ ] No imports from `components/basic|form|layout|overlay/` in `editors/mcp-inspector/`.
- [ ] `npm run lint` clean; `npx tsc --noEmit` reports no new errors.
- [ ] All three panels (Tools / Resources / Prompts) round-trip correctly with at least one configured MCP server.

This task does NOT run `/review`, `/document`, or `/userdoc` — those run at
EPIC-025 close per the epic's deferred review model.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
