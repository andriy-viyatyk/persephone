import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { test } from "../../../lib/context.mjs";
import { closePublishedSample, openPublishedSample } from "../helpers.mjs";

const requiresPublishedBoard = { requires: ["launch", "published-board-checkout"] };

async function writeJsonl(file, records) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

function sessionView(editor) {
    return editor.evaluate(
        "() => ({meta:[...document.querySelectorAll('#sessMeta span')].map((node)=>({text:node.textContent,title:node.title})),turns:[...document.querySelectorAll('#transcript .turn')].length,prompts:[...document.querySelectorAll('#transcript .item.k-user')].map((node)=>node.textContent),answers:[...document.querySelectorAll('#transcript .item.k-assistant')].map((node)=>node.textContent)})",
    );
}

export default [
    test("renders synthetic Claude turns, paired edit diff, and de-duplicated usage", async (ctx) => {
        const file = ctx.fixture("boards-samples/agent-log-viewer/.claude/projects/synthetic-project/claude-session.jsonl");
        await writeJsonl(file, [
            {
                type: "user",
                sessionId: "synthetic-claude-session",
                cwd: "C:/synthetic/project",
                timestamp: "2026-01-02T10:00:00.000Z",
                message: { role: "user", content: "Please edit the sample note." },
            },
            {
                type: "assistant",
                sessionId: "synthetic-claude-session",
                timestamp: "2026-01-02T10:00:01.000Z",
                message: {
                    id: "claude-msg-1",
                    model: "claude-sonnet-4-20250514",
                    content: [
                        { type: "text", text: "I will update the sample note." },
                        { type: "tool_use", id: "edit-1", name: "Edit", input: { file_path: "note.txt", old_string: "old phrase", new_string: "new phrase" } },
                    ],
                    usage: { input_tokens: 100, output_tokens: 30, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 },
                },
            },
            {
                type: "assistant",
                sessionId: "synthetic-claude-session",
                timestamp: "2026-01-02T10:00:01.500Z",
                message: {
                    id: "claude-msg-1",
                    content: [{ type: "text", text: "Edit complete." }],
                    usage: { input_tokens: 900, output_tokens: 900 },
                },
            },
            {
                type: "user",
                sessionId: "synthetic-claude-session",
                timestamp: "2026-01-02T10:00:02.000Z",
                message: { role: "user", content: [{ type: "tool_result", tool_use_id: "edit-1", content: "Synthetic edit succeeded." }] },
                toolUseResult: {
                    filePath: "note.txt",
                    structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-old phrase", "+new phrase"] }],
                },
            },
            {
                type: "user",
                sessionId: "synthetic-claude-session",
                timestamp: "2026-01-02T10:01:00.000Z",
                message: { role: "user", content: "Find the second needle phrase." },
            },
            { type: "unknown-synthetic-record", sessionId: "synthetic-claude-session", timestamp: "2026-01-02T10:01:01.000Z" },
            {
                type: "assistant",
                sessionId: "synthetic-claude-session",
                timestamp: "2026-01-02T10:01:02.000Z",
                message: {
                    id: "claude-msg-2",
                    model: "claude-sonnet-4-20250514",
                    content: [{ type: "text", text: "The second needle phrase is in this synthetic answer." }],
                    usage: { input_tokens: 40, output_tokens: 20 },
                },
            },
        ]);

        let handle;
        try {
            handle = await openPublishedSample(
                ctx,
                "agent-log-viewer",
                "agent-log-viewer/.claude/projects/synthetic-project/claude-session.jsonl",
            );
            await handle.editor.waitFor({ text: "The second needle phrase is in this synthetic answer." });
            const view = await sessionView(handle.editor);
            ctx.expect(view.turns).toBe(2);
            ctx.expect(view.prompts.join(" ")).toContain("Please edit the sample note.");
            ctx.expect(view.prompts.join(" ")).toContain("Find the second needle phrase.");
            ctx.expect(view.answers.join(" ")).toContain("The second needle phrase is in this synthetic answer.");
            ctx.expect(view.meta.some(({ text }) => text.includes("turns 2"))).toBe(true);
            ctx.expect(view.meta.some(({ title }) => title === "Input 140\nOutput 50\nCache read 10\nCache write 5")).toBe(true);

            await handle.editor.click("#transcript details.tool > summary");
            const diff = await ctx.waitFor(
                async () => {
                    try {
                        return await handle.editor.evaluate(
                            "() => ({added:document.querySelector('#transcript details.tool .diff .add')?.textContent || '',removed:document.querySelector('#transcript details.tool .diff .del')?.textContent || ''})",
                        );
                    } catch {
                        return null;
                    }
                },
                (value) => value?.added.includes("new phrase") && value?.removed.includes("old phrase"),
            );
            ctx.expect(diff.added).toContain("new phrase");
            ctx.expect(diff.removed).toContain("old phrase");
            const toolResult = await handle.editor.evaluate(
                "() => [...document.querySelectorAll('#transcript details.tool .out')].map((node) => node.textContent).join(' ')",
            );
            ctx.expect(toolResult).toContain("Synthetic edit succeeded.");
            ctx.expect((await sessionView(handle.editor)).answers.join(" ")).toContain("The second needle phrase is in this synthetic answer.");
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("renders synthetic Codex turns and cumulative token deltas", async (ctx) => {
        const file = ctx.fixture("boards-samples/agent-log-viewer/.codex/sessions/2026/01/02/rollout-synthetic.jsonl");
        await writeJsonl(file, [
            { timestamp: "2026-01-02T11:00:00.000Z", type: "session_meta", payload: { id: "synthetic-codex-session", cwd: "C:/synthetic/project", cli_version: "synthetic" } },
            { timestamp: "2026-01-02T11:00:01.000Z", type: "turn_context", payload: { model: "gpt-4.1" } },
            { timestamp: "2026-01-02T11:00:02.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "First synthetic Codex prompt." }] } },
            { timestamp: "2026-01-02T11:00:03.000Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "input_text", text: "First synthetic Codex answer." }] } },
            { timestamp: "2026-01-02T11:00:04.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100, output_tokens: 10 }, last_token_usage: { input_tokens: 100, output_tokens: 10 } } } },
            { timestamp: "2026-01-02T11:01:00.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Second synthetic Codex prompt." }] } },
            { timestamp: "2026-01-02T11:01:01.000Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "input_text", text: "Second synthetic Codex answer." }] } },
            { timestamp: "2026-01-02T11:01:02.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 160, output_tokens: 30 }, last_token_usage: { input_tokens: 160, output_tokens: 30 } } } },
        ]);

        let handle;
        try {
            handle = await openPublishedSample(
                ctx,
                "agent-log-viewer",
                "agent-log-viewer/.codex/sessions/2026/01/02/rollout-synthetic.jsonl",
            );
            await handle.editor.waitFor({ text: "Second synthetic Codex answer." });
            const view = await sessionView(handle.editor);
            ctx.expect(view.turns).toBe(2);
            ctx.expect(view.prompts.join(" ")).toContain("First synthetic Codex prompt.");
            ctx.expect(view.prompts.join(" ")).toContain("Second synthetic Codex prompt.");
            ctx.expect(view.answers.join(" ")).toContain("First synthetic Codex answer.");
            ctx.expect(view.answers.join(" ")).toContain("Second synthetic Codex answer.");
            ctx.expect(view.meta.some(({ text }) => text.includes("turns 2"))).toBe(true);
            ctx.expect(view.meta.some(({ title }) => title === "Input 160\nOutput 30\nCache read 0\nCache write 0")).toBe(true);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("finds a synthetic turn by text in the session view", async (ctx) => {
        const file = ctx.fixture("boards-samples/agent-log-viewer/.claude/projects/synthetic-project/find-session.jsonl");
        await writeJsonl(file, [
            {
                type: "user",
                sessionId: "synthetic-find-session",
                timestamp: "2026-01-02T12:00:00.000Z",
                message: { role: "user", content: "First synthetic find prompt." },
            },
            {
                type: "assistant",
                sessionId: "synthetic-find-session",
                timestamp: "2026-01-02T12:00:01.000Z",
                message: { id: "find-msg-1", content: [{ type: "text", text: "First synthetic find answer." }] },
            },
            {
                type: "user",
                sessionId: "synthetic-find-session",
                timestamp: "2026-01-02T12:01:00.000Z",
                message: { role: "user", content: "needle phrase only in second turn" },
            },
            {
                type: "assistant",
                sessionId: "synthetic-find-session",
                timestamp: "2026-01-02T12:01:01.000Z",
                message: { id: "find-msg-2", content: [{ type: "text", text: "Second synthetic find answer." }] },
            },
        ]);

        let handle;
        try {
            handle = await openPublishedSample(
                ctx,
                "agent-log-viewer",
                "agent-log-viewer/.claude/projects/synthetic-project/find-session.jsonl",
            );
            await handle.editor.waitFor({ text: "Second synthetic find answer." });
            await handle.editor.type("#find", "needle phrase only in second turn");
            await handle.editor.pressKey("Enter");
            const search = await ctx.waitFor(
                async () => {
                    try {
                        return await handle.editor.evaluate(
                            "() => ({hits:document.querySelectorAll('#outline .ot.hit').length,info:document.querySelector('#findInfo')?.textContent,marks:document.querySelectorAll('#transcript mark').length})",
                        );
                    } catch {
                        return null;
                    }
                },
                (value) => value?.hits === 1 && value?.info !== "Searching…" && value.marks > 0,
            );
            ctx.expect(search.hits).toBe(1);
            ctx.expect(search.marks > 0).toBe(true);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),
];
