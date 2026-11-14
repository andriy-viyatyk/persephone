import type { ILink } from "../../api/types/io.tree";
import { getFaviconPath, getHostname, onFaviconReady } from "../../components/icons/favicon-cache";

export class FaviconRowTracker {
    private readonly hostnameRows = new Map<string, number[]>();
    private readonly faviconUnsubs: Array<() => void> = [];
    private generation = 0;
    private disposed = false;
    private repaint: (rows: number[]) => void;

    public constructor(onRepaint: (rows: number[]) => void) {
        this.repaint = onRepaint;
    }

    public track(links: ILink[], rowOf: (index: number) => number): void {
        this.releaseSubscriptions();
        this.disposed = false;
        const generation = ++this.generation;
        for (let index = 0; index < links.length; index++) {
            const hostname = getHostname(links[index].href);
            if (!hostname) continue;
            const rows = this.hostnameRows.get(hostname);
            const row = rowOf(index);
            if (rows && rows[rows.length - 1] !== row) rows.push(row);
            else if (!rows) this.hostnameRows.set(hostname, [row]);
        }
        for (const hostname of this.hostnameRows.keys()) {
            void getFaviconPath(hostname)
                .then((path) => { if (path) this.repaintHostname(hostname, generation); })
                .catch((): void => undefined);
            this.faviconUnsubs.push(onFaviconReady(hostname, () => this.repaintHostname(hostname, generation)));
        }
    }

    public dispose(): void {
        this.disposed = true;
        this.generation++;
        this.releaseSubscriptions();
    }

    private repaintHostname(hostname: string, generation: number): void {
        if (this.disposed || generation !== this.generation) return;
        const rows = this.hostnameRows.get(hostname);
        if (rows?.length) this.repaint([...rows]);
    }

    private releaseSubscriptions(): void {
        this.generation++;
        for (const unsubscribe of this.faviconUnsubs.splice(0)) unsubscribe();
        this.hostnameRows.clear();
    }
}
