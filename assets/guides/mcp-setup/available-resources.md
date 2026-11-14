---
title: "Available Resources"
audience: "user"
summary: "Which guide resources can MCP clients read?"
---

# Available Resources

## Available Resources

MCP resources are read-only documents that AI clients can discover and read to gain context before using tools.

| Resource | URI | Description |
|----------|-----|-------------|
| **Overview Guide** | `persephone://guides/overview` | Start here — the mental model (windows, pages, editors, boards, tools) and a task → tool → guide routing table. Read this first if you are new to Persephone. |
| **pages.logView.push Guide** | `persephone://guides/ui-push` | Log View output channel — entry types, dialogs, examples. Read when showing output to the user. |
| **Pages Guide** | `persephone://guides/pages` | Pages & windows — page properties, editor types, creating pages, multi-window support. Read when working with tabs or documents. |
| **Scripting Guide** | `persephone://guides/scripting` | Full scripting API — `app` object, editor facades, TypeScript, Node.js access. Read when using `script.execute`. |
| **Links Guide** | `persephone://guides/links` | Links editor JSON format — LinkItem structure, categories, tags. Read before creating or editing links pages. |
| **Boards Guide** | `persephone://guides/boards` | Board authoring/automation reference — bridge API, theme contract, local vendoring, `pages[pageId].editor` testing. Read before building or opening a board. |
| **Tools Guide** | `persephone://guides/tools` | Agent Tools registry — `tools.search`/`tools.execute`, the stdin-JSON + result-marker contract, `.env` secrets. Read before using them. |
| **Browser Guide** | `persephone://guides/browser` | Browser automation in depth — `call` paths, snapshot format, ref lifecycle, waiting strategies, errors, and older-tool equivalents. |
| **UI Guide** | `persephone://guides/ui` | Persephone screen catalogue and layout entry point — application chrome, stable selector guidance, where Settings lives, and how to highlight an element on screen. Read when helping the user with the app itself. |
| **UI Editors Guide** | `persephone://guides/ui-editors` | The editor catalog — what each editor is for, how the user opens it, what it can do. Read when explaining Persephone's capabilities to the user. |
| **Full Guide** | `persephone://guides/full` | All guides combined into one document. Only read if you need the complete reference. |

AI agents also receive **server instructions** on connection — a concise overview of persephone and its main workflows, with pointers to which guide to read for each task. This means agents have immediate context without reading any resource.

The `call` tool follows the browser privacy boundary: a user-opened incognito or Tor page is not
readable through its object-model path, while a private page opened by the agent is available to
that agent. The `app.call()` method in ordinary scripts has the same page privacy rule.

