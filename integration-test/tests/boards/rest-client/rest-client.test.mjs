import { test } from "../../../lib/context.mjs";
import { closeBoardPage } from "../../helpers/boards.mjs";

const collectionPath = "boards/rest-client/collection.rest.json";
const contentMaskPath = "boards/rest-client/content-mask.json";

function request(id, name, collection, method, url, options = {}) {
    return {
        id,
        name,
        collection,
        method,
        url,
        headers: options.headers ?? [],
        body: options.body ?? "",
        bodyType: options.bodyType ?? "none",
        bodyLanguage: options.bodyLanguage ?? "plaintext",
        formData: [],
        binaryFilePath: "",
        formDataEntries: [],
    };
}

function collectionText(requests) {
    return `${JSON.stringify({ type: "rest-client", requests }, null, 2)}\n`;
}

async function resetCollection(ctx, requests) {
    await ctx.app.fs.write(ctx.fixture(collectionPath), collectionText(requests));
}

async function openRestClient(ctx, path) {
    const opened = await ctx.app.pages.openFile(ctx.fixture(path));
    if (!opened?.id) throw new Error(`Could not open REST Client fixture: ${path}`);
    return opened.id;
}

async function waitForRestClient(ctx, pageId) {
    await ctx.waitFor(`pages[${JSON.stringify(pageId)}].editor.frameReady`, (value) => value === true, { timeout: 15000 });
    const model = await ctx.waitFor(
        async (active) => {
            try {
                const editorApp = active.app.pages[pageId].editor.app;
                const id = await editorApp.id;
                const requests = await editorApp.requests;
                return id === "rest-client" && Array.isArray(requests) ? { id, requests } : null;
            } catch {
                return null;
            }
        },
        (value) => value !== null,
        { timeout: 15000 },
    );
    return model;
}

async function readRestModel(ctx, pageId, member) {
    return ctx.waitFor(
        async (active) => {
            try {
                return await active.app.pages[pageId].editor.app[member];
            } catch {
                return null;
            }
        },
        (value) => value !== null,
        { timeout: 15000 },
    );
}

async function closePage(ctx, pageId) {
    await closeBoardPage(ctx, pageId);
}

export default [
    test("opens a .rest.json collection in the bundled REST Client and lists its requests", async (ctx) => {
        const requests = [
            request("us2098-get", "Fake GET request", "Fake collection", "GET", ctx.httpUrl("/echo")),
            request("us2098-post", "Fake POST request", "Fake collection", "POST", ctx.httpUrl("/echo"), {
                body: "{\"fake\":true}", bodyType: "raw", bodyLanguage: "json",
            }),
        ];
        let pageId;
        try {
            await resetCollection(ctx, requests);
            pageId = await openRestClient(ctx, collectionPath);
            await waitForRestClient(ctx, pageId);
            const editorId = await ctx.app.pages[pageId].editor.id;
            const modelId = await ctx.app.pages[pageId].editor.app.id;
            const modelRequests = await readRestModel(ctx, pageId, "requests");
            ctx.expect(editorId.startsWith("board-editor:")).toBe(true);
            ctx.expect(modelId).toBe("rest-client");
            ctx.expect(modelRequests.map(({ id, name }) => ({ id, name }))).toEqual(requests.map(({ id, name }) => ({ id, name })));

            const editor = ctx.handle(ctx.app.pages[pageId].editor);
            await editor.switchTab("board-secondary:requests");
            const snapshot = await editor.snapshot();
            ctx.expect(snapshot).toContain("Fake GET request");
            ctx.expect(snapshot).toContain("Fake POST request");
        } finally {
            await closePage(ctx, pageId);
        }
    }),

    test("content match offers the REST Client editor for a plain .json file", async (ctx) => {
        const requests = [request("us2098-content", "Fake content-mask request", "", "GET", ctx.httpUrl("/echo"))];
        let pageId;
        try {
            await ctx.app.fs.write(ctx.fixture(contentMaskPath), collectionText(requests));
            const opened = await ctx.app.pages.openFile(ctx.fixture(contentMaskPath));
            pageId = opened.id;
            ctx.expect(await ctx.app.pages[pageId].editor.id).toBe("monaco");
            const options = await ctx.app.pages[pageId].editorSwitches.options;
            const restClientOption = options.find((option) => option.label === "REST Client" && option.id.startsWith("board-editor:"));
            ctx.expect(restClientOption).toBeTruthy();
            await ctx.app.pages[pageId].editorSwitches.switchTo(restClientOption.id);
            const model = await waitForRestClient(ctx, pageId);
            ctx.expect(model.id).toBe("rest-client");
            ctx.expect(model.requests.map(({ id, name }) => ({ id, name }))).toEqual(requests.map(({ id, name }) => ({ id, name })));
        } finally {
            await closePage(ctx, pageId);
        }
    }),

    test("sends GET to the loopback fixture and shows status, body, and headers", async (ctx) => {
        const responseBody = await ctx.callText("fs.read", [ctx.fixture("http/rest-client/get.json")]);
        await resetCollection(ctx, [request("us2098-get-response", "Fake GET response", "", "GET", ctx.httpUrl("/rest-client/get.json"))]);
        let pageId;
        try {
            pageId = await openRestClient(ctx, collectionPath);
            await waitForRestClient(ctx, pageId);
            const response = await ctx.app.pages[pageId].editor.app.send();
            const modelResponse = await ctx.app.pages[pageId].editor.app.response;
            const contentType = response.headers.find(({ key }) => key.toLowerCase() === "content-type");
            ctx.expect(response.status).toBe(200);
            ctx.expect(response.body).toBe(responseBody);
            ctx.expect(contentType.value).toContain("application/json");
            ctx.expect(modelResponse).toEqual(response);
        } finally {
            await closePage(ctx, pageId);
        }
    }),

    test("sends POST body and header to the local echo route", async (ctx) => {
        const payload = "{\"fake\":\"us2098\"}";
        const headerValue = "fake-header-value";
        await resetCollection(ctx, [request("us2098-post-echo", "Fake POST echo", "", "POST", ctx.httpUrl("/echo"), {
            headers: [{ key: "X-US-2098", value: headerValue, enabled: true }],
            body: payload,
            bodyType: "raw",
            bodyLanguage: "json",
        })]);
        let pageId;
        try {
            pageId = await openRestClient(ctx, collectionPath);
            await waitForRestClient(ctx, pageId);
            const response = await ctx.app.pages[pageId].editor.app.send();
            const echoed = JSON.parse(response.body);
            ctx.expect(response.status).toBe(200);
            ctx.expect(echoed.method).toBe("POST");
            ctx.expect(echoed.body).toBe(payload);
            ctx.expect(echoed.headers["x-us-2098"]).toBe(headerValue);
        } finally {
            await closePage(ctx, pageId);
        }
    }),

    test("shows an HTTP 404 as a response rather than a transport error", async (ctx) => {
        await resetCollection(ctx, [request("us2098-404", "Fake missing fixture", "", "GET", ctx.httpUrl("/rest-client/does-not-exist.json"))]);
        let pageId;
        try {
            pageId = await openRestClient(ctx, collectionPath);
            await waitForRestClient(ctx, pageId);
            const response = await ctx.app.pages[pageId].editor.app.send();
            ctx.expect(response.status).toBe(404);
            ctx.expect(response.body).toBe("Not Found\n");
        } finally {
            await closePage(ctx, pageId);
        }
    }),

    test("shows a loopback connection-refused request as a transport failure", async (ctx) => {
        await resetCollection(ctx, [request("us2098-refused", "Fake refused request", "", "GET", ctx.httpUrl("/refused"))]);
        let pageId;
        try {
            pageId = await openRestClient(ctx, collectionPath);
            await waitForRestClient(ctx, pageId);
            const response = await ctx.app.pages[pageId].editor.app.send();
            ctx.expect(response.status).toBe(0);
            ctx.expect(response.headers).toEqual([]);
            ctx.expect(response.body.length > 0).toBe(true);
        } finally {
            await closePage(ctx, pageId);
        }
    }),

    test("saves an edited request back to the collection file", async (ctx) => {
        const requestId = "us2098-save-url";
        const newUrl = ctx.httpUrl("/echo?source=edited");
        await resetCollection(ctx, [request(requestId, "Fake saved request", "Fake save collection", "GET", ctx.httpUrl("/echo"))]);
        let pageId;
        try {
            pageId = await openRestClient(ctx, collectionPath);
            await waitForRestClient(ctx, pageId);
            await ctx.app.pages[pageId].editor.app.setRequestUrl(requestId, newUrl);
            await ctx.waitFor(`pages[${JSON.stringify(pageId)}].modified`, (modified) => modified === true, { timeout: 10000 });
            ctx.expect(await ctx.app.pages[pageId].save()).toBe(true);
            const savedText = await ctx.waitFor(
                async (active) => {
                    try {
                        return await active.callText("fs.read", [ctx.fixture(collectionPath)]);
                    } catch {
                        return null;
                    }
                },
                (content) => {
                    if (typeof content !== "string") return false;
                    try { return JSON.parse(content).requests?.some((item) => item.id === requestId && item.url === newUrl) ?? false; }
                    catch { return false; }
                },
                { timeout: 15000 },
            );
            ctx.expect(JSON.parse(savedText).type).toBe("rest-client");
            ctx.expect(JSON.parse(savedText).requests.find((item) => item.id === requestId).url).toBe(newUrl);
            const modified = await ctx.waitFor(`pages[${JSON.stringify(pageId)}].modified`, (value) => value === false, { timeout: 10000 });
            ctx.expect(modified).toBe(false);
        } finally {
            await closePage(ctx, pageId);
        }
    }),

    test("http.request.open creates a request page without sending it", async (ctx) => {
        const payload = {
            url: ctx.httpUrl("/echo"),
            method: "POST",
            headers: { "X-US-2098": "fake-capability-header", "Content-Type": "application/json" },
            body: "{\"capability\":\"fake\"}",
            title: "Fake capability request",
        };
        const result = await ctx.app.capabilities["http.request.open"].open(payload);
        const pageId = result.pageId;
        // Leave this untitled unsaved page for runner cleanup, which answers its close prompt with Don't Save.
        await ctx.waitFor(`pages[${JSON.stringify(pageId)}].editor.frameReady`, (value) => value === true, { timeout: 15000 });
        const model = await ctx.waitFor(
            async (active) => {
                try {
                    const editorApp = active.app.pages[pageId].editor.app;
                    const id = await editorApp.id;
                    const selectedRequest = await editorApp.selectedRequest;
                    const requests = await editorApp.requests;
                    const response = await editorApp.response;
                    return id === "rest-client" && selectedRequest && Array.isArray(requests)
                        ? { id, selectedRequest, requests, response } : null;
                } catch {
                    return null;
                }
            },
            (value) => value !== null,
            { timeout: 15000 },
        );
        ctx.expect(model.id).toBe("rest-client");
        ctx.expect(model.requests.length).toBe(1);
        ctx.expect(model.selectedRequest.url).toBe(payload.url);
        ctx.expect(model.selectedRequest.method).toBe(payload.method);
        ctx.expect(model.selectedRequest.headers.find(({ key }) => key === "X-US-2098")).toEqual({
            key: "X-US-2098", value: "fake-capability-header", enabled: true,
        });
        ctx.expect(model.selectedRequest.body).toBe(payload.body);
        ctx.expect(model.response).toBe(null);
    }),
];
