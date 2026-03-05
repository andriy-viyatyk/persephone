# ContentViewModel Lifecycle

How content-view editors manage their view state through ref-counted ViewModels.

## Class Hierarchy

```mermaid
classDiagram
    class IContentHost {
        <<interface>>
        +id: string
        +state: IState~IContentHostState~
        +changeContent(content, byUser?)
        +changeEditor(editor)
        +changeLanguage(language)
        +stateStorage: EditorStateStorage
        +acquireViewModel(editorId): Promise~ContentViewModel~
        +releaseViewModel(editorId)
    }

    class ContentViewModelHost {
        -viewModels: Map~string, Entry~
        +acquire(editorId): Promise~ContentViewModel~
        +release(editorId)
        +tryGet(editorId): ContentViewModel?
        +disposeAll()
    }

    class ContentViewModel~TState~ {
        <<abstract>>
        +host: IContentHost
        +state: TGlobalState~TState~
        #onInit()*
        #onContentChanged(content)*
        #onDispose()
    }

    class TextFileModel {
        implements IContentHost
        -_vmHost: ContentViewModelHost
    }

    class NoteItemEditModel {
        implements IContentHost
        -_vmHost: ContentViewModelHost
    }

    IContentHost <|.. TextFileModel
    IContentHost <|.. NoteItemEditModel
    TextFileModel *-- ContentViewModelHost
    NoteItemEditModel *-- ContentViewModelHost
    ContentViewModelHost o-- ContentViewModel

    ContentViewModel <|-- TextViewModel
    ContentViewModel <|-- GridViewModel
    ContentViewModel <|-- MarkdownViewModel
    ContentViewModel <|-- NotebookViewModel
    ContentViewModel <|-- TodoViewModel
    ContentViewModel <|-- LinkViewModel
    ContentViewModel <|-- SvgViewModel
    ContentViewModel <|-- HtmlViewModel
    ContentViewModel <|-- MermaidViewModel
```

## Acquire / Release Lifecycle

```mermaid
sequenceDiagram
    participant RC as React Component
    participant Hook as useContentViewModel
    participant Host as IContentHost
    participant VMH as ContentViewModelHost
    participant Reg as EditorRegistry
    participant VM as ContentViewModel

    Note over RC: Component mounts

    RC->>Hook: useContentViewModel(host, editorId)
    Hook->>Host: acquireViewModel(editorId)
    Host->>VMH: acquire(editorId)

    alt First acquisition (not cached)
        VMH->>Reg: loadViewModelFactory(editorId)
        Reg-->>VMH: factory function
        VMH->>VM: factory(host) → new ViewModel
        VM->>VM: init() → onInit()
        Note right of VM: Parse content,<br/>set up subscriptions
        VMH->>VMH: cache VM, refs = 1
    else Already cached
        VMH->>VMH: refs++
    end

    VMH-->>Hook: ContentViewModel
    Hook-->>RC: viewModel ready

    Note over RC: Component renders using VM state

    RC->>RC: useSyncExternalStore(vm.state)
    VM-->>RC: Reactive state updates

    Note over RC: Content changes externally

    Host->>VM: onContentChanged(newContent)
    VM->>VM: Re-parse, update state
    VM-->>RC: State update → re-render

    Note over RC: Component unmounts

    RC->>Hook: cleanup
    Hook->>Host: releaseViewModel(editorId)
    Host->>VMH: release(editorId)
    VMH->>VMH: refs--

    alt refs === 0
        VMH->>VM: dispose() → onDispose()
        Note right of VM: Cleanup subscriptions,<br/>flush pending saves
        VMH->>VMH: remove from cache
    else refs > 0
        Note right of VMH: Keep cached<br/>(other consumers exist)
    end
```

## Multiple Consumers

A ViewModel can have multiple consumers simultaneously (e.g., NotebookEditor + NotebookEditorFacade):

```mermaid
graph LR
    HOST["TextFileModel<br/>(IContentHost)"] --> VMH["ContentViewModelHost"]

    VMH --> |"refs: 1"| GVM["GridViewModel"]
    VMH --> |"refs: 0 → disposed"| MVM["MarkdownViewModel"]
    VMH --> |"refs: 2"| NVM["NotebookViewModel"]

    GVM --- GE["GridEditor<br/>(React component)"]
    NVM --- NE["NotebookEditor<br/>(React component)"]
    NVM --- NF["NotebookEditorFacade<br/>(script access)"]

    style HOST fill:#e3f2fd
    style VMH fill:#fff3e0
    style GVM fill:#e8f5e9
    style MVM fill:#ffebee
    style NVM fill:#e8f5e9
```

## Key Rules

1. **Never construct ViewModels directly** — always go through `host.acquireViewModel()`
2. **Always release** — every `acquire` must be paired with a `release`
3. **`tryGet()` doesn't increment refs** — use for read-only peeking (e.g., toolbar state)
4. **`disposeAll()` on host dispose** — TextFileModel calls this when the page tab closes
