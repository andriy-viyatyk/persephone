import type { CallOptions, HandleMetadata } from "./app-proxy.js";
import type { Expect, PollOptions, PollMatchers } from "./poll-expect.js";
import type { UsePageOptions } from "./browser-helpers.js";

export type { CallOptions };
export type { Expect, PollOptions, PollMatchers };

export interface WaitOptions extends CallOptions { message?: string; }

export interface TestContext {
    app: object;
    root: object;
    openBrowser(url: string, options?: { profile?: string; incognito?: boolean; timeout?: number }): Promise<object>;
    usePage(options: UsePageOptions): Promise<object>;
    /** The same stand-in, but `await` and async returns keep it instead of reading the node. */
    handle(node: unknown, metadata?: HandleMetadata): object;
    call(path?: string, args?: unknown, options?: CallOptions): Promise<unknown>;
    callText(path?: string, args?: unknown, options?: CallOptions): Promise<string>;
    /** Assign `value` to a writable call-tree property; the stand-in cannot express an assignment. */
    set(path: string, value: unknown, options?: { timeout?: number }): Promise<unknown>;
    waitFor(pathOrCallback: string | ((ctx: TestContext) => unknown | Promise<unknown>), predicate: (value: unknown) => boolean | Promise<boolean>, options?: WaitOptions): Promise<unknown>;
    expect: Expect;
    script(code: string): Promise<string>;
    restartApp(): Promise<void>;
    launchSecondInstance(args?: string[]): Promise<number>;
    /** Resolve a path next to the test file, for fixtures the test ships with. */
    file(relative: string): string;
    /** Note a line in `tests.log` and the console, for context a later reader needs. */
    log(message: string): void;
    _state: { step: string; error?: string; stepOf(error: unknown): string; ownedPages: Set<string>; sessionPages: Set<string>; pagesUnderTest(): ReadonlySet<string> };
}

export { createContext } from "./context-operations.js";
