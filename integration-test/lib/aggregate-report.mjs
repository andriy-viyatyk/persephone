import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { REPORT_ROOT, RUNNER_ROOT } from "./config.mjs";

export function relativeIdentity(file, name) {
    const relative = path.isAbsolute(file) ? path.relative(RUNNER_ROOT, file) : file;
    const normalized = path.posix.normalize(relative.replaceAll("\\", "/"));
    return `${process.platform === "win32" ? normalized.toLowerCase() : normalized}\0${name}`;
}

export async function collectModuleReport(stageDirectory, selected, target) {
    try {
        const report = JSON.parse(await readFile(path.join(stageDirectory, "report.json"), "utf8"));
        const results = [];
        for (const item of report.results ?? []) {
            const result = selected.find((candidate) => candidate.name === item.name && path.resolve(candidate.absoluteFile) === path.resolve(item.file));
            if (!result) continue;
            const aggregate = { file: result.file, name: result.name, requires: result.requires, status: item.status, durationMs: item.durationMs ?? 0,
                ...(item.skipReason ? { skipReason: item.skipReason } : {}),
                ...(item.error ? { failure: { message: item.error, step: item.step ?? "", path: "", response: "" } } : {}) };
            if (Array.isArray(item.screenshots) && item.screenshots.length) {
                aggregate.failure ??= { message: item.error ?? "Test failed.", step: item.step ?? "", path: "", response: "" };
                const names = [];
                for (const screenshot of item.screenshots) {
                    const source = path.resolve(stageDirectory, screenshot);
                    const filename = `${safe(result.file)}-${safe(result.name)}-${randomUUID()}${path.extname(screenshot)}`;
                    const destination = path.join(REPORT_ROOT, "screenshots", filename);
                    await mkdir(path.dirname(destination), { recursive: true });
                    await copyFile(source, destination);
                    names.push(path.relative(REPORT_ROOT, destination).replaceAll("\\", "/"));
                }
                aggregate.failure.screenshots = names;
            }
            results.push(aggregate);
        }
        if (report.setupFailure || results.length < selected.length) {
            const message = report.setupFailure ?? `Product runner exited with code ${report.summary?.failed ? 1 : 0} without reporting every selected identity.`;
            const present = new Set(results.map((result) => `${result.file}\0${result.name}`));
            for (const item of selected) if (!present.has(`${item.file}\0${item.name}`)) {
                const reason = skipReason(item, target);
                results.push(reason
                    ? { ...item, status: "skipped", durationMs: 0, skipReason: reason }
                    : { ...item, status: "failed", durationMs: 0, failure: { message, step: "product runner setup or launch", path: "", response: "" }, appMainLog: path.join(stageDirectory, "app-main.log") });
            }
        }
        for (const result of results) result.target = target.name;
        return results;
    } catch (error) {
        return selected.map((item) => {
            const reason = skipReason(item, target);
            return reason
                ? { file: item.file, name: item.name, requires: item.requires, status: "skipped", durationMs: 0, skipReason: reason, target: target.name }
                : { file: item.file, name: item.name, requires: item.requires, status: "failed", durationMs: 0,
                    failure: { message: `Could not read product runner report: ${error.message}`, step: "product runner report", path: "", response: "" },
                    appMainLog: path.join(stageDirectory, "app-main.log"), target: target.name };
        });
    }
}

function skipReason(item, target) {
    if (target.attach && item.requires?.includes("launch")) return "requires an owned app launch";
    if (item.requires?.some((tag) => tag !== "launch" && tag !== "desktop" && !target.with.includes(tag))) return `requires opt-in tags: ${item.requires.filter((tag) => tag !== "launch" && tag !== "desktop" && !target.with.includes(tag)).join(", ")}`;
    return undefined;
}

/** Compare this run with an earlier `latest.json` (`--baseline <file>`), per file and test name,
 *  for the selected tests only. Without a baseline there is no comparison. */
async function compareWithBaseline(baselinePath, results, selection) {
    if (!baselinePath) return undefined;
    const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
    const current = new Map(results.map((item) => [relativeIdentity(item.file, item.name), item]));
    const selected = new Set(selection.map((item) => relativeIdentity(item.file, item.name)));
    const old = new Map((baseline.results ?? []).map((item) => [relativeIdentity(item.file, item.name), item]));
    const comparison = [];
    for (const [key, before] of old) {
        if (!selected.has(key)) continue;
        const after = current.get(key);
        comparison.push({ file: before.file, name: before.name, baselineStatus: before.status,
            newStatus: after?.status ?? "missing", outcome: !after ? "missing" : before.status === after.status ? "unchanged" : "changed" });
    }
    for (const [key, after] of current) if (!old.has(key)) comparison.push({ file: after.file, name: after.name, baselineStatus: "missing", newStatus: after.status, outcome: "added" });
    return comparison;
}

export async function writeAggregateReport(results, { target, selection, startedAt, gone = [], baselinePath, environmentStop }) {
    const comparison = await compareWithBaseline(baselinePath, results, selection);
    const failed = results.filter((item) => item.status === "failed");
    const passed = results.filter((item) => item.status === "passed");
    const skipped = results.filter((item) => item.status === "skipped");
    const notRun = results.filter((item) => item.status === "not-run");
    const changed = comparison?.filter((item) => item.outcome !== "unchanged") ?? [];
    const resultOrder = new Map(selection.map((item, index) => [`${item.file}\0${item.name}`, index]));
    results.sort((left, right) => (resultOrder.get(`${left.file}\0${left.name}`) ?? Number.MAX_SAFE_INTEGER) - (resultOrder.get(`${right.file}\0${right.name}`) ?? Number.MAX_SAFE_INTEGER));
    const reportResults = results.map(({ file, name, status, durationMs, requires, skipReason, failure, target: resultTarget, appMainLog }) => ({
        file, name, status, durationMs,
        ...(requires?.length ? { requirements: requires } : {}),
        ...(skipReason ? { skipReason } : {}), ...(failure ? { failure } : {}),
        ...(resultTarget ? { target: resultTarget } : {}), ...(appMainLog ? { appMainLog } : {}),
    }));
    const payload = { runAt: startedAt, target, selection, summary: { passed: passed.length, failed: failed.length, skipped: skipped.length, notRun: notRun.length }, ...(environmentStop ? { environmentStop } : {}), results: reportResults,
        ...(gone.length ? { gone } : {}),
        ...(comparison ? { baseline: baselinePath, comparison, parity: { unchanged: comparison.length - changed.length, changed: changed.length } } : {}) };
    const lines = ["# Integration test report", "", `Run: ${startedAt}`, `Target: ${target}`, `Passed: ${passed.length}  Failed: ${failed.length}  Skipped: ${skipped.length}  Not run: ${notRun.length}`, ...(environmentStop ? [`Environment stop: ${environmentStop}`, "A not-run test may already have changed state."] : []), ...(comparison ? [`Baseline changes: ${changed.length} (${baselinePath})`] : []), ""];
    for (const result of results) {
        lines.push(`## ${result.status.toUpperCase()}: ${result.name}`, "", `File: \`${result.file}\``, `Duration: ${result.durationMs} ms`);
        if (result.skipReason) lines.push(`Reason: ${result.skipReason}`);
        if (result.failure) lines.push(`Step: ${result.failure.step}`, "", "Error:", "", fence(result.failure.message));
        if (result.failure?.screenshots) lines.push("Screenshots:", ...result.failure.screenshots.map((file) => `- [${file}](${encodeURI(file)})`));
        if (result.appMainLog) lines.push(`App log: [${result.appMainLog}](${encodeURI(result.appMainLog)})`);
        lines.push("");
    }
    if (gone.length) lines.push("## Saved failures that no longer exist", "", ...gone.map((item) => `- ${item.file} — ${item.name}`), "");
    if (comparison) lines.push("## Baseline comparison", "", ...comparison.map((item) => `- ${item.outcome}: ${item.file} — ${item.name} (${item.baselineStatus} → ${item.newStatus})`), "");
    await mkdir(REPORT_ROOT, { recursive: true });
    await atomic(path.join(REPORT_ROOT, "latest.json"), `${JSON.stringify(payload, null, 2)}\n`);
    await atomic(path.join(REPORT_ROOT, "latest.md"), `${lines.join("\n")}\n`);
    const rerun = results.filter((item) => item.status === "failed" || (environmentStop && item.status === "not-run"));
    await atomic(path.join(REPORT_ROOT, "last-failed.json"), `${JSON.stringify({ version: 1, failed: rerun.map(({ file, name }) => ({ file, name })) }, null, 2)}\n`);
    console.log(`Integration tests: ${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped${comparison ? `; baseline changes ${changed.length}` : ""}. Reports: ${REPORT_ROOT}`);
    for (const item of changed) console.log(`BASELINE ${item.outcome}: ${item.file} — ${item.name} (${item.baselineStatus} → ${item.newStatus})`);
    return { passed: passed.length, failed: failed.length, skipped: skipped.length, notRun: notRun.length, changed: changed.length };
}

async function atomic(file, content) {
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, content, "utf8");
    await rename(temporary, file);
}

function safe(value) { return value.replaceAll(/[\\/]/g, "_").replaceAll(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 100); }
function fence(value) { const longest = Math.max(2, ...[...String(value).matchAll(/`+/g)].map((item) => item[0].length)); const marker = "`".repeat(longest + 1); return `${marker}\n${value}\n${marker}`; }
