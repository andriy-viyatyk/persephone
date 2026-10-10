import { t } from "./i18n.js";

function getEnabledHeaders(request) {
    return request.headers
        .filter(header => header.enabled && header.key.trim())
        .map(header => ({ key: header.key.trim(), value: header.value }));
}

function getBodyString(request) {
    if (request.bodyType === "none") return undefined;
    if (request.bodyType === "form-urlencoded") {
        const pairs = request.formData
            .filter(field => field.enabled && field.key.trim())
            .map(field => `${encodeURIComponent(field.key.trim())}=${encodeURIComponent(field.value)}`);
        return pairs.length > 0 ? pairs.join("&") : undefined;
    }
    return request.body || undefined;
}

export function serializeAsCurlBash(request) {
    const parts = ["curl"];
    const headers = getEnabledHeaders(request);
    const body = getBodyString(request);
    parts.push(`'${request.url.replace(/'/g, "'\\''")}'`);
    if (request.method !== "GET" || body) parts.push(`-X ${request.method}`);
    for (const header of headers) {
        const value = `${header.key}: ${header.value}`.replace(/'/g, "'\\''");
        parts.push(`-H '${value}'`);
    }
    if (body) parts.push(`--data-raw '${body.replace(/'/g, "'\\''")}'`);
    return parts.join(" \\\n  ");
}

export function serializeAsCurlCmd(request) {
    const parts = ["curl"];
    const headers = getEnabledHeaders(request);
    const body = getBodyString(request);
    parts.push(`"${request.url.replace(/"/g, '\\"')}"`);
    if (request.method !== "GET" || body) parts.push(`-X ${request.method}`);
    for (const header of headers) {
        const value = `${header.key}: ${header.value}`.replace(/"/g, '\\"');
        parts.push(`-H "${value}"`);
    }
    if (body) parts.push(`--data-raw "${body.replace(/"/g, '\\"')}"`);
    return parts.join(" ^\n  ");
}

export function serializeAsFetch(request) {
    return serializeFetch(request, false);
}

export function serializeAsFetchNodeJs(request) {
    return serializeFetch(request, true);
}

function serializeFetch(request, nodeJs) {
    const headers = getEnabledHeaders(request);
    const body = getBodyString(request);
    const options = [];
    if (request.method !== "GET") options.push(`  method: ${JSON.stringify(request.method)}`);
    if (headers.length > 0) {
        const entries = headers
            .map(header => `    ${JSON.stringify(header.key)}: ${JSON.stringify(header.value)}`)
            .join(",\n");
        options.push(`  headers: {\n${entries}\n  }`);
    }
    if (body) options.push(`  body: ${JSON.stringify(body)}`);
    const prefix = nodeJs ? "const res = await fetch" : "fetch";
    if (options.length === 0) return `${prefix}(${JSON.stringify(request.url)});`;
    return `${prefix}(${JSON.stringify(request.url)}, {\n${options.join(",\n")}\n});`;
}

const COPY_FORMATS = [
    ["request.copyAs.curlBash", serializeAsCurlBash],
    ["request.copyAs.curlCmd", serializeAsCurlCmd],
    ["request.copyAs.fetch", serializeAsFetch],
    ["request.copyAs.fetchNode", serializeAsFetchNodeJs],
];

export function createCopyMenu(model, anchor) {
    const menu = document.createElement("div");
    menu.className = "request-copy-menu";
    menu.setAttribute("role", "menu");
    for (const [label, serialize] of COPY_FORMATS) {
        const item = document.createElement("button");
        item.type = "button";
        item.textContent = t(label);
        item.setAttribute("role", "menuitem");
        item.addEventListener("click", async () => {
            try {
                const request = model.selectedRequest;
                if (request) await persephone.clipboard.writeText(serialize(request));
            } catch (error) {
                persephone.notify(error?.message || t("errors.copyRequest"), "error");
            }
            close();
        });
        menu.append(item);
    }
    const dismiss = event => { if (!menu.contains(event.target) && !anchor.contains(event.target)) close(); };
    const dismissKey = event => { if (event.key === "Escape") close(); };
    // Remove the listeners together with the menu, whoever removes it.
    const remove = menu.remove.bind(menu);
    function close() { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", dismissKey); remove(); }
    menu.remove = close;
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismissKey);
    document.body.append(menu);
    const bounds = anchor.getBoundingClientRect();
    const menuBounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(bounds.left, innerWidth - menuBounds.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(bounds.bottom, innerHeight - menuBounds.height - 4))}px`;
    return menu;
}
