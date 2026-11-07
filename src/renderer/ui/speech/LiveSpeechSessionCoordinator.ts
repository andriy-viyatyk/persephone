/** Coordinates speech features inside one renderer window. */
class LiveSpeechSessionCoordinator {
    private owner: string | undefined;
    private readonly listeners = new Set<(busy: boolean) => void>();

    public acquire(owner: string): (() => void) | undefined {
        if (this.owner) return undefined;
        this.owner = owner;
        this.notify();
        let released = false;
        return () => {
            if (released) return;
            released = true;
            if (this.owner === owner) {
                this.owner = undefined;
                this.notify();
            }
        };
    }

    public isBusy(): boolean {
        return this.owner !== undefined;
    }

    public subscribe(listener: (busy: boolean) => void): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    private notify(): void {
        for (const listener of this.listeners) listener(this.isBusy());
    }
}

export const liveSpeechSessionCoordinator = new LiveSpeechSessionCoordinator();
