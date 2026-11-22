export interface CallOptions { timeout?: number; maxLength?: number; dialog?: boolean; }
export interface HandleMetadata { pageId?: string; }
type Call = (path?: string, args?: unknown, options?: CallOptions) => Promise<unknown>;
type PathSegment = { key: string; mode: "member" | "index" };

const INSPECT = Symbol.for("nodejs.util.inspect.custom");
/** Internal: lets `asHandle` rebuild a stand-in for the same path. */
const SEGMENTS = Symbol("persephone.appStandIn.segments");
const OPTIONS = Symbol("persephone.appStandIn.options");
const METADATA = Symbol("persephone.appStandIn.metadata");

/** Identifies app proxies without reading a proxy property or triggering its call behavior. */
export function isAppStandIn(value: unknown): boolean {
    return typeof value === "function" && Boolean((value as unknown as Record<symbol, unknown>)[SEGMENTS]);
}

export function createAppProxy(call: Call, beforeCall: (path: string, args?: unknown) => void, onError: (error: unknown) => void): object {
    return createNode(call, beforeCall, onError, [], true, {});
}

/**
 * The same stand-in without `then` on its own level, so returning it from an async function (or
 * awaiting it) keeps the stand-in instead of reading the node. Its children stay awaitable.
 */
export function asHandle(node: unknown, call: Call, beforeCall: (path: string, args?: unknown) => void, onError: (error: unknown) => void, metadata?: HandleMetadata): object {
    const standIn = typeof node === "function" ? node as unknown as Record<symbol, PathSegment[] | CallOptions | HandleMetadata | undefined> : undefined;
    const segments = standIn?.[SEGMENTS] as PathSegment[] | undefined;
    if (!segments) throw new TypeError("ctx.handle(node) takes an app stand-in such as ctx.app.pages[id].editor.");
    return createNode(call, beforeCall, onError, segments, false, standIn?.[OPTIONS] as CallOptions | undefined ?? {}, metadata ?? standIn?.[METADATA] as HandleMetadata | undefined);
}

function createNode(call: Call, beforeCall: (path: string, args?: unknown) => void, onError: (error: unknown) => void, segments: PathSegment[], awaitable: boolean, options: CallOptions, metadata?: HandleMetadata): object {
    const target = function appStandIn() {};
    const proxy = new Proxy(target, {
        get(_target, property) {
            if (property === SEGMENTS) return segments;
            if (property === OPTIONS) return options;
            if (property === METADATA) return metadata;
            if (property === "pageId" && metadata?.pageId !== undefined) return metadata.pageId;
            if (property === "withOptions") return (nextOptions: CallOptions) => createNode(call, beforeCall, onError, segments, awaitable, { ...options, ...nextOptions }, metadata);
            if (property === "then" && !awaitable) return undefined;
            if (property === "then") {
                // Awaiting reads the node; that is valid for a terminal `$help` / `$describe` too.
                // Returns the chained Promise, so `node.then(read)` yields `read`'s result like a Promise would.
                return (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => {
                    const apiPath = encodePath(segments);
                    beforeCall(apiPath);
                    return call(apiPath, undefined, options).then(onFulfilled, onRejected);
                };
            }
            if (property === Symbol.toStringTag) return "PersephoneAppProxy";
            if (property === INSPECT) return () => `[PersephoneAppProxy ${encodePath(segments) || "<root>"}]`;
            if (property === Symbol.toPrimitive) return () => `[PersephoneAppProxy ${encodePath(segments) || "<root>"}]`;
            if (typeof property === "symbol") throw new TypeError(`Unsupported symbol property ${String(property)} on app stand-in; use ctx.call(path) for unsupported call paths.`);
            if (segments.at(-1)?.key === "$help" || segments.at(-1)?.key === "$describe") {
                throw new Error(`Cannot continue after terminal ${segments.at(-1)?.key}; use ctx.call(path) when the call grammar permits it.`);
            }
            if (property === "then") return undefined;
            if (property === "catch" || property === "finally") {
                // A stand-in is awaitable, not a Promise; `.catch` would otherwise become a call-tree member.
                throw new TypeError(`An app stand-in is awaitable but not a Promise; use try { await node } catch instead of .${property}().`);
            }
            return createNode(call, beforeCall, onError, [...segments, { key: property, mode: segmentMode(property) }], true, options);
        },
        set(_target, property) {
            // An assignment cannot be awaited, so it is never sent; fail loudly instead of storing it on the stand-in.
            const name = typeof property === "string" ? property : String(property);
            let target: string;
            try { target = encodePath([...segments, { key: name, mode: segmentMode(name) }]); }
            catch { target = `${encodePath(segments)}.${name}`; }
            throw new TypeError(`Assignment through the app stand-in is not sent to the app; use await ctx.set(${JSON.stringify(target)}, value).`);
        },
        apply(_target, _thisArg, args) {
            if (!segments.length) throw new Error("The app root is not callable; await ctx.app to read its summary.");
            let apiPath: string;
            try { apiPath = encodePath(segments); }
            catch (error) {
                beforeCall(segments.map(({ key }) => key).join("."), args);
                onError(error);
                throw error;
            }
            beforeCall(apiPath, args);
            const last = segments[segments.length - 1];
            if (!last) throw new Error("The app root is not callable; await ctx.app to read its summary.");
            if (last.key === "$help" || last.key === "$describe" || last.mode === "index" || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(last.key)) {
                const error = new Error(last.key === "$help" || last.key === "$describe"
                    ? `Terminal ${last.key} cannot be called; await it as a value or use ctx.call(path).`
                    : `Indexed or non-identifier member ${JSON.stringify(last.key)} cannot be called through the app stand-in; use ctx.call(path, args).`);
                onError(error);
                throw error;
            }
            try { validateArguments(args, apiPath); }
            catch (error) { onError(error); throw error; }
            const cleaned = args.slice();
            while (cleaned.length && cleaned.at(-1) === undefined) cleaned.pop();
            return call(encodePath(segments), cleaned, options);
        },
    });
    return proxy;
}

function segmentMode(key: string): PathSegment["mode"] {
    if (/^(0|[1-9]\d*)$/.test(key)) return "index";
    return "member";
}

function encodePath(segments: PathSegment[]): string {
    return segments.map(({ key, mode }, index) => {
        if ((key.startsWith("$help") || key.startsWith("$describe")) && key !== "$help" && key !== "$describe") {
            throw new Error(`Member ${JSON.stringify(key)} is reserved by the call grammar; use ctx.call(path) when the grammar permits it.`);
        }
        if (index === 0 && !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) && key !== "$help" && key !== "$describe") throw new Error(`Root member ${JSON.stringify(key)} cannot be represented by the call grammar; use ctx.call(path) when the grammar permits it.`);
        if (key === "then") throw new Error('The "then" member is consumed by JavaScript Promise handling; use ctx.call(path) to access it.');
        // The root segment is a bare name; later member segments take a leading dot.
        const dot = index === 0 ? "" : ".";
        if (key === "$help" || key === "$describe") return `${dot}${key}`;
        if (mode === "index") return `[${key}]`;
        if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) return `${dot}${key}`;
        return `[${JSON.stringify(key)}]`;
    }).join("");
}

function validateArguments(args: unknown[], apiPath: string): void {
    const guidance = `Invalid arguments for ${apiPath}; functions and non-JSON values are unsupported. Use waitFor({ selector }) on the browser editor or ctx.script(code).`;
    const visit = (value: unknown, location: string, ancestors: Set<object>): void => {
        if (value === undefined || value === null || typeof value === "string" || typeof value === "boolean") return;
        if (typeof value === "number") {
            if (!Number.isFinite(value)) throw new TypeError(`${guidance} ${location} is not a finite number.`);
            return;
        }
        if (typeof value !== "object") throw new TypeError(`${guidance} ${location} has unsupported type ${typeof value}.`);
        if (ancestors.has(value)) throw new TypeError(`${guidance} ${location} creates a cycle.`);
        ancestors.add(value);
        if (Array.isArray(value)) {
            if (Object.getOwnPropertyDescriptor(value, "toJSON")) throw new TypeError(`${guidance} ${location}.toJSON is unsupported.`);
            for (let index = 0; index < value.length; index++) {
                const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
                if (!descriptor) throw new TypeError(`${guidance} ${location}[${index}] is a sparse array slot.`);
                if (!("value" in descriptor)) throw new TypeError(`${guidance} ${location}[${index}] is an accessor property.`);
                if (descriptor.value === undefined) throw new TypeError(`${guidance} ${location}[${index}] is undefined.`);
                visit(descriptor.value, `${location}[${index}]`, ancestors);
            }
            if (Object.getOwnPropertySymbols(value).length) throw new TypeError(`${guidance} ${location} has symbol keys.`);
            for (const key of Object.keys(value)) {
                if (key !== "toJSON" && !/^(0|[1-9]\d*)$/.test(key)) throw new TypeError(`${guidance} ${location}.${key} is an extra array property.`);
                if (key === "toJSON") throw new TypeError(`${guidance} ${location}.toJSON is unsupported.`);
            }
        } else {
            const prototype = Object.getPrototypeOf(value);
            if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${guidance} ${location} is not a plain object.`);
            if (Object.getOwnPropertySymbols(value).length) throw new TypeError(`${guidance} ${location} has symbol keys.`);
            if (Object.getOwnPropertyDescriptor(value, "toJSON")) throw new TypeError(`${guidance} ${location}.toJSON is unsupported.`);
            for (const key of Object.keys(value)) {
                const descriptor = Object.getOwnPropertyDescriptor(value, key);
                if (!descriptor || !("value" in descriptor)) throw new TypeError(`${guidance} ${location}.${key} is an accessor property.`);
                if (key === "toJSON") throw new TypeError(`${guidance} ${location}.toJSON is unsupported.`);
                if (descriptor.value !== undefined) visit(descriptor.value, `${location}.${key}`, ancestors);
            }
        }
        ancestors.delete(value);
    };
    let lastDefinedIndex = args.length - 1;
    while (lastDefinedIndex >= 0 && args[lastDefinedIndex] === undefined) lastDefinedIndex--;
    for (let index = 0; index <= lastDefinedIndex; index++) {
        if (args[index] === undefined) throw new TypeError(`${guidance} args[${index}] is undefined; only trailing undefined arguments may be omitted.`);
        visit(args[index], `args[${index}]`, new Set());
    }
}
