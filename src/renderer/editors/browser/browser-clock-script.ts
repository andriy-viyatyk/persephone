/** Builds a self-contained page script that installs a per-frame fake clock. */
export function buildBrowserClockSource(initialTime: number): string {
    return `(() => {
        const marker = Symbol.for("persephone.browser-clock");
        if (window[marker]) return;

        const NativeDate = Date;
        const nativePerformanceNow = performance.now.bind(performance);
        const nativeSetTimeout = window.setTimeout.bind(window);
        const nativeClearTimeout = window.clearTimeout.bind(window);
        const dateDescriptor = Object.getOwnPropertyDescriptor(window, "Date");
        const performanceNowDescriptor = Object.getOwnPropertyDescriptor(performance, "now");
        const timerDescriptors = Object.fromEntries(["setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame"]
            .map((key) => [key, Object.getOwnPropertyDescriptor(window, key)]));
        const startPerformance = nativePerformanceNow();
        const startTime = ${initialTime};
        let fastForwarded = 0;
        let nextId = 1;
        let wakeup;
        let draining = false;
        const jobs = new Map();

        const elapsed = () => Math.max(0, nativePerformanceNow() - startPerformance) + fastForwarded;
        const clockNow = () => startTime + elapsed();
        const fakePerformanceNow = () => startPerformance + elapsed();

        function FakeDate(...args) {
            if (!new.target) return new NativeDate(clockNow()).toString();
            return args.length === 0 ? new NativeDate(clockNow()) : new NativeDate(...args);
        }
        FakeDate.prototype = NativeDate.prototype;
        Object.setPrototypeOf(FakeDate, NativeDate);
        Object.defineProperty(FakeDate, "now", { configurable: true, value: clockNow });

        const schedule = (callback, delay, interval, frame) => {
            if (typeof callback !== "function") throw new TypeError("Timer callback must be a function.");
            const id = nextId++;
            const requested = Number(delay);
            const due = elapsed() + (Number.isFinite(requested) ? Math.max(0, requested) : 0);
            jobs.set(id, { id, callback, due, interval, frame });
            scheduleWakeup();
            return id;
        };
        const clear = (id) => {
            jobs.delete(Number(id));
            scheduleWakeup();
        };
        const runDue = () => {
            if (draining) return;
            draining = true;
            let runs = 0;
            let callbackFailed = false;
            try {
                while (true) {
                    const current = elapsed();
                    let next;
                    for (const job of jobs.values()) {
                        if (job.due <= current && (!next || job.due < next.due || (job.due === next.due && job.id < next.id))) next = job;
                    }
                    if (!next) break;
                    if (++runs > 10000) throw new Error("Fake clock callback limit exceeded.");
                    if (next.interval !== undefined) next.due += next.interval;
                    else jobs.delete(next.id);
                    try {
                        if (next.frame) next.callback.call(window, fakePerformanceNow());
                        else next.callback.call(window);
                    } catch {
                        callbackFailed = true;
                    }
                }
            } finally {
                draining = false;
                scheduleWakeup();
            }
            if (callbackFailed) throw new Error("A fake clock callback failed.");
        };
        function scheduleWakeup() {
            if (wakeup !== undefined) nativeClearTimeout(wakeup);
            wakeup = undefined;
            if (jobs.size === 0) return;
            let earliest = Infinity;
            for (const job of jobs.values()) earliest = Math.min(earliest, job.due);
            wakeup = nativeSetTimeout(() => {
                wakeup = undefined;
                runDue();
            }, Math.max(0, Math.min(earliest - elapsed(), 2147483647)));
        }

        Object.defineProperty(window, "Date", { configurable: true, writable: true, value: FakeDate });
        Object.defineProperty(performance, "now", { configurable: true, writable: true, value: fakePerformanceNow });
        Object.defineProperties(window, {
            setTimeout: { configurable: true, writable: true, value: (callback, delay = 0) => schedule(callback, delay) },
            clearTimeout: { configurable: true, writable: true, value: clear },
            setInterval: { configurable: true, writable: true, value: (callback, delay = 0) => schedule(callback, delay, Math.max(1, Number(delay) || 0)) },
            clearInterval: { configurable: true, writable: true, value: clear },
            requestAnimationFrame: { configurable: true, writable: true, value: (callback) => schedule(callback, 1000 / 60, undefined, true) },
            cancelAnimationFrame: { configurable: true, writable: true, value: clear },
        });

        const handle = {
            fastForward(ms) {
                fastForwarded += ms;
                runDue();
            },
            uninstall() {
                if (wakeup !== undefined) nativeClearTimeout(wakeup);
                wakeup = undefined;
                jobs.clear();
                restore(window, "Date", dateDescriptor);
                restore(performance, "now", performanceNowDescriptor);
                for (const [key, descriptor] of Object.entries(timerDescriptors)) restore(window, key, descriptor);
                delete window[marker];
            },
        };
        Object.defineProperty(window, marker, { configurable: true, enumerable: false, value: handle });

        function restore(target, key, descriptor) {
            if (descriptor) Object.defineProperty(target, key, descriptor);
            else delete target[key];
        }
    })();`;
}

