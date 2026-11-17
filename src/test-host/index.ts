import { run } from "./runner.js";
import type { HostConfiguration } from "./launcher.js";
import type { TestContext } from "./context.js";
import { errMessage } from "../shared/utils.js";
import { test as createTestDescriptor } from "./test-api.js";
import { TEST_HOST_CONFIG_MARKER } from "../ipc/test-host-protocol.js";

type ControllerConfiguration = HostConfiguration;
declare global { var test: (name: string, run: (context: TestContext) => Promise<void>, options?: { requires?: string[] }) => unknown; }

/** Flush both output streams, then exit: a utility process does not exit when its event loop is idle. */
function exitAfterFlush(code: number): void {
    process.stdout.write("", () => process.stderr.write("", () => process.exit(code)));
}

async function main(): Promise<void> {
    let code = 1;
    try {
        const markerIndex = process.argv.indexOf(TEST_HOST_CONFIG_MARKER);
        const raw = markerIndex >= 0 ? process.argv[markerIndex + 1] : undefined;
        if (!raw) throw new Error("Missing test host configuration.");
        const configuration = JSON.parse(raw) as ControllerConfiguration;
        globalThis.test = createTestDescriptor;
        code = await run(configuration);
    } catch (error) {
        console.error(`Test host failed: ${errMessage(error)}`);
    }
    exitAfterFlush(code);
}
void main();
