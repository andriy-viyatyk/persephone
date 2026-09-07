---
title: "Board"
audience: both
summary: "Sandboxed custom HTML applications and file editors backed by scripts and board manifests."
editorId: "board-view"
---

# Board

A Board is a custom HTML application hosted by Persephone and backed by scripts in a board folder.
Boards can be dashboards, viewers, tools, or custom editors associated with file masks.

## How to Open

Open a trusted board from the Explorer **Boards** panel, a `board-manifest.json` row, or the Boards
tab in **Tools & Editors**. Published boards can be installed from the catalog. A trusted board
declaring `fileMasks` can appear in the editor switch for matching files.

## Layout

## Board capabilities

Boards own their HTML, CSS, and JavaScript UI and can call backend scripts through the
`persephone.execute()` channel. Integration helpers cover notifications, file/folder dialogs, raw
links, and file access. The `--p-*` theme contract follows app theme changes. The board toolbar can
reload the board, show its log, and switch declared secondary views. Custom editors may either own
local file I/O or use a content host for Persephone-managed encoding, encryption, autosave, and
unsaved changes.

## Trust and safety

Installed or otherwise untrusted boards show the **Trust this board?** gate before rendering because
their scripts run with the user's privileges. Trust is remembered per folder and inherited by boards
inside a trusted folder. API-created boards from `app.boards.createBoard` and `createDemoBoard`
scaffold and auto-trust their board; the installed/published-board path still uses the user trust gate.

## Agent API

After narrowing `page.editor.id` to `board-view`, the `BoardEditor` facade exposes trust/render state,
manifest metadata, reload, status, declared secondary views, snapshots, clicks, typing, evaluation,
screenshots, network requests, and frame selection. Verified chrome elements include
`board-toolbar-explorer`, `board-toolbar-reload`, `board-toolbar-log`, `board-toolbar-properties`,
and `board-trust`. Board iframe content is reached through snapshots rather than the chrome inventory.

The app's `board-info` id is a separate screen-owned content-host exception: the page lifecycle can
accept it through `pages.addEditorPage` because its registration has `hasContentHost: true`. This does
not make `board-info` one of the 23 editor guide pages, and the old blanket claim that every app/tool
page is rejected is incorrect.

## Errors and limits

Untrusted content remains restricted until the user answers the trust prompt. A board can be trusted
but still fail to load because of its manifest, script, or iframe content; use its status and log for
diagnosis. See [Boards](../boards.md) for manifests and custom editors.
