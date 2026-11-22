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

    const activeRecorder = recorder;
    const record = (text: string) => { activeRecorder.text = text; };
    let activeClipboardEvent: ClipboardEvent | null = null;
    let eventText: string | null = null;
    let alive = true;
    const dataTransferPrototype = DataTransfer.prototype;
    const setDataDescriptor = Object.getOwnPropertyDescriptor(dataTransferPrototype, "setData");
    const originalSetData = dataTransferPrototype.setData;
    const wrappedSetData = function(format: string, data: string): void {
        if (activeClipboardEvent && format.toLowerCase() === "text/plain") eventText = data;
        return originalSetData.call(this, format, data);
    };
    dataTransferPrototype.setData = wrappedSetData;

    const observeCopy = (event: ClipboardEvent) => {
        activeClipboardEvent = event;
        eventText = null;
        const selectionText = window.getSelection()?.toString() ?? "";
        queueMicrotask(() => {
            if (!alive) return;
            let clipboardText: string | null = eventText;
            const handlerSetText = eventText !== null;
            if (clipboardText === null) {
                try { clipboardText = event.clipboardData?.getData("text/plain") ?? null; }
                catch { clipboardText = null; }
            }
            record(handlerSetText ? clipboardText ?? "" : clipboardText || selectionText);
            activeClipboardEvent = null;
            eventText = null;
        });
    };
    const observeKeydown = (event: KeyboardEvent) => {
        if (!alive || !event.isTrusted || activeRecorder.staged === null) return;
        const pasteShortcut = (event.ctrlKey && event.key.toLowerCase() === "v")
            || (event.shiftKey && event.key === "Insert");
        if (!pasteShortcut) return;
        const text = activeRecorder.staged;
        activeRecorder.staged = null;
        event.preventDefault();
        const transfer = new DataTransfer();
        transfer.setData("text/plain", text);
        const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer });
        const target = document.activeElement ?? document;
        const handled = !target.dispatchEvent(paste);
        if (handled) return;
        const editable = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
            || (target instanceof HTMLElement && target.isContentEditable);
        if (editable) document.execCommand("insertText", false, text);
    };
    window.addEventListener("copy", observeCopy, true);
    window.addEventListener("cut", observeCopy, true);
    document.addEventListener("keydown", observeKeydown, true);

    const clipboard = navigator.clipboard;
    const clipboardDescriptors = new Map<string, PropertyDescriptor | undefined>();
    const clipboardWrappers = new Map<string, (...args: never[]) => unknown>();
    if (clipboard) {
        for (const method of ["readText", "writeText", "write"]) clipboardDescriptors.set(method, Object.getOwnPropertyDescriptor(clipboard, method));
        const originalReadText = clipboard.readText.bind(clipboard);
        const originalWriteText = clipboard.writeText.bind(clipboard);
        const originalWrite = clipboard.write.bind(clipboard);
        try {
            const wrappedReadText = () => {
                if (activeRecorder.staged !== null) {
                    const staged = activeRecorder.staged;
                    activeRecorder.staged = null;
                    return Promise.resolve(staged);
                }
                return originalReadText();
            };
            const wrappedWriteText = (text: string) => originalWriteText(text).then(() => { record(text); });
            const wrappedWrite = (items: ClipboardItems) => originalWrite(items).then(async () => {
                for (const item of items) {
                    if (!item.types.includes("text/plain")) continue;
                    try { record(await (await item.getType("text/plain")).text()); }
                    catch { /* A successful native write remains successful if observation fails. */ }
                }
            });
            clipboardWrappers.set("readText", wrappedReadText);
            clipboardWrappers.set("writeText", wrappedWriteText);
            clipboardWrappers.set("write", wrappedWrite);
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
        window.removeEventListener("copy", observeCopy, true);
        window.removeEventListener("cut", observeCopy, true);
        document.removeEventListener("keydown", observeKeydown, true);
        try {
            if (dataTransferPrototype.setData === wrappedSetData && setDataDescriptor) Object.defineProperty(dataTransferPrototype, "setData", setDataDescriptor);
        } catch { /* Page changes to the prototype are left intact. */ }
        if (!clipboard) return;
        for (const [method, wrapper] of clipboardWrappers) {
            try {
                if (clipboard[method as "readText" | "writeText" | "write"] !== wrapper) continue;
                const descriptor = clipboardDescriptors.get(method);
                if (descriptor) Object.defineProperty(clipboard, method, descriptor);
                else delete (clipboard as unknown as Record<string, unknown>)[method];
            } catch { /* Page changes to the clipboard object are left intact. */ }
        }
    };
}
