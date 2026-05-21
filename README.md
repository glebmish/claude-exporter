# Claude Exporter

[![CI](https://github.com/glebmish/claude-exporter/actions/workflows/ci.yml/badge.svg)](https://github.com/glebmish/claude-exporter/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/claude-exporter.svg)](https://www.npmjs.com/package/claude-exporter)
[![npm downloads](https://img.shields.io/npm/dm/claude-exporter.svg)](https://www.npmjs.com/package/claude-exporter)
[![License: MIT](https://img.shields.io/github/license/glebmish/claude-exporter.svg)](LICENSE)

Export Claude.ai conversations to Markdown straight into your Obsidian vault — or, if you prefer, via a CLI or a Chrome extension. Produces readable notes with artifacts, tool use, citations, and an optional AI-generated table of contents.

![Obsidian plugin demo](docs/demo.gif)

## Three ways to use it

| | What it is | For |
|---|---|---|
| **Obsidian plugin** (`obsidian-plugin/`) | Exports directly into a vault | Keeping a searchable archive inside Obsidian |
| **CLI** (`cli/`) | `claude-exporter <url>` in the terminal | Scripts, batch exports, one-off dumps |
| **Chrome extension** (`extension/`) | Popup on claude.ai, downloads Markdown + artifacts | Quick manual exports while browsing |

All three share the same converter, so output is consistent across them.

## Obsidian

### What it offers

- **Export Claude Chat** button - export by URL or select chat in the browser manually.
- **Refresh-All modal** — re-export every Claude note in a folder in one go.
- **Refresh button** — a refresh icon on any exported note re-runs the export in place and incrementally updates AI-generated TOC.
- **Vault-aware artifact placement** — artifacts land in a separate vault folder you choose, linked from the note.
- **Obsidian markdown flavor** - callouts for thinking blocks and tool use, wikilinks to artifacts.
- **Template support** for note name and content.

### Install

Install via [**BRAT**](https://github.com/TfTHacker/obsidian42-brat) (the community beta-plugin installer):

1. In Obsidian, install and enable the **BRAT** community plugin.
2. **BRAT → Add Beta plugin** → paste `glebmish/claude-exporter` → **Add Plugin**.
3. **Settings → Community plugins**, enable **Claude Exporter**.

BRAT will pull the latest release and auto-update on subsequent versions. To use AI enrichment, set the path to your local `claude` CLI in the plugin settings — see [AI enrichment](#ai-enrichment-optional).

Or, build from source (see [Build from source](#build-from-source)) and copy the artifacts into your vault (**copy, not symlink** — symlinks break Obsidian Sync):

```bash
mkdir -p <vault>/.obsidian/plugins/claude-exporter
cp obsidian-plugin/dist/* <vault>/.obsidian/plugins/claude-exporter/
```

Then in **Settings → Community plugins**, enable **Claude Exporter**.

### Usage

The plugin's three entry points:

- **Export Claude chat** — opens a modal where you paste a `claude.ai/chat/...` URL, or click "Choose" to pick a chat in the browser.
- **Refresh exported chat** — re-export the currently-open note in place; incrementally updates any existing AI-generated TOC.
- **Refresh all exported chats in folder** — opens the Refresh-All modal; review the list of detected exports, re-run them sequentially with progress.

### Configuration

Open **Settings → Community plugins → Claude Exporter** to configure:

| Setting | Purpose |
|---|---|
| **Export folder** | Vault-relative path for exported chats |
| **Artifacts folder** | Vault-relative path for artifact files |
| **Chat file name** | Template for the note filename — see [Filename templates](#filename-templates) for variables |
| **Artifact file name** | Template for artifact filenames — see [Filename templates](#filename-templates) for variables |
| **Note template** | Vault path to a Markdown template file (e.g. `_templates/claude-chat.md`); blank uses the built-in format. See [Template system](#template-system) for variables. |
| **Chrome path** | Override the auto-detected Chrome binary |
| **Include thinking** | Include Claude's thinking/reasoning blocks |
| **Include tool calls** | Include tool use details (search, web fetch, etc.) |
| **AI Table of Contents** | Toggle AI enrichment; reveals a **Claude executable path** sub-setting where you paste the output of `which claude`. See [AI enrichment](#ai-enrichment-optional). |

### Limitations

- **Desktop Obsidian only.** The plugin is `isDesktopOnly: true` — no iOS/Android.
- **Manual login on first run.** Same separate-profile Chrome model as the CLI — see [Access to claude.ai chats](#access-to-claudeai-chats).
- **Requires Claude Code** installed and authorized for AI-enrichment

## CLI

### What it offers

- Machine-readable **`--json`** output for piping into shell scripts and other tools.
- **`--existing`** flag for driving incremental re-export from outside Obsidian (the plugin uses the same code path internally).
- Support for simple Markdown and Obsidian flavor
- Drives the same export pipeline as the Obsidian plugin — every plugin feature is reachable from the command line for scripted vault imports

### Install

Run without installing:

```bash
npx claude-exporter <chat-url-or-id> [flags]
```

Or install globally:

```bash
npm install -g claude-exporter
claude-exporter <chat-url-or-id> [flags]
```

Requires **Node 18 or newer**. Chrome (or another Chromium build) must be installed; the CLI launches it in a separate profile — see [Access to claude.ai chats](#access-to-claudeai-chats).

Or, build from source (see [Build from source](#build-from-source)) and either run `node cli/dist/main.mjs <url>` directly or `npm link` to expose it as `claude-exporter` on your `PATH`.

### Examples

```bash
# Full list of arguments
claude-exporter --help

# Quickest start — export one chat into the current folder
npx claude-exporter https://claude.ai/chat/abc-123

# Text-only — skip artifact files and inline images
npx claude-exporter https://claude.ai/chat/abc-123 --no-artifacts --no-images

# Full transcript — include assistant thinking blocks and tool-call details
npx claude-exporter https://claude.ai/chat/abc-123 --thinking --tools

# Custom Markdown layout via a template file
npx claude-exporter https://claude.ai/chat/abc-123 --template ./my-template.md

# AI table of contents with per-topic recaps
# (requires the `claude` CLI installed and logged in — see "AI enrichment" below)
npx claude-exporter https://claude.ai/chat/abc-123 --toc recap

# Full Obsidian-plugin simulation: vault output, Obsidian flavor, custom
# template with enrichment placeholders, attachments redirected to a shared
# Attachments folder
npx claude-exporter https://claude.ai/chat/abc-123 \
  -o ~/vault/Claude \
  --attachments-dir ~/vault/Claude/Attachments \
  --format obsidian \
  --template ~/vault/Claude/_claude-template.md
```

### Limitations

- **Manual login on first run.** The first export pops up a Chrome window for an interactive sign-in; subsequent exports reuse the profile cookie until it expires.
- **Requires Chrome on disk.** No headless fallback and no built-in Chromium. Point `--chrome-path` (or `CHROME_PATH`) at any Chromium build if Chrome isn't your default.
- **Requires Claude Code** installed and authorized for AI-enrichment

## Chrome extension

### What it offers

- **Export** as a single-file download: `.md` file plus artifacts in a single archive.
- **Copy chat** button — copy the rendered Markdown to the clipboard without saving to disk.

### Install

Install the prebuilt bundle:

1. Download `claude-exporter-extension-v<version>.zip` (e.g. `claude-exporter-extension-v0.1.2.zip`) from the [latest release](https://github.com/glebmish/claude-exporter/releases/latest).
2. Unzip it somewhere stable (don't delete the folder — Chrome reads from it on every startup).
3. Open `chrome://extensions`, enable **Developer mode** (top right), click **Load unpacked**, and select the unzipped folder.

If Chrome shows "Manifest file is missing or unreadable" after Load unpacked, you likely selected the parent folder — make sure the folder you pick contains `manifest.json` directly.

Or, build from source (see [Build from source](#build-from-source)) and load the `extension/` directory directly. After `build:extension`, the source dir is itself a valid unpacked-loadable folder (the manifest references `dist/content.js`, which the build produces in place).

### Usage

1. Make sure you're signed in to claude.ai in the same browser profile.
2. Navigate to any `claude.ai/chat/...` page.
3. Click the **Claude Exporter** icon in the toolbar.
4. In the popup, toggle the per-export options and click **Export** to download, or **Copy chat** to put the rendered Markdown on your clipboard.

The export drops a `.md` file in your configured Downloads subdir, with artifacts bundled into a sibling `.zip` when **Include artifacts** is on.

### Configuration

Open the extension's settings page (gear icon in the popup, or `chrome://extensions` → **Details → Extension options**):

| Setting | Purpose |
|---|---|
| **Output directory** | Subdirectory within your Downloads folder. Default: `claude-chats`. |

Per-export toggles in the popup (not persisted across exports — set them each time):

- **Include artifacts** (default on)
- **Include thinking**
- **Include tool calls**

### Limitations

- **Active tab only.** The popup exports whichever chat is open in the current tab; no batch UI. For bulk, use the CLI or the plugin's Refresh-All modal.

## Access to claude.ai chats

The exporter reads conversations by capturing Claude's own backend JSON responses — the same payloads the web app receives when it renders your chat. It does not screen-scrape rendered HTML or simulate clicks. Two different paths get those requests authenticated, depending on which surface you use.

Nothing is stored by the tool itself — no tokens, no credentials — and nothing leaves your machine. All three surfaces read Anthropic's **internal** conversation endpoint; there is no SLA on its shape, so a schema change upstream will break exports until the converter is updated.

### CLI and Obsidian plugin

On first run, the tool launches a **separate Chrome profile** (empty, isolated from your main browser) and opens claude.ai. You log in once in that window; the session cookie stays in that profile for subsequent exports. The Chrome instance is driven over the DevTools Protocol, so requests to the conversation endpoint carry the same cookie a real browser would.

### Chrome extension

The extension runs inside your normal browser session — no separate profile, no extra login. As long as you're signed in to claude.ai in the tab where you click the popup, the extension reuses that session directly.

## Template system

Every exported note is rendered through a template string. The default template lives in the plugin settings / CLI; override it to change layout. Variables use `{{name}}` syntax.

| Variable | Content |
|---|---|
| `{{title}}` | Conversation title |
| `{{content}}` | Rendered messages + links section — the main body |
| `{{header}}` | Title + date range + model + message count block |
| `{{url}}` | Source URL on claude.ai |
| `{{model}}` | Model used in the conversation |
| `{{created}}`, `{{updated}}`, `{{exported}}` | ISO date strings |
| `{{createdTimestamp}}`, `{{updatedTimestamp}}` | Unix timestamps (seconds) |
| `{{messages}}` | Message count |
| `{{artifacts}}` | Artifact count |
| `{{toc}}` | AI-generated table of contents — empty unless enrichment is enabled |
| `{{tocWithRecap}}` | TOC with a short recap per topic |
| `{{keyTopics}}` | Key topics as a bullet list |
| `{{keyTopicsFlat}}` | Key topics as a comma-delimited string (handy for frontmatter tags) |

If `{{content}}` is not present in the template, the rendered content is appended to the end.

### Filename templates

The chat note filename and artifact filenames are also templated. Configurable in Obsidian plugin settings, or via `--chat-name-template` / `--artifact-name-template` flags on the CLI. Use `--chat-name <literal>` to override with an exact filename (no substitution):

| Setting | Default | Variables |
|---|---|---|
| **Chat file name** | `{{created}} {{title}}` | `{{title}}`, `{{titleSanitized}}`, `{{created}}`, `{{updated}}`, `{{exported}}`, `{{model}}`, `{{messages}}`, `{{artifacts}}` |
| **Artifact file name** | `{{seqNum}} {{title}}` | `{{seqNum}}`, `{{title}}`, `{{titleSanitized}}`, `{{chatTitle}}`, `{{chatTitleSanitized}}`, `{{chatCreated}}` |

`{{title}}` (and `{{chatTitle}}`) preserve case and spaces — only filesystem-unsafe characters are stripped. Defaults produce Obsidian-style names like `2026-04-28 Project Roadmap.md` and `01 Setup Guide.md`.

Extensions are appended automatically. Unknown variables (e.g. typos like `{{ttile}}`) are left literal in the resulting filename so mistakes are visible. If the template renders empty, the filename falls back to `untitled`.

## AI enrichment (optional)

The TOC, recap, and key-topics features use the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) with the `claude-haiku-4-5` model. Authentication is delegated to the local [`claude` CLI](https://docs.claude.com/en/docs/claude-code/overview) — whichever account you're logged into there is what gets used. No API key needs to be set anywhere in this tool. The feature is **opt-in**: without the `claude` CLI installed and logged in, enrichment flags and template placeholders render empty.

To enable:

- Install the `claude` CLI and log in (`claude` → follow prompts).
- In the Obsidian plugin, set the path to the `claude` executable in settings (e.g. the output of `which claude`). For the CLI, `claude` just needs to be on `PATH`.
- Pick which enrichment you want via template variables (`{{toc}}`, `{{tocWithRecap}}`, `{{keyTopics}}`, `{{keyTopicsFlat}}`) or CLI flags (`--toc headers|recap`, `--topics`). The two surfaces are mutually exclusive: with `--template`, placeholders carry the intent.

Incremental re-export: when re-exporting a note that already has a TOC, existing entries are parsed and reused, and the model only runs if new messages were added. This keeps re-exports cheap and stable.

## Build from source

```bash
git clone https://github.com/glebmish/claude-exporter.git
cd claude-exporter
npm install
```

Then build whichever consumer(s) you want:

```bash
npm run build:cli         # → cli/dist/main.mjs
npm run build:extension   # → extension/dist/
npm run build:plugin      # → obsidian-plugin/dist/ (main.js + manifest.json)
```

## Project layout

```
cli/                  CLI entry point and esbuild config
extension/            Chrome MV3 extension (popup, content script, settings)
obsidian-plugin/      Obsidian plugin (UI, export orchestration, settings)
packages/
  converter/          Conversation JSON → Markdown, template substitution
  chrome/             Separate-profile Chrome lifecycle + CDP WebSocket client
  orchestrator/       Wires converter + chrome + vault into the runExport pipeline
  toc/                AI enrichment via Claude Agent SDK (Haiku)
test/                 Node test runner suites + fixtures
```

## Internals

Contributor-facing notes on how the pieces fit together:

- [docs/architecture.md](docs/architecture.md) — module boundaries, the export pipeline, and how the three surfaces share the converter.
- [docs/claude-ai-api.md](docs/claude-ai-api.md) — shape of the upstream conversation JSON the converter reads, and the fetch path.
- [docs/sandbox-files.md](docs/sandbox-files.md) — how artifact sandbox files are resolved, named, and placed.

## Changelog

Release notes live on the [GitHub Releases page](https://github.com/glebmish/claude-exporter/releases).

## License

MIT — see [LICENSE](LICENSE).
