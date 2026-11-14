---
title: "Boards — ship your own documentation"
audience: agent
summary: "Add a guides folder to a board so its user and agent docs ship with it: manifest field, front matter, editorId, Layout section, trust rules."
---

# Boards — ship your own documentation

## Ship your own documentation — the `guides` folder

Put the board's user and agent documentation **in the board**, so it versions and ships with the
board independently of a Persephone release.

1. Add `"guides": "guides"` to `board-manifest.json`.
2. Create `guides/index.md` (the entry page) and any further `.md` files, including nested folders.
3. Start every page with front matter:

```markdown
---
title: "Using My Board"
audience: user
summary: "One sentence, shown beside the page in the About guide tree."
editorId: "board"
---

# Using My Board
...
```

`title` and `summary` are required. `audience` is `user`, `agent`, or `both`; `agent` pages stay
hidden until the reader enables **Show agent guides**, so user and agent documentation can live
side by side. `editorId: "board"` marks a page as documentation for this board and makes `F1` on
one of its pages open that guide. Use the literal token `board`; the real editor id contains an
absolute path and differs on every machine. A `## Layout` section is available as
`guides[...].layout`.

Only a **trusted** board contributes documentation. Untrusting or removing the board removes its
pages from the guide tree and search immediately.
