---
title: "Complete generic site extension example"
audience: agent
summary: "Build a bounded page model with stable ids, explicit content reads, refresh, and cleanup."
---
## Complete generic example

Adapt the role, id, label, body selectors, and action to the site's actual structure. This example
assumes list items have stable `data-item-id` and `data-label` attributes and contain a
`[data-item-body]` element. The collection returns ids and labels only; body text is read only when
`read(id)` is called.

```js
const runtime = window.__persephoneSiteRuntime;
const MAX_ITEMS = 100;
const MAX_ID_LENGTH = 200;
const MAX_LABEL_LENGTH = 200;
const MAX_BODY_LENGTH = 8000;

function listElement() {
    return document.querySelector('[role="list"]');
}

function matchingItems() {
    const list = listElement();
    if (!list) return [];
    return Array.from(list.querySelectorAll('[role="listitem"][data-item-id][data-label]'))
        .filter(item => {
            const id = item.getAttribute("data-item-id") || "";
            return id.length > 0 && id.length <= MAX_ID_LENGTH;
        })
        .slice(0, MAX_ITEMS);
}

function describeItems() {
    return matchingItems().map(item => ({
        id: item.getAttribute("data-item-id"),
        label: (item.getAttribute("data-label") || "").slice(0, MAX_LABEL_LENGTH),
    }));
}

// The item shape is probed from the first item once, so only "empty or not" changes the shape.
// Item values are read live on every request and need no refresh().
function collectionShape() {
    return matchingItems().length > 0;
}

function findItem(id) {
    return matchingItems().find(item => item.getAttribute("data-item-id") === id);
}

const root = {
    get items() {
        return describeItems();
    },
    read(id) {
        const item = findItem(id);
        if (!item) throw new Error("No visible list item has that id.");
        const body = item.querySelector("[data-item-body]");
        return {
            id,
            body: (body ? body.textContent || "" : "").slice(0, MAX_BODY_LENGTH),
        };
    },
    activate(id) {
        const item = findItem(id);
        if (!item) throw new Error("No visible list item has that id.");
        item.click();
        return { activated: id };
    },
    aiVision: {
        kind: "SiteList",
        summary: "A bounded model of the visible items in the current list.",
        help: "items contains visible ids and labels only. Call read(id) only when the user asks for an item's body. activate(id) clicks the matching visible item.",
        members: [
            { name: "items", kind: "property", summary: "Visible item ids and header labels; at most 100." },
            { name: "read", kind: "method", signature: "read(id: string)", summary: "Read the body for one visible item by stable id." },
            { name: "activate", kind: "method", signature: "activate(id: string)", summary: "Click one visible item by stable id.", caution: "Acts on the page and may change its current view." },
        ],
    },
};

const remote = runtime.expose(root);
let lastShape = collectionShape();
const observer = new MutationObserver(() => {
    const nextShape = collectionShape();
    if (nextShape === lastShape) return;
    lastShape = nextShape;
    remote.refresh();
});
if (document.body) {
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-item-id", "data-label"],
    });
}
runtime.onDispose(() => observer.disconnect());
remote.refresh();
```

MCP may suggest this guide after repeated automation of a site. This is optional and non-blocking: finish the current task, ask whether the work recurs, and offer an extension if appropriate. Agent tips can be disabled in Settings → MCP Server / Mneme.
