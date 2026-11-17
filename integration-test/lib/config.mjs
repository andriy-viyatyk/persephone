import path from "node:path";
import { fileURLToPath } from "node:url";

// Deadline values are milliseconds before the caller's scale is applied once.
export const BASE_TIMEOUTS = Object.freeze({
    startup: 30000,
    request: 30000,
    wait: 10000,
    poll: 200,
    shutdown: 5000,
    screenshot: 5000,
    devProbe: 3000,
    secondInstance: 15000,
});

export const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const RUNNER_ROOT = path.resolve(REPOSITORY_ROOT, "integration-test");
export const TEST_ROOT = path.join(RUNNER_ROOT, "tests");
export const FIXTURE_ROOT = path.join(RUNNER_ROOT, "fixtures");
export const HTTP_FIXTURE_ROOT = path.join(FIXTURE_ROOT, "http");
export const HTTP_FIXTURE_PORT = 17867;
export const HTTP_FIXTURE_URL = `http://127.0.0.1:${HTTP_FIXTURE_PORT}`;
export const SEED_ROOT = path.join(RUNNER_ROOT, "seed");
export const PROFILE_ROOT = path.join(RUNNER_ROOT, ".profile");
export const REPORT_ROOT = path.join(RUNNER_ROOT, "reports");
export const RUNS_ROOT = path.join(REPORT_ROOT, "runs");
export const TEST_SETUP_PATH = path.join(RUNNER_ROOT, "test-setup.mjs");
export const KEEP_OPEN_PATH = path.join(REPORT_ROOT, "keep-open.json");
export const LOCK_PATH = path.join(RUNNER_ROOT, ".runner.lock");
export const DEV_MARKER_PATH = path.join(REPOSITORY_ROOT, ".vite", "dev-server.json");
export const DEV_MAIN_PATH = path.join(REPOSITORY_ROOT, ".vite", "build", "main.js");
export const RESTART_DEV_NOTICE = "The dev bundle was replaced; run npm start again before dev tests.";
export const PROD_BUILD_BLOCKED_MESSAGE = "stop npm start first; --prod rebuilds .vite/build, then run npm start again";
export const MCP_URL = "http://127.0.0.1:17865/mcp";
export const TEST_PORTS = Object.freeze([17865, 17866, 17700, 19052, HTTP_FIXTURE_PORT]);

export function createTimeouts(scale = 1) {
    return { ...Object.fromEntries(Object.entries(BASE_TIMEOUTS).map(([name, value]) => [name, Math.min(2_147_483_647, Math.max(1, Math.round(value * scale)))])), scale };
}
