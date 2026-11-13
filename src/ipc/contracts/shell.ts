import type { TimeoutExemptions } from "../timeout-exemptions";


export interface ShellApi {
    openTerminal: (path: string, command: string) => Promise<void>;
    detectTerminal: () => Promise<string>;
}


export const shellTimeoutExemptions = {
    detectTerminal: "Synchronous executable lookup has no timeout.",
} satisfies TimeoutExemptions<ShellApi>;
