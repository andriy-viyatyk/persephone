type ClipboardOperation = "install" | "read" | "write" | "reset";

const RECORDER_KEY = "__persephoneBrowserTestClipboard";

/** Build a self-contained expression that runs in the page's main world. */
export function pageClipboardRecorderSource(operation: ClipboardOperation, value?: string): string {
    return `(${pageClipboardRecorderOperation.toString()})(${JSON.stringify(operation)}, ${JSON.stringify(value)})`;
}

/** This function is serialized into the page, so it must not close over module state. */
function pageClipboardRecorderOperation(operation: ClipboardOperation, value?: string): string | null | void {
    const key = "__persephoneBrowserTestClipboard";
    type Recorder = { text: string | null; staged: string | null; installed: boolean; cleanup?: () => void };
    const host = window as Window & { [RECORDER_KEY]?: Recorder };
    let recorder = host[key];

    if (operation === "reset") {
        if (recorder) {
            recorder.cleanup?.();
            recorder.text = null;
            recorder.staged = null;
            recorder.installed = false;
            delete host[key];
        }
        return;
    }

    if (!recorder) {
        recorder = { text: null, staged: null, installed: false };
        Object.defineProperty(host, key, { configurable: true, enumerable: false, value: recorder });
    }

    if (operation === "write") {
        recorder.staged = value ?? "";
        return;
    }
    if (operation === "read") return recorder.text;
    if (recorder.installed) return;
    recorder.installed = true;

    // While installed, the page's clipboard is isolated from the operating system's: native copy,
    // cut and paste are cancelled and replayed against a private DataTransfer, so a test never
    // overwrites the user's clipboard and never reads it. A cancelled clipboard event with no data
    // leaves the OS clipboard untouched.
    const activeRecorder = recorder;
    const record = (text: string) => { activeRecorder.text = text; };
    /** One-shot staged text first, else the page's own last copy. */
    const takePasteText = (): string => {
        const staged = activeRecorder.staged;
        activeRecorder.staged = null;
        return staged ?? activeRecorder.text ?? "";
    };
    let alive = true;
    const isEditable = (target: EventTarget | null) => target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || (target instanceof HTMLElement && target.isContentEditable);

    const replayCopy = (type: "copy" | "cut", target: EventTarget) => {
        const selectionText = window.getSelection()?.toString() ?? "";
        const transfer = new DataTransfer();
        const replay = new ClipboardEvent(type, { bubbles: true, cancelable: true, clipboardData: transfer });
        const handled = !target.dispatchEvent(replay);
        if (handled) {
            record(transfer.getData("text/plain"));
            return;
        }
        record(selectionText);
        if (type === "cut" && selectionText && isEditable(target)) document.execCommand("delete");
    };
    const replayPaste = (target: EventTarget) => {
        const text = takePasteText();
        const transfer = new DataTransfer();
        transfer.setData("text/plain", text);
        const replay = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer });
        const handled = !target.dispatchEvent(replay);
        if (!handled && text && isEditable(target)) document.execCommand("insertText", false, text);
    };
    const interceptClipboardEvent = (event: ClipboardEvent) => {
        // Replays are untrusted, as is a page's own `new ClipboardEvent(...)`; neither touches the OS.
        if (!alive || !event.isTrusted) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const target = event.target ?? document;
        if (event.type === "paste") replayPaste(target);
        else replayCopy(event.type as "copy" | "cut", target);
    };
    // Keyboard paste is replayed from keydown so it reaches a focused element that is not editable,
    // where Chromium may fire no native paste event; cancelling the keydown also cancels that paste.
    const interceptPasteShortcut = (event: KeyboardEvent) => {
        if (!alive || !event.isTrusted) return;
        const pasteShortcut = (event.ctrlKey && event.key.toLowerCase() === "v")
            || (event.shiftKey && event.key === "Insert");
        if (!pasteShortcut) return;
        event.preventDefault();
        replayPaste(document.activeElement ?? document);
    };
    window.addEventListener("copy", interceptClipboardEvent, true);
    window.addEventListener("cut", interceptClipboardEvent, true);
    window.addEventListener("paste", interceptClipboardEvent, true);
    document.addEventListener("keydown", interceptPasteShortcut, true);

    const clipboard = navigator.clipboard;
    const clipboardDescriptors = new Map<string, PropertyDescriptor | undefined>();
    const clipboardWrappers = new Map<string, (...args: never[]) => unknown>();
    if (clipboard) {
        for (const method of ["read", "readText", "writeText", "write"]) clipboardDescriptors.set(method, Object.getOwnPropertyDescriptor(clipboard, method));
        try {
            // Isolated like the events above: reads never reach the OS clipboard, writes stay here.
            const wrappedReadText = () => Promise.resolve(takePasteText());
            const wrappedRead = () => Promise.resolve([new ClipboardItem({ "text/plain": new Blob([takePasteText()], { type: "text/plain" }) })]);
            const wrappedWriteText = (text: string) => { record(String(text)); return Promise.resolve(); };
            const wrappedWrite = async (items: ClipboardItems) => {
                for (const item of items) {
                    if (!item.types.includes("text/plain")) continue;
                    try { record(await (await item.getType("text/plain")).text()); }
                    catch { /* A write the page cannot read back is simply not recorded. */ }
                }
            };
            clipboardWrappers.set("read", wrappedRead);
            clipboardWrappers.set("readText", wrappedReadText);
            clipboardWrappers.set("writeText", wrappedWriteText);
            clipboardWrappers.set("write", wrappedWrite);
            Object.defineProperty(clipboard, "read", {
                configurable: true,
                value: wrappedRead,
            });
            Object.defineProperty(clipboard, "readText", {
                configurable: true,
                value: wrappedReadText,
            });
            Object.defineProperty(clipboard, "writeText", {
                configurable: true,
                value: wrappedWriteText,
            });
            Object.defineProperty(clipboard, "write", {
                configurable: true,
                value: wrappedWrite,
            });
        } catch { /* Some page contexts expose non-configurable clipboard methods. */ }
    }
    activeRecorder.cleanup = () => {
        alive = false;
        window.removeEventListener("copy", interceptClipboardEvent, true);
        window.removeEventListener("cut", interceptClipboardEvent, true);
        window.removeEventListener("paste", interceptClipboardEvent, true);
        document.removeEventListener("keydown", interceptPasteShortcut, true);
        if (!clipboard) return;
        for (const [method, wrapper] of clipboardWrappers) {
            try {
                if (clipboard[method as "read" | "readText" | "writeText" | "write"] !== wrapper) continue;
                const descriptor = clipboardDescriptors.get(method);
                if (descriptor) Object.defineProperty(clipboard, method, descriptor);
                else delete (clipboard as unknown as Record<string, unknown>)[method];
            } catch { /* Page changes to the clipboard object are left intact. */ }
        }
    };
}
