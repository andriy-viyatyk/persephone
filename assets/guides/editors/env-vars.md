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

```
+---------------------------------------------------------------------+
| [Page nav]                                             [Switch]     |  shared text chrome around the environment variables body
+---------------------------------------------------------------------+
| [Namespace column]                         [Selected pane]          |  environment-variable body: namespace navigation at left
| [Add namespace]                                                     |  bottom of the namespace column
| [Profile tabs]                                  [+ Profile]         |  top of the selected namespace pane; Add profile at right side of the profile tabs
| [Profile rows] [Delete profile]                                     |  selected profile controls in the namespace pane
| [Environment variable grid]                                         |  selected profile data below its controls
+---------------------------------------------------------------------+
```

### User-facing label → `elements` name

- Profile tabs → `env-vars-profile-tabs`
- Add profile → `env-vars-add-profile`
- Delete profile → `env-vars-delete-profile`
- Namespace row → `env-vars-namespace-row`
- Add namespace → `env-vars-add-namespace`
- Delete namespace → `env-vars-delete-namespace`
- Environment variable grid → `env-vars-grid`
- Unlock → `env-vars-unlock`
- Page navigation and Editor switch → no entry: shared shell controls
- Grid cell editors → no entry: editor-internal data-grid controls

### When the file is locked

```
+---------------------------------------------------------------------+
|                              [Unlock]                               |  locked environment panel with its centered unlock action
+---------------------------------------------------------------------+
```

### When a namespace and profile are active

```
+---------------------------------------------------------------------+
| [Profile tabs]                                  [+ Profile]         |  top of the selected namespace pane; Add profile at right side of the profile tabs
| [Environment variable grid]                                         |  selected profile data below the profile controls
+---------------------------------------------------------------------+
```

### Drawn controls without `elements`

- Page navigation and Editor switch — no entry: shared shell controls are owned by the common chrome.
- Data-grid cell editors — no entry: editor-internal controls; the environment variable grid is the addressable region.

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
