export function profileSocketName(profile: string): string {
    return `persephone${profile ? `-${profile}` : ""}.sock`;
}
