// =============================================================================
// MOCKUP — ComponentQueue (foundation primitive)
//
// EPIC-028 design phase. Non-compiling sketch — for reading, not building.
//
// Lives at /src/renderer/core/state/ComponentQueue.ts (new file).
//
// Resolves: walkthrough 02 / S4 — the recurring pattern of "model needs to
// tell its React component to do something, but the component may not be
// mounted yet." Updated by walkthrough 12 / SF6 — adds request/reply half
// (`register` / `execute`) for view-context queries (Monaco's
// `getSelectedText`, `getCursorPosition`, `insertText`, `replaceSelection`).
//
// Today's manifestations of this problem (will migrate during respective
// walkthroughs, not all at once):
//   - TextFileModel `_pendingRevealLine` / `_pendingHighlightText` fields +
//      acquireViewModel reads them when the view mounts
//   - PageModel `_pendingActivePanel` — deferred until secondary editors restore
//   - PageModel `pendingSecondaryDescriptors`
//   - ContentViewModelHost.acquire/release ref-counting (entire system dies in
//      this epic; ComponentQueue replaces the "wait for view" half of its job)
//   - TextEditorFacade.getSelectedText / getCursorPosition / insertText /
//      replaceSelection — view-context probes; today proxy through the
//      ViewModel's `editorRef`. Under EPIC-028 they route through the
//      register/execute half of this primitive.
//
// Design contract:
//   - **Two parallel channels**: fire-and-forget events (`send` / `subscribe`
//      / `use`) and request/reply queries (`execute` / `register`). Same
//      mailbox semantics on both sides; one component handles both for an
//      editor.
//   - **Mailbox semantics, FIFO**. send() and execute() go directly to the
//      handler if one is subscribed; otherwise queue. New subscriber drains
//      its queue once, then receives subsequent calls live.
//   - **No coalescing**. If the model sends 5 `revealLine` events before
//      mount, the handler sees 5. Coalescing is the SENDER's responsibility,
//      not the queue's — duplicate sends indicate a bug to fix at the source.
//   - **Single consumer** (one handler at a time, per channel). Multiple
//      subscribers across an editor's lifetime are fine sequentially;
//      concurrent subscribers are not supported (would invite ambiguity about
//      who drains the queue).
//   - **State vs. events**. Reactive state goes in `TOneState`. The queue is
//      for one-shot imperative commands (revealLine, focus, scrollTo) and
//      one-shot context queries (getSelectedText, getCursorPosition). If
//      the data still matters after the consumer reads it, it belongs in
//      state, not the queue.
// =============================================================================

// -----------------------------------------------------------------------------
// Event base shape
// -----------------------------------------------------------------------------

/** All queue events have a `type` discriminator. Concrete event types extend
 *  this via union types specific to each editor. */
export interface ComponentQueueEvent {
    readonly type: string;
}

// -----------------------------------------------------------------------------
// ComponentQueue
// -----------------------------------------------------------------------------

/** Pending request entry — req plus the resolve/reject closures that complete
 *  the model-side Promise once a handler drains the request. */
interface PendingRequest<Req> {
    req: Req;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
}

export class ComponentQueue<
    E extends ComponentQueueEvent = ComponentQueueEvent,
    Req = never,
> {
    // Fire-and-forget channel (S4 — events).
    private _queue: E[] = [];
    private _handler: ((event: E) => void) | null = null;

    // Request/reply channel (SF6 — view-context queries).
    private _pendingRequests: PendingRequest<Req>[] = [];
    private _requestHandler: ((req: Req) => unknown) | null = null;

    /**
     * Send an event. If a handler is subscribed, fires immediately (sync).
     * Otherwise queues until a handler subscribes.
     *
     * Sender's responsibility to avoid duplicate sends — the queue does not
     * coalesce. A flurry of identical events will all be replayed to the
     * consumer in order.
     */
    send(event: E): void {
        if (this._handler) {
            this._handler(event);
        } else {
            this._queue.push(event);
        }
    }

    /**
     * Programmatic subscribe (non-hook). Drains any queued events to the
     * handler synchronously, then routes future sends to it.
     *
     * Returns an unsubscribe function. After unsubscribe, subsequent sends
     * accumulate in the queue again until the next subscriber.
     *
     * Only ONE handler may be subscribed at a time. Subscribing while another
     * handler is active replaces it (no warning; the React hook ensures
     * single-consumer in practice).
     */
    subscribe(handler: (event: E) => void): () => void {
        // Drain queued events first, in FIFO order.
        const drained = this._queue;
        this._queue = [];
        for (const ev of drained) handler(ev);

        this._handler = handler;
        return () => {
            if (this._handler === handler) {
                this._handler = null;
            }
        };
    }

    /**
     * React hook. Subscribes for the lifetime of the component, drains queue
     * on mount, delivers future events while mounted.
     *
     * Strict-mode-safe: useEffect cleanup unsubscribes; remount re-subscribes
     * to an empty queue (events sent during the unmounted gap have been
     * accumulating, and the new subscribe drains them).
     */
    use(handler: (event: E) => void): void {
        // useEffect(() => this.subscribe(handler), [this]);
        //   — handler captured from closure; consumer is responsible for
        //     handler stability (useCallback) if the closure references
        //     other reactive values. Matches Persephone's existing
        //     state.use(...) convention.
    }

    /**
     * Send a request, expect a reply (SF6). If a request handler is registered,
     * invokes it sync and resolves with the return value. Otherwise queues the
     * request; resolution happens when `register` is called and drains the
     * queue, OR rejection happens when `dispose` is called.
     *
     * Consumer narrows the return type via cast:
     *   const text = await model.queue.execute({ type: "getSelectedText" }) as string;
     *
     * Wrapping in typed model methods is the recommended pattern:
     *   class MonacoEditor extends EditorModel {
     *       async getSelectedText(): Promise<string> {
     *           return this.queue.execute({ type: "getSelectedText" }) as Promise<string>;
     *       }
     *   }
     *
     * Stale-result risk: if the model calls `execute` while the view is
     * unmounted and re-mounts later, the queued request resolves against the
     * NEW view's state — selection-at-mount-time, not selection-at-call-time.
     * Senders that care add their own timeout via `Promise.race`.
     */
    execute(req: Req): Promise<unknown> {
        if (this._requestHandler) {
            try {
                return Promise.resolve(this._requestHandler(req));
            } catch (error) {
                return Promise.reject(error);
            }
        }
        return new Promise<unknown>((resolve, reject) => {
            this._pendingRequests.push({ req, resolve, reject });
        });
    }

    /**
     * Programmatic register (non-hook) for the request/reply channel (SF6).
     * Drains any queued requests by invoking `handler` for each and resolving
     * the corresponding Promise. Throws from the handler become Promise
     * rejections on the model side.
     *
     * Only ONE request handler may be registered at a time. Registering while
     * another handler is active replaces it (no warning; React hook pattern
     * ensures single-consumer in practice).
     *
     * Returns an unregister function. After unregister, subsequent execute()
     * calls accumulate in the pending queue again until the next register.
     */
    register(handler: (req: Req) => unknown): () => void {
        // Drain pending requests first, in FIFO order.
        const pending = this._pendingRequests;
        this._pendingRequests = [];
        for (const { req, resolve, reject } of pending) {
            try { resolve(handler(req)); }
            catch (error) { reject(error); }
        }

        this._requestHandler = handler;
        return () => {
            if (this._requestHandler === handler) {
                this._requestHandler = null;
            }
        };
    }

    /**
     * React hook for the request/reply channel (SF6). Registers for the
     * lifetime of the component, drains pending requests on mount, handles
     * future requests while mounted, unregisters on unmount.
     *
     * Parallel to `use()` — same single-consumer discipline, same handler
     * stability convention.
     *
     *   - useEffect(() => this.register(handler), [this]);
     *   — handler captured from closure; consumer is responsible for handler
     *     stability (useCallback) if the closure references other reactive
     *     values. Matches Persephone's existing state.use(...) convention.
     *
     * Strict-mode-safe: useEffect cleanup unregisters; remount re-registers
     * to a (possibly populated) pending queue, which drains FIFO into the
     * fresh handler.
     *
     * Usage:
     *   model.queue.useRequest((req) => {
     *       const ed = monacoRef.current;
     *       if (!ed) throw new Error("Monaco not mounted");
     *       switch (req.type) {
     *           case "getSelectedText":   return ed.getModel()?.getValueInRange(ed.getSelection()!) ?? "";
     *           case "getCursorPosition": return ed.getPosition() ?? { lineNumber: 1, column: 1 };
     *           case "insertText":        ed.executeEdits("script", [{ range: ed.getSelection()!, text: req.text }]); return;
     *           case "replaceSelection":  ed.executeEdits("script", [{ range: ed.getSelection()!, text: req.text }]); return;
     *       }
     *   });
     */
    useRequest(handler: (req: Req) => unknown): void {
        // useEffect(() => this.register(handler), [this]);
    }

    /**
     * Clear both queues and drop any subscriber/registered handler. Called by
     * `EditorModel.dispose` so an editor that closes before its view mounts
     * doesn't leak events. Pending requests reject with a disposal error so
     * awaiting scripts don't hang.
     */
    dispose(): void {
        this._queue.length = 0;
        this._handler = null;

        const pending = this._pendingRequests;
        this._pendingRequests = [];
        for (const { reject } of pending) {
            reject(new Error("ComponentQueue disposed before request was handled"));
        }
        this._requestHandler = null;
    }

    /** Inspection helper for tests / debugging — fire-and-forget channel. */
    get pendingCount(): number {
        return this._queue.length;
    }

    /** Inspection helper for tests / debugging — request/reply channel. */
    get pendingRequestCount(): number {
        return this._pendingRequests.length;
    }
}

// =============================================================================
// Usage shape
// =============================================================================
//
// // In each editor class, declare an event union:
// type MonacoQueueEvent =
//     | { type: "revealLine";    line: number }
//     | { type: "highlightText"; text: string | undefined }
//     | { type: "focus" };
//
// // Parameterize the queue:
// class MonacoEditor extends EditorModel<MonacoEditorState> {
//     readonly queue = new ComponentQueue<MonacoQueueEvent>();
//
//     applyRestoreData(data: Partial<MonacoEditorState> & {
//         revealLine?: number;
//         highlightText?: string;
//     }): void {
//         if (data.revealLine !== undefined) {
//             this.queue.send({ type: "revealLine", line: data.revealLine });
//         }
//         if (data.highlightText !== undefined) {
//             this.queue.send({ type: "highlightText", text: data.highlightText });
//         }
//         // ...
//     }
// }
//
// // In the React view:
// const MonacoView = ({ model }: { model: MonacoEditor }) => {
//     const monacoRef = useRef<monaco.editor.IStandaloneCodeEditor>();
//     model.queue.use(ev => {
//         const m = monacoRef.current;
//         if (!m) return;  // Monaco instance not ready; event lost
//         switch (ev.type) {
//             case "revealLine":    m.revealLine(ev.line); break;
//             case "highlightText": setHighlight(ev.text); break;
//             case "focus":         m.focus(); break;
//         }
//     });
//     // ...
// };
//
// =============================================================================
// Usage shape — request/reply (SF6)
// =============================================================================
//
// // Editor declares a request union alongside the event union:
// type MonacoQueueRequest =
//     | { type: "getSelectedText" }
//     | { type: "getCursorPosition" }
//     | { type: "insertText";       text: string }
//     | { type: "replaceSelection"; text: string };
//
// class MonacoEditor extends EditorModel<MonacoEditorState> {
//     readonly queue = new ComponentQueue<MonacoQueueEvent, MonacoQueueRequest>();
//
//     async getSelectedText(): Promise<string> {
//         return this.queue.execute({ type: "getSelectedText" }) as Promise<string>;
//     }
//     async getCursorPosition(): Promise<{ lineNumber: number; column: number }> {
//         return this.queue.execute({ type: "getCursorPosition" }) as Promise<{ lineNumber: number; column: number }>;
//     }
//     async insertText(text: string): Promise<void> {
//         await this.queue.execute({ type: "insertText", text });
//     }
//     async replaceSelection(text: string): Promise<void> {
//         await this.queue.execute({ type: "replaceSelection", text });
//     }
// }
//
// // React view registers one dispatcher closing over the editor ref:
// const MonacoView = ({ model }: { model: MonacoEditor }) => {
//     const monacoRef = useRef<monaco.editor.IStandaloneCodeEditor>();
//     model.queue.useRequest((req) => {
//         const ed = monacoRef.current;
//         if (!ed) throw new Error("Monaco not mounted");
//         switch (req.type) {
//             case "getSelectedText":
//                 return ed.getModel()?.getValueInRange(ed.getSelection()!) ?? "";
//             case "getCursorPosition":
//                 return ed.getPosition() ?? { lineNumber: 1, column: 1 };
//             case "insertText":
//                 ed.executeEdits("script", [{ range: ed.getSelection()!, text: req.text }]);
//                 return undefined;
//             case "replaceSelection":
//                 ed.executeEdits("script", [{ range: ed.getSelection()!, text: req.text }]);
//                 return undefined;
//         }
//     });
//     // ...
// };
//
// // TextEditorFacade collapses to thin Promise-returning delegates:
// class TextEditorFacade {
//     constructor(private readonly editor: MonacoEditor) {}
//     getSelectedText():    Promise<string>                    { return this.editor.getSelectedText(); }
//     getCursorPosition():  Promise<{ lineNumber: number; column: number }> { return this.editor.getCursorPosition(); }
//     insertText(t: string):     Promise<void>                 { return this.editor.insertText(t); }
//     replaceSelection(t: string): Promise<void>               { return this.editor.replaceSelection(t); }
// }
//
// =============================================================================
