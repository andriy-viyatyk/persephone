import { RestClientModel } from "./rest-client-model.js";
import { renderRequestEditor } from "./views/request-editor.js";
import { renderResponseViewer } from "./views/response-viewer.js";
import { renderRequestTree } from "./views/request-tree.js";
import { createSplitter } from "./components/splitter.js";
import { createAiVisionModel, elements } from "./ai-vision-model.js";
import { t } from "./i18n.js";

const root = document.querySelector("#app");
const model = new RestClientModel(persephone);
const processedIntentIds = new Set();
let activeViews = [];
let disposed = false;

const disposeViews = () => {
    for (const view of activeViews) view.dispose?.();
    activeViews = [];
};

const send = async () => {
    try { await model.sendRequest(() => disposed); }
    catch (error) { persephone.notify(error?.message || t("errors.send"), "warning"); }
};

const render = () => {
    disposeViews();
    root.replaceChildren();
    if (model.error) {
        const error = document.createElement("section");
        error.className = "error";
        const title = document.createElement("h1");
        title.textContent = t("errors.collection.read");
        const details = document.createElement("pre");
        details.textContent = model.error;
        error.append(title, details);
        root.append(error);
        return;
    }

    if (persephone.view === "requests") {
        activeViews.push(renderRequestTree(model, root));
        return;
    }

    const board = document.createElement("div");
    board.className = "board";
    const detail = document.createElement("div");
    detail.className = "request-response-layout";
    const requestRoot = document.createElement("div");
    requestRoot.className = "request-pane-root";
    const responseRoot = document.createElement("div");
    responseRoot.className = "response-pane-root";
    const splitter = createSplitter({ name: "rest-detail-splitter", orientation: "horizontal", initial: 70 });
    detail.append(requestRoot, splitter.element, responseRoot);
    board.append(detail);
    root.append(board);
    splitter.refresh();
    const requestView = renderRequestEditor(model, requestRoot, {
        onSend: send,
        onCancel: () => model.cancelRequest(),
    });
    const responseView = renderResponseViewer(model, responseRoot);
    const toggle = () => splitter.toggle();
    requestRoot.querySelector(".pane-header")?.addEventListener("dblclick", toggle);
    responseRoot.querySelector(".pane-header")?.addEventListener("dblclick", toggle);
    activeViews.push(requestView, responseView, splitter);
};

model.subscribe(render);
window.addEventListener("pagehide", () => {
    disposed = true;
    model.cancelRequest();
    disposeViews();
    model.dispose();
}, { once: true });

await model.load({ initializeState: persephone.view === "main" });
if (persephone.view === "main") persephone.aiVision.expose(createAiVisionModel(model));
// Each frame answers `elements`/`highlight` for its own view from its own registry; only main exposes the model.
else persephone.aiVision.createElements(elements);

const handleIntent = async (intent) => {
    if (!intent || processedIntentIds.has(intent.requestId)) return;
    processedIntentIds.add(intent.requestId);
    try {
        await model.openRequestIntent(intent);
        intent.resolve();
    } catch (error) {
        intent.reject(error);
    }
};

const unsubscribeIntent = persephone.intent.onRequest((intent) => {
    void handleIntent(intent);
});
const initialIntent = persephone.intent.get();
if (initialIntent) void handleIntent(initialIntent);

window.addEventListener("pagehide", unsubscribeIntent, { once: true });
