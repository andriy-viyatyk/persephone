import { test } from "../../../lib/context.mjs";
import { closePublishedSample, openPublishedSample, samePublishedRoot } from "../helpers.mjs";

const expectedCertificate = {
    validFrom: "2026-11-18 06:42:57 UTC",
    validUntil: "2036-11-15 06:42:57 UTC",
    sha1: "B4:30:D4:E3:63:30:A0:AC:65:9E:2C:2C:D8:A4:41:C1:83:D0:4D:71",
    sha256: "F7:78:67:3D:3B:44:35:33:B3:DA:19:B7:60:30:FC:E6:C7:93:72:AE:43:73:4D:7C:8A:20:F6:8D:02:D2:EA:26",
};

async function assertCertificate(ctx, handle) {
    const editor = ctx.app.pages[handle.id].editor;
    ctx.expect(samePublishedRoot(await editor.boardRoot, handle.root)).toBe(true);
    await ctx.waitFor(`pages[${JSON.stringify(handle.id)}].editor.frameReady`, (ready) => ready === true);
    await ctx.waitFor(() => editor.evaluate("() => document.querySelector('#report').hidden"), (hidden) => hidden === false, { timeout: 10000 });
    await ctx.waitFor(() => editor.evaluate("() => document.querySelector('#panel').innerText.includes('SHA-256')"), (ready) => ready === true, { timeout: 10000 });
    const state = await editor.evaluate("() => ({ panel: document.querySelector('#panel').innerText, title: document.querySelector('#selection-title').innerText, count: document.querySelector('#cert-count').innerText })");
    ctx.expect(state.count).toBe("1");
    ctx.expect(state.title).toContain("CN=Sample Test Certificate");
    ctx.expect(state.title).toContain("O=Example Test");
    ctx.expect(state.panel).toContain("CN=Sample Test Certificate");
    ctx.expect(state.panel).toContain("O=Example Test");
    ctx.expect(state.panel).toContain(expectedCertificate.validFrom);
    ctx.expect(state.panel).toContain(expectedCertificate.validUntil);
    ctx.expect(state.panel).toContain(expectedCertificate.sha1);
    ctx.expect(state.panel).toContain(expectedCertificate.sha256);
}

export default [
    test("certificate viewer shows PEM identity, validity and fingerprints", async (ctx) => {
        const handle = await openPublishedSample(ctx, "cert-viewer", "cert-viewer/sample.pem");
        try {
            await assertCertificate(ctx, handle);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, { requires: ["launch", "published-board-checkout"] }),

    test("certificate viewer reads the same certificate from DER", async (ctx) => {
        const handle = await openPublishedSample(ctx, "cert-viewer", "cert-viewer/sample.der");
        try {
            await assertCertificate(ctx, handle);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, { requires: ["launch", "published-board-checkout"] }),

    test("certificate viewer shows a visible error for a corrupt PEM file", async (ctx) => {
        const handle = await openPublishedSample(ctx, "cert-viewer", "cert-viewer/corrupt.pem");
        try {
            const editor = ctx.app.pages[handle.id].editor;
            ctx.expect(samePublishedRoot(await editor.boardRoot, handle.root)).toBe(true);
            await ctx.waitFor(() => editor.evaluate("() => !document.querySelector('#state').hidden && document.querySelector('#state').classList.contains('error')"), (error) => error === true, { timeout: 10000 });
            const state = await editor.evaluate("() => ({ state: document.querySelector('#state').innerText, reportHidden: document.querySelector('#report').hidden })");
            ctx.expect(state.state).toContain("Could not inspect this file.");
            ctx.expect(state.reportHidden).toBe(true);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, { requires: ["launch", "published-board-checkout"] }),
];
