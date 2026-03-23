# US-250: Rest Client — MCP & API Integration

**Epic:** EPIC-010 (Rest Client)
**Status:** Planned

## Goal

Ensure the Rest Client editor is properly documented and integrated into the MCP resource guides so AI agents can create `.rest.json` pages with correct data format. No editor facade needed — scripts can read/write JSON content directly and use `app.fetch()` for HTTP requests.

## Background

### Why no editor facade
- All request data is plain JSON — scripts/agents can read `page.content` and parse it
- `app.fetch()` provides the same HTTP client that the Rest Client uses internally
- AI agents have their own HTTP capabilities — they don't need to invoke requests through the editor
- The editor's value is as a **UI tool for humans**, not as a programmatic API

### What needs updating
1. **MCP pages guide** (`assets/mcp-res-pages.md`) — missing `rest-client` editor type, language/title requirements, and data format documentation
2. **Editor Types list** in the guide — missing `rest-client` and `log-view` and `grid-jsonl`

### Current state
- `addEditorPage("rest-client", "json", "Title.rest.json", content)` — works, creates rest-client page
- `validateForLanguage` falls back to `"monaco"` if language isn't `"json"`
- `isEditorContent` detects `"type": "rest-client"` + `"requests"` in JSON content
- Editor Types list in MCP guide is outdated — missing `rest-client`, `log-view`, `grid-jsonl`

## Implementation Plan

### Step 1: Update Editor Types list

**File:** `assets/mcp-res-pages.md` (line 64)

Add missing editor types to the list:
```
"monaco" · "grid-json" · "grid-csv" · "grid-jsonl" · "md-view" · "notebook-view" · "todo-view" · "link-view" · "graph-view" · "draw-view" · "svg-view" · "html-view" · "mermaid-view" · "log-view" · "rest-client" · "pdf-view" · "image-view" · "browser-view" · "about-view" · "settings-view" · "mcp-view"
```

### Step 2: Add rest-client to editor/language table

**File:** `assets/mcp-res-pages.md` (after line 83)

Add row:
```
| `rest-client` | **`json`** | `.rest.json` (**required**) | `"API Collection.rest.json"` |
```

Also add missing editors:
```
| `grid-jsonl` | **`jsonl`** | — | `"Logs"` |
| `log-view` | **`jsonl`** | `.log.jsonl` (optional) | `"Output.log.jsonl"` |
```

### Step 3: Add Rest Client data format section

**File:** `assets/mcp-res-pages.md` (after the Graph Editor Format section, before Grouped Pages)

Add a new section documenting the `.rest.json` format:

```markdown
### Rest Client Format (`rest-client`)

The Rest Client editor displays a collection of HTTP requests. Content is JSON:

{
    "type": "rest-client",
    "requests": [
        {
            "id": "unique-id",
            "name": "Get Users",
            "collection": "User API",
            "method": "GET",
            "url": "https://api.example.com/users",
            "headers": [
                { "key": "Authorization", "value": "Bearer token", "enabled": true }
            ],
            "body": "",
            "bodyType": "none",
            "bodyLanguage": "plaintext",
            "formData": []
        }
    ]
}
```

Document the request fields, body types, and provide tips for AI agents.

### Step 4: Add to structured editors initial content list

**File:** `assets/mcp-res-pages.md` (line 90-93)

Add rest-client to the list of editors with required initial content:
```
- **Rest Client:** Empty: `{"type":"rest-client","requests":[]}`
```

## Acceptance Criteria

- [ ] Editor Types list includes `rest-client`, `log-view`, `grid-jsonl`
- [ ] Editor/language table has `rest-client` row with required language and title suffix
- [ ] Rest Client data format documented with full JSON schema and field descriptions
- [ ] Empty content template documented for rest-client
- [ ] AI agents can create valid `.rest.json` pages using only the MCP guide

## Files Changed Summary

| File | Change |
|------|--------|
| `assets/mcp-res-pages.md` | Add rest-client to editor list, table, format section, and initial content |
