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
| [IApp](app.md) | `app` | [app.md](app.md) | Implemented (Phase 0) |
| [ISettings](settings.md) | `app.settings` | [settings.md](settings.md) | Implemented (Phase 1) |
| [IEditorRegistry](editors.md) | `app.editors` | [editors.md](editors.md) | Implemented (Phase 1) |
| [IRecentFiles](recent.md) | `app.recent` | [recent.md](recent.md) | Implemented (Phase 1) |
| [IFileSystem](fs.md) | `app.fs` | [fs.md](fs.md) | Implemented (Phase 2) |
| [IWindow](window.md) | `app.window` | [window.md](window.md) | Implemented (Phase 2) |
| [IPageCollection](pages.md) | `app.pages` | [pages.md](pages.md) | Planned |
| [IPage](page.md) | `page` / `app.pages.active` | [page.md](page.md) | Planned |
| [IUserInterface](ui.md) | `app.ui` | [ui.md](ui.md) | Implemented (Phase 3a) |
| [IShell](shell.md) | `app.shell` | [shell.md](shell.md) | Implemented (Phase 3b) |
| [IDownloads](downloads.md) | `app.downloads` | [downloads.md](downloads.md) | Implemented (Phase 3b) |

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

### Shared Types

| Type | Defined in | Status |
|------|-----------|--------|
| `IDisposable` | `api/types/common.d.ts` | Implemented (Phase 0) |
| `IEvent<T>` | `api/types/common.d.ts` | Implemented (Phase 0) |

### Lifecycle & Concepts

| Topic | Doc | Status |
|-------|-----|--------|
| Application Lifecycle | [app-lifecycle.md](app-lifecycle.md) | Draft |
| Page Lifecycle | [page-lifecycle.md](page-lifecycle.md) | Draft |
