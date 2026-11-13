export interface VoiceTypingInsertResult {
    copied: boolean;
}

export interface LiveTextInserterOptions {
    insert: (text: string, deferClipboard?: boolean) => Promise<VoiceTypingInsertResult>;
    clipboard: (text: string) => void;
}

export interface LiveTextResultOutcome {
    copied: boolean;
    error?: unknown;
}

/** Serializes committed live segments and reconciles the provider's final result. */
export class LiveTextInserter {
    private insertionQueue: Promise<void> = Promise.resolve();
    private readonly insertedSegments: string[] = [];
    private readonly bufferedSegments: string[] = [];
    private clipboardFallback = false;

    public constructor(private readonly options: LiveTextInserterOptions) {}

    public queueSegment(rawText: string, isCurrent: () => boolean, onError: (error: unknown) => void): void {
        const text = rawText.trim();
        if (!text) return;
        this.insertionQueue = this.insertionQueue.then(async () => {
            if (!isCurrent()) return;
            if (this.clipboardFallback) {
                this.bufferedSegments.push(text);
                return;
            }
            try {
                const result = await this.options.insert(text, true);
                if (result.copied) {
                    this.clipboardFallback = true;
                    this.bufferedSegments.push(text);
                } else {
                    this.insertedSegments.push(text);
                }
            } catch (error) {
                onError(error);
                this.clipboardFallback = true;
                this.bufferedSegments.push(text);
            }
        });
    }

    public async finishLiveResult(text: string, isCurrent: () => boolean, onError: (error: unknown) => void): Promise<LiveTextResultOutcome> {
        await this.insertionQueue;
        if (!isCurrent()) return { copied: false };
        const resultText = text.trim();
        if (this.clipboardFallback) {
            const expected = [this.insertedSegments.join(" "), this.bufferedSegments.join(" ")].filter(Boolean).join(" ");
            if (resultText.startsWith(`${expected} `)) {
                const suffix = resultText.slice(expected.length + 1);
                if (suffix) this.bufferedSegments.push(suffix);
            } else if (resultText !== expected) {
                console.warn("Voice typing provider result did not match its committed segment contract.");
            }
            return { copied: this.copyBuffered(isCurrent) };
        }

        const inserted = this.insertedSegments.join(" ");
        if (resultText === inserted) return { copied: false };
        if (inserted && resultText.startsWith(`${inserted} `)) {
            return this.insertFinalResult(resultText.slice(inserted.length + 1), isCurrent, onError);
        }
        if (!inserted) return this.insertFinalResult(resultText, isCurrent, onError);
        console.warn("Voice typing provider result did not match its committed segment contract.");
        return { copied: false };
    }

    public async insertFinalResult(text: string, isCurrent: () => boolean, onError: (error: unknown) => void): Promise<LiveTextResultOutcome> {
        if (!text || !isCurrent()) return { copied: false };
        try {
            const result = await this.options.insert(text);
            return { copied: result.copied };
        } catch (error) {
            onError(error);
            return { copied: false, error };
        }
    }

    public copyBuffered(isCurrent: () => boolean): boolean {
        const buffered = this.bufferedSegments.join(" ").trim();
        if (!buffered || !isCurrent()) return false;
        this.options.clipboard(buffered);
        this.bufferedSegments.length = 0;
        return true;
    }

    public async drain(): Promise<void> {
        await this.insertionQueue;
    }
}
