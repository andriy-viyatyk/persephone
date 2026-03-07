[← Home](../index.md) · [Scripting Guide](../scripting.md)

# Scripting API Reference

Complete reference for the scripting API available when running JavaScript or TypeScript in js-notepad.

## Global Variables

Scripts have two global variables:

| Variable | Type | Description |
|----------|------|-------------|
| `page` | [IPage](./page.md) | The current page (tab). Read/write content, switch editors, access grouped output. |
| `app` | [IApp](./app.md) | The application object. Access settings, file system, dialogs, pages, and more. |
| `preventOutput()` | function | Suppress default script output to the grouped page. See [Output Suppression](../scripting.md#output-suppression). |

```javascript
// Both are available as globals — no import needed
const text = page.content;
const theme = app.settings.theme;
```

## API by Area

### Page

| API | Description |
|-----|-------------|
| [page](./page.md) | Current page — content, language, editor, grouped output |
| [page.runScript()](./page.md#runscriptpromisestring) | Run page content as a script (same as F5) |
| [page.asText()](./page.md#astextpromiseitexteditor) | Monaco text editor — selection, cursor, insert |
| [page.asGrid()](./page.md#asgridpromiseigrideditor) | Grid editor — rows, columns, cells |
| [page.asNotebook()](./page.md#asnotebookpromiseinotebookeditor) | Notebook — notes, categories, tags |
| [page.asTodo()](./page.md#astodopromiseitodoeditor) | Todo lists — items, lists, tags |
| [page.asLink()](./page.md#aslinkpromiseilinkeditor) | Link collections — URLs, categories |
| [page.asBrowser()](./page.md#asbrowserpromiseibrowsereditor) | Browser — navigate, back, forward |
| [page.asMarkdown()](./page.md#asmarkdownpromiseimarkdowneditor) | Markdown preview — rendered HTML |
| [page.asSvg()](./page.md#assvgpromiseisvgeditor) | SVG preview |
| [page.asHtml()](./page.md#ashtmlpromiseihtmleditor) | HTML preview |
| [page.asMermaid()](./page.md#asmermaidpromiseimermaideditor) | Mermaid diagram preview |

### Application

| API | Description |
|-----|-------------|
| [app](./app.md) | Application root — version, all services |
| [app.pages](./pages.md) | Open tabs — open files, navigate, group, pin |
| [app.fs](./fs.md) | File system — read, write, dialogs, OS folders |
| [app.settings](./settings.md) | Configuration — get/set settings, change events |
| [app.ui](./ui.md) | User interface — confirm, input, password, notifications |
| [app.shell](./shell.md) | OS integration — open URLs, encryption, version info |
| [app.window](./window.md) | Window — minimize, maximize, zoom, multi-window |
| [app.editors](./editors.md) | Editor registry — list editors, resolve by file |
| [app.recent](./recent.md) | Recent files — load, add, remove, clear |
| [app.downloads](./downloads.md) | Downloads — track, cancel, open downloaded files |

## Node.js Access

Scripts have full Node.js access via `require()`:

```javascript
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Use npm packages
const _ = require(path.join('D:\\myproject\\node_modules', 'lodash'));
```

## Output

Script return values are written to the grouped (side-by-side) output page:

| Return Type | Output |
|-------------|--------|
| String | Written as-is |
| Number/Boolean | Converted to string |
| Object/Array | JSON formatted |
| Error | Error message + stack trace |
| `undefined` | "undefined" |

See [Scripting Guide](../scripting.md) for full details on running scripts.
