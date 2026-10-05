---
title: "REST Client Board"
audience: both
summary: "Open REST collections, send HTTP requests, inspect responses, and use the board model through AiVision."
editorId: "board"
---

# REST Client Board

The bundled REST Client board edits .rest.json collections and JSON content with the root shape { type: "rest-client", requests: [...] }. It is bundled with Persephone and does not require a trust prompt.

## Opening a collection

Open a .rest.json file or JSON content detected with type "rest-client" and a requests array. Use the REST Client standalone new-page entry for a scratch collection. The http.request.open capability routes an HTTP request from supported Persephone surfaces into a board page.

The guide is listed in the About page and in MCP `guides` as `installed-boards/rest-client/index`. Press F1 on a REST Client page to open it.

## Layout

The Requests secondary view contains the request tree and collection actions. In the main view, the selected request pane is above the response pane. Within the request pane, Headers is above Body. The request-body splitter resizes Headers and Body; the horizontal detail splitter resizes the request pane above the response pane.

Segmented controls are div[role=radiogroup] groups. Click a matching data-value button, for example [data-name="body-type-select"] [data-value="raw"]; do not use native select() on them. method-label, body-language, and response-language are native selects. The two language controls are inside label.language-picker. Icon buttons expose their tooltip text in title. Conditional and repeated controls appear only when their view and row are present; repeated matches do not identify a row index.

### Named controls

| Control | Purpose |
|---|---|
| method-label, url-input, rest-send | Choose a method, edit the selected URL, and send the request. Send awaits the real network request. |
| request-header-collection, request-header-name, request-copy-as, request-delete | Edit request metadata, copy as code, or delete the selected request. |
| headers-view, headers-copy, kv-row-key, kv-row-value, kv-row-delete | Change header presentation, copy headers, edit keys, locate values, or delete repeated rows. |
| request-body-splitter, body-type-select, body-language | Resize Headers/Body, choose none/raw/form-urlencoded/binary/form-data, and choose a raw language. |
| form-data-key, form-data-type-toggle, form-data-value, form-data-browse, form-data-delete | Edit multipart names, switch text/file rows, locate text values, browse for files, and delete rows. |
| rest-detail-splitter | Resize the request pane above the response pane. |
| response-tab-select, response-headers-view, response-copy-headers, response-language, response-open-in-tab | Switch response views, copy response headers, set a view-local language override, or open a text response in a tab. |
| rest-client-tree, rest-tree-add, request-tree-collection, request-tree-item | View/manage the request tree, add a request, expand a collection, or select/open request actions. |
| request-tree-duplicate, request-tree-delete, collection-tree-add, collection-tree-delete | Duplicate/delete a request or add/delete requests in a collection through tree context menus. |
| confirm-dialog-main, confirm-cancel-main, confirm-ok-main | Main-frame request deletion confirmation. |
| confirm-dialog-requests, confirm-cancel-requests, confirm-ok-requests | Requests-frame request or collection deletion confirmation. |

Binary Save to File, Open in Image Viewer, CodeMirror body content, and OS file pickers are unnamed. Open in Image Viewer opens the image data URL directly in a blob-URL Image Viewer page titled Image. Only Save to File asks for a path.

## Requests and responses

A collection root is { type: "rest-client", requests: [...] }. Each request needs a unique id and may have name, collection, method, url, headers, body, bodyType, bodyLanguage, formData, binaryFilePath, and formDataEntries. Collections group requests in the tree. Body types are none, raw, form-urlencoded, binary, and form-data; raw languages are plaintext, json, javascript, html, xml.

The response pane shows body or headers and supports local response-language overrides. HTTP error statuses are ordinary responses. Transport and body-read failures resolve as status 0 responses. Binary response cache entries are session-only. Persisted text response cache data is capped at 9 MiB. Request upload bodies are capped at 32 MiB; the bridge has no file-size query, so file data is allocated by readFile before the cap can be checked.

## Agent model

Select a board page where pages[i].editor.id begins with board-editor:, then use the board model at pages[i].editor.app. The model's id property is the "rest-client" kind marker; the page editor id remains board-editor:<root>.

The model returns fresh copied request, header, form, and response snapshots. Requests and selected request fields include the complete collection data, including credentials. send() sends the selected request's real headers and body to the real service and awaits completion. Request-targeted methods validate ids and report unknown requests. Header keys and enabled flags can be changed, but there are no setters for header values, bodies, or form values, so secrets are not copied into method arguments or MCP history. duplicateRequest(id) duplicates a request and copyAs(format) returns cURL bash, cURL cmd, fetch, or Node fetch source without changing clipboard state.

Response state and view-owned actions are read through the model or operated through the visible controls. Element discovery is available through the page editor's AiVision surface; repeated selectors may match several rows and do not carry an index.

## Errors and limits

Malformed collection JSON is reported in the board. Open in New Editor is not available for board request rows because the bridge cannot create another page of the same board. The board-local request tree does not accept native Persephone link or trait drops. Use the available request tree and supported capability routes for these operations.
