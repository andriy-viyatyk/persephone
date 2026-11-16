import path from "node:path";

export interface ApplicationProfileArguments {
    name?: string;
    directory?: string;
    remainingArgs: string[];
}

export function parseApplicationProfile(args: string[]): ApplicationProfileArguments {
    let name: string | undefined;
    let directory: string | undefined;
    const remainingArgs: string[] = [];
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === "--profile" || arg.startsWith("--profile=")) {
            if (name !== undefined) throw new Error("Duplicate profile option.");
            const value = arg === "--profile" ? args[++index] : arg.slice(10);
            const normalized = value?.toLowerCase();
            if (!normalized || !/^[a-z0-9-]{1,32}$/.test(normalized) || normalized === "default") throw new Error("Invalid profile name.");
            name = normalized;
        } else if (arg === "--profile-dir" || arg.startsWith("--profile-dir=")) {
            if (directory !== undefined) throw new Error("Duplicate profile directory option.");
            const value = arg === "--profile-dir" ? args[++index] : arg.slice("--profile-dir=".length);
            if (!value || (arg === "--profile-dir" && value.startsWith("--"))) throw new Error("Invalid profile directory.");
            directory = path.resolve(value);
        } else remainingArgs.push(arg);
    }
    if (directory !== undefined && name === undefined) throw new Error("A profile name is required with a profile directory.");
    return { name, directory, remainingArgs };
}

export function applicationProfileName(): string | undefined {
    return parseApplicationProfile(process.argv.slice(1)).name;
}

export function applicationProfileDirectory(): string | undefined {
    return parseApplicationProfile(process.argv.slice(1)).directory;
}
