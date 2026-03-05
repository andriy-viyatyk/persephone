[← API Reference](./index.md)

# app.shell

OS integration: open URLs, encryption, and version information.

```javascript
await app.shell.openExternal("https://github.com");
```

## Methods

### openExternal(url) → `Promise<void>`

Open a URL in the OS default browser.

```javascript
await app.shell.openExternal("https://github.com");
await app.shell.openExternal("mailto:user@example.com");
```

## app.shell.version

Version and update information.

| Method | Returns | Description |
|--------|---------|-------------|
| `runtimeVersions()` | `Promise<IRuntimeVersions>` | Get Electron, Node, and Chrome versions. |
| `checkForUpdates(force?)` | `Promise<IUpdateInfo>` | Check for app updates. |

```javascript
const versions = await app.shell.version.runtimeVersions();
console.log(`Node: ${versions.node}, Chrome: ${versions.chrome}`);

const update = await app.shell.version.checkForUpdates();
if (update.updateAvailable) {
    app.ui.notify(`Update available: ${update.latestVersion}`, "info");
}
```

### IRuntimeVersions

| Property | Type |
|----------|------|
| `electron` | `string` |
| `node` | `string` |
| `chrome` | `string` |

### IUpdateInfo

| Property | Type | Description |
|----------|------|-------------|
| `currentVersion` | `string` | Currently installed version. |
| `latestVersion` | `string \| null` | Latest available version. |
| `updateAvailable` | `boolean` | True if an update is available. |
| `releaseUrl` | `string \| null` | URL to the release page. |
| `releaseVersion` | `string \| null` | Release version string. |
| `publishedAt` | `string \| null` | Release publish date. |
| `releaseNotes` | `string \| null` | Release notes text. |
| `error` | `string?` | Error message if check failed. |

## app.shell.encryption

Content encryption/decryption using AES-GCM.

| Method | Returns | Description |
|--------|---------|-------------|
| `encrypt(text, password)` | `Promise<string>` | Encrypt text. Returns encrypted string. |
| `decrypt(encryptedText, password)` | `Promise<string>` | Decrypt text. Returns original string. |
| `isEncrypted(text)` | `boolean` | Check if text appears encrypted (checks version prefix). |

```javascript
// Encrypt content
const password = await app.ui.password({ mode: "encrypt" });
if (password) {
    const encrypted = await app.shell.encryption.encrypt(page.content, password);
    page.content = encrypted;
}

// Decrypt content
if (app.shell.encryption.isEncrypted(page.content)) {
    const password = await app.ui.password();
    if (password) {
        page.content = await app.shell.encryption.decrypt(page.content, password);
    }
}
```
