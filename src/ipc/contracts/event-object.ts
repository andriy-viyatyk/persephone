export interface EventObject<T> {
    subscribe: (callback: (data: T) => void) => () => void;
    send: (data: T) => void;
}

