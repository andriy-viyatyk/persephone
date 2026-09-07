---
title: "REST Client"
audience: both
summary: "HTTP request collections with request editing, body formats, responses, and export."
editorId: "rest-client"
---

# REST Client

REST Client edits and sends an HTTP request collection. It keeps a request tree in the sidebar and
the selected request in the main area.

## How to Open

Open a `.rest.json` file. JSON with `"type": "rest-client"` and `"requests"` can also expose the
switch. Agents can use `pages.addEditorPage("rest-client", "json", title, content)`. Scripts that
only need an HTTP call can use `app.fetch(url, options)` instead.

## Layout

```
+---------------------------------------------------------------------+
| [Page nav]                                             [Switch]     |  shared text chrome around the REST client body
+---------------------------------------------------------------------+
| [Request tree] [Add]       [Request: Method] [URL] [Send]           |  request tree at left and selected request bar in the body
| [Collection] [Name]                          [Copy as] [Delete]     |  selected request header above its editor
| [Headers] [Table/JSON] [Copy]                                       |  request headers section header
| [Header/form rows]                                                  |  repeated request rows
| [Body] [Body type] [Language]                                       |  request body section header
| [Request body]                                                      |  request body below the Body section
| [Response tabs] [Language] [Open in tab]                            |  response region with actions at the right
+---------------------------------------------------------------------+
```

### User-facing label → `elements` name

- Add request → `rest-tree-add`
- Method → `method-label`
- URL → `url-input`
- Send → `rest-send`
- Collection → `request-header-collection`
- Request name → `request-header-name`
- Copy as → `request-copy-as`
- Delete request → `request-delete`
- Headers view → `headers-view`
- Copy headers → `headers-copy`
- Body type → `body-type-select`
- Body language → `body-language`
- Response language → `response-language`
- Response tabs → `response-tab-select`
- Response headers view → `response-headers-view`
- Open in tab → `response-open-in-tab`
- Header/form key → `kv-row-key`
- Header/form value → `kv-row-value`
- Header/form delete → `kv-row-delete`
- Multipart key → `form-data-key`
- Multipart type → `form-data-type-toggle`
- Multipart text value → `form-data-value`
- Multipart file browse → `form-data-browse`
- Multipart delete → `form-data-delete`
- Request body splitter → `request-body-splitter`
- Page navigation and Editor switch → no entry: shared shell controls
- Request tree rows and response-copy headers → no entry: repeated content or view-local action

### When the Method menu is open

```
+---------------------------------------------------------------------+
| [HTTP method choices]                                               |  transient method menu beside the selected request bar
+---------------------------------------------------------------------+
```

### When the raw body-language menu is open

```
+---------------------------------------------------------------------+
| [Body languages]                                                    |  transient raw body-language menu beside the Body section
+---------------------------------------------------------------------+
```

### When the request headers are shown as a table

```
+---------------------------------------------------------------------+
| [Headers] [Table/JSON] [Copy headers]                               |  Headers section controls at the right side of its header
| [Key] [Value]                                            [Delete]   |  each repeated header/form row runs left to right
+---------------------------------------------------------------------+
```

### When the request body is binary or form-data

```
+---------------------------------------------------------------------+
| [Multipart key] [Type] [Value/Browse]              [Delete]         |  multipart row controls run left to right
+---------------------------------------------------------------------+
```

### When response tabs are available

```
+---------------------------------------------------------------------+
| [Body] [Headers]                              [Language] [Open]     |  response tabs at left and response actions at right
| [Response body or headers]                                          |  response content below its header
+---------------------------------------------------------------------+
```

### Drawn controls without `elements`

- Page navigation and Editor switch — no entry: shared shell controls are owned by the common chrome.
- Request tree rows and response-copy headers — no entry: repeated content or a view-local action without a facade entry.
- The native file chooser behind Multipart file browse — no entry: OS-owned controls.

## Requests and responses

Request bodies can be none, form-urlencoded, raw with a language selector, binary streamed from disk,
or multipart form-data. Header and form controls edit the selected request. Responses render according
to their type; binary and image responses include saving and inline preview. **Copy as...** exports a
request as cURL, fetch, or Node fetch.

## Agent API

After narrowing `page.editor.id` to `rest-client`, the facade exposes the request collection and
request/response state. Verified elements include `rest-tree-add`, `url-input`, `body-language`,
`body-type-select`, `headers-copy`, `request-body-splitter`, `request-copy-as`, multipart controls,
header/form controls, request controls, response controls, and `rest-send`.

## Errors and limits

Malformed REST JSON or an invalid request shape prevents useful loading. Network, authentication, and
server errors belong to the response state; `app.fetch` is the simpler route when no collection UI is
needed.
