---
title: "Boards"
audience: both
summary: "Custom HTML-page applications hosted by Persephone and backed by local scripts: what a board is, how to create one, and where each topic is documented."
editorId: "board-info"
---

# Boards

Boards let you build fully custom HTML-page applications that can live anywhere on disk and run local scripts on demand. The UI is yours to author as plain HTML — Persephone hosts the page and wires one bridge object, `window.persephone`, so your page can call scripts and show native dialogs.

> **Target audience:** This guide is for users who want to create and use boards. For AI-agent builders, the per-board `CLAUDE.md` inside each board folder is the primary authoring reference.

## Layout

```
+---------------------------------------------------------------------+
| [page nav] [Board Info toolbar]                            [switch] |  shared toolbar with Board Info content and switch at the right
+---------------------------------------------------------------------+
| [Install location] [Browse]                                         |  install-mode location row
| [catalog tiles: Download / Cancel / Retry / Register]               |  install-mode catalog body
| [properties: Open / Uninstall / Unregister]                         |  properties-mode action row
| [published versions: Retry / Update or Install]                     |  published versions body
+---------------------------------------------------------------------+
```

### User-facing label → `elements` name

- Browse → `board-info-browse`
- Download → `board-info-download`
- Cancel → `board-info-cancel`
- Retry download → `board-info-retry`
- Register board → `board-info-register`
- Delete download → `board-info-delete`
- Open board → `board-info-open`
- Uninstall → `board-info-uninstall`
- Unregister → `board-info-unregister`
- Retry published versions → `board-info-versions-retry`
- Update or Install version → `board-info-version-install`

### When Board Info is in install mode

```
+---------------------------------------------------------------------+
| [Install location] [Browse]                                         |  install mode location row
+---------------------------------------------------------------------+
| [available] [downloading] [failed] [downloaded] [registered]        |  catalog board tiles with state-specific actions
+---------------------------------------------------------------------+
```

### When Board Info is in properties mode

```
+---------------------------------------------------------------------+
| [Open] [Uninstall or Unregister]                                    |  properties mode action row for the selected board
| [published versions: loading/error/empty/available]                 |  published versions section below the properties
+---------------------------------------------------------------------+
```

### When a published-version list is loading, failed, empty, or available

```
+---------------------------------------------------------------------+
| [Retry] [published version rows]                [Update or Install] |  published-version list with its state-specific action
+---------------------------------------------------------------------+
```

### When Board Info asks for trust confirmation

```
+---------------------------------------------------------------------+
| [trust confirmation]                                                |  trust confirmation surface before an untrusted board action
+---------------------------------------------------------------------+
```

### Drawn controls without `elements`

- Install progress, dynamic catalog/version rows, and the native install-location folder picker — no entry: progress and rows are repeated state; the picker is an OS dialog.

Evidence: `BoardInfoEditorView.ts:83-90,188-309,316-429,455-470` and `BoardInfoEditorFacade.ts:18-30`.

---

## Concepts

## What is a board?

A board is a small web app stored in any folder on your machine — it is identified by a `board-manifest.json` file in the board's root folder. When you open a board in Persephone, the page renders in a sandboxed context — isolated from the host application — and receives a single injected `persephone` bridge object.

Some editors are shipped as **bundled boards**. They appear in **Tools & Editors → Editors** under
the **Built-in** folder, alongside trusted boards, and they need no trust confirmation because they are part of
the Persephone installation. The bundled **Excalidraw** board handles `.excalidraw` files and is
included in the offline installation. Right-click it in the Built-in list and choose **Disable** to
remove its file association and its image/diagram handoff capabilities. If no replacement board is
installed, those actions show **No image editor is registered** or **No diagram editor is
registered**. A disabled bundled board stays in the Built-in list, greyed out and no longer
creatable. Any page that already has it open shows the untrusted screen while it is disabled.
Right-click it and choose **Enable** to bring it back. The change takes effect immediately, with no
restart.

The three parts:

| Part | What it is |
|------|-----------|
| **Frontend** | `index.html` + your CSS/JS. Owns all UI and state. |
| **Backend** | Scripts in `scripts/` (any language — `.js`, `.py`, `.ps1`, `.sh`, …). They run as real OS processes with your privileges. |
| **Channel** | `persephone.execute(commandLine)` — or `persephone.executeNode(script, args?)` to guarantee a Node backend with nothing installed on your machine (see below). The page calls a script, the script prints JSON to stdout, the page parses it and renders. |

## Where do boards live?

Boards can live **anywhere on disk** — any folder containing a `board-manifest.json` file is a board. Persephone creates this file automatically when scaffolding a board.

## Getting started

### 1. Create a board

**From the Boards panel (recommended):** open any folder in the **File Explorer** sidebar, then click the **Boards** button in the Explorer header to open the Boards panel. Click **New board** — a dialog opens asking for a folder and a name. The folder defaults to the current Explorer root (you can change it or browse to another location). A live label previews the final path. Click **Create** and the board is scaffolded, trusted, and opened in a single step.

To install a full working demo board instead, click the caret on the **New board** split-button and choose **Create Demo board**.

**From a script** (an AI agent calls the same members as `call` paths: `boards.createBoard`, `boards.createDemoBoard`, `boards.openBoard`):
```javascript
// Create a blank board in any folder — auto-trusted at creation
const root = await app.boards.createBoard("My Board", "C:/work/boards");
await app.boards.openBoard(root);

// Or scaffold from the Demo template
const root = await app.boards.createDemoBoard("Demo", "C:/work/boards");
await app.boards.openBoard(root);
```

The board opens immediately after creation.

## Read next

| Read when you want to … | Page |
|---|---|
| see how trust and permissions work | [trust-and-permissions](trust-and-permissions.md) |
| open, run, edit and manage boards; the demo board, icon and error log | [getting-started](getting-started.md) |
| configure board settings, the toolbar, the right-click menu, or the sidebar panel | [board-ui](board-ui.md) |
| declare services, capabilities and intents | [services-and-capabilities](services-and-capabilities.md) |
| handle capability and intent requests | [capability-handlers](capability-handlers.md) |
| serve content providers or claim Browser downloads | [content-providers](content-providers.md) |
| make a board the editor for a file type or folder | [custom-editors](custom-editors.md) |
| handle source opens, unsaved work, content-host and stream-host editors | [custom-editors-advanced](custom-editors-advanced.md) |
| call the board bridge from a board page | [bridge](bridge.md) |
| use integration methods, `persephone.openContent`, `persephone.call`, themes | [bridge-integration](bridge-integration.md) |
| report busy state, use page state, or reach the board's own model | [bridge-state](bridge-state.md) |
| match Persephone's theme; lay out a board folder; ship board docs | [theme-and-layout](theme-and-layout.md) |
| keep a board's secrets in environment variables | [env-vars](env-vars.md) |
| install published boards, use recommended components, build with an AI agent | [published-boards](published-boards.md) |

Agents building a board read the [board authoring guide](../agents/boards/index.md).
