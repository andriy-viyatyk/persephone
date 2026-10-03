// EPIC-120 (US-1604): an AiVision model for Outlook on the web, installed as a site extension.
// Copy this file to `<userData>/data/site-extensions/outlook/extension.js` beside manifest.json.
//
// Runs in the page's main world after the bundled runtime (`__persephoneSiteRuntime`). Everything
// is read live from the DOM through roles and attributes, never generated class names. Lists
// return headers only; a body comes only from an explicit read(id). Nothing sends, moves or
// deletes mail.

const runtime = window.__persephoneSiteRuntime;
const MAX_BODY = 20000;

const ownText = (el) => Array.from(el.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent)
    .join("")
    .replace(/\s+/g, " ")
    .trim();

const listbox = () => document.querySelector("[role=main] [role=listbox], [role=listbox]");
const rowElements = () => Array.from(document.querySelectorAll("[role=option][data-convid]"));
const rowById = (id) => rowElements().find((row) => row.getAttribute("data-convid") === String(id));

/** Header fields of one message row. The row's text spans, in order, are sender, subject, date
 *  (its title is the full timestamp) and preview; badges can add one more before the date. */
function readRow(row) {
    const spans = Array.from(row.querySelectorAll("span"))
        .filter((span) => ownText(span) && !span.closest("button, [role=checkbox], [role=note], i"));
    const sender = spans[0];
    const dateIndex = spans.findIndex((span, index) => index > 0 && span.title && !isNaN(Date.parse(span.title)));
    const date = dateIndex > 0 ? spans[dateIndex] : undefined;
    const subject = dateIndex > 1 ? spans[dateIndex - 1] : spans[1];
    const label = row.getAttribute("aria-label") || "";
    return {
        id: row.getAttribute("data-convid"),
        sender: sender ? ownText(sender) : "",
        senderEmail: sender && sender.title && sender.title.includes("@") ? sender.title : "",
        subject: subject ? ownText(subject) : "",
        date: date ? date.title : "",
        unread: /^unread\b/i.test(label),
        selected: row.getAttribute("aria-selected") === "true",
    };
}

function folderElements() {
    const seen = new Set();
    const result = [];
    for (const item of document.querySelectorAll("[role=treeitem][data-folder-name]")) {
        const name = item.getAttribute("data-folder-name");
        if (!name || seen.has(name)) continue;
        seen.add(name);
        result.push(item);
    }
    return result;
}

function currentFolder() {
    const selected = document.querySelector("[role=treeitem][data-folder-name][aria-selected=true]");
    return selected ? selected.getAttribute("data-folder-name") : "";
}

function totalInFolder() {
    const first = document.querySelector("[role=option][data-convid][aria-setsize]:not([aria-setsize='0'])");
    const size = first ? Number(first.getAttribute("aria-setsize")) : NaN;
    return Number.isFinite(size) ? size : undefined;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, timeoutMs) {
    const started = Date.now();
    for (;;) {
        const value = check();
        if (value) return value;
        if (Date.now() - started > timeoutMs) return undefined;
        await delay(100);
    }
}

function requireRow(id) {
    const row = rowById(id);
    if (!row) {
        throw new Error(`No message ${JSON.stringify(id)} in the visible list. The list is virtualized: `
            + "use scrollMessages(\"down\") or search(text) to bring it into view, then read messages again.");
    }
    return row;
}

async function openMessage(id) {
    const row = requireRow(id);
    row.scrollIntoView({ block: "nearest" });
    row.click();
    await waitFor(() => rowById(id)?.getAttribute("aria-selected") === "true", 5000);
    return readRow(rowById(id) || row);
}

/** The open message's body text. The reading pane holds one or more message bodies; the
 *  last expanded one belongs to the selected conversation's newest message. */
function readingPaneBody() {
    const bodies = Array.from(document.querySelectorAll("[aria-label='Message body'], [role=document]"))
        .filter((element) => !element.isContentEditable);
    const body = bodies.at(-1);
    return body ? body.innerText.replace(/\n{3,}/g, "\n\n").trim() : undefined;
}

async function readMessage(id) {
    const before = readingPaneBody();
    const header = await openMessage(id);
    const body = await waitFor(() => {
        const text = readingPaneBody();
        return text !== undefined && text !== before ? text : undefined;
    }, 8000) ?? readingPaneBody() ?? "";
    return {
        ...header,
        body: body.length > MAX_BODY ? body.slice(0, MAX_BODY) + "\n[truncated]" : body,
    };
}

function setInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

function pressEnter(input) {
    for (const type of ["keydown", "keypress", "keyup"]) {
        input.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    }
}

async function search(text) {
    const input = document.querySelector("[role=search] input, input[role=combobox]");
    if (!input) throw new Error("The search box is not on screen.");
    input.focus();
    input.click();
    await delay(150);
    const before = rowElements().map((row) => row.getAttribute("data-convid")).join();
    setInputValue(input, String(text));
    await delay(150);
    pressEnter(input);
    // Outlook swaps the list in place: wait for a different, non-empty set of rows, then let
    // it settle. An empty result keeps the old rows only until the timeout.
    await waitFor(() => {
        const rows = rowElements();
        return rows.length > 0 && rows.map((row) => row.getAttribute("data-convid")).join() !== before;
    }, 10000);
    await delay(400);
    return { visible: rowElements().length, total: totalInFolder() };
}

/** The list's scroll container: inside the listbox in Outlook's current layout, above it in older
 *  ones. Undefined while everything fits. */
function listScroller() {
    const list = listbox();
    if (!list) return undefined;
    const scrolls = (element) => element.scrollHeight > element.clientHeight + 2
        && /auto|scroll/.test(getComputedStyle(element).overflowY);
    let scroller = [list, ...list.querySelectorAll("div")].find(scrolls);
    for (let element = list.parentElement; !scroller && element && element !== document.body; element = element.parentElement) {
        if (scrolls(element)) scroller = element;
    }
    return scroller;
}

function scrollMessages(direction) {
    if (!listbox()) throw new Error("The message list is not on screen.");
    const scroller = listScroller();
    if (!scroller) throw new Error("The message list does not scroll.");
    const page = scroller.clientHeight * 0.9;
    const top = direction === "top" ? 0 : scroller.scrollTop + (direction === "up" ? -page : page);
    scroller.scrollTop = top;
    return delay(400).then(() => ({ visible: rowElements().length, atTop: scroller.scrollTop === 0,
        atBottom: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2 }));
}

async function openFolder(name) {
    const item = folderElements().find((element) => element.getAttribute("data-folder-name") === String(name).toLowerCase());
    if (!item) throw new Error(`No folder "${name}". Read folders for the names.`);
    item.click();
    await waitFor(() => currentFolder() === item.getAttribute("data-folder-name"), 5000);
    await delay(500);
    return { folder: currentFolder(), visible: rowElements().length };
}

// ── Model ────────────────────────────────────────────────────────────

const MESSAGE_MEMBERS = [
    { name: "id", kind: "property", summary: "Conversation id; pass it to open, read." },
    { name: "sender", kind: "property", summary: "Sender display name." },
    { name: "senderEmail", kind: "property", summary: "Sender address, when the row shows one." },
    { name: "subject", kind: "property", summary: "Subject line." },
    { name: "date", kind: "property", summary: "Received time as Outlook shows it." },
    { name: "unread", kind: "property", summary: "True while the message is unread." },
    { name: "read", kind: "method", signature: "read()", summary: "Open this message and return its headers and body text.", caution: "Opening marks the message read." },
];

function messageNode(row) {
    const header = readRow(row);
    return {
        ...header,
        read: () => readMessage(header.id),
        aiVision: {
            kind: "OutlookMessage",
            summary: "One message row: headers only. Call read() for the body.",
            members: MESSAGE_MEMBERS,
            summarize: () => readRow(rowById(header.id) || row),
        },
    };
}

const messagesNode = {
    aiVision: {
        kind: "OutlookMessages",
        summary: "Message rows currently rendered in the list (virtualized: a window, not the whole folder).",
        help: "Outlook renders only the rows near the scroll position. Index by position (messages[0]) "
            + "or by id (messages[\"<id>\"]). total is the folder size when Outlook reports it. Use "
            + "scrollMessages(\"down\") to move the window, or search(text) to narrow the list.",
        members: [],
        index: (key) => {
            const rows = rowElements();
            const row = typeof key === "number" ? rows[key] : rowById(key);
            return row ? messageNode(row) : undefined;
        },
        summarize: () => ({
            kind: "OutlookMessages",
            folder: currentFolder(),
            visible: rowElements().length,
            total: totalInFolder(),
            items: rowElements().map(readRow),
        }),
    },
};

const foldersNode = {
    aiVision: {
        kind: "OutlookFolders",
        summary: "Mail folders in the navigation tree, by name.",
        members: [],
        index: (key) => {
            const items = folderElements();
            const item = typeof key === "number"
                ? items[key]
                : items.find((element) => element.getAttribute("data-folder-name") === String(key).toLowerCase());
            if (!item) return undefined;
            const name = item.getAttribute("data-folder-name");
            return {
                name,
                open: () => openFolder(name),
                aiVision: {
                    kind: "OutlookFolder",
                    summary: "One mail folder.",
                    members: [
                        { name: "name", kind: "property", summary: "Folder name (lower case, as Outlook keys it)." },
                        { name: "open", kind: "method", signature: "open()", summary: "Show this folder in the message list." },
                    ],
                    summarize: () => ({ name, current: currentFolder() === name }),
                },
            };
        },
        summarize: () => ({
            kind: "OutlookFolders",
            current: currentFolder(),
            names: folderElements().map((element) => element.getAttribute("data-folder-name")),
        }),
    },
};

const root = {
    get folder() { return currentFolder(); },
    get folders() { return foldersNode; },
    get messages() { return messagesNode; },
    open: openMessage,
    read: readMessage,
    search,
    scrollMessages,
    openFolder,
    aiVision: {
        kind: "OutlookApp",
        summary: "Outlook on the web: folders, the visible message list, read, search.",
        overview: "Read messages for the visible list (headers only).\nread(id) returns one body.\n"
            + "openFolder(name) or search(text) changes the list; scrollMessages pages through it.",
        help: "A site extension model over the signed-in Outlook page. messages is what Outlook has "
            + "rendered right now, so after openFolder, search or scrollMessages read messages again. "
            + "Ids are conversation ids from messages[n].id. Nothing here sends, moves or deletes mail.",
        members: [
            { name: "folder", kind: "property", summary: "The folder shown in the message list." },
            { name: "folders", kind: "property", node: true, indexable: true, summary: "Mail folders by name." },
            { name: "messages", kind: "property", node: true, indexable: true, summary: "Visible message rows, headers only." },
            { name: "open", kind: "method", signature: "open(id: string)", summary: "Select a message so the reading pane shows it; returns its headers.", caution: "Opening marks the message read." },
            { name: "read", kind: "method", signature: "read(id: string)", summary: "Open a message and return its headers and body text.", caution: "Opening marks the message read." },
            { name: "search", kind: "method", signature: "search(text: string)", summary: "Run Outlook's mailbox search; messages then holds the results." },
            { name: "scrollMessages", kind: "method", signature: "scrollMessages(direction: \"down\" | \"up\" | \"top\")", summary: "Scroll the virtualized list by a page; returns how many rows are rendered." },
            { name: "openFolder", kind: "method", signature: "openFolder(name: string)", summary: "Show a folder by name (see folders)." },
        ],
        summarize: () => ({
            kind: "OutlookApp",
            folder: currentFolder(),
            visible: rowElements().length,
            total: totalInFolder(),
        }),
    },
};

const remote = runtime.expose(root);

// expose() derives the indexed item shapes once, so refresh when the list goes between empty
// and non-empty (Outlook renders it long after the document loads).
// New mail is reported without its content: with the list scrolled to the top, a never-seen
// unread row first on screen while the previous top row is still listed below it. (Outlook sets
// aria-posinset only on the focused row, so position comes from layout.) Scrolling back to the top (a seen row) and a search
// (the old top row disappears) do not match.
let shapeKey = "";
let topId = "";
let topFolder = "";
const seenIds = new Set();
let pending = 0;
const check = () => {
    pending = 0;
    const rows = rowElements();
    const folder = currentFolder();
    const nextKey = [rows.length > 0, folderElements().length > 0].join("|");
    if (nextKey !== shapeKey) {
        shapeKey = nextKey;
        remote.refresh();
    }
    if (folder !== topFolder) {
        seenIds.clear();
        topId = "";
        topFolder = folder;
    }
    const scroller = listScroller();
    const atTop = !scroller || scroller.scrollTop < 5;
    const top = atTop
        ? rows.slice().sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0]
        : undefined;
    const ids = rows.map((row) => row.getAttribute("data-convid"));
    if (top) {
        const id = top.getAttribute("data-convid");
        if (topId && id !== topId && !seenIds.has(id) && ids.includes(topId) && readRow(top).unread) {
            remote.notify(`New unread message at the top of ${folder}.`);
        }
        topId = id;
    }
    ids.forEach((id) => seenIds.add(id));
};
new MutationObserver(() => {
    if (!pending) pending = setTimeout(check, 400);
}).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-selected"] });
check();
