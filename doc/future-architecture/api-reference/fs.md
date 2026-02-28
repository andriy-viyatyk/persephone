# IFileSystem — `app.fs`

File system operations. Read and write files, check existence, show native dialogs.

## Access

```javascript
app.fs
```

---

## Methods

### `read(filePath, encoding?)`

Read a text file.

```javascript
const content = await app.fs.read("C:/Users/me/data.json");
const content = await app.fs.read("C:/Users/me/data.txt", "utf-16le");
```

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `filePath` | `string` | — | Absolute path to file |
| `encoding` | `string?` | auto-detect | File encoding (`"utf-8"`, `"utf-16le"`, `"ascii"`, etc.) |

**Returns:** `Promise<string>` — File content as text.

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

Write text content to a file. Creates the file if it doesn't exist. Overwrites if it does.

```javascript
await app.fs.write("C:/Users/me/output.json", JSON.stringify(data, null, 2));
```

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `filePath` | `string` | — | Absolute path to file |
| `content` | `string` | — | Text content to write |
| `encoding` | `string?` | `"utf-8"` | File encoding |

**Returns:** `Promise<void>`

**Error behavior:** Throws if path is invalid or write fails (permissions, disk full, etc.).

---

### `writeBinary(filePath, data)`

Write binary data to a file.

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

Check if a file exists.

```javascript
if (await app.fs.exists("C:/Users/me/config.json")) {
  const config = JSON.parse(await app.fs.read("C:/Users/me/config.json"));
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `filePath` | `string` | Absolute path to check |

**Returns:** `Promise<boolean>` — `true` if file exists, `false` otherwise.

**Error behavior:** Returns `false` on any error (not found, no permission, etc.).

---

### `delete(filePath)`

Delete a file.

```javascript
await app.fs.delete("C:/Users/me/temp.txt");
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `filePath` | `string` | Absolute path to file |

**Returns:** `Promise<void>`

**Error behavior:** Throws if file does not exist or cannot be deleted.

---

### `showOpenDialog(options?)`

Show the native "Open File" dialog.

```javascript
const filePath = await app.fs.showOpenDialog();
const filePath = await app.fs.showOpenDialog({
  title: "Select a JSON file",
  filters: [{ name: "JSON", extensions: ["json"] }],
});
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `options?` | `OpenDialogOptions` | Dialog configuration |

**OpenDialogOptions:**
| Property | Type | Description |
|----------|------|-------------|
| `title?` | `string` | Dialog window title |
| `defaultPath?` | `string` | Initial directory or file path |
| `filters?` | `FileFilter[]` | File type filters (e.g., `[{ name: "Text", extensions: ["txt"] }]`) |
| `multiSelect?` | `boolean` | Allow selecting multiple files (default: `false`) |

**Returns:** `Promise<string | string[] | null>` — Selected file path(s), or `null` if cancelled.

**Error behavior:** Returns `null` if the user cancels. Never throws.

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
| `options?` | `SaveDialogOptions` | Dialog configuration |

**SaveDialogOptions:**
| Property | Type | Description |
|----------|------|-------------|
| `title?` | `string` | Dialog window title |
| `defaultPath?` | `string` | Suggested file name or path |
| `filters?` | `FileFilter[]` | File type filters |

**Returns:** `Promise<string | null>` — Selected save path, or `null` if cancelled.

**Error behavior:** Returns `null` if the user cancels. Never throws.

---

### `showFolderDialog(options?)`

Show the native "Select Folder" dialog.

```javascript
const folderPath = await app.fs.showFolderDialog({ title: "Select output folder" });
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `options?` | `FolderDialogOptions` | Dialog configuration |

**FolderDialogOptions:**
| Property | Type | Description |
|----------|------|-------------|
| `title?` | `string` | Dialog window title |
| `defaultPath?` | `string` | Initial directory |

**Returns:** `Promise<string | null>` — Selected folder path, or `null` if cancelled.

**Error behavior:** Returns `null` if the user cancels. Never throws.

---

### `commonFolder(name)`

Get the path to a standard OS folder.

```javascript
const downloads = app.fs.commonFolder("downloads");
const desktop = app.fs.commonFolder("desktop");
const docs = app.fs.commonFolder("documents");
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
| `"userData"` | App data folder (`~/.notepad-data/`) |
| `"home"` | User's home directory |

**Returns:** `string` — Absolute path to the folder.

**Error behavior:** Returns empty string for unknown folder names.

---

### `showInExplorer(filePath)`

Show a file in the OS file explorer (Windows Explorer, Finder, etc.).

```javascript
app.fs.showInExplorer("C:/Users/me/documents/report.pdf");
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `filePath` | `string` | Path to file or folder |

**Returns:** `void`

**Error behavior:** Silently fails if path doesn't exist.

---

## Examples

### Read JSON file, transform, write result

```javascript
const raw = await app.fs.read("C:/data/users.json");
const users = JSON.parse(raw);
const active = users.filter(u => u.active);
await app.fs.write("C:/data/active-users.json", JSON.stringify(active, null, 2));
```

### Pick file and open it

```javascript
const filePath = await app.fs.showOpenDialog({
  filters: [{ name: "Markdown", extensions: ["md"] }]
});
if (filePath) {
  await app.pages.open(filePath);
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
const configPath = app.fs.commonFolder("userData") + "/my-script-config.json";
if (!(await app.fs.exists(configPath))) {
  await app.fs.write(configPath, JSON.stringify({ version: 1 }, null, 2));
}
const config = JSON.parse(await app.fs.read(configPath));
```
