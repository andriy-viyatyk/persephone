export class ViewPort<T> {
    private registration: { port: T } | undefined;

    attach(port: T): () => void {
        const registration = { port };
        this.registration = registration;
        let attached = true;

        return () => {
            if (!attached) return;
            attached = false;
            if (this.registration === registration) this.registration = undefined;
        };
    }

    get(): T | undefined {
        return this.registration?.port;
    }

    clear(): void {
        this.registration = undefined;
    }
}
