import { confirmDialog } from "../components/confirm.js";
import { createIcon, createIconButton } from "../components/icons.js";

const EMPTY_LABEL = "(empty)";

function createButton(label, name, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.name = name;
    button.addEventListener("click", action);
    return button;
}

export function renderRequestTree(model, root) {
    const section = document.createElement("section");
    section.className = "requests-view";
    section.dataset.name = "rest-client-tree";
    const header = document.createElement("header");
    header.className = "tree-header";
    const title = document.createElement("span");
    title.className = "section-title";
    title.textContent = "Requests";
    const add = createIconButton({ icon: "plus", name: "rest-tree-add", title: "Add request", onClick: () => model.addRequest() });
    header.append(title, add);
    const groupsRoot = document.createElement("div");
    groupsRoot.className = "request-groups";
    section.append(header, groupsRoot);
    root.replaceChildren(section);

    let menu;
    let disposed = false;
    const closeMenu = () => { menu?.remove(); menu = undefined; };
    const dismiss = event => { if (menu && !menu.contains(event.target)) closeMenu(); };
    const dismissKey = event => { if (event.key === "Escape") closeMenu(); };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismissKey);

    const showMenu = (event, actions) => {
        event.preventDefault();
        closeMenu();
        menu = document.createElement("div");
        menu.className = "request-context-menu";
        menu.setAttribute("role", "menu");
        for (const [label, name, action, separator = false] of actions) {
            if (separator) menu.append(document.createElement("hr"));
            const item = createButton(label, name, () => { closeMenu(); action(); });
            item.setAttribute("role", "menuitem");
            menu.append(item);
        }
        document.body.append(menu);
        const bounds = menu.getBoundingClientRect();
        menu.style.left = `${Math.max(4, Math.min(event.clientX, innerWidth - bounds.width - 4))}px`;
        menu.style.top = `${Math.max(4, Math.min(event.clientY, innerHeight - bounds.height - 4))}px`;
    };

    const groups = new Map();
    for (const request of model.data.requests) {
        const key = request.collection || "";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(request);
    }

    for (const [collection, requests] of groups) {
        const group = document.createElement("section");
        group.className = "request-collection";
        const groupHeader = document.createElement("button");
        groupHeader.type = "button";
        groupHeader.className = "collection-row";
        groupHeader.dataset.name = "request-tree-collection";
        groupHeader.dataset.collectionId = `__col__${collection}`;
        groupHeader.setAttribute("aria-expanded", "true");
        const disclosure = document.createElement("span");
        disclosure.className = "collection-disclosure";
        disclosure.append(createIcon("chevron-down"));
        const label = document.createElement("span");
        label.className = collection ? "collection-label" : "collection-label collection-empty";
        label.textContent = collection || EMPTY_LABEL;
        groupHeader.append(disclosure, label);
        const rows = document.createElement("div");
        rows.className = "collection-requests";
        groupHeader.addEventListener("click", () => {
            const expanded = groupHeader.getAttribute("aria-expanded") === "true";
            groupHeader.setAttribute("aria-expanded", String(!expanded));
            rows.hidden = expanded;
        });
        groupHeader.addEventListener("contextmenu", event => showMenu(event, [
            ["Add Request", "collection-tree-add", () => model.addRequest(undefined, collection)],
            ["Delete Collection", "collection-tree-delete", () => {
                const label = collection || EMPTY_LABEL;
                void confirmDialog(`Delete all requests in "${label}"?`, { view: "requests" }).then((ok) => { if (ok) model.deleteCollection(collection); });
            }, true],
        ]));
        groupHeader.addEventListener("dragover", event => {
            if (event.dataTransfer?.types.includes("text/plain")) event.preventDefault();
        });
        groupHeader.addEventListener("drop", event => {
            const fromId = event.dataTransfer?.getData("text/plain");
            if (!fromId) return;
            event.preventDefault();
            model.moveRequest(fromId, `__col__${collection}`, collection);
        });

        for (const request of requests) {
            const row = document.createElement("button");
            row.type = "button";
            row.className = "request-tree-item";
            row.dataset.name = "request-tree-item";
            row.dataset.requestId = request.id;
            row.draggable = true;
            row.setAttribute("aria-current", String(request.id === model.selectedRequestId));
            const method = document.createElement("span");
            method.className = "request-method";
            method.dataset.method = request.method;
            method.textContent = request.method;
            const name = document.createElement("span");
            name.className = "request-name";
            name.textContent = request.name || EMPTY_LABEL;
            row.append(method, name);
            row.addEventListener("click", () => model.selectRequest(request.id));
            row.addEventListener("contextmenu", event => {
                showMenu(event, [
                    ["Duplicate", "request-tree-duplicate", () => model.duplicateRequest(request.id)],
                    ["Delete", "request-tree-delete", () => {
                        void confirmDialog(`Delete "${request.name || EMPTY_LABEL}"?`, { view: "requests" }).then((ok) => { if (ok) model.deleteRequest(request.id); });
                    }, true],
                ]);
            });
            row.addEventListener("dragstart", event => {
                event.dataTransfer?.setData("text/plain", request.id);
                if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
            });
            row.addEventListener("dragover", event => {
                if (event.dataTransfer?.types.includes("text/plain")) event.preventDefault();
            });
            row.addEventListener("drop", event => {
                const fromId = event.dataTransfer?.getData("text/plain");
                if (!fromId || fromId === request.id) return;
                event.preventDefault();
                model.moveRequest(fromId, request.id, request.collection);
            });
            rows.append(row);
        }
        group.append(groupHeader, rows);
        groupsRoot.append(group);
    }

    return {
        dispose() {
            if (disposed) return;
            disposed = true;
            closeMenu();
            document.removeEventListener("pointerdown", dismiss);
            document.removeEventListener("keydown", dismissKey);
            section.remove();
        },
    };
}
