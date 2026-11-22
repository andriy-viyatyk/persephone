import { startStaticServer, suitePath } from "../lib/static-server.mjs";

let server;
let baseUrl;

export async function beforeAll() {
    server = await startStaticServer(suitePath("../site"));
    baseUrl = server.url;
}

export async function afterAll() {
    await server?.close();
}

export default [
    test("the shipped mock page accepts and lists an item", async (ctx) => {
        const site = await ctx.openBrowser("about:blank");
        await site.attachTestExtension({
            host: new URL(baseUrl).host,
            scriptPath: suitePath("../model"),
            name: "Mock page model",
        });
        await site.navigateAndWait(baseUrl);

        // The model registers shortly after the page loads: poll the first read instead of sleeping.
        await ctx.expect.poll(() => site.app.heading()).toBe("Mock list");
        await site.type("label=New item", "Offline check");
        await site.click('role=button[name="Add item"]');

        await ctx.expect.poll(() => site.app.items(), {
            timeout: 5000,
            message: "The page model should report the submitted item",
        }).toEqual(["Offline check"]);
    }),
];
