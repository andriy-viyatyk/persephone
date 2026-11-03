/** Profile metadata is passed by the main process before renderer initialization. */
export function rendererProfileName(): string | undefined {
    return process.argv.find((arg) => arg.startsWith("--persephone-application-profile="))?.slice("--persephone-application-profile=".length);
}

export function profileDefaultPort(base: number, profileName: string | undefined): number {
    return base + (profileName ? 100 : 0);
}
