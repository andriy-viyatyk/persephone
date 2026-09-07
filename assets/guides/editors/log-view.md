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
