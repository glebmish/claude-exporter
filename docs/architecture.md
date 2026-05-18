# Architecture

Reader: a contributor who wants to add a feature or fix a bug. This doc explains
where things live, how the pieces fit, and the invariants that aren't obvious
from reading individual files. For the user-facing tour see `README.md`; for
exact JSON shapes see the converter source (no separate wire-format doc exists
yet).

## Overview

The repo produces one capability — "render a Claude.ai conversation as
Markdown, fetch its attachments, write the result somewhere" — and ships it
through three surfaces:

- `cli/` — Node CLI, `claude-exporter <url>`
- `obsidian-plugin/` — Obsidian plugin (modal, ribbon icon, per-note refresh button, Refresh-All modal)
- `extension/` — Chrome MV3 extension (popup + content script)

Reusable logic sits under `packages/`:

- `packages/converter/` — JSON-in, Markdown-out. No I/O, no Node deps.
- `packages/chrome/` — separate-profile Chrome lifecycle and CDP client.
- `packages/orchestrator/` — wires converter + chrome + filesystem into the
  `runExport` pipeline.
- `packages/toc/` — optional AI enrichment (TOC, recap, key topics) via the
  Claude Agent SDK with `claude-haiku-4-5`.

The CLI and Obsidian plugin both call `runExport` from `packages/orchestrator`.
The Chrome extension does not — it imports `packages/converter` directly and
implements its own light pipeline in `extension/src/content.ts`. See
[Surfaces](#surfaces) for why.

## Layered model

```text
          surfaces
   ┌──────┬────────────────┬──────────────┐
   │ cli/ │ obsidian-plugin│ extension/   │
   └───┬──┴────────┬───────┴──────┬───────┘
       │           │              │
       │           │              │ (extension bypasses)
       ▼           ▼              │
   packages/orchestrator          │
       │           │              │
       ▼           ▼              ▼
   packages/chrome   packages/toc   packages/converter
       │
       └──────────────┐
                      ▼
              packages/converter
```

Rules of thumb:

- `packages/converter` has no Node, no DOM, no `fs`, no `child_process`. It
  takes a conversation JSON plus options and returns a rendered Markdown
  string. The Chrome extension content script runs the converter unmodified
  in the page context — that's the test of its purity.
- `packages/chrome` is Node-only. It spawns Chrome (`child_process.spawn`)
  against a dedicated profile (`~/.claude-exporter-chrome`), exposes a
  `CdpClient` over a `ws` WebSocket, and runs page-side `fetch()` calls via
  `Runtime.evaluate` to read the conversation, images, and sandbox files.
- `packages/toc` is Node-only and depends on `@anthropic-ai/claude-agent-sdk`.
  Authentication is delegated entirely to the local `claude` CLI binary —
  the SDK uses whichever account that CLI is logged into; this repo never
  sees an API key.
- `packages/orchestrator` is the only place that knows about all four
  concerns. It depends on converter + chrome + toc and exposes a
  `FileSystem` interface that surfaces implement.

Edges that look surprising but are intentional:

- `packages/chrome/cdp.ts` and `packages/chrome/index.ts` import
  `StageError` from `../orchestrator/errors.ts`. Errors are shared
  vocabulary; the orchestrator is the natural home for that type and
  pulling it out into a separate `errors/` package would be ceremony.
- `obsidian-plugin/src/template.ts` is a 1-line re-export of
  `packages/orchestrator/template.ts`. Same for
  `packages/orchestrator/fs.ts` re-exporting the `FileSystem` type.
  Treat these as namespace aliases, not extension points.

## The export pipeline

`runExport(opts, deps)` in `packages/orchestrator/index.ts` is the canonical
flow. The eight phases below are labelled inline in that file; this section
is the contributor-facing version of those comments.

Inputs split into:

- `ExportOptions` — what to export, how to render it, where to write it,
  whether to enrich, refresh hints, Chrome settings. Defined in
  `packages/orchestrator/types.ts`.
- `ExportDeps` — `{ fs, onStatus?, signal?, cdpOverride?, onFetchComplete? }`.
  `fs` is the `FileSystem` interface the surface implements. `cdpOverride`
  is the Chrome-skipping test seam (and also how the Obsidian plugin reuses
  its "browse and pick" Chrome session).

### Phase 1: fetch

`fetchData` either uses `deps.cdpOverride` directly, or calls `withCdp` to
launch Chrome (`packages/chrome/index.ts: findChrome → launchChrome →
waitForReady → CdpClient.connect`), waits for the `sessionKey` +
`lastActiveOrg` cookies (via `extractAuth`), and then runs three CDP calls
through `Runtime.evaluate`:

- `fetchConversation(id)` — the `/api/organizations/.../chat_conversations/
  .../?tree=true&rendering_mode=messages&render_all_tools=true` endpoint.
- `fetchImageAsDataUrl(url)` for each inline image (`collectImages` in the
  converter walks the message tree to find them).
- `listSandboxFiles` + `downloadSandboxFile` for each "wiggle" sandbox file.

Immediately after fetch, `fetchData` calls `selectActiveLineage(data)`
(from `packages/converter/index.ts`) and assigns the result back to
`data.chat_messages`. The conversation API returns every branch the user
ever explored (edit-and-retry), and the active leaf is named in
`current_leaf_message_uuid`; this filter trims the array to that lineage
so every downstream phase — image fetch, render, enrichment — sees only
the conversation the user last saw. Falls back to the unfiltered array
when the leaf pointer is missing or stale. See
[claude-ai-api.md#branching](./claude-ai-api.md#branching) for the wire-
level details.

Sandbox files are listed under `/mnt/user-data/uploads/...` (user uploads)
and `/mnt/user-data/outputs/...` (Claude-written artifacts). See
[Cross-cutting](#cross-cutting-concerns) for the basename-matching trick
that handles the `/home/claude/...` alias.

### Phase 1.5: research-artifact replay

Wiggle does not store the "research artifact" outputs (the long-form reports
with `compass_artifact_wf-…` IDs). Their bodies live in
`tool_use.input.content` of `command="create"` blocks on the `artifacts`
tool. `replayResearchArtifacts` (in `packages/converter/index.ts`) walks
those blocks and `researchArtifactsAsSandboxFiles`
(`packages/orchestrator/sandbox.ts`) wraps each one as a synthetic
`SandboxFileContent`. They land in the same list as wiggle files so phase 8
writes them next to real artifacts and the converter links them with the
same machinery. Only `command="create"` is replayed; `update` / `rewrite`
warn and are dropped.

### Phase 2: parse

`parseConversation(data, options, context)` in `packages/converter/index.ts`
is the single render step. It produces a `ConversationResult` with:

- `messages: RenderedMessage[]` — each message's header + body, plus an
  optional `sectionHeading` / `sectionRange` populated later by enrichment.
- `linksSection` — consolidated citations.
- `datedTitle` — the on-disk filename stem, computed from the chat-name
  template (default `{{created}} {{title}}`).
- Everything needed by the default render and the template renderer.

Phase 2 also calls the converter's "Phase 0" sandbox indexing — see
[Cross-cutting](#cross-cutting-concerns).

### Phase 3: discover / load existing

If `existingFilePath` is set, or `discoverExistingByDatedTitle` finds
`<outputDir>/<datedTitle>.md`, `loadExistingFile`
(`packages/orchestrator/refresh.ts`) parses out:

- the previous `## Table of Contents` block, if present;
- a key-topics list (either from a `## Key topics` section, or from a
  template-derived `{{keyTopicsFlat}}` substitution by reverse-matching
  prefix/suffix);
- the previous human-message count, from the `- **Messages**: N` body line.

If `opts.patchInProgress` is set, the existing file's frontmatter key bound
to `{{exported}}` is rewritten to `updating` (via `findExportedKey` +
`patchInProgress` in `packages/orchestrator/template.ts`) so concurrent
readers see a stable signal that the file is mid-rewrite.

### Phase 4: enrichment intent

`scanTemplateVars` finds `{{toc}}`, `{{tocWithRecap}}`, `{{keyTopics}}`,
`{{keyTopicsFlat}}` in the template body. The orchestrator stays orthogonal:
callers (CLI, plugin) decide whether template placeholders should turn into
enrichment flags. The CLI does this in `cli/src/main.ts`; the plugin in
`obsidian-plugin/src/export.ts`.

### Phase 5: enrichment

`decideEnrichment` (`packages/orchestrator/refresh.ts`) is a four-way switch:

1. No enrichment wanted → pass-through.
2. Existing TOC covers the current message count and recap/topics are
   recoverable → `reuseExistingToc` rebuilds the result fields locally.
3. Topics-only fast path: template uses only `{{keyTopics}}` /
   `{{keyTopicsFlat}}`, no `{{toc}}` block exists in the file, but topics
   are present in the body — synthesise the topics fields and skip the
   agent.
4. Otherwise → `enrichWithToc` calls the Claude Agent SDK
   (`@anthropic-ai/claude-agent-sdk` + `claude-haiku-4-5`) with an
   incremental prompt that includes the existing TOC and only asks the
   model to handle the new tail. Failures land in `warnings`; the export
   still completes.

### Phase 6: render

If a template is set, `applyTemplate` substitutes variables. Without a
template, `renderDefault` emits a fixed layout (frontmatter, header, TOC if
present, content). `filterEnrichmentForDefaultRender` enforces the
`--toc-recap` vs `--toc` precedence (recap is a strict superset of the
headers list).

### Phase 7: stale-attachment cleanup

When refreshing an existing file, the per-chat attachments folder
(`<attachmentsBaseDir>/<datedTitle>/`) is wiped before phase 8 writes the
new set. This is unconditional on refresh — otherwise a renamed artifact
would leave its old name behind.

### Phase 8: write

The note goes to `<outputDir>/<datedTitle>.md`. Sandbox files go to
`<attachmentsBaseDir>/<datedTitle>/<relativeWritePath>`. `relativeWritePath`
is either `<filename>` for artifacts or `uploads/<filename>` for uploads.
Images go alongside.

The `onFetchComplete` deps callback fires *between phase 1 and phase 5*, not
at the end of phase 8. The Obsidian plugin uses it to release the Chrome
process before the (potentially slow) enrichment call so the user's Chrome
window doesn't linger.

## Surfaces

### CLI (`cli/`)

`cli/src/main.ts` is the thinnest of the three. It:

1. parses argv via `cli/src/argv.ts`,
2. reads the template file if `--template` was passed,
3. instantiates `NodeFs` (`cli/src/fs-node.ts`) — a `FileSystem` impl over
   `node:fs`,
4. calls `runExport` with a `Presenter` (prose or JSON) on `onStatus`,
5. classifies thrown errors into stages for the presenter.

`SIGINT` aborts via `AbortController`. Exit codes: `0` success or
`not_found` (benign skip), `1` errors, `2` argv errors, `130` cancelled.

Argv quirks worth knowing:

- `--template` and `--toc`/`--topics` are mutually exclusive; with a
  template, the placeholders carry the intent.
- `--chrome-port` is digit-only by design (rejects hex, scientific,
  decimals, whitespace).
- `--existing <path>` implicitly turns on `patchInProgress`.

### Obsidian plugin (`obsidian-plugin/`)

`obsidian-plugin/src/main.ts` registers a ribbon icon, a command, a
settings tab, and (via `setupExportButton`) an in-header refresh button on
any note whose frontmatter contains a Claude conversation URL or UUID.

`obsidian-plugin/src/export.ts: runExport` is the thin wrapper around the
orchestrator. It:

- builds an `ExportOptions` from `ExportSettings`, defaulting `format` to
  `"obsidian"`,
- always sets `patchInProgress: true` and `discoverExistingByDatedTitle:
  true` (every export is implicitly a refresh-if-exists),
- supplies a `VaultFs` (`obsidian-plugin/src/fs-vault.ts`) — a `FileSystem`
  impl over Obsidian's `app.vault.*` API and `normalizePath`.

`browseAndPick` in the same file is the "Browse Claude…" path: it owns a
Chrome session, waits for the user to navigate to a chat, returns
`{ conversationId, cdp, child }`, and lets the caller pass the open `cdp`
into `runExport` via `deps.cdpOverride`. The orchestrator's
`onFetchComplete` callback then closes the CDP and kills Chrome, so the
slow enrichment step doesn't keep the browser open.

UI files live under `obsidian-plugin/src/ui/`:

- `export-modal.ts` — paste-a-URL modal; also hosts the "Browse Claude..."
  and "Refresh All..." buttons.
- `refresh-all-modal.ts` — finds every note under the export folder with a
  Claude ID in its frontmatter, lets the user multi-select, runs them
  sequentially.
- `refresh-button.ts` — the per-note header button; this is where
  `getConversationIdFromFrontmatter` lives.
- `settings-tab.ts` — settings UI.

### Chrome extension (`extension/`)

The extension is the odd one out. It uses only `packages/converter` —
it does **not** go through `packages/orchestrator` or `packages/chrome`.

Why: in the page context, fetching the conversation is just a same-origin
`fetch('/api/organizations/.../chat_conversations/...')` with the session
cookie already attached, and the result must be packed as a `.zip` for
download (via `JSZip` in the popup) since the extension has no filesystem.
There's no Chrome to spawn, no CDP to drive, no vault to write to — the
orchestrator's value-add doesn't apply.

The split:

- `extension/src/content.ts` runs as the content script on `claude.ai`.
  It fetches the conversation, calls `fetchAllImages` and
  `fetchAllSandboxFiles` (re-implemented locally — they mirror what
  `packages/orchestrator/images.ts` and `packages/orchestrator/sandbox.ts`
  do but for the page context), and calls `buildMarkdown` from the
  converter. Returns `{ markdown, sandboxFiles, imageFiles, datedTitle }`
  over `chrome.runtime.onMessage`.
- `extension/src/popup.ts` runs in the popup, sends `{ action: 'export' }`
  or `{ action: 'copyChat' }` to the content script, zips the result with
  JSZip, and uses `chrome.downloads.download` to save it.

A subtle bit in `popup.ts: sendToContentScript`: the manifest declares the
content script via `content_scripts`, but tabs that were already open when
the extension was (re)loaded never receive it. On the
"Receiving end does not exist" error the popup falls back to
`chrome.scripting.executeScript({ files: ['dist/content.js'] })` and
retries — so the user never sees the stale-tab failure.

The extension's `manifest.json` requests `activeTab`, `storage`,
`downloads`, `tabs`, `scripting`, and host permission for
`https://claude.ai/*`. Settings live in `chrome.storage.local`.

## Cross-cutting concerns

### Converter purity

`packages/converter/index.ts` is the contract. The same module is imported
by the Node CLI, the Obsidian plugin (which runs in Electron's renderer),
and the Chrome extension content script (which runs in the page context).
Don't add `node:fs`, `node:child_process`, `Buffer`, or DOM APIs to anything
under `packages/converter/`. If you need binary decoding, use `atob` /
`Uint8Array` (see `packages/orchestrator/images.ts: decodeDataUrl`).

### Sandbox indexing: path + basename + artifactId

In `packages/converter/index.ts` around lines 460–485, sandbox files are
indexed three ways:

```ts
const sandboxFileByPath = new Map<string, SandboxEntry>();
const sandboxFileByBasename = new Map<string, SandboxEntry>();
const sandboxFileByArtifactId = new Map<string, SandboxEntry>();
```

Why three:

1. **By path.** The wiggle listing returns paths like
   `/mnt/user-data/outputs/02-shape.md`; tool calls in the same
   conversation reference the same file by that path. Direct match.
2. **By basename.** Claude's sandbox-shell environment increasingly emits
   tool calls that reference the same files by their `/home/claude/...`
   path. Same file, different directory. Indexing by basename lets the
   converter still emit a wikilink when only the parent directory differs.
3. **By artifactId.** Research artifacts (replayed in phase 1.5) have no
   real path. The `artifacts` tool_use block carries
   `input.id = "compass_artifact_wf-..."` and the synthetic
   `SandboxFileContent` carries `artifactId` set to that id. The converter
   matches the tool_use id to the entry.

If you add a new artifact source, follow the same pattern: synthesise a
unique `path`, set `artifactId` (or a similar discriminator), and the
converter will link it.

### `path` is sometimes synthetic

For replayed research artifacts, `SandboxFileContent.path` is
`research-artifact:<id>` — a placeholder used only to keep map keys
unique. Any code that treats `path` as a filesystem path will break on
research artifacts; treat it as opaque.

### Filename templates and seqNum continuity

Wiggle sandbox files are numbered sequentially by `createdAt` ascending
(`packages/orchestrator/sandbox.ts: fetchSandboxFiles`). Research
artifacts replayed afterwards continue from the last wiggle `seqNum` so
templates like `{{seqNum}} {{title}}` produce unique filenames across both
sources. If both produce the same templated filename a warning is emitted
(no auto-deduplication — overwriting is the documented failure mode).

### Electron-side AbortSignal compat in toc

`packages/toc/index.ts` opens with a monkey-patch:

```ts
EventEmitter.setMaxListeners = (...args) => {
  try { _origSetMaxListeners(...args); } catch (_) { /* Electron AbortSignal compat */ }
};
```

Obsidian's renderer process exposes browser-flavoured `AbortSignal`
(EventTarget), but the Agent SDK passes it to Node's
`EventEmitter.setMaxListeners`, which rejects non-Node EventTargets. The
patch swallows the throw — the only consequence is no listener limit on
internal SDK abort signals, harmless. Don't remove without an explicit
Electron-side test.

### Error stages

`StageError` (`packages/orchestrator/errors.ts`) carries a stage tag:
`cancelled | cdp | conversation | not_found | filesystem | auth | usage`.
The CLI maps stages to exit codes; the Obsidian plugin surfaces
`not_found` as a benign "chat no longer in Claude" notice. New error
classes should reuse stages where possible — adding a new stage is
fine, but every consumer that switches on stage has to handle it.

The `"Cancelled"` plain string thrown at AbortSignal check sites is
intentionally not a `StageError`; the CLI checks for the literal in
`classifyError`.

### AbortSignal

The orchestrator checks `deps.signal?.aborted` at phase boundaries and
inside long-running loops (image fetch, sandbox download). The CLI hooks
`SIGINT` → `ac.abort()`. The Obsidian plugin has Cancel buttons on the
export modal and refresh-all modal that abort the same controller. The
Chrome extension has no abort — operations are short enough not to need
one.

### In-progress marker

When refreshing, the existing note's frontmatter key bound to
`{{exported}}` is patched to the literal string `updating` *before*
phase 5/6/8 overwrite the file. Downstream consumers (sync agents,
indexers) can detect a transient state without parsing partial Markdown.
The key name is template-derived; the default render uses `exported:`,
templates can choose any key.

## Testing seams

Two interfaces hide the heavyweight dependencies:

- `FileSystem` (`packages/orchestrator/types.ts`) — `NodeFs`
  (`cli/src/fs-node.ts`), `VaultFs` (`obsidian-plugin/src/fs-vault.ts`),
  `InMemoryFs` (`test/helpers/in-memory-fs.ts`).
- `CdpFacade` (`packages/orchestrator/types.ts`) — the methods the
  orchestrator actually uses from `CdpClient`. Tests pass a
  `cdpOverride` made by `makeStubCdp` (`test/helpers/stub-cdp.ts`); the
  Obsidian plugin uses the same seam to share its own real `CdpClient`
  with the orchestrator's `runExport`.

If you're adding a phase to the pipeline that needs new I/O, prefer
extending one of these interfaces over reaching for `node:fs` or a fresh
WebSocket. The whole test suite (`test/*.test.ts`, run with
`node --test --experimental-strip-types test/*.test.ts`) leans on these
two seams.

## Build & runtime targets

Three esbuild configs:

- `cli/esbuild.config.mjs` — Node 18 ESM, `packages: "external"`, bundles
  to `cli/dist/main.mjs` with a `#!/usr/bin/env node` banner.
- `extension/esbuild.config.mjs` — two IIFE builds (content + popup),
  browser target, ES2022.
- `obsidian-plugin/esbuild.config.mjs` — CJS, `obsidian` /
  `electron` / `@codemirror/*` / `@lezer/*` marked external, copies
  `manifest.json` (and `styles.css` if present) into `dist/`. Production
  build is one-shot; dev mode is watch.

The Chrome extension's manifest copy/asset story lives outside esbuild:
`extension/popup.html`, `extension/settings.html`, `extension/background.js`,
`extension/jszip.min.js`, and `extension/icons/` are all loaded by Chrome
directly from `extension/` — there's no copy step.

The Obsidian plugin is `isDesktopOnly: true` in `manifest.json` because
the orchestrator + Chrome lifecycle requires Node + `child_process`.

## Where to make changes

| If you want to... | Edit |
|---|---|
| Change how a message block is rendered | `packages/converter/index.ts` |
| Add a new tool-call summary shape | `packages/converter/index.ts: toolCallSummary` |
| Change how a tool callout is decorated (integration prefix, duration tag, …) | `packages/converter/index.ts: decorateToolCall` |
| Change how tool_result merges into the matching tool_use callout | `packages/converter/index.ts` — the `tool_use_id` map in the assistant rendering loop |
| Change how citation origins are surfaced in the Links section | `packages/converter/index.ts: CitationTracker` |
| Change the standard vs obsidian flavor (callout, wikilink, etc.) | `packages/converter/formatters.ts` |
| Add a filename template variable | `packages/converter/filename-template.ts` and `packages/orchestrator/sandbox.ts: computeFilename` (sandbox files); `packages/converter/index.ts` around the `applyFilenameTemplate(chatNameTemplate, …)` call (chat note) |
| Add a `{{var}}` to the body template | `packages/orchestrator/template.ts: applyTemplate` and `ConversationResult` in `packages/converter/types.ts` |
| Add a new CDP-side fetch | `packages/chrome/cdp.ts` (page-side `fetch` via `Runtime.evaluate`), then add to `CdpFacade` in `packages/orchestrator/types.ts` |
| Add a new pipeline phase | `packages/orchestrator/index.ts: runExport` — match the existing `deps.onStatus?.(...)` + `signal?.aborted` pattern |
| Tune enrichment reuse rules | `packages/orchestrator/refresh.ts: decideEnrichment` |
| Add a new error class | `packages/orchestrator/errors.ts: ErrorStage` — and handle it in `cli/src/main.ts: classifyError` |
| Add a CLI flag | `cli/src/argv.ts` and the USAGE block at its top |
| Add an Obsidian setting | `obsidian-plugin/src/main.ts: ClaudeExporterSettings`, `obsidian-plugin/src/ui/settings-tab.ts`, and wire it through `obsidian-plugin/src/export.ts` |
| Add an extension popup option | `extension/popup.html`, `extension/src/popup.ts`, and (if it affects rendering) thread it through `handleExport` in `extension/src/content.ts` |
| Support a new sandbox-file source | Produce a `SandboxFileContent` in `packages/orchestrator/sandbox.ts`, ensure its `path` (or `artifactId`) is unique, and the converter will pick it up |
| Run the tests | `npm test` |
