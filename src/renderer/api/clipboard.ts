import { api } from "../../ipc/renderer/api";

/**
 * Copy text to the OS clipboard through Electron's native clipboard.
 *
 * Deliberately NOT `navigator.clipboard.writeText`. Chromium stamps every
 * Web-API clipboard write with the registered `CanIncludeInClipboardHistory`
 * format set to 0 — "do not put this in clipboard history" — which Windows
 * clipboard-history tools honour. Persephone's own tracker no
 * longer drops those, because the watcher exempts copies our own process owns
 *, but every other history tool on the machine still does.
 * Electron's native write sets no such format and,
 * unlike the Web API, does not require document focus, which removes a class of
 * "Document is not focused" copy failures.
 */
export function toClipboard(text: string): void {
    void api.clipboardWriteText(text).catch((error: unknown) => console.error("Failed to copy text:", error));
}
