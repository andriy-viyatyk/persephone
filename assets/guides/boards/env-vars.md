---
title: "Boards — environment variables and secrets"
audience: both
summary: "Keep a board's secrets outside its folder: storage location, the .env.json editor, reading and writing variables, collisions, and letting an AI agent configure them."
---

# Boards — environment variables and secrets

## Environment variables — secrets outside the board folder

A board should never store secrets — connection strings, API keys, passwords — inside its own folder, because that folder is exactly what gets copied, shared, or committed to a repo. Persephone instead keeps a single, optional password-encrypted `.env.json` file **outside every board's folder**, with each board reading and writing only its own slice of it.

### What this does and doesn't protect

For a board with object-form permissions, the bridge limits the operations it can request. A board
granted `execute`, `fileSystem: "full"`, or another **Full access** permission can still reach
sensitive resources, so review its grant list before trusting it. Legacy boards without an object
permissions declaration remain unrestricted during the deprecation period. This storage feature
solves:

1. **Secrets no longer live in the shareable board folder.** Copying, zipping, or committing a board no longer leaks its connection strings.
2. **Optional password encryption protects the file at rest** if the machine or the file itself is stolen.

Per-board isolation keeps each board's variables in its own slice. Permission grants still govern
what the board can do through Persephone; a board with broad grants may be able to access secrets
through other means. The [board trust dialog](trust-and-permissions.md#board-trust-gate) shows its requested grants.

### Configuring the storage location

Open **Settings** and find the **Board Environment Variables** section:

| Control | Description |
|---------|-------------|
| Path display | Shows the configured `.env.json` path, or "Not configured yet". |
| **Browse...** | Point the setting at an already-existing `.env.json` file — a plain native Open File dialog. Nothing is created or overwritten. |
| **Create...** | Choose a path (defaults to Persephone's data folder) and create a new, empty file there. |
| **Unlink** | Clear the setting. The file itself is left untouched on disk. |
| **Open Environment Variables** | Opens the configured file in its built-in editor (disabled until a path is configured). |

If no path is configured yet, the first time any board calls `persephone.var.*` you'll instead see a one-time **"Create environment variables storage"** dialog with an editable default path — declining it makes that call fail (a well-behaved board handles this gracefully).

Encryption is entirely optional and reuses Persephone's existing file-encryption feature — encrypt or decrypt the `.env.json` file the same way you would any other text file, from its tab's right-click menu. The first time a board (or the editor) needs to read an encrypted, not-yet-unlocked file, Persephone prompts once per session for the password.

### The `.env.json` editor

Opening a `.env.json` file (from Settings, the File Explorer, or File → Open) shows a dedicated editor instead of raw JSON:

- **Left pane** — every namespace (board) currently stored in the file. Click one to select it; add a new namespace or delete an existing one from here.
- **Right pane** — profile tabs for the selected namespace (`default`, plus any custom profiles a board has written, e.g. `dev`/`qa`), and below them a grid of that profile's variable names and values. Values are shown in plain text — there's nothing to mask on your own local machine.
- Add, edit, or delete variables directly in the grid — range-select, copy/paste, and add-row all work the same as any other Persephone grid.
- Press **Ctrl+S** (or navigate away) to save; the file re-encrypts automatically on save if it was encrypted.
- A locked (encrypted, not-yet-unlocked) file shows an **Unlock** button instead of its contents.

### How a board reads and writes its own variables

From inside a board's own script (`app.js`):

```js
// Read one value (the "default" profile, unless env is given)
const server = await persephone.var.get("SNOWFLAKE_SERVER");

// Write a value into this board's OWN namespace
await persephone.var.set("SNOWFLAKE_USER", "my-user");

// List this board's variable names (not values) in a profile
const keys = await persephone.var.list();

// A named profile other than the default, e.g. "dev"
const devServer = await persephone.var.get("SNOWFLAKE_SERVER", "dev");

// Open the environment variables editor, scoped to this board
await persephone.var.show();
```

- `persephone.var.get(name, env?)` / `.set(name, value, env?)` / `.list(env?)` are always scoped to the **calling board's own namespace** — a board never passes a namespace, so it has no way to name and reach another board's variables.
- **Every call is async and can reject**: storage not configured and you declined to create it, the file is locked and you cancelled or entered the wrong password, or a store error. A board should handle rejection gracefully (e.g. show its own "please configure your connection" message) instead of assuming the call always succeeds.
- A board's namespace is its manifest's `author`/`name` (e.g. `"Persephone/Excel Viewer"`) when **both** fields are explicitly set in `board-manifest.json`; otherwise it falls back to the board's own root folder path. Changing `author`/`name` later re-namespaces the board and orphans its previously-stored variables — keep them stable once secrets are stored under them.

### Namespace collisions at registration

Two different boards can end up with the same `author`/`name` — for example, a developer's working copy of a board and its installed copy from the catalog. Registering (trusting) a board whose namespace already matches an already-registered board shows an advisory dialog naming the other board, with:

- **Register Anyway** — proceed; both boards will share the same stored variables.
- **Cancel** — stop, so you can give the new board a distinct `author`/`name` in its manifest before registering it again.

This only happens for `author`/`name` namespaces — a board using its root-path fallback can never collide with another board.

### Letting an AI agent configure a board's secrets for you

An agent can provision a board's environment variables ahead of time — for example, right after scaffolding a board that needs a database connection — using the `app.boardVars` scripting namespace, which (unlike `persephone.var.*`) can target **any** namespace:

```js
const root = await app.boards.createBoard("Snowflake Viewer", "C:/boards");
const namespace = await app.boardVars.namespaceFor(root);
await app.boardVars.set(namespace, "SNOWFLAKE_SERVER", "abc123.snowflakecomputing.com");
await app.boards.openBoard(root);
```

This means you can ask an agent to "build me a board that connects to Snowflake" and have it scaffold the board **and** configure its connection secrets in one go, without opening the `.env.json` editor by hand yourself. See [app.boardVars](../scripting/api/app-capabilities-and-vars.md#boardvars) for the full method reference.

---
