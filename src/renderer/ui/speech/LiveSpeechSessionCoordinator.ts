/** Coordinates speech features inside one renderer window. */
class LiveSpeechSessionCoordinator {
    private owner: string | undefined;

    public acquire(owner: string): (() => void) | undefined {
        if (this.owner) return undefined;
        this.owner = owner;
        let released = false;
        return () => {
            if (released) return;
            released = true;
            if (this.owner === owner) this.owner = undefined;
        };
    }

    public isBusy(): boolean {
        return this.owner !== undefined;
    }
}

export const liveSpeechSessionCoordinator = new LiveSpeechSessionCoordinator();
