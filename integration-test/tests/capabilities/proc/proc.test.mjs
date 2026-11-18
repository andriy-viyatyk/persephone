import { test } from "../../../lib/context.mjs";
import { readFile } from "node:fs/promises";

function nodeCommand(source, extraArgument) {
    const base = `node -e "${source}"`;
    return extraArgument === undefined ? base : `${base} "${extraArgument}"`;
}

async function scriptJson(ctx, source) {
    return JSON.parse(await ctx.script(source));
}

async function ensureNodeAvailable(ctx) {
    try {
        const result = await scriptJson(ctx, `
            const handle = app.proc.execute("node --version");
            const decoder = new TextDecoder();
            let version = "";
            handle.on("stdout", (chunk) => { version += decoder.decode(chunk); });
            const exit = await new Promise((resolve, reject) => {
                handle.on("exit", resolve);
                handle.on("error", reject);
            });
            return JSON.stringify({ version: version.trim(), exit });
        `);
        if (result.exit.code !== 0 || !result.version.startsWith("v")) {
            throw new Error(`Node version check failed: ${JSON.stringify(result)}`);
        }
    } catch (error) {
        throw new Error(`Node is unavailable on the test app PATH: ${error.message}`);
    }
}

function procTest(name, run) {
    return test(name, run, { requires: ["launch"] });
}

export default [
    procTest("one-shot text, JSON, and bytes return stdout", async (ctx) => {
        await ensureNodeAvailable(ctx);
        const result = await scriptJson(ctx, `
            const textHandle = app.proc.execute(${JSON.stringify(nodeCommand("process.stdout.write('proc text fixture')"))});
            const text = await textHandle.getText();
            let textMixError;
            try { textHandle.on("stdout", () => {}); } catch (error) { textMixError = error.message; }

            const jsonHandle = app.proc.execute(${JSON.stringify(nodeCommand("process.stdout.write(JSON.stringify({value:'proc json fixture'}))"))});
            const json = await jsonHandle.getJson();

            const bytesHandle = app.proc.execute(${JSON.stringify(nodeCommand("process.stdout.write(Buffer.from([0,1,127,255]))"))});
            const bytes = Array.from(await bytesHandle.getBytes());
            return JSON.stringify({ text, textMixError, json, bytes });
        `);
        ctx.expect(result.text).toBe("proc text fixture");
        ctx.expect(result.textMixError).toContain("cannot attach a stdout/stderr listener");
        ctx.expect(result.json).toEqual({ value: "proc json fixture" });
        ctx.expect(result.bytes).toEqual([0, 1, 127, 255]);
    }),

    procTest("non-zero exit rejects JSON with diagnostics", async (ctx) => {
        await ensureNodeAvailable(ctx);
        const result = await scriptJson(ctx, `
            const handle = app.proc.execute(${JSON.stringify(nodeCommand("process.stderr.write('proc diagnostic fixture');process.exitCode=7"))});
            try {
                await handle.getJson();
                return JSON.stringify({ unexpectedSuccess: true });
            } catch (error) {
                return JSON.stringify({ name: error.name, exitCode: error.exitCode, stderr: error.stderr, message: error.message });
            }
        `);
        ctx.expect(result.name).toBe("RunnerError");
        ctx.expect(result.exitCode).toBe(7);
        ctx.expect(result.stderr).toContain("proc diagnostic fixture");
        ctx.expect(result.message).toContain("Command exited with code 7");
    }),

    procTest("streaming delivers stdout, stderr, and exit", async (ctx) => {
        await ensureNodeAvailable(ctx);
        const result = await scriptJson(ctx, `
            const handle = app.proc.execute(${JSON.stringify(nodeCommand("process.stdout.write('proc stdout fixture');process.stderr.write('proc stderr fixture')"))});
            const decoder = new TextDecoder();
            let stdout = "";
            let stderr = "";
            handle.on("stdout", (chunk) => { stdout += decoder.decode(chunk); });
            handle.on("stderr", (chunk) => { stderr += decoder.decode(chunk); });
            const exit = await new Promise((resolve, reject) => {
                handle.on("exit", resolve);
                handle.on("error", reject);
            });
            let getterError;
            try { await handle.getText(); } catch (error) { getterError = error.message; }
            return JSON.stringify({ stdout, stderr, exit, getterError });
        `);
        ctx.expect(result.stdout).toBe("proc stdout fixture");
        ctx.expect(result.stderr).toBe("proc stderr fixture");
        ctx.expect(result.exit).toEqual({ code: 0, signal: null });
        ctx.expect(result.getterError).toContain("streaming mode");
    }),

    procTest("stdin, cwd, env, and direct spawn options work", async (ctx) => {
        await ensureNodeAvailable(ctx);
        const cwd = ctx.fixture("us-2117/proc/cwd");
        await ctx.app.fs.removeDir(cwd, true);
        await ctx.app.fs.mkdir(cwd);
        const result = await scriptJson(ctx, `
            const inputHandle = app.proc.execute("cmd.exe", { shell: false });
            const inputPromise = inputHandle.getText();
            inputHandle.write("echo proc stdin fixture\\r\\nexit\\r\\n");
            inputHandle.endStdin();
            const input = await inputPromise;

            const optionHandle = app.proc.execute(${JSON.stringify(nodeCommand("process.stdout.write(JSON.stringify([process.cwd(),process.env.US2117_FIXTURE]))"))}, {
                cwd: ${JSON.stringify(cwd)}, env: { US2117_FIXTURE: "synthetic-env-value" },
            });
            return JSON.stringify({ input, options: await optionHandle.getJson() });
        `);
        ctx.expect(result.input).toContain("proc stdin fixture");
        ctx.expect(result.options).toEqual([cwd, "synthetic-env-value"]);
    }),

    procTest("spawn failures are reported as errors", async (ctx) => {
        const missingPath = ctx.fixture("us-2117/proc/missing-executable.exe");
        const result = await scriptJson(ctx, `
            const handle = app.proc.execute(${JSON.stringify(missingPath)}, { shell: false });
            const error = await new Promise((resolve) => handle.on("error", resolve));
            return JSON.stringify(error);
        `);
        ctx.expect(result.message).toContain(missingPath);
    }),

    procTest("kill ends the child process tree", async (ctx) => {
        const marker = ctx.fixture("us-2117/proc/child-pid.txt");
        try { await ctx.app.fs.removeFile(marker); } catch { /* No marker exists on the first run. */ }
        const command = nodeCommand(
            "require('node:fs').writeFileSync(process.argv[1],String(process.pid));process.stdout.write(String(process.pid));setInterval(()=>{},1000)",
            marker,
        );
        let scriptPromise;
        let pid;
        try {
            scriptPromise = scriptJson(ctx, `
                const handle = app.proc.execute(${JSON.stringify(command)});
                const decoder = new TextDecoder();
                let finished = false;
                const exitPromise = new Promise((resolve, reject) => {
                    let output = "";
                    handle.on("stdout", (chunk) => {
                        output += decoder.decode(chunk);
                        if (/^\\d+$/.test(output)) handle.kill();
                    });
                    handle.on("exit", (exit) => { finished = true; resolve({ output, exit }); });
                    handle.on("error", (error) => { finished = true; reject(error); });
                });
                try { return JSON.stringify(await exitPromise); }
                finally {
                    if (!finished) {
                        handle.kill();
                        await exitPromise.catch(() => {});
                    }
                }
            `);
            pid = Number(await ctx.waitFor(
                async () => readFile(marker, "utf8").catch(() => null),
                (value) => value !== null && /^\d+$/.test(value.trim()),
            ));
            const result = await scriptPromise;
            ctx.expect(result.output).toBe(String(pid));
            ctx.expect(result.exit.code === null || result.exit.code !== 0).toBe(true);
            const gone = await ctx.waitFor(
                () => {
                    try { process.kill(pid, 0); return false; }
                    catch { return true; }
                },
                (value) => value === true,
            );
            ctx.expect(gone).toBe(true);
        } finally {
            if (pid) {
                try { process.kill(pid); } catch { /* The child may already have exited. */ }
            }
            if (scriptPromise) await scriptPromise.catch(() => {});
        }
    }),
];
