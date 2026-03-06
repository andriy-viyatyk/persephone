# US-117: Fix Editor Switch Buttons for Structured JSON Editors

## Problem

When a page is created programmatically (via MCP `create_page` or scripting) with a structured editor like `notebook-view`, `todo-view`, or `link-view`, the toolbar switch buttons don't show the correct editor option unless the page title ends with the expected file extension.

**Example:** A page created with `editor: "link-view"`, `language: "json"`, `title: "My Links"` shows switch buttons "JSON" and "Grid" — but NOT "Links". The "Links" button only appears if the title ends with `.link.json`.

This happens because `editorRegistry.getSwitchOptions()` calls each editor's `switchOption()` function, which checks the file name pattern:
- `link-view` requires `.link.json`
- `todo-view` requires `.todo.json`
- `notebook-view` requires `.note.json`

When a page is already using one of these editors but the title doesn't match the pattern, the user cannot switch back to that editor after switching away.

## Affected Editors

| Editor | Required pattern | `switchOption()` check |
|--------|-----------------|----------------------|
| `notebook-view` | `*.note.json` | `languageId === "json" && fileName matches /\.note\.json$/i` |
| `todo-view` | `*.todo.json` | `languageId === "json" && fileName matches /\.todo\.json$/i` |
| `link-view` | `*.link.json` | `languageId === "json" && fileName matches /\.link\.json$/i` |

## Key Files

- `src/renderer/editors/registry.ts` — `getSwitchOptions()` method
- `src/renderer/editors/register-editors.ts` — `switchOption()` definitions for each editor
- `src/renderer/editors/text/TextToolbar.tsx` — calls `getSwitchOptions()` for toolbar rendering

## Proposed Approach

Add a `type` field to the JSON root structure of structured editor files:

```json
{ "type": "link-editor", "links": [], "state": {} }
{ "type": "todo-editor", "lists": [], "tags": [], "items": [], "state": {} }
{ "type": "note-editor", "notes": [], "state": {} }
```

Then modify `switchOption()` for each structured editor to also check:
1. Parse the JSON content (or read from ViewModel state)
2. If `type` matches the expected value AND required properties exist (e.g., `links` array for link-editor), return a positive priority

This way, any JSON file with the correct `type` field will show the appropriate switch button regardless of file name.

### Additional Considerations

- **Backward compatibility:** Existing `.note.json`, `.todo.json`, `.link.json` files without `type` should still work (file extension check remains as fallback)
- **Auto-adding `type`:** When creating new pages via facade/MCP, include `type` in the initial JSON content
- **When saving:** Consider auto-adding `type` if missing when ViewModel serializes data
- **Performance:** Content parsing for `switchOption()` should be fast since it runs on toolbar render; may want to cache or read from ViewModel state instead of re-parsing

## Acceptance Criteria

- [ ] Structured JSON editors show correct switch buttons even when title lacks file extension
- [ ] Switching away from a structured editor and back works correctly
- [ ] Existing files with proper extensions still work (backward compatible)
- [ ] New files created via MCP/scripting include `type` field
- [ ] No regressions in toolbar behavior for other editors

## Status

**Planned** — Not started
