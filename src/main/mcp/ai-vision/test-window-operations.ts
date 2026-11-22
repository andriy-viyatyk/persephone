import { openWindows } from "../../open-windows";
import type { OpenWindowData } from "../../open-windows";
import { errMessage } from "../../../shared/utils";

const WINDOW_READY_TIMEOUT = 30_000;

interface TestWindowIdentity { index: number; windowId: number; }

/** Owns window selection and the lifetime of windows created specifically for attached tests. */
export class TestWindowOperations {
    private readonly created = new Map<string, TestWindowIdentity>();

    constructor(private readonly windows = openWindows) {}

    async createTestWindow(): Promise<TestWindowIdentity> {
        const record = this.windows.createWindow();
        const identity = this.identityOf(record);
        this.created.set(this.key(identity), identity);
        try {
            await waitForWindow(record, WINDOW_READY_TIMEOUT);
            this.assertLive(identity);
            return identity;
        } catch (error) {
            try {
                this.disposeTestWindow(identity.index, identity.windowId);
            } catch (cleanupError) {
                throw new Error(`Test window setup failed: ${errMessage(error)}; cleanup failed: ${errMessage(cleanupError)}`, { cause: cleanupError });
            }
            throw error;
        }
    }

    selectTestWindow(selector: string): TestWindowIdentity | { count: number } {
        if (typeof selector !== "string" || !selector) throw new Error("--window requires a window index or title substring.");
        const numeric = /^\d+$/.test(selector);
        if (numeric) {
            const index = Number(selector);
            if (!Number.isSafeInteger(index)) throw new Error("--window numeric index must be a non-negative safe integer.");
            const record = this.windows.findWindowDataByIndex(index);
            const identity = record && this.liveIdentity(record);
            return identity ?? { count: 0 };
        }
        const normalized = selector.toLocaleLowerCase();
        const matches = this.windows.allWindowData().flatMap((record) => {
            const identity = this.liveIdentity(record);
            if (!identity || record.boardRoot) return [];
            const title = record.window?.window.getTitle() ?? "";
            return title.toLocaleLowerCase().includes(normalized) ? [identity] : [];
        });
        return matches.length === 1 ? matches[0] : { count: matches.length };
    }

    disposeTestWindow(index: number, windowId: number): void {
        const identity = { index, windowId };
        if (!this.created.has(this.key(identity))) throw new Error("Only a window created by this test runner can be disposed.");
        this.assertLive(identity);
        this.windows.disposeTestWindow(index, windowId);
        this.created.delete(this.key(identity));
    }

    private assertLive(identity: TestWindowIdentity): void {
        const record = this.windows.findWindowDataByIndex(identity.index);
        if (!record || this.liveIdentity(record)?.windowId !== identity.windowId) {
            throw new Error("The test window was closed or replaced; the run stopped.");
        }
    }

    private liveIdentity(record: OpenWindowData): TestWindowIdentity | undefined {
        const window = record.window?.window;
        if (!window || window.isDestroyed()) return undefined;
        return { index: record.index, windowId: window.id };
    }

    private identityOf(record: OpenWindowData): TestWindowIdentity {
        const identity = this.liveIdentity(record);
        if (!identity) throw new Error("The test window closed before it could be identified.");
        return identity;
    }

    private key(identity: TestWindowIdentity): string { return `${identity.index}:${identity.windowId}`; }
}

function waitForWindow(record: OpenWindowData, timeout: number): Promise<void> {
    if (!record.whenReady) return Promise.reject(new Error("The test window did not expose a readiness signal."));
    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("The test window did not become ready before the startup timeout.")), timeout);
        record.whenReady?.then(() => { clearTimeout(timer); resolve(); }, (error: unknown) => { clearTimeout(timer); reject(error); });
    });
}
