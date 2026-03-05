# Script Execution Flow

How a user script goes from F5 keystroke to result display, through wrappers, facades, and auto-cleanup.

## Full Execution Flow

```mermaid
sequenceDiagram
    participant U as User
    participant AM as TextFileActionsModel
    participant SR as ScriptRunner
    participant SC as ScriptContext
    participant AW as AppWrapper
    participant PW as PageWrapper
    participant F as EditorFacade
    participant VM as ContentViewModel
    participant GP as Grouped Page

    U->>AM: Press F5
    AM->>AM: Determine script source
    Note right of AM: Script panel open?<br/>→ run panel content<br/>JS file + no panel?<br/>→ run page content/selection

    AM->>SR: runWithResult(pageId, script, page)
    SR->>SC: createScriptContext(page)

    rect rgb(232, 245, 233)
        Note over SC,PW: Context Creation
        SC->>SC: releaseList = []
        SC->>AW: new AppWrapper(releaseList)
        AW->>AW: Wrap app singleton
        SC->>PW: new PageWrapper(model, releaseList)
        PW->>PW: Wrap PageModel → IPage

        SC->>SC: Build Proxy chain
        Note right of SC: 1. Check customContext<br/>   (app, page, React)<br/>2. Fall back to globalThis<br/>3. Auto-bind functions
    end

    SC-->>SR: { context, cleanup }

    rect rgb(240, 248, 255)
        Note over SR,GP: Script Execution
        SR->>SR: Wrap script in async function
        Note right of SR: with(this) { ... }<br/>+ lexical JS globals<br/>+ implicit return

        SR->>SR: Execute script

        Note over PW,VM: Script accesses page.content
        SR->>PW: page.content (getter)
        PW-->>SR: model.state.get().content

        Note over PW,VM: Script calls page.asGrid()
        SR->>PW: await page.asGrid()
        PW->>VM: host.acquireViewModel("grid-json")
        VM-->>PW: GridViewModel (refs +1)
        PW->>PW: releaseList.push(release fn)
        PW->>F: new GridEditorFacade(vm)
        F-->>SR: IGridEditor

        Note over F: Script uses facade
        SR->>F: facade.addRows(5)
        F->>VM: vm.addRows(5)

        Note over PW,GP: Script accesses page.grouped
        SR->>PW: page.grouped.content = result
        PW->>PW: Auto-create grouped page
        PW->>GP: new PageWrapper(grouped, releaseList)
        GP->>GP: changeContent(result)
    end

    SR->>SR: await result (if Promise)
    SR->>SR: convertToText(result)
    Note right of SR: object → JSON<br/>string → as-is<br/>Error → stack trace

    rect rgb(255, 243, 224)
        Note over SR,VM: Cleanup (always runs)
        SR->>SC: cleanup()
        SC->>SC: Iterate releaseList
        SC->>VM: releaseViewModel("grid-json")
        Note right of VM: refs -1 → 0 → dispose
        SC->>SC: releaseList = []
    end

    SR->>GP: Write result to grouped page
    SR-->>AM: result string
```

## Wrapper Architecture

```mermaid
graph TD
    CTX["ScriptContext"] --> AW["AppWrapper<br/><i>implements IApp</i>"]
    CTX --> PW["PageWrapper<br/><i>implements IPage</i>"]
    CTX --> RE["React"]

    AW --> |"app.pages"| PCW["PageCollectionWrapper<br/><i>implements IPageCollection</i>"]
    AW --> |"app.settings"| SET["settings (direct)"]
    AW --> |"app.fs"| FS["fs (direct)"]
    AW --> |"app.ui"| UI["ui (direct)"]
    AW --> |"app.window"| WIN["window (direct)"]
    AW --> |"app.shell"| SH["shell (direct)"]

    PCW --> |"returns"| PW2["PageWrapper<br/><i>for each page</i>"]

    PW --> |"page.asText()"| TF["TextEditorFacade"]
    PW --> |"page.asGrid()"| GF["GridEditorFacade"]
    PW --> |"page.asNotebook()"| NF["NotebookEditorFacade"]
    PW --> |"page.asTodo()"| TDF["TodoEditorFacade"]
    PW --> |"page.asLink()"| LF["LinkEditorFacade"]
    PW --> |"page.asBrowser()"| BF["BrowserEditorFacade"]
    PW --> |"page.asMarkdown()"| MF["MarkdownEditorFacade"]
    PW --> |"page.asSvg()"| SF["SvgEditorFacade"]
    PW --> |"page.asHtml()"| HF["HtmlEditorFacade"]
    PW --> |"page.asMermaid()"| MMF["MermaidEditorFacade"]

    PW --> |"page.grouped"| PW3["PageWrapper<br/><i>auto-created</i>"]

    subgraph RL["Shared releaseList"]
        R1["() => release grid-json"]
        R2["() => release notebook"]
        R3["..."]
    end

    TF -.-> RL
    GF -.-> RL
    NF -.-> RL

    style CTX fill:#fff3e0
    style AW fill:#e8f5e9
    style PW fill:#e8f5e9
    style PCW fill:#e8f5e9
    style RL fill:#ffebee
```

## Auto-Release Guarantee

```mermaid
flowchart TB
    START["Script starts"] --> CREATE["releaseList = []"]
    CREATE --> RUN["Execute script code"]

    RUN --> |"page.asGrid()"| ACQ1["acquire VM<br/>push release fn"]
    RUN --> |"page.asText()"| ACQ2["acquire VM<br/>push release fn"]
    RUN --> |"page.grouped.asNotebook()"| ACQ3["acquire VM<br/>push release fn"]

    ACQ1 --> RUN
    ACQ2 --> RUN
    ACQ3 --> RUN

    RUN --> |"success or error"| FINALLY["finally block"]
    FINALLY --> CLEANUP["cleanup()"]
    CLEANUP --> REL1["release grid VM"]
    REL1 --> REL2["release text VM"]
    REL2 --> REL3["release notebook VM"]
    REL3 --> DONE["All VMs released ✓"]

    style START fill:#e8f5e9
    style FINALLY fill:#fff3e0
    style CLEANUP fill:#ffebee
    style DONE fill:#e8f5e9
```

The `finally` block in `ScriptRunner.run()` ensures cleanup runs even if the script throws.
Every ViewModel acquired through any path (direct page, grouped page, app.pages collection) is tracked in the same `releaseList`.
