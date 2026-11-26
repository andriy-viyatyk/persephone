import path from "node:path";
import { test } from "../../../lib/context.mjs";
import { fixtureBoard, trustFixtureBoard, untrustBoard } from "../../helpers/boards.mjs";
import { samePath } from "../../helpers/path-comparison.mjs";
import { isLinux, isWindows } from "../../../../src/shared/platform.ts";

export default test("board service receives the profile-local home environment", async (ctx) => {
    const root = fixtureBoard(ctx, "bridge/service-environment-board");
    try {
        await trustFixtureBoard(ctx, root);

        const paths = await ctx.app.main.runtime.paths;
        const profileLocalAppData = path.join(paths.userData, "test-local-app-data");
        const result = await ctx.app.boards.requestService(root, { op: "local-app-data" });

        if (isWindows) {
            const roamingAppData = await ctx.app.fs.commonFolder("appData");
            const realLocalAppData = path.join(path.dirname(roamingAppData), "Local");
            ctx.expect(samePath(result.localAppData, profileLocalAppData)).toBe(true);
            ctx.expect(samePath(result.localAppData, realLocalAppData)).toBe(false);
        } else if (isLinux) {
            ctx.expect(samePath(result.home, path.join(paths.userData, "test-home"))).toBe(true);
        }
    } finally {
        await untrustBoard(ctx, root);
    }
}, { requires: ["launch"] });
