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

## Requests and responses

Request bodies can be none, form-urlencoded, raw with a language selector, binary streamed from disk,
or multipart form-data. Header and form controls edit the selected request. Responses render according
to their type; binary and image responses include saving and inline preview. **Copy as...** exports a
request as cURL, fetch, or Node fetch.

## Agent API

After narrowing `page.editor.id` to `rest-client`, the facade exposes the request collection and
request/response state. Verified elements include `url-input`, `body-language`, `body-type-select`,
multipart controls, header/form controls, request controls, response controls, and `rest-send`.

## Errors and limits

Malformed REST JSON or an invalid request shape prevents useful loading. Network, authentication, and
server errors belong to the response state; `app.fetch` is the simpler route when no collection UI is
needed.
