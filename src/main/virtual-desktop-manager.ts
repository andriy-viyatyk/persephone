import type { BrowserWindow } from "electron";
import { errMessage } from "../shared/utils";

const DESKTOP_KEY = "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VirtualDesktops";
const CLSID = "aa509086-5ca9-4c25-8f95-589d3c07b48a";
const IID = "a5cd92ff-29be-454c-8d04-d82879fb3f1b";
const ERROR_MORE_DATA = 234;
const REG_BINARY = 3;
const REG_SZ = 1;
/** HKEY_CURRENT_USER is the sign-extended handle value 0x80000001, passed as `intptr_t`. */
const HKEY_CURRENT_USER = -2147483647n;
/** RegGetValueW requires a type-restriction flag; the value types are checked after reading. */
const RRF_RT_ANY = 0x0000ffff;
/** CLSCTX_ALL, as used by the US-2184 prototype. */
const CLSCTX_ALL = 0x17;
/** TYPE_E_ELEMENTNOTFOUND as a signed HRESULT: the window has no desktop assigned yet. */
const TYPE_E_ELEMENTNOTFOUND = 0x8002802b | 0;

export interface VirtualDesktopEntry {
    id: string;
    number: number;
    name?: string;
}

export interface ResolvedVirtualDesktop {
    id: string;
    selector: string;
    desktops: VirtualDesktopEntry[];
}

type KoffiRuntime = typeof import("koffi");

function parseGuid(value: string): Uint8Array {
    const match = /^(?:\{([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\}|([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12}))$/i.exec(value);
    if (!match) throw new Error(`Invalid virtual desktop GUID: ${value}`);
    const hexadecimal = `${match[1] ?? match[6]}${match[2] ?? match[7]}${match[3] ?? match[8]}${match[4] ?? match[9]}${match[5] ?? match[10]}`;
    const bytePairs = hexadecimal.match(/../g);
    if (!bytePairs) throw new Error(`Invalid virtual desktop GUID: ${value}`);
    const ordered = bytePairs.map((byte) => Number.parseInt(byte, 16));
    return Uint8Array.from([ordered[3], ordered[2], ordered[1], ordered[0], ordered[5], ordered[4], ordered[7], ordered[6], ...ordered.slice(8)]);
}

function formatGuid(bytes: Uint8Array): string {
    if (bytes.length !== 16) throw new Error(`Malformed virtual desktop GUID data (${bytes.length} bytes).`);
    const ordered = [bytes[3], bytes[2], bytes[1], bytes[0], bytes[5], bytes[4], bytes[7], bytes[6], ...bytes.slice(8)];
    const hex = ordered.map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function hexHresult(value: number): string {
    return `0x${(value >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
}

class WindowsVirtualDesktopAdapter {
    private readonly koffi: KoffiRuntime;
    private readonly interfacePointer: unknown;
    private readonly methodTypes: [import("koffi").IKoffiCType, import("koffi").IKoffiCType, import("koffi").IKoffiCType];
    private readonly methodPointers: [unknown, unknown, unknown];
    private readonly regGetValue: (...args: unknown[]) => number;

    constructor() {
        this.koffi = require("koffi") as KoffiRuntime;
        const ole32 = this.koffi.load("ole32.dll");
        const registry = this.koffi.load("advapi32.dll");
        const coCreateInstance = ole32.func("int __stdcall CoCreateInstance(const void *clsid, void *outer, uint32_t context, const void *iid, _Out_ void **result)");
        const instance: unknown[] = [null];
        const result = coCreateInstance(Buffer.from(parseGuid(CLSID)), null, CLSCTX_ALL, Buffer.from(parseGuid(IID)), instance) as number;
        if (result < 0) throw new Error(`CoCreateInstance(IVirtualDesktopManager) failed with HRESULT ${hexHresult(result)}.`);
        this.interfacePointer = instance[0];
        if (!this.interfacePointer) throw new Error("CoCreateInstance returned an empty IVirtualDesktopManager pointer.");
        this.methodTypes = [
            this.koffi.proto("int __stdcall IsWindowOnCurrentVirtualDesktop(void *self, intptr_t hwnd, _Out_ int32_t *current)"),
            this.koffi.proto("int __stdcall GetWindowDesktopId(void *self, intptr_t hwnd, _Out_ void *desktopId)"),
            this.koffi.proto("int __stdcall MoveWindowToDesktop(void *self, intptr_t hwnd, const void *desktopId)"),
        ];
        const vtable = this.koffi.decode(this.interfacePointer, "void *");
        const slots = this.koffi.decode(vtable, this.koffi.array("void *", 6)) as unknown[];
        this.methodPointers = [slots[3], slots[4], slots[5]];
        this.regGetValue = registry.func("int __stdcall RegGetValueW(intptr_t key, const char16_t *subKey, const char16_t *value, uint32_t flags, _Out_ uint32_t *type, void *data, _Inout_ uint32_t *size)") as (...args: unknown[]) => number;
    }

    readValue(subKey: string, valueName: string): { type: number; data: Buffer } {
        const key = HKEY_CURRENT_USER;
        const type = [0];
        const size = [0];
        const first = this.regGetValue(key, subKey, valueName, RRF_RT_ANY, type, null, size);
        if (first !== 0 && first !== ERROR_MORE_DATA) throw new Error(`RegGetValueW(${valueName}) failed with ${hexHresult(first)}.`);
        if (!Number.isSafeInteger(size[0]) || size[0] < 1 || size[0] > 1024 * 1024) throw new Error(`Malformed registry size for ${valueName}: ${size[0]}.`);
        const data = Buffer.alloc(size[0]);
        const readSize = [data.length];
        const result = this.regGetValue(key, subKey, valueName, RRF_RT_ANY, type, data, readSize);
        if (result !== 0) throw new Error(`RegGetValueW(${valueName}) failed with ${hexHresult(result)}.`);
        if (readSize[0] !== data.length) return { type: type[0], data: data.subarray(0, readSize[0]) };
        return { type: type[0], data };
    }

    desktopList(): VirtualDesktopEntry[] {
        const idsValue = this.readValue(DESKTOP_KEY, "VirtualDesktopIDs");
        if (idsValue.type !== REG_BINARY) throw new Error(`VirtualDesktopIDs must be REG_BINARY (received type ${idsValue.type}).`);
        if (idsValue.data.length === 0 || idsValue.data.length % 16 !== 0) throw new Error(`Malformed VirtualDesktopIDs registry data (${idsValue.data.length} bytes).`);
        const ids: string[] = [];
        for (let offset = 0; offset < idsValue.data.length; offset += 16) ids.push(formatGuid(idsValue.data.subarray(offset, offset + 16)));
        return ids.map((id, index) => {
            let name: string | undefined;
            try {
                const value = this.readValue(`${DESKTOP_KEY}\\Desktops\\{${id}}`, "Name");
                if (value.type !== REG_SZ || value.data.length < 2 || value.data.length % 2 !== 0) throw new Error(`Malformed Name value for virtual desktop ${index + 1}.`);
                name = value.data.toString("utf16le").replace(/\0+$/, "");
            } catch (error) {
                if (!errMessage(error).includes(hexHresult(2))) throw error;
            }
            return { id, number: index + 1, ...(name ? { name } : {}) };
        });
    }

    currentDesktopId(): string {
        const current = this.readValue(DESKTOP_KEY, "CurrentVirtualDesktop");
        if (current.type !== REG_BINARY) throw new Error(`CurrentVirtualDesktop must be REG_BINARY (received type ${current.type}).`);
        if (current.data.length !== 16) throw new Error(`Malformed CurrentVirtualDesktop registry data (${current.data.length} bytes).`);
        return formatGuid(current.data);
    }

    isOnCurrentDesktop(window: BrowserWindow): boolean {
        const result: number[] = [0];
        const hr = this.koffi.call(this.methodPointers[0], this.methodTypes[0], this.interfacePointer, this.hwnd(window), result) as number;
        if (hr < 0) throw new Error(`IsWindowOnCurrentVirtualDesktop failed with HRESULT ${hexHresult(hr)}.`);
        return result[0] !== 0;
    }

    moveToDesktop(window: BrowserWindow, id: string): void {
        const hr = this.koffi.call(this.methodPointers[2], this.methodTypes[2], this.interfacePointer, this.hwnd(window), Buffer.from(parseGuid(id))) as number;
        if (hr < 0) throw new Error(`MoveWindowToDesktop failed with HRESULT ${hexHresult(hr)}.`);
        const actualId = Buffer.alloc(16);
        const readHr = this.koffi.call(this.methodPointers[1], this.methodTypes[1], this.interfacePointer, this.hwnd(window), actualId) as number;
        // A never-shown window has no desktop yet (TYPE_E_ELEMENTNOTFOUND); Windows applies the move on
        // first show (US-2184 2d/2e), so only a window that already has a desktop is checked here.
        if (readHr === TYPE_E_ELEMENTNOTFOUND) return;
        if (readHr < 0) throw new Error(`GetWindowDesktopId failed with HRESULT ${hexHresult(readHr)}.`);
        if (formatGuid(actualId) !== id.toLowerCase()) throw new Error(`GetWindowDesktopId returned ${formatGuid(actualId)} after placement on ${id}.`);
    }

    /** HWND as an integer for `intptr_t` parameters (`koffi.as` does not turn integers into pointers). */
    private hwnd(window: BrowserWindow): bigint {
        const handle = window.getNativeWindowHandle();
        return handle.length === 8 ? handle.readBigInt64LE() : BigInt(handle.readInt32LE());
    }
}

export class VirtualDesktopManager {
    private adapter: WindowsVirtualDesktopAdapter | undefined;
    lastVisibilityProbeDurationMs: number | undefined;

    resolveSelector(selector: string): ResolvedVirtualDesktop {
        if (process.platform !== "win32") throw new Error("Virtual desktop selection is supported only on Windows.");
        const adapter = this.getAdapter();
        const desktops = adapter.desktopList();
        if (!desktops.length) throw new Error(`No virtual desktops are available for selector ${selector}; create one with Win+Ctrl+D.`);
        const numeric = /^\d+$/.test(selector);
        let matches: VirtualDesktopEntry[];
        if (numeric) {
            const number = Number(selector);
            matches = Number.isSafeInteger(number) && number > 0 ? desktops.filter((desktop) => desktop.number === number) : [];
        } else matches = desktops.filter((desktop) => desktop.name?.toLowerCase() === selector.toLowerCase());
        if (matches.length !== 1) {
            const available = desktops.map((desktop) => `${desktop.number}${desktop.name ? ` (${desktop.name})` : ""}`).join(", ");
            if (matches.length > 1) throw new Error(`Virtual desktop name ${selector} is ambiguous. Available desktops: ${available}.`);
            throw new Error(`Virtual desktop ${selector} not found. Available desktops: ${available}. Create one with Win+Ctrl+D.`);
        }
        return { id: matches[0].id, selector, desktops };
    }

    isOnCurrentDesktop(window: BrowserWindow): boolean {
        const startedAt = performance.now();
        try { return this.getAdapter().isOnCurrentDesktop(window); }
        finally { this.lastVisibilityProbeDurationMs = performance.now() - startedAt; }
    }

    moveToDesktop(window: BrowserWindow, id: string): void {
        this.getAdapter().moveToDesktop(window, id);
    }

    currentDesktopId(): string {
        return this.getAdapter().currentDesktopId();
    }

    private getAdapter(): WindowsVirtualDesktopAdapter {
        if (process.platform !== "win32") throw new Error("Virtual desktop APIs are supported only on Windows.");
        this.adapter ??= new WindowsVirtualDesktopAdapter();
        return this.adapter;
    }
}

export const virtualDesktopManager = new VirtualDesktopManager();
