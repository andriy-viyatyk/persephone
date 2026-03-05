# Editor System

How files are resolved to editors, and how the two editor categories render differently.

## Editor Resolution

```mermaid
flowchart LR
    FILE["File Opened<br/><i>example.note.json</i>"] --> REG["EditorRegistry<br/>.resolve(filePath)"]

    REG --> |"Query all editors'<br/>acceptFile()"| BEST["Best Match<br/><i>highest priority wins</i>"]

    BEST --> |"category:<br/>content-view"| CV["Content View<br/><i>Shares TextFileModel</i>"]
    BEST --> |"category:<br/>page-editor"| PE["Page Editor<br/><i>Own PageModel</i>"]
    BEST --> |"no match<br/>(priority 0)"| MONACO["Monaco Fallback<br/><i>default text editor</i>"]

    style FILE fill:#e3f2fd
    style REG fill:#fff3e0
    style CV fill:#e8f5e9
    style PE fill:#f3e5f5
    style MONACO fill:#e8f5e9
```

## Rendering Architecture

```mermaid
graph TB
    RP["RenderEditor<br/><i>Switches on editor category</i>"]

    RP -->|"page-editor"| AE["AsyncEditor<br/><i>Lazy-loads module</i>"]
    AE --> PDF["PdfViewer"]
    AE --> IMG["ImageViewer"]
    AE --> BR["BrowserPageView"]
    AE --> AB["AboutPage"]
    AE --> SET["SettingsPage"]
    AE --> CMP["CompareEditor"]

    RP -->|"content-view"| TPV["TextPageView<br/><i>Shared shell</i>"]

    TPV --> TB["TextToolbar"]
    TPV --> ACT["ActiveEditor<br/><i>Renders current view</i>"]
    TPV --> SP["ScriptPanel"]
    TPV --> TF["TextFooter"]

    ACT -->|"editor state"| MON["Monaco<br/><i>Text Editor</i>"]
    ACT -->|"editor state"| GJ["Grid (JSON)"]
    ACT -->|"editor state"| GC["Grid (CSV)"]
    ACT -->|"editor state"| MD["Markdown Preview"]
    ACT -->|"editor state"| NB["Notebook"]
    ACT -->|"editor state"| TD["ToDo"]
    ACT -->|"editor state"| LK["Links"]
    ACT -->|"editor state"| SVG["SVG Preview"]
    ACT -->|"editor state"| HTML["HTML Preview"]
    ACT -->|"editor state"| MMD["Mermaid"]

    style RP fill:#fff3e0
    style AE fill:#f3e5f5
    style TPV fill:#e8f5e9
    style TB fill:#c8e6c9
    style ACT fill:#c8e6c9
    style SP fill:#c8e6c9
    style TF fill:#c8e6c9
    style MON fill:#e8eaf6
    style GJ fill:#e8eaf6
    style GC fill:#e8eaf6
    style MD fill:#e8eaf6
    style NB fill:#e8eaf6
    style TD fill:#e8eaf6
    style LK fill:#e8eaf6
    style SVG fill:#e8eaf6
    style HTML fill:#e8eaf6
    style MMD fill:#e8eaf6
```

## Resolution Priority

| Priority | Meaning | Example |
|----------|---------|---------|
| **20** | Filename pattern match | `*.note.json` → notebook-view |
| **100** | Extension match | `.pdf` → pdf-view |
| **0** | Default fallback | `*` → monaco |
| **-1** | Not applicable | Editor rejects this file |

## Editor Switch (Content Views Only)

Content views can switch between each other within the same `TextPageView`:

```mermaid
flowchart LR
    JSON["data.json"] --> SW["Switch Dropdown"]
    SW -->|"switchOption()"| OPT1["JSON (Monaco)"]
    SW -->|"switchOption()"| OPT2["Grid"]

    NOTE["tasks.note.json"] --> SW2["Switch Dropdown"]
    SW2 -->|"switchOption()"| OPT3["JSON (Monaco)"]
    SW2 -->|"switchOption()"| OPT4["Notebook"]

    MD2["readme.md"] --> SW3["Switch Dropdown"]
    SW3 -->|"switchOption()"| OPT5["Markdown (Monaco)"]
    SW3 -->|"switchOption()"| OPT6["Preview"]

    style SW fill:#fff3e0
    style SW2 fill:#fff3e0
    style SW3 fill:#fff3e0
```

The `page.editor` property on `TextFileModel` state controls which content view renders.
