---
title: "Environment Variables Editor"
audience: both
summary: "Per-board environment variables with namespaces, profiles, editable values, and encryption."
editorId: "env-vars-view"
---

# Environment Variables Editor

The Environment Variables editor manages the per-board secrets store outside board folders. It shows
namespaces for boards, profiles, and editable Name/Value pairs.

## How to Open

Open **Settings** -> **Board Environment Variables**, or let a board call `persephone.var.show()`.
The editor id is `env-vars-view`; it is not a general-purpose `.env` text editor.

## Layout

## Profiles and values

Select a board namespace, then choose the `default` profile or a profile declared by that board.
Values are shown in plain text while the store is unlocked. An encrypted file shows **Locked** and
requires **Unlock** before values can be edited. Add and remove profiles and namespaces from their
respective views.

## Agent API

After narrowing `page.editor.id` to `env-vars-view`, the facade exposes namespace, profile, and value
state. Verified elements include `env-vars-grid`, `env-vars-profile-tabs`, `env-vars-add-profile`,
`env-vars-delete-profile`, `env-vars-namespace-row`, `env-vars-add-namespace`,
`env-vars-delete-namespace`, and `env-vars-unlock`.

## Errors and limits

Locked encrypted values cannot be edited until the user unlocks the store. Environment variables are
board-scoped; they are not ordinary files inside the board directory.
