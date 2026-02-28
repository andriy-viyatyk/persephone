# App Object Model — API Reference

Complete reference for all interface objects. This documentation serves both human users (scripts) and AI bots.

## How to Read

Each interface document contains:
- **Overview** — what the interface is and when to use it
- **Properties** — readable (and sometimes writable) values
- **Methods** — actions with parameters, return types, and error behavior
- **Events** — subscribable notifications
- **Examples** — common usage patterns

## Interface Index

### Core Services

| Interface | Access | Doc | Status |
|-----------|--------|-----|--------|
| [IApp](app.md) | `app` | [app.md](app.md) | Planned |
| [IPageCollection](pages.md) | `app.pages` | [pages.md](pages.md) | Planned |
| [IPage](page.md) | `page` / `app.pages.active` | [page.md](page.md) | Planned |
| [ISettings](settings.md) | `app.settings` | [settings.md](settings.md) | Draft |
| [IFileSystem](fs.md) | `app.fs` | [fs.md](fs.md) | Draft |
| [IUserInterface](ui.md) | `app.ui` | [ui.md](ui.md) | Planned |
| [IWindow](window.md) | `app.window` | [window.md](window.md) | Planned |
| [IEditorRegistry](editors.md) | `app.editors` | [editors.md](editors.md) | Planned |
| [IRecentFiles](recent.md) | `app.recent` | [recent.md](recent.md) | Planned |
| [IShell](shell.md) | `app.shell` | [shell.md](shell.md) | Planned |

### Editor-Specific

| Interface | Access | Doc | Status |
|-----------|--------|-----|--------|
| [ITextEditor](text-editor.md) | `page.asText()` | [text-editor.md](text-editor.md) | Planned |
| [IBrowserEditor](browser-editor.md) | `page.asBrowser()` | [browser-editor.md](browser-editor.md) | Planned |
| [IGridEditor](grid-editor.md) | `page.asGrid()` | [grid-editor.md](grid-editor.md) | Planned |
| INotebookEditor | `page.asNotebook()` | — | Planned |
| ITodoEditor | `page.asTodo()` | — | Planned |
| ILinksEditor | `page.asLinks()` | — | Planned |
| IMarkdownEditor | `page.asMarkdown()` | — | Planned |

### Lifecycle & Concepts

| Topic | Doc | Status |
|-------|-----|--------|
| Application Lifecycle | [app-lifecycle.md](app-lifecycle.md) | Draft |
| Page Lifecycle | [page-lifecycle.md](page-lifecycle.md) | Draft |
