import { ContextMenuEvent } from '../api/events/events';

declare global {
  interface MouseEvent {
    contextMenuEvent?: ContextMenuEvent<unknown>;
    contextMenuPromise?: Promise<boolean>;
  }
}

export {};