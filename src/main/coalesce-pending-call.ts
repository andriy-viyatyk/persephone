export function coalescePendingCall<TResult>(operation: () => Promise<TResult>): () => Promise<TResult> {
    let pending: Promise<TResult> | undefined;
    return () => {
        if (pending) return pending;
        pending = operation().finally(() => {
            pending = undefined;
        });
        return pending;
    };
}
