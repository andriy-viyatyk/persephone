import { test } from "../../../lib/context.mjs";
import path from "node:path";
import { isLinux, isWindows } from "../../../../src/shared/platform.ts";
import { closeBoardPage, fixtureBoard, openBoardPage, trustFixtureBoard, untrustBoard } from "../../helpers/boards.mjs";
import { comparablePath, samePath } from "../../helpers/path-comparison.mjs";

const MODULE_SERVICE = "module-service";
const ROUND_TRIP_BOARD = `${MODULE_SERVICE}/round-trip-board`;
const SETTINGS_BOARD = `${MODULE_SERVICE}/settings-board`;
const CRASH_BOARD = `${MODULE_SERVICE}/crash-board`;

const sameRoot = samePath;

async function serviceRecord(ctx, root) {
    const boards = await ctx.app.boards.list();
    return boards.find((board) => sameRoot(board.root, root))?.service;
}

async function stopFixtureService(ctx, root) {
    const current = await serviceRecord(ctx, root);
    if (!current) return;
    if (current.state !== "stopped") {
        await ctx.app.boards.stopService(root);
    }
    await ctx.waitFor(
        (active) => active.app.boards.list(),
        (boards) => {
            const service = boards.find((board) => sameRoot(board.root, root))?.service;
            return service?.state === "stopped" && service.pid === undefined;
        },
    );
}

async function cleanupFixture(ctx, root, pageIds = []) {
    for (const pageId of pageIds) await closeBoardPage(ctx, pageId);
    try {
        await stopFixtureService(ctx, root);
    } finally {
        await untrustBoard(ctx, root);
    }
}

function assertSandboxEnvironment(ctx, environment, userData) {
    const testHome = path.join(userData, "test-home");
    const testBin = path.join(userData, "test-bin");
    const localAppData = path.join(userData, "test-local-app-data");
    ctx.expect(comparablePath(environment.CLAUDE_CONFIG_DIR)).toBe(comparablePath(path.join(testHome, ".claude")));
    ctx.expect(comparablePath(environment.CODEX_HOME)).toBe(comparablePath(path.join(testHome, ".codex")));
    if (isLinux) {
        const expected = {
            HOME: testHome,
            XDG_CONFIG_HOME: path.join(testHome, ".config"),
            XDG_DATA_HOME: path.join(testHome, ".local", "share"),
            XDG_CACHE_HOME: path.join(testHome, ".cache"),
            XDG_STATE_HOME: path.join(testHome, ".local", "state"),
            CLAUDE_CONFIG_DIR: path.join(testHome, ".claude"),
            CODEX_HOME: path.join(testHome, ".codex"),
        };
        for (const [key, value] of Object.entries(expected)) {
            ctx.expect(comparablePath(environment[key])).toBe(comparablePath(value));
        }
        ctx.expect(environment.XDG_RUNTIME_DIR).toBe(null);
        const expectedPath = [testBin, "/usr/local/bin", "/usr/bin", "/bin"];
        ctx.expect(environment.PATH.split(path.delimiter).map(comparablePath)).toEqual(expectedPath.map(comparablePath));
        ctx.expect(environment.PATH).not.toContain(path.join(testHome, ".npm"));
        ctx.expect(environment.PATH).not.toContain(path.join(testHome, ".claude"));
        ctx.expect(environment.PATH).not.toContain(path.join(testHome, ".codex"));
        return;
    }
    if (!isWindows) return;
    const { root } = path.parse(testHome);
    const expected = {
        USERPROFILE: testHome,
        HOMEDRIVE: root.replace(/[\\/]+$/, ""),
        HOMEPATH: path.relative(root, testHome).replace(/^/, path.sep),
        APPDATA: path.join(testHome, "AppData", "Roaming"),
        LOCALAPPDATA: localAppData,
    };
    for (const [key, value] of Object.entries(expected)) {
        ctx.expect(comparablePath(environment[key])).toBe(comparablePath(value));
    }

    const systemRoot = environment.SystemRoot;
    const expectedPath = [
        testBin,
        path.join(systemRoot, "System32"),
        systemRoot,
        path.join(systemRoot, "System32", "Wbem"),
        path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0"),
    ];
    ctx.expect(environment.PATH.split(path.delimiter).map(comparablePath)).toEqual(expectedPath.map(comparablePath));
    ctx.expect(comparablePath(environment.PATH).includes(comparablePath("\\appdata\\local\\programs\\"))).toBe(false);
    ctx.expect(comparablePath(environment.PATH).includes(comparablePath("\\npm\\"))).toBe(false);
    ctx.expect(comparablePath(environment.PATH).includes(comparablePath("\\claude\\"))).toBe(false);
    ctx.expect(comparablePath(environment.PATH).includes(comparablePath("\\codex\\"))).toBe(false);
}

function serviceTest(name, run) {
    return test(name, run, { requires: ["launch"] });
}

export default [
    serviceTest("page request lazily starts the service and reports running status", async (ctx) => {
        const root = fixtureBoard(ctx, ROUND_TRIP_BOARD);
        let page;
        try {
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            const reply = await page.editor.evaluate("async () => await window.persephone.service.request({ op: 'echo', value: 'fixture' })");
            ctx.expect(reply).toEqual({ op: "echo", value: "fixture", handledBy: "module-service-fixture" });

            const running = await ctx.waitFor(
                (active) => active.app.boards.list(),
                (boards) => boards.find((board) => sameRoot(board.root, root))?.service?.state === "running",
            );
            const service = running.find((board) => sameRoot(board.root, root)).service;
            ctx.expect(service.pid).toBeTruthy();
            ctx.expect(service.startedAt).toBeTruthy();
        } finally {
            await cleanupFixture(ctx, root, [page?.id]);
        }
    }),

    serviceTest("page and service exchange a channel message", async (ctx) => {
        const root = fixtureBoard(ctx, ROUND_TRIP_BOARD);
        let page;
        try {
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            const reply = await page.editor.evaluate(`async () => {
                const channel = await window.persephone.service.openChannel({ op: "round-trip" });
                try {
                    return await new Promise((resolve, reject) => {
                        channel.onMessage(resolve);
                        channel.onClose((reason) => reject(new Error(reason.message)));
                        channel.send({ value: "fixture-channel" });
                    });
                } finally {
                    channel.close();
                }
            }`);
            ctx.expect(reply).toEqual({ value: "fixture:fixture-channel", handledBy: "module-service-fixture" });
        } finally {
            await cleanupFixture(ctx, root, [page?.id]);
        }
    }),

    serviceTest("service remains available without a page until explicitly stopped", async (ctx) => {
        const root = fixtureBoard(ctx, ROUND_TRIP_BOARD);
        let page;
        try {
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            await page.editor.evaluate("async () => await window.persephone.service.request({ op: 'echo', value: 'initial' })");
            const running = await ctx.waitFor(
                (active) => active.app.boards.list(),
                (boards) => boards.find((board) => sameRoot(board.root, root))?.service?.state === "running",
            );
            const pid = running.find((board) => sameRoot(board.root, root)).service.pid;

            await closeBoardPage(ctx, page.id);
            page = undefined;
            const afterClose = await ctx.waitFor(
                (active) => active.app.boards.list(),
                (boards) => {
                    const service = boards.find((board) => sameRoot(board.root, root))?.service;
                    return service?.state === "running" && service.pid === pid;
                },
            );
            ctx.expect(afterClose.find((board) => sameRoot(board.root, root)).service.pid).toBe(pid);
            ctx.expect(await ctx.app.boards.requestService(root, { op: "echo", value: "background" })).toEqual({
                op: "echo",
                value: "background",
                handledBy: "module-service-fixture",
            });

            await ctx.app.boards.stopService(root);
            const stopped = await ctx.waitFor(
                (active) => active.app.boards.list(),
                (boards) => {
                    const service = boards.find((board) => sameRoot(board.root, root))?.service;
                    return service?.state === "stopped" && service.pid === undefined;
                },
            );
            ctx.expect(stopped.find((board) => sameRoot(board.root, root)).service.state).toBe("stopped");
        } finally {
            await cleanupFixture(ctx, root, [page?.id]);
        }
    }),

    serviceTest("two content-host pages share one service lease", async (ctx) => {
        const root = fixtureBoard(ctx, ROUND_TRIP_BOARD);
        const firstFile = ctx.fixture(`boards/${ROUND_TRIP_BOARD}/samples/first.svc-test`);
        const secondFile = ctx.fixture(`boards/${ROUND_TRIP_BOARD}/samples/second.svc-test`);
        let firstId;
        let secondId;
        try {
            await trustFixtureBoard(ctx, root);
            firstId = (await ctx.app.pages.openFile(firstFile)).id;
            secondId = (await ctx.app.pages.openFile(secondFile)).id;
            ctx.expect(firstId === secondId).toBe(false);

            for (const pageId of [firstId, secondId]) {
                await ctx.waitFor(
                    (active) => active.app.pages[pageId].editor.id,
                    (id) => id === `board-editor:${root}`,
                );
                ctx.expect(await ctx.app.pages[pageId].editor.boardRoot).toBe(root);
                await ctx.waitFor(
                    (active) => active.app.pages[pageId].editor.frameReady,
                    (ready) => ready === true,
                );
            }

            const first = ctx.handle(ctx.app.pages[firstId].editor);
            const second = ctx.handle(ctx.app.pages[secondId].editor);
            const firstIdentity = await first.evaluate("async () => await window.persephone.service.request({ op: 'identity' })");
            const secondIdentity = await second.evaluate("async () => await window.persephone.service.request({ op: 'identity' })");
            ctx.expect(firstIdentity.pid).toBe(secondIdentity.pid);

            await closeBoardPage(ctx, firstId);
            firstId = undefined;
            const remainingIdentity = await second.evaluate("async () => await window.persephone.service.request({ op: 'identity' })");
            ctx.expect(remainingIdentity.pid).toBe(firstIdentity.pid);
            const running = await ctx.waitFor(
                (active) => active.app.boards.list(),
                (boards) => boards.find((board) => sameRoot(board.root, root))?.service?.state === "running",
            );
            ctx.expect(running.find((board) => sameRoot(board.root, root)).service.pid).toBe(firstIdentity.pid);
        } finally {
            await cleanupFixture(ctx, root, [firstId, secondId]);
        }
    }),

    serviceTest("service reads the fixture board setting", async (ctx) => {
        const root = fixtureBoard(ctx, SETTINGS_BOARD);
        try {
            await trustFixtureBoard(ctx, root);
            ctx.expect(await ctx.app.boards.requestService(root, { op: "setting" })).toBe("fixture-default");
        } finally {
            await cleanupFixture(ctx, root);
        }
    }),

    serviceTest("service receives its test-profile board data path", async (ctx) => {
        const root = fixtureBoard(ctx, ROUND_TRIP_BOARD);
        try {
            await trustFixtureBoard(ctx, root);
            const result = await ctx.app.boards.requestService(root, { op: "environment" });
            const paths = await ctx.app.main.runtime.paths;
            ctx.expect(sameRoot(result.boardData, path.join(paths.userData, "board-data", "round-trip-board"))).toBe(true);
        } finally {
            await cleanupFixture(ctx, root);
        }
    }),

    serviceTest("service and board child processes receive the test profile sandbox", async (ctx) => {
        const root = fixtureBoard(ctx, ROUND_TRIP_BOARD);
        let page;
        try {
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            const userData = (await ctx.app.main.runtime.paths).userData;
            const serviceReply = await ctx.app.boards.requestService(root, { op: "environment" });
            ctx.expect(sameRoot(serviceReply.boardData, path.join(userData, "board-data", "round-trip-board"))).toBe(true);
            assertSandboxEnvironment(ctx, serviceReply.environment, userData);

            const executeEnvironment = await page.editor.evaluate(
                "async () => await window.persephone.execute('node scripts/environment.mjs').getJson(/@@RESULT@@(.*)/)",
            );
            assertSandboxEnvironment(ctx, executeEnvironment, userData);

            const executeNodeEnvironment = await page.editor.evaluate(
                "async () => await window.persephone.executeNode('scripts/environment.mjs').getJson(/@@RESULT@@(.*)/)",
            );
            assertSandboxEnvironment(ctx, executeNodeEnvironment, userData);
            if (isWindows) {
                ctx.expect(executeEnvironment.PATHEXT).toBe(serviceReply.environment.PATHEXT);
                ctx.expect(executeNodeEnvironment.PATHEXT).toBe(serviceReply.environment.PATHEXT);
                for (const lookup of executeEnvironment.pathLookups) {
                    ctx.expect(comparablePath(lookup)).toBe(comparablePath(executeEnvironment.PATH));
                }
                for (const lookup of executeNodeEnvironment.pathLookups) {
                    ctx.expect(comparablePath(lookup)).toBe(comparablePath(executeNodeEnvironment.PATH));
                }
            }

            const testHome = path.join(userData, "test-home");
            if (isWindows) {
                for (const folder of ["AppData", ".claude", ".codex"]) {
                    ctx.expect(await ctx.app.fs.listDir(testHome)).toContain(folder);
                }
                ctx.expect(await ctx.app.fs.listDir(path.join(testHome, "AppData"))).toContain("Roaming");
                for (const folder of ["test-bin", "test-local-app-data"]) {
                    ctx.expect(await ctx.app.fs.listDir(userData)).toContain(folder);
                }
            } else if (isLinux) {
                for (const folder of [".config", ".local", ".cache", ".claude", ".codex"]) {
                    ctx.expect(await ctx.app.fs.listDir(testHome)).toContain(folder);
                }
                ctx.expect(await ctx.app.fs.listDir(path.join(testHome, ".local"))).toContain("share");
                ctx.expect(await ctx.app.fs.listDir(path.join(testHome, ".local"))).toContain("state");
                ctx.expect(await ctx.app.fs.listDir(userData)).toContain("test-bin");
                ctx.expect(await ctx.app.fs.listDir(path.join(userData, "test-bin"))).toContain("node");
            }

            const nodeCheck = await ctx.script(`
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
            const parsedNodeCheck = JSON.parse(nodeCheck);
            ctx.expect(parsedNodeCheck.exit.code).toBe(0);
            ctx.expect(parsedNodeCheck.version.startsWith("v")).toBe(true);
        } finally {
            await cleanupFixture(ctx, root, [page?.id]);
        }
    }),

    serviceTest("crash budget exhausts and Board Info shows failed status", async (ctx) => {
        const root = fixtureBoard(ctx, CRASH_BOARD);
        let page;
        try {
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            await ctx.app.boards.startService(root);
            const failedBoards = await ctx.waitFor(
                (active) => active.app.boards.list(),
                (boards) => {
                    const service = boards.find((board) => sameRoot(board.root, root))?.service;
                    return service?.state === "failed" && service.restartCount === 3;
                },
            );
            const failed = failedBoards.find((board) => sameRoot(board.root, root)).service;
            ctx.expect(failed.pid).toBe(undefined);
            ctx.expect(failed.restartCount).toBe(3);

            let requestError;
            try {
                await ctx.app.boards.requestService(root, { op: "echo" });
            } catch (error) {
                requestError = error;
            }
            ctx.expect(requestError.message).toContain(failed.reason);

            const pageSlot = `[data-name="page-slot"][data-page-id="${page.id}"]`;
            await ctx.app.window.screen.click(`${pageSlot} [data-name="board-toolbar-more"]`);
            await ctx.app.window.screen.click(`[data-name="board-menu"] [data-name="board-properties"]`);
            await ctx.waitFor(
                (active) => active.app.pages[page.id].editor.id,
                (id) => id === "board-info",
            );
            const infoText = await ctx.waitFor(
                (active) => active.app.window.screen.evaluate(`() => document.querySelector(${JSON.stringify(`${pageSlot} [data-name="board-info-editor"]`)})?.textContent ?? ""`),
                (text) => text.includes("State: failed") && text.includes("Restarts: 3"),
            );
            ctx.expect(infoText).toContain("State: failed");
            ctx.expect(infoText).toContain("Restarts: 3");

            const terminalFailure = await ctx.waitFor(
                (active) => active.app.boards.list(),
                (boards) => {
                    const service = boards.find((board) => sameRoot(board.root, root))?.service;
                    return service?.state === "failed" && service.restartCount === 3 && service.pid === undefined;
                },
            );
            ctx.expect(terminalFailure.find((board) => sameRoot(board.root, root)).service.state).toBe("failed");
        } finally {
            await cleanupFixture(ctx, root, [page?.id]);
        }
    }),
];
