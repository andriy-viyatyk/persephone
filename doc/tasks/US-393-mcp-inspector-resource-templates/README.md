# US-393: Interactive Resource Templates in MCP Inspector

## Goal

Make MCP resource templates interactive in the MCP Inspector editor. Currently, resource templates (parameterized URIs like `docs://documents/{document_id}`) are listed in the Resources panel sidebar but are display-only — users cannot select them, fill in parameters, or read resources from them.

## Background

### MCP Resource Templates

The MCP protocol supports two kinds of resources:
- **Static resources** — concrete URIs (e.g., `docs://documents/readme`). Already fully supported.
- **Resource templates** — parameterized URI templates using RFC 6570 syntax (e.g., `docs://documents/{document_id}`). Currently listed but non-interactive.

Resource templates let MCP servers expose dynamic resources where the client fills in parameters to construct a concrete URI, then reads the resource at that URI.

### Current State

**What works:**
- `loadResources()` in [McpInspectorEditorModel.ts](../../../src/renderer/editors/mcp-inspector/McpInspectorEditorModel.ts) fetches both `listResources()` and `listResourceTemplates()` from the MCP server (line 431-434)
- Templates are stored in `McpResourcesPanelState.templates` as `McpResourceTemplateInfo[]` (line 74-79)
- Templates appear in the sidebar under a "Templates" section label (ResourcesPanel.tsx line 231-244)

**What's missing:**
- Template sidebar items have **no `onClick` handler** — clicking does nothing (line 234-242)
- No detail panel view for templates (the detail pane only shows when `selectedRes` matches a static resource)
- No URI template parameter extraction (parsing `{param}` from the template string)
- No parameter input form for filling in template variables
- No "construct URI + read resource" action for templates

### Similar Implementation to Reference

The **Prompts panel** ([PromptsPanel.tsx](../../../src/renderer/editors/mcp-inspector/PromptsPanel.tsx)) is the closest pattern. It has:
- Sidebar with selectable items
- Detail panel showing name, description, argument fields
- Argument input via `TextAreaField` components
- A "Get Prompt" button that calls the server with filled-in arguments
- Result display area

The resource template UI should follow the same layout pattern.

### Key Files

| File | Role |
|------|------|
| [McpInspectorEditorModel.ts](../../../src/renderer/editors/mcp-inspector/McpInspectorEditorModel.ts) | Model — state, methods |
| [ResourcesPanel.tsx](../../../src/renderer/editors/mcp-inspector/ResourcesPanel.tsx) | View — resources & templates UI |
| [ResourceContentView.tsx](../../../src/renderer/editors/mcp-inspector/ResourceContentView.tsx) | Content display (reuse for template results) |
| [PromptsPanel.tsx](../../../src/renderer/editors/mcp-inspector/PromptsPanel.tsx) | Reference pattern for argument input UI |

## Implementation Plan

### Step 1: Add template selection and parameter state to the model

**File:** `McpInspectorEditorModel.ts`

- Add `selectedTemplateUri` (string) to `McpResourcesPanelState` to track which template is selected
- Add `templateArgs` (Record<string, string>) for template parameter values
- Add `templateReadLoading` (boolean) and `templateReadContent` / `templateReadError` for read results
- Add `selectTemplate(uriTemplate: string)` method — sets `selectedTemplateUri`, clears `selectedUri` (so static resource deselects), parses parameters from the template
- Add `setTemplateArg(name: string, value: string)` method
- Add `readTemplateResource()` method:
  1. Expand the URI template by substituting `{param}` placeholders with values from `templateArgs`
  2. Call `client.readResource({ uri: expandedUri })` 
  3. Store result in `templateReadContent` / `templateReadError`
  4. Log to history

### Step 2: URI template parameter extraction

**File:** `McpInspectorEditorModel.ts` (or a small helper)

- Write a simple `extractTemplateParams(uriTemplate: string): string[]` function
- Extracts parameter names from RFC 6570 simple string expansion: `{paramName}` patterns
- Example: `"docs://documents/{document_id}/sections/{section}"` → `["document_id", "section"]`
- Write a simple `expandUriTemplate(uriTemplate: string, args: Record<string, string>): string` function
- Replaces `{paramName}` with the corresponding value from args
- No need for full RFC 6570 support — simple `{name}` substitution covers most MCP use cases

### Step 3: Update ResourcesPanel UI

**File:** `ResourcesPanel.tsx`

- Make template sidebar items clickable with `onClick={() => model.selectTemplate(t.uriTemplate)}`
- Add active state styling for selected templates (same as static resources)
- Update the detail panel to show template details when a template is selected:
  - Template name
  - URI template string
  - Description and MIME type (if available)
  - Parameter input fields (one `TextAreaField` per extracted parameter, similar to PromptsPanel argument fields)
  - "Read Resource" button that calls `model.readTemplateResource()`
  - Loading/error states
  - Result display using existing `ResourceContentView` component
- Mutual exclusion: selecting a template deselects static resource and vice versa

### Step 4: Update `selectResource` to deselect template

**File:** `McpInspectorEditorModel.ts`

- In `selectResource()`, also clear `selectedTemplateUri` so template deselects when a static resource is selected

## Concerns / Open Questions

1. **RFC 6570 complexity** — ✅ **Resolved:** Only support simple `{name}` parameters. No operators like `{+path}`, `{#fragment}`, etc.

2. **Input field type** — ✅ **Resolved:** Use `TextAreaField` for consistency with the Prompts panel.

## Acceptance Criteria

- [ ] Clicking a resource template in the sidebar selects it and shows its details in the detail panel
- [ ] Template detail panel shows: name, URI template, description, MIME type
- [ ] Parameter input fields are generated from the URI template (one per `{param}`)
- [ ] "Read Resource" button constructs the URI by substituting parameters and calls `readResource`
- [ ] Read results display using existing `ResourceContentView`
- [ ] Loading and error states work correctly
- [ ] Selecting a template deselects any selected static resource (and vice versa)
- [ ] All MCP requests are logged to history
- [ ] UI follows the existing panel patterns (consistent with Prompts panel layout)
