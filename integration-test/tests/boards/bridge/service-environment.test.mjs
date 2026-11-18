import path from "node:path";
import { test } from "../../../lib/context.mjs";
import { fixtureBoard, trustFixtureBoard, untrustBoard } from "../../helpers/boards.mjs";

function comparablePath(value) {
    return value.replace(/[\\/]+/g, "\\").replace(/\\+$/, "").toLowerCase();
}

function samePath(left, right) {
    return typeof left === "string" && typeof right === "string"
        && comparablePath(left) === comparablePath(right);
}

export default test("board service inherits profile-local LOCALAPPDATA", async (ctx) => {
    const root = fixtureBoard(ctx, "bridge/service-environment-board");
    try {
        await trustFixtureBoard(ctx, root);

        const paths = await ctx.app.main.runtime.paths;
        const profileLocalAppData = path.join(paths.userData, "test-local-app-data");
        const roamingAppData = await ctx.app.fs.commonFolder("appData");
        const realLocalAppData = path.join(path.dirname(roamingAppData), "Local");
        const result = await ctx.app.boards.requestService(root, { op: "local-app-data" });

        ctx.expect(samePath(result.localAppData, profileLocalAppData)).toBe(true);
        ctx.expect(samePath(result.localAppData, realLocalAppData)).toBe(false);
    } finally {
        await untrustBoard(ctx, root);
    }
}, { requires: ["launch"] });
