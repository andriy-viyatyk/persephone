/** Create a span host whose children participate directly in the parent layout. */
export function createContentsElement(part?: string): HTMLSpanElement {
    const element = document.createElement("span");
    element.style.display = "contents";
    if (part !== undefined) element.dataset.part = part;
    return element;
}
