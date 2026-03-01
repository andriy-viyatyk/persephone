# IShell — `app.shell`

**Status:** Implemented (Phase 3b)

OS integration: open URLs, content encryption/decryption, version/update info.

## Access

```javascript
app.shell
```

---

## Methods

### `openExternal(url)`

Open a URL in the OS default browser.

```javascript
await app.shell.openExternal("https://github.com");
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `url` | `string` | URL to open |

**Returns:** `Promise<void>`

---

## Sub-services

### `encryption` (read-only)

Content encryption/decryption using AES-GCM. See [IEncryptionService](#iencryptionservice).

```javascript
app.shell.encryption
```

**Type:** `IEncryptionService`

---

### `version` (read-only)

Runtime version info and update checking. See [IVersionService](#iversionservice).

```javascript
app.shell.version
```

**Type:** `IVersionService`

---

## IEncryptionService

### `encrypt(text, password)`

Encrypt text with a password using AES-GCM (PBKDF2 key derivation, 100k iterations, SHA-256).

```javascript
const encrypted = await app.shell.encryption.encrypt("secret data", "myPassword");
// "ENC-v001:base64encodeddata..."
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `text` | `string` | Plain text to encrypt |
| `password` | `string` | Encryption password |

**Returns:** `Promise<string>` — Encrypted string with version prefix (`ENC-v001:...`).

**Error behavior:** Throws on encryption failure.

---

### `decrypt(encryptedText, password)`

Decrypt previously encrypted text.

```javascript
const text = await app.shell.encryption.decrypt(encrypted, "myPassword");
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `encryptedText` | `string` | Encrypted string (must have `ENC-vNNN:` prefix) |
| `password` | `string` | Decryption password |

**Returns:** `Promise<string>` — Decrypted plain text.

**Error behavior:** Throws if text is not encrypted, password is wrong, or version is unsupported.

---

### `isEncrypted(text)`

Check if text appears to be encrypted (has a valid version prefix).

```javascript
if (app.shell.encryption.isEncrypted(content)) {
    // content starts with "ENC-v001:" or similar
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `text` | `string` | Text to check |

**Returns:** `boolean` — `true` if text has a valid `ENC-vNNN:` prefix with version > 0.

**Note:** This is a synchronous method (no await needed).

---

## IVersionService

### `runtimeVersions()`

Get Electron, Node.js, and Chrome version strings.

```javascript
const versions = await app.shell.version.runtimeVersions();
console.log(versions.electron, versions.node, versions.chrome);
```

**Returns:** `Promise<IRuntimeVersions>` — `{ electron: string, node: string, chrome: string }`

---

### `checkForUpdates(force?)`

Check for application updates via GitHub Releases API.

```javascript
const info = await app.shell.version.checkForUpdates();
if (info.updateAvailable) {
    console.log(`New version: ${info.releaseVersion}`);
    await app.shell.openExternal(info.releaseUrl);
}
```

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `force` | `boolean?` | `false` | Force re-check (bypasses cache) |

**Returns:** `Promise<IUpdateInfo>`

**IUpdateInfo fields:**
| Field | Type | Description |
|-------|------|-------------|
| `currentVersion` | `string` | Currently running version |
| `latestVersion` | `string \| null` | Latest version on GitHub |
| `updateAvailable` | `boolean` | Whether an update is available |
| `releaseUrl` | `string \| null` | URL to the release page |
| `releaseVersion` | `string \| null` | Version of the latest release |
| `publishedAt` | `string \| null` | Release publication date |
| `releaseNotes` | `string \| null` | Release notes (markdown) |
| `error` | `string?` | Error message if check failed |

---

## Examples

### Encrypt and decrypt content

```javascript
const encrypted = await app.shell.encryption.encrypt("Hello, World!", "secret123");
console.log(app.shell.encryption.isEncrypted(encrypted)); // true

const decrypted = await app.shell.encryption.decrypt(encrypted, "secret123");
console.log(decrypted); // "Hello, World!"
```

### Open a URL

```javascript
await app.shell.openExternal("https://github.com");
```

### Check for updates

```javascript
const info = await app.shell.version.checkForUpdates(true);
if (info.updateAvailable) {
    console.log(`Update available: ${info.releaseVersion}`);
}
```

---

## Implementation Notes

- Encryption uses Web Crypto API (AES-GCM with PBKDF2 key derivation). All crypto runs in the renderer process — no IPC needed.
- `openExternal()` uses Electron's `shell.openExternal()` directly in the renderer (works with `nodeIntegration: true`).
- Version/update methods delegate to IPC calls (`api.getRuntimeVersions()`, `api.checkForUpdates()`) because the version service runs in the main process.
- Implementation is organized as `api/shell/` subfolder with focused modules: `encryption.ts`, `version.ts`, `shell-calls.ts`, composed by `index.ts`.
