// =============================================================================
// MOCKUP — ComponentQueue (foundation primitive)
//
// EPIC-028 design phase. Non-compiling sketch — for reading, not building.
//
// Lives at /src/renderer/core/state/ComponentQueue.ts (new file).
//
// Resolves: walkthrough 02 / S4 — the recurring pattern of "model needs to
// tell its React component to do something, but the component may not be
// mounted yet."
//
// Today's manifestations of this problem (will migrate during respective
// walkthroughs, not all at once):
//   - TextFileModel `_pendingRevealLine` / `_pendingHighlightText` fields +
//      acquireViewModel reads them when the view mounts
//   - PageModel `_pendingActivePanel` — deferred until secondary editors restore
//   - PageModel `pendingSecondaryDescriptors`
//   - ContentViewModelHost.acquire/release ref-counting (entire system dies in
//      this epic; ComponentQueue replaces the "wait for view" half of its job)
//
// Design contract:
//   - **Mailbox semantics, FIFO**. send() goes directly to handler if one is
//      subscribed; otherwise queues. New subscriber drains the queue once,
//      then receives subsequent events live.
//   - **No coalescing**. If the model sends 5 `revealLine` events before
//      mount, the handler sees 5. Coalescing is the SENDER's responsibility,
//      not the queue's — duplicate sends indicate a bug to fix at the source.
//   - **Single consumer** (one handler at a time). Multiple subscribers across
//      an editor's lifetime are fine sequentially; concurrent subscribers are
//      not supported (would invite ambiguity about who drains the queue).
//   - **State vs. events**. Reactive state goes in `TOneState`. The queue is
//      for one-shot imperative commands (revealLine, focus, scrollTo) and
//      one-shot context queries (TBD — see "Future: execute/register"). If
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

export class ComponentQueue<E extends ComponentQueueEvent = ComponentQueueEvent> {
    private _queue: E[] = [];
    private _handler: ((event: E) => void) | null = null;

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
     * Clear the queue and drop any subscriber. Called by `EditorModel.dispose`
     * so an editor that closes before its view mounts doesn't leak events.
     */
    dispose(): void {
        this._queue.length = 0;
        this._handler = null;
    }

    /** Inspection helper for tests / debugging. */
    get pendingCount(): number {
        return this._queue.length;
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
//
// Future extension: execute() / register() for view-context queries
// =============================================================================
//
// The walkthrough discussion raised a second pattern: the model wants to
// reach INTO the view's context (e.g., the live Monaco instance) and run a
// callback there, with a result. Today this is hand-rolled via tryGet(...).
//
// Sketch (NOT in v1):
//
//   // View registers a resource:
//   model.queue.register("monacoInstance", monaco);     // on mount
//   model.queue.unregister("monacoInstance");           // on unmount
//
//   // Model awaits + invokes:
//   const sel = await model.queue.execute<string>(
//       "monacoInstance",
//       (monaco) => monaco.getSelection().toString(),
//       { timeout: 500 },
//   );
//
// Not implemented in v1. v1 ships the mailbox half (send / subscribe / use)
// which is enough for S4 (revealLine, highlightText, focus). The execute /
// register half lands when a real use case (script API getSelection, copy,
// MCP focusEditor, etc.) drives it — likely walkthrough 12 (scripting
// facades) or walkthrough 20 (Monaco).
//
// =============================================================================
