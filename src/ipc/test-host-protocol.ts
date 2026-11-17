/** Precedes the JSON configuration in the test host's argv. Electron can append its own switches
 *  after a utility process's arguments, so the host finds its configuration by this marker. */
export const TEST_HOST_CONFIG_MARKER = "--persephone-test-host-config";

/** The internal options the test host passes to the app it launches. One list, so the controller's
 *  own `--test-*` parser, the launch operands, second-instance handling and the host agree. */
export function isTestInstanceOption(argument: string): boolean {
    return argument === "--test-instance" || argument.startsWith("--test-mcp-port=") || argument.startsWith("--test-log-dir=");
}
