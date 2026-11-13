import { clipboard, ClipboardItem } from "electron";

export async function writeClipboardText(text: string): Promise<void> {
    await clipboard.writeText(text);
}

export async function writeClipboardPng(bytes: Uint8Array): Promise<void> {
    await clipboard.write([new ClipboardItem({ "image/png": new Blob([new Uint8Array(bytes)], { type: "image/png" }) })]);
}
