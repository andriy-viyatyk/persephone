---
title: "Log View"
audience: both
summary: "Structured JSONL output, messages, and interactive dialogs for agent and script results."
editorId: "log-view"
---

# Log View

Log View presents structured log entries, plain messages, and interactive answers in a readable
output page. It is also the editor behind the script-facing log channel.

## How to Open

Open a `.log.jsonl` file, or use `pages.logView.push(entries)` to create and append to the managed
Log View page. A JSONL page can expose Log View by content detection only when it carries a marker
matching `"type": "log.*"`; arbitrary JSONL is not sufficient.

## Layout

```
+---------------------------------------------------------------------+
| [Nav] [Clear] [Timestamps]                              [Switch]    |  left side of the Log View toolbar
+---------------------------------------------------------------------+
| [Grid output] [Markdown output] [Mermaid output] [Text output]      |  Log View output body, with each output card's actions revealed on hover
| [inline dialog]                                                     |  Log View dialog surface below its output entries
+---------------------------------------------------------------------+
```

### User-facing label → `elements` name

- Clear → `log-clear`
- Timestamps → `log-toggle-timestamps`
- Open Grid in editor → `log-grid-open-in-editor`
- Open Markdown in editor → `log-markdown-open-in-editor`
- Open Mermaid in editor → `log-mermaid-open-in-editor`
- Copy Mermaid → `log-mermaid-copy`
- Open text in editor → `log-text-open-in-editor`
- Radio group → `log-radio-group`
- Select → `log-select`
- Text input → `log-text-input`
- Dialog answer button → `log-dialog-button`
- Dialog checkbox → `log-dialog-checkbox`
- Page navigation and Editor switch → no entry: shell-owned controls
- Output content and repeated entries → no entry: content is data rendered by Log View.

### When output-card actions are visible

```
+---------------------------------------------------------------------+
| [Grid output card]                                      [Open]      |  top-right of each Grid output card, on hover
| [Markdown output card]                                [Open]        |  top-right of each Markdown output card, on hover
| [Mermaid output card]                         [Open] [Copy]         |  top-right of each Mermaid output card, after Open in editor, on hover
| [Text output card]                                      [Open]      |  top-right of each text output card, on hover
+---------------------------------------------------------------------+
```

### When a Log View dialog is open

```
+---------------------------------------------------------------------+
| [radio group]                                                       |  in the Log View dialog, radio-group area
| [select]                                                            |  in the Log View dialog, select area
| [text input]                                                        |  in the Log View dialog, text-input area
| [answer buttons]                                                    |  in the Log View dialog, answer-button row
| [checkbox list]                                                     |  in the Log View dialog, checkbox list
+---------------------------------------------------------------------+
```

### Drawn controls without `elements`

- Output content, entry titles, and rendered Grid/Markdown/Mermaid/Text bodies — no entry: repeated
  Log View data; the stable output actions are the addressable controls.

Evidence: `src/renderer/editors/log-view/index.ts:72-84,115-177`, the output views under
`src/renderer/editors/log-view/items/`, and `LogViewEditorFacade.ts:15-28`.

## Entries and dialogs

Entries can be viewed as structured Grid data, Markdown, Mermaid, or plain text when the entry type
allows it. Clear the log, toggle timestamps, open an entry in the relevant editor, copy Mermaid
content, and answer interactive dialogs. The exact display depends on each pushed entry's shape.

## Agent API

`pages.logView.push(entries)` is the programmatic write route and `pages.logView.dialogResult(id)`
reads a dialog answer. After narrowing `page.editor.id` to `log-view`, its facade exposes the log
state and verified elements: `log-clear`, `log-toggle-timestamps`, `log-grid-open-in-editor`,
`log-markdown-open-in-editor`, `log-mermaid-open-in-editor`, `log-mermaid-copy`,
`log-text-open-in-editor`, `log-radio-group`, `log-select`, `log-text-input`, `log-dialog-button`,
and `log-dialog-checkbox`.

## Errors and limits

Malformed JSONL or entries with an unsupported shape may render as an error or plain text. Use the
managed push API for interactive dialogs and preserve the returned dialog id when reading its result.
