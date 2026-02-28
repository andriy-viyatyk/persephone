# IFileSystem — `app.fs`

**Status:** Implemented (Phase 2)

Unified file system API. Combines direct Node.js file operations (read/write/exists/delete) with IPC-based dialogs (open/save/folder) and OS integration (commonFolder, showInExplorer).

Used by both application code and scripts.

## Access

```javascript
app.fs
```

---

## Methods — File I/O

### `read(filePath, encoding?)`

Read a text file with auto-detected encoding. Returns content only.

```javascript
const content = await app.fs.read("C:/Users/me/data.json");
const content = await app.fs.read("C:/Users/me/data.txt", "utf-16le");
```

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `filePath` | `string` | — | Absolute path to file |
| `encoding` | `string?` | auto-detect | File encoding (`"utf-8"`, `"utf-16le"`, `"windows-1251"`, etc.) |

**Returns:** `Promise<string>` — File content as text.

**Encoding detection:** BOM detection → explicit encoding → jschardet auto-detection → UTF-8 fallback → windows-1251 fallback.

**Error behavior:** Throws if file does not exist or cannot be read.

---

### `readFile(filePath, encoding?)`

Read a text file, returning both content and detected encoding. Use when you need to preserve the original encoding (e.g., for save-back).

```javascript
const { content, encoding } = await app.fs.readFile("C:/Users/me/data.txt");
console.log(`Encoding: ${encoding}`); // "utf-8", "utf-16le", "windows-1251", etc.
```

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `filePath` | `string` | — | Absolute path to file |
| `encoding` | `string?` | auto-detect | File encoding override |

**Returns:** `Promise<ITextFile>` — `{ content: string, encoding: string }`

**Error behavior:** Throws if file does not exist or cannot be read.

---

### `readBinary(filePath)`

Read a file as binary data.

```javascript
const buffer = await app.fs.readBinary("C:/Users/me/image.png");
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `filePath` | `string` | Absolute path to file |

**Returns:** `Promise<Buffer>` — Raw file content.

**Error behavior:** Throws if file does not exist or cannot be read.

---

### `write(filePath, content, encoding?)`

Write text content to a file. Creates parent directories if needed. Overwrites if file exists.

```javascript
await app.fs.write("C:/Users/me/output.json", JSON.stringify(data, null, 2));
await app.fs.write("C:/Users/me/data.txt", content, "utf-16le");
```

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `filePath` | `string` | — | Absolute path to file |
| `content` | `string` | — | Text content to write |
| `encoding` | `string?` | `"utf-8"` | File encoding. Supports: `"utf-8"`, `"utf-8-bom"`, `"utf-16le"`, `"utf-16be"`, and any encoding supported by iconv-lite |

**Returns:** `Promise<void>`

**Error behavior:** Throws if path is invalid or write fails.

---

### `writeBinary(filePath, data)`

Write binary data to a file. Creates parent directories if needed.

```javascript
await app.fs.writeBinary("C:/Users/me/output.bin", buffer);
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `filePath` | `string` | Absolute path to file |
| `data` | `Buffer` | Binary data to write |

**Returns:** `Promise<void>`

**Error behavior:** Throws if path is invalid or write fails.

---

### `exists(filePath)`

Check if a file or directory exists.

```javascript
if (await app.fs.exists("C:/Users/me/config.json")) {
  const config = JSON.parse(await app.fs.read("C:/Users/me/config.json"));
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `filePath` | `string` | Absolute path to check |

**Returns:** `Promise<boolean>` — `true` if exists, `false` otherwise.

**Error behavior:** Returns `false` on any error.

---

### `delete(filePath)`

Delete a file. No-op if file doesn't exist.

```javascript
await app.fs.delete("C:/Users/me/temp.txt");
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `filePath` | `string` | Absolute path to file |

**Returns:** `Promise<void>`

---

## Methods — Path Resolution

### `resolveDataPath(relativePath)`

Resolve a relative path within the per-window app data folder. Supports `{windowIndex}` placeholder.

```javascript
const settingsPath = app.fs.resolveDataPath("settings.json");
const windowPath = app.fs.resolveDataPath("state-{windowIndex}.json");
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `relativePath` | `string` | Relative path. `{windowIndex}` is replaced with current window index. |

**Returns:** `string` — Absolute path in the data folder.

---

### `resolveCachePath(relativePath)`

Resolve a relative path within the per-window cache folder.

```javascript
const cachePath = app.fs.resolveCachePath("preview.html");
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `relativePath` | `string` | Relative path within cache folder |

**Returns:** `string` — Absolute path in the cache folder.

---

### `commonFolder(name)`

Get the path to a standard OS folder (async — IPC call).

```javascript
const downloads = await app.fs.commonFolder("downloads");
const desktop = await app.fs.commonFolder("desktop");
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `name` | `string` | Folder identifier |

**Known folder names:**
| Name | Description |
|------|-------------|
| `"documents"` | User's Documents folder |
| `"downloads"` | User's Downloads folder |
| `"desktop"` | User's Desktop folder |
| `"home"` | User's home directory |
| `"userData"` | App data folder (e.g., `C:\Users\NAME\AppData\Roaming\js-notepad`) |
| `"appData"` | AppData\Roaming |
| `"temp"` | System temp folder |
| `"pictures"` | User's Pictures folder |
| `"music"` | User's Music folder |
| `"videos"` | User's Videos folder |
| `"exe"` | Application executable folder |

**Returns:** `Promise<string>` — Absolute path to the folder.

---

## Methods — Dialogs

### `showOpenDialog(options?)`

Show the native "Open File" dialog.

```javascript
const paths = await app.fs.showOpenDialog();
const paths = await app.fs.showOpenDialog({
  title: "Select a JSON file",
  filters: [{ name: "JSON", extensions: ["json"] }],
  multiSelect: true,
});
if (paths) {
  console.log(paths[0]); // First selected file
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `options?` | `IOpenDialogOptions` | Dialog configuration |

**IOpenDialogOptions:**
| Property | Type | Description |
|----------|------|-------------|
| `title?` | `string` | Dialog window title |
| `defaultPath?` | `string` | Initial directory or file path |
| `filters?` | `IFileFilter[]` | File type filters (e.g., `[{ name: "Text", extensions: ["txt"] }]`) |
| `multiSelect?` | `boolean` | Allow selecting multiple files (default: `false`) |

**Returns:** `Promise<string[] | null>` — Array of selected file paths, or `null` if cancelled.

---

### `showSaveDialog(options?)`

Show the native "Save File" dialog.

```javascript
const filePath = await app.fs.showSaveDialog({
  defaultPath: "output.csv",
  filters: [{ name: "CSV", extensions: ["csv"] }],
});
if (filePath) {
  await app.fs.write(filePath, csvContent);
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `options?` | `ISaveDialogOptions` | Dialog configuration |

**ISaveDialogOptions:**
| Property | Type | Description |
|----------|------|-------------|
| `title?` | `string` | Dialog window title |
| `defaultPath?` | `string` | Suggested file name or path |
| `filters?` | `IFileFilter[]` | File type filters |

**Returns:** `Promise<string | null>` — Selected save path, or `null` if cancelled.

---

### `showFolderDialog(options?)`

Show the native "Select Folder" dialog.

```javascript
const folders = await app.fs.showFolderDialog({ title: "Select output folder" });
if (folders) {
  console.log(folders[0]); // Selected folder
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `options?` | `IFolderDialogOptions` | Dialog configuration |

**IFolderDialogOptions:**
| Property | Type | Description |
|----------|------|-------------|
| `title?` | `string` | Dialog window title |
| `defaultPath?` | `string` | Initial directory |

**Returns:** `Promise<string[] | null>` — Array of selected folder paths, or `null` if cancelled.

---

## Methods — OS Integration

### `showInExplorer(filePath)`

Show a file in the OS file explorer (select it in the parent folder).

```javascript
app.fs.showInExplorer("C:/Users/me/documents/report.pdf");
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `filePath` | `string` | Path to file or folder |

**Returns:** `void`

---

### `showFolder(folderPath)`

Open a folder in the OS file explorer.

```javascript
app.fs.showFolder("C:/Users/me/documents");
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `folderPath` | `string` | Path to folder |

**Returns:** `void`

---

## Types

### `ITextFile`

```typescript
interface ITextFile {
    content: string;    // File content as string
    encoding: string;   // Detected or specified encoding
}
```

### `IFileFilter`

```typescript
interface IFileFilter {
    name: string;         // Display name (e.g., "Text Files")
    extensions: string[]; // Extensions without dots (e.g., ["txt", "md"])
}
```

---

## Examples

### Read JSON file, transform, write result

```javascript
const raw = await app.fs.read("C:/data/users.json");
const users = JSON.parse(raw);
const active = users.filter(u => u.active);
await app.fs.write("C:/data/active-users.json", JSON.stringify(active, null, 2));
```

### Read with encoding info and save back

```javascript
const file = await app.fs.readFile("C:/data/legacy.txt");
console.log(`Encoding: ${file.encoding}`);
const modified = file.content.replace(/old/g, "new");
await app.fs.write("C:/data/legacy.txt", modified, file.encoding);
```

### Pick file via dialog

```javascript
const paths = await app.fs.showOpenDialog({
  filters: [{ name: "Markdown", extensions: ["md"] }]
});
if (paths) {
  const content = await app.fs.read(paths[0]);
  console.log(content);
}
```

### Save current page content to a new file

```javascript
const savePath = await app.fs.showSaveDialog({
  defaultPath: "export.txt"
});
if (savePath) {
  await app.fs.write(savePath, page.content);
}
```

### Check if config exists, create default if not

```javascript
const configPath = app.fs.resolveDataPath("my-script-config.json");
if (!(await app.fs.exists(configPath))) {
  await app.fs.write(configPath, JSON.stringify({ version: 1 }, null, 2));
}
const config = JSON.parse(await app.fs.read(configPath));
```

---

## Implementation Notes

- File I/O uses direct Node.js `fs` operations (enabled by `nodeIntegration: true`) — no IPC overhead
- Dialogs use IPC to the main process (Electron native dialogs)
- Encoding detection uses BOM detection, jschardet, and iconv-lite (same as the internal text loading pipeline)
- `write()` and `writeBinary()` automatically create parent directories
- `resolveDataPath()` and `resolveCachePath()` are synchronous — paths are initialized during bootstrap
- Scripts have unrestricted file system access by design (same as `require("fs")`)
