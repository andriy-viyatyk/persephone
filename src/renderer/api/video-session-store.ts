class VideoSessionStore {
    private value = false;

    get muted(): boolean {
        return this.value;
    }

    setMuted(value: boolean): void {
        this.value = value;
    }
}

export const videoSessionStore = new VideoSessionStore();
