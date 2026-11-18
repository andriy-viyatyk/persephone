import { test } from "../../../lib/context.mjs";
import { closeBoardPage, fixtureBoard, openBoardPage, trustFixtureBoard, untrustBoard } from "../../helpers/boards.mjs";

const MODULE_SERVICE = "module-service";
const ROUND_TRIP_BOARD = `${MODULE_SERVICE}/round-trip-board`;
const SETTINGS_BOARD = `${MODULE_SERVICE}/settings-board`;
const CRASH_BOARD = `${MODULE_SERVICE}/crash-board`;

function sameRoot(left, right) {
    return typeof left === "string" && typeof right === "string"
        && left.replace(/[\\/]+/g, "\\").replace(/\\+$/, "").toLowerCase()
            === right.replace(/[\\/]+/g, "\\").replace(/\\+$/, "").toLowerCase();
}

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
