import { createIconElement } from "../../uikit/shared/slots";

export function createSystemButton(
    name: string,
    icon: SVGElement,
    title: string,
    registerClick: (button: HTMLButtonElement, listener: () => void) => void,
    onClick: () => void,
): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.name = name;
    button.className = `system-button darkBackground${name === "window-close" ? " close-button" : ""}`;
    button.title = title;
    button.append(icon);
    registerClick(button, onClick);
    return button;
}

export function createWindowToggleButton(
    registerClick: (button: HTMLButtonElement, listener: () => void) => void,
    onClick: () => void,
): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = "system-button darkBackground";
    button.type = "button";
    button.dataset.name = "window-toggle";
    registerClick(button, onClick);
    return button;
}

export function updateWindowToggle(
    button: HTMLButtonElement,
    isMaximized: boolean,
    restoreTitle: string,
    maximizeTitle: string,
): void {
    button.replaceChildren(createIconElement(isMaximized ? "window-restore" : "window-maximize"));
    button.title = isMaximized ? restoreTitle : maximizeTitle;
}
