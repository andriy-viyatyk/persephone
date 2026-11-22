interface PendingMenuRequest {
    released: boolean;
    consumed: boolean;
    expiry?: ReturnType<typeof setTimeout>;
}

// A prevented page contextmenu can produce no guest event, so expire its suppression entry shortly after the click.
const AUTOMATION_MENU_GRACE_MS = 500;

/** Tracks one expected guest context-menu event for each trusted automation right-click. */
export class BrowserAutomationMenuGuard {
    private readonly requests = new Map<string, PendingMenuRequest[]>();
    private disposed = false;

    arm(tabId: string): void {
        if (this.disposed) return;
        const requests = this.requests.get(tabId) ?? [];
        requests.push({ released: false, consumed: false });
        this.requests.set(tabId, requests);
    }

    release(tabId: string): void {
        if (this.disposed) return;
        const request = this.requests.get(tabId)?.find(entry => !entry.released);
        if (!request) return;
        request.released = true;
        if (request.consumed) {
            this.remove(tabId, request);
            return;
        }
        request.expiry = setTimeout(() => this.remove(tabId, request), AUTOMATION_MENU_GRACE_MS);
    }

    consume(tabId: string): boolean {
        const request = this.requests.get(tabId)?.find(entry => !entry.consumed);
        if (!request) return false;
        request.consumed = true;
        if (request.expiry !== undefined) {
            clearTimeout(request.expiry);
            request.expiry = undefined;
        }
        if (request.released) this.remove(tabId, request);
        return true;
    }

    clearTab(tabId: string): void {
        const requests = this.requests.get(tabId);
        if (!requests) return;
        for (const request of requests) {
            if (request.expiry !== undefined) clearTimeout(request.expiry);
        }
        this.requests.delete(tabId);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const tabId of this.requests.keys()) this.clearTab(tabId);
    }

    private remove(tabId: string, request: PendingMenuRequest): void {
        if (request.expiry !== undefined) clearTimeout(request.expiry);
        const requests = this.requests.get(tabId);
        if (!requests) return;
        const index = requests.indexOf(request);
        if (index >= 0) requests.splice(index, 1);
        if (requests.length === 0) this.requests.delete(tabId);
    }
}
