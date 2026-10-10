import { t } from "../i18n.js";

export function createSplitter({ name, orientation = "horizontal", initial = 50 }) {
    const element = document.createElement("div");
    element.className = `splitter splitter-${orientation}`;
    element.dataset.name = name;
    element.tabIndex = 0;
    element.setAttribute("role", "separator");
    element.setAttribute("aria-orientation", orientation);
    element.setAttribute("aria-label", t(name === "request-body-splitter" ? "accessibility.resizeHeadersBody" : "accessibility.resizeRequestResponse"));
    let ratio = initial;
    const apply = () => {
        if (!element.parentElement) return;
        const property = orientation === "horizontal" ? "gridTemplateRows" : "gridTemplateColumns";
        const dimension = orientation === "horizontal" ? element.parentElement.clientHeight : element.parentElement.clientWidth;
        if (dimension) {
            const percent = Math.max(10, Math.min(90, ratio));
            element.parentElement.style[property] = orientation === "horizontal"
                ? `minmax(80px, ${percent}fr) 6px minmax(80px, ${100 - percent}fr)`
                : `minmax(220px, ${percent}fr) 6px minmax(240px, ${100 - percent}fr)`;
        }
        element.setAttribute("aria-valuenow", String(Math.round(ratio)));
    };
    const resize = event => {
        const rect = element.parentElement.getBoundingClientRect();
        const position = orientation === "horizontal" ? event.clientY - rect.top : event.clientX - rect.left;
        const length = orientation === "horizontal" ? rect.height : rect.width;
        ratio = Math.max(10, Math.min(90, position / length * 100)); apply();
    };
    let stopDrag;
    const start = event => {
        event.preventDefault();
        const move = next => resize(next);
        stopDrag = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stopDrag); stopDrag = undefined; };
        window.addEventListener("pointermove", move); window.addEventListener("pointerup", stopDrag, { once: true });
    };
    const keydown = event => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault(); ratio += ["ArrowRight", "ArrowDown"].includes(event.key) ? 2 : -2; apply();
    };
    element.addEventListener("pointerdown", start); element.addEventListener("keydown", keydown);
    const observer = new ResizeObserver(apply);
    const refresh = () => { if (element.parentElement) observer.observe(element.parentElement); apply(); };
    return { element, refresh, toggle() { ratio = ratio < 50 ? 70 : 30; apply(); }, dispose() { stopDrag?.(); observer.disconnect(); element.removeEventListener("pointerdown", start); element.removeEventListener("keydown", keydown); } };
}
