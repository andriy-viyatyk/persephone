import { mkdir, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

/** Single-line text for headings and labels: collapse newlines, neutralize HTML. */
function markdown(value) {
    return String(value ?? "").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll(/\s*\n\s*/g, " ");
}

/** Multi-line text as a fenced block; the fence outgrows any backtick run inside the text. */
function fenced(value) {
    const text = String(value ?? "");
    const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
    const fence = "`".repeat(longest + 1);
    return `${fence}\n${text}\n${fence}`;
}

async function atomicWrite(filePath, content) {
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, content, "utf8");
    await rename(temporary, filePath);
}

export async function captureFailure(context, directory, id) {
    const client = context._getClient();
    const original = {
        message: context._state.failure?.message,
        step: context._state.step,
        path: client?.lastCallPath,
        response: client?.lastResponse,
    };
    let screenshot;
    let captureError;
    try {
        const image = await client.screenshot();
        const prefix = id.file.replaceAll(/[\\/]/g, "_").replaceAll(/[^a-zA-Z0-9_.-]/g, "_");
        const absolute = await saveScreenshot(image, directory, prefix);
        screenshot = path.relative(path.dirname(directory), absolute).replaceAll("\\", "/");
    } catch (error) {
        captureError = error.message;
    } finally {
        if (client) {
            client.lastCallPath = original.path;
            client.lastResponse = original.response;
        }
    }
    return { ...original, screenshot, captureError };
}

export async function saveScreenshot(image, directory, prefix = "screenshot") {
    const extension = image.mimeType === "image/jpeg" ? ".jpg" : image.mimeType === "image/png" ? ".png" : null;
    if (!extension) throw new Error(`Unsupported screenshot MIME type: ${image.mimeType}`);
    await mkdir(directory, { recursive: true });
    const filename = `${prefix}-${randomUUID()}${extension}`;
    const absolute = path.join(directory, filename);
    await writeFile(absolute, Buffer.from(image.data, "base64"), { flag: "wx" });
    return absolute;
}

export async function writeReports(results, { directory, target, selection, startedAt }) {
    await mkdir(directory, { recursive: true });
    const failed = results.filter((result) => result.status === "failed");
    const skipped = results.filter((result) => result.status === "skipped");
    const passed = results.filter((result) => result.status === "passed");
    const payload = {
        runAt: startedAt,
        target,
        selection,
        results: results.map((result) => ({
            file: result.file,
            name: result.name,
            status: result.status,
            durationMs: result.durationMs,
            ...(result.requirements?.length ? { requirements: result.requirements } : {}),
            ...(result.skipReason ? { skipReason: result.skipReason } : {}),
            ...(result.failure ? { failure: result.failure } : {}),
        })),
    };
    const markdownLines = ["# Integration test report", "", `Run: ${markdown(startedAt)}`, `Target: ${markdown(target)}`, `Selection: ${markdown(JSON.stringify(selection))}`, "", `Passed: ${passed.length}  Failed: ${failed.length}  Skipped: ${skipped.length}`, ""];
    for (const result of results) {
        markdownLines.push(`## ${markdown(result.status.toUpperCase())}: ${markdown(result.name)}`, "", `File: \`${markdown(result.file)}\``, `Duration: ${result.durationMs} ms`);
        if (result.status === "skipped") markdownLines.push(`Reason: ${markdown(result.skipReason)}`);
        if (result.failure) {
            markdownLines.push(`Step: ${markdown(result.failure.step)}`, `Path: \`${String(result.failure.path ?? "").replaceAll("`", "'")}\``, "", "Error:", "", fenced(result.failure.message), "", "Response:", "", fenced(result.failure.response));
            if (result.failure.screenshot) markdownLines.push(`Screenshot: [${markdown(result.failure.screenshot)}](${encodeURI(result.failure.screenshot)})`);
            if (result.failure.captureError) markdownLines.push(`Screenshot capture failed: ${markdown(result.failure.captureError)}`);
        }
        markdownLines.push("");
    }
    await atomicWrite(path.join(directory, "latest.json"), `${JSON.stringify(payload, null, 2)}\n`);
    await atomicWrite(path.join(directory, "latest.md"), `${markdownLines.join("\n")}\n`);
    await atomicWrite(path.join(directory, "last-failed.json"), `${JSON.stringify({ version: 1, failed: failed.map(({ file, name }) => ({ file, name })) }, null, 2)}\n`);
    for (const result of skipped) console.log(`SKIPPED ${result.file} — ${result.name}: ${result.skipReason}`);
    console.log(`Integration tests: ${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped. Reports: ${directory}`);
    return { passed: passed.length, failed: failed.length, skipped: skipped.length };
}
