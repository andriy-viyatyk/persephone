# Todo Editor Format (`todo-view`)

**IMPORTANT: Read this guide BEFORE creating or updating todo pages. Incorrect JSON structure will result in an empty or broken editor.**

## Creating a Todo Page

```
create_page({
  title: "Tasks.todo.json",
  editor: "todo-view",
  language: "json",
  content: JSON.stringify(todoData)
})
```

**Required:** `language: "json"`, title ending with `.todo.json`

## Root Structure

```json
{
  "lists": [ ...list names... ],
  "tags": [ ...tag definitions... ],
  "items": [ ...TodoItem objects... ],
  "state": {}
}
```

| Field | Type | Description |
|-------|------|-------------|
| `lists` | string[] | List names — items are grouped by list. At least one list is required for items to be visible |
| `tags` | TodoTag[] | Tag definitions with name and color (can be `[]`) |
| `items` | TodoItem[] | Array of todo items |
| `state` | object | Per-item UI state; use empty `{}` when creating |

## TodoItem Structure

Every field is **required**:

```json
{
  "id": "unique-id-1",
  "list": "Release",
  "title": "Run test suite",
  "done": false,
  "createdDate": "2026-03-20T10:00:00.000Z",
  "doneDate": null,
  "comment": null,
  "tag": null
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (use UUID or any unique string) |
| `list` | string | List name — **must match** one of the names in the root `lists` array |
| `title` | string | Task title text |
| `done` | boolean | Whether the task is completed |
| `createdDate` | string | ISO 8601 date string |
| `doneDate` | string \| null | ISO 8601 date when completed, or `null` if not done |
| `comment` | string \| null | Optional comment text; `null` means no comment |
| `tag` | string \| null | Tag name reference (must match a tag in the `tags` array), or `null` |

**Important:** The `list` field must reference a list name that exists in the root `lists` array. Items with non-existent list names will not be visible.

## TodoTag Structure

```json
{
  "name": "urgent",
  "color": "#e06c75"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Tag name |
| `color` | string | Hex color from palette (e.g., `"#e06c75"`), or `""` for no color |

## Full Example

A todo list with 2 lists, 1 tag, and 5 items:

```json
{
  "lists": ["Release", "Follow-up"],
  "tags": [
    { "name": "critical", "color": "#e06c75" }
  ],
  "items": [
    {
      "id": "item-1",
      "list": "Release",
      "title": "Run full test suite and fix failures",
      "done": false,
      "createdDate": "2026-03-20T10:00:00.000Z",
      "doneDate": null,
      "comment": null,
      "tag": "critical"
    },
    {
      "id": "item-2",
      "list": "Release",
      "title": "Update version in package.json",
      "done": false,
      "createdDate": "2026-03-20T10:01:00.000Z",
      "doneDate": null,
      "comment": null,
      "tag": null
    },
    {
      "id": "item-3",
      "list": "Release",
      "title": "Write release notes",
      "done": false,
      "createdDate": "2026-03-20T10:02:00.000Z",
      "doneDate": null,
      "comment": "Include breaking changes section",
      "tag": null
    },
    {
      "id": "item-4",
      "list": "Release",
      "title": "Build and sign installer",
      "done": false,
      "createdDate": "2026-03-20T10:03:00.000Z",
      "doneDate": null,
      "comment": null,
      "tag": null
    },
    {
      "id": "item-5",
      "list": "Follow-up",
      "title": "Notify users about the new release",
      "done": false,
      "createdDate": "2026-03-20T10:04:00.000Z",
      "doneDate": null,
      "comment": null,
      "tag": null
    }
  ],
  "state": {}
}
```

## Lists

- Lists group items — the left panel shows list names with item counts
- Each item belongs to exactly one list via the `list` field
- Use meaningful list names (e.g., `"Backlog"`, `"Sprint 1"`, `"Done"`)
- At least one list must exist for items to display

## Tags

- Tags provide visual labels with optional colors
- Each item can have one tag (or `null` for no tag)
- Colors are hex strings (e.g., `"#e06c75"`, `"#98c379"`, `"#61afef"`)
