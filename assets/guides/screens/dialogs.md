---
title: "Dialogs and Transient Surfaces"
audience: both
summary: "Application dialogs, find bars, Log View questions, unsaved-change prompts, and file-opening surfaces."
screen: "dialogs"
---

# Dialogs and Transient Surfaces

This guide covers verified surfaces that appear during an action: find bars, application modals,
Log View questions, unsaved-change prompts, and the file-opening flow. They are not permanent
shell regions. A dialog or popup exists because an action caused it to appear, so inspect the
current state before addressing it.

The architecture contract excludes transient dialogs, popup menus, and toasts from shell layout
anchors. The app-owned Find Bar names below are a narrower, contractual exception for editor-local
targets; Monaco's native widget and the operating-system file picker have no app `data-name`
selector.

## Layout

## Find and replace surfaces

The shared app-owned Find Bar is an absolute overlay used by editors such as Markdown and Browser.
Its five contractual names are:

| Element | Selector |
|---|---|
| Find Bar | `[data-name="find-bar"]` |
| Find input | `[data-name="find-input"]` |
| Previous match | `[data-name="find-prev"]` |
| Next match | `[data-name="find-next"]` |
| Close Find Bar | `[data-name="find-close"]` |

These names are stable editor-local targets. The native Monaco find/replace widget used by the
text editor is a different surface and has no persistent app-owned selector. Use the editor's
find or replace action and inspect the native widget rather than inventing an app selector.

## Application dialogs

The script-facing UI operations `ui.confirm`, `ui.input`, `ui.password`, and `ui.textDialog` open
blocking application dialogs. They wait for an answer or cancellation and are modal surfaces,
not regions of the shell. Explain the question and use the available answer or cancel action;
do not treat a transient dialog's internal names as a general contract.

## Log View dialog entries

Log View is an inline output surface. Its interactive entries are distinct from the modal stack and
can ask the user through `pages.logView` or script UI output. The verified entry types are:

- `input.confirm` — a yes/no confirmation;
- `input.text` — a text response;
- `input.buttons` — a choice among buttons;
- `input.checkboxes` — one or more checkbox choices;
- `input.radioboxes` — one radio choice;
- `input.select` — a selection from a list.

Use the Log View page and its dialog/result API for these entries. They are inline questions, not
application shell anchors.

## Unsaved changes

Closing a modified text page can open the **Unsaved Changes** confirmation with **Save**,
**Don't Save**, and **Cancel**. Cancel leaves the page visible. Save writes the changes before
release; Don't Save discards them. The same release check applies when a modified panel or main
editor is being closed. Treat Save and Don't Save as the two choices that can destroy or preserve
the pending edits.

## Opening a file

“Open File” has two stages. Persephone first opens its application-owned Open URL dialog, where the
user chooses a URL or a file path. A File choice then opens the native operating-system file
picker, which can select one or multiple files. The OS picker is not given an app `data-name`
selector; it is outside the renderer contract. Describe the two-stage flow and use the active
dialog or native picker rather than presenting either as a permanent shell layout anchor.

