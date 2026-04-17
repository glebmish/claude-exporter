import { App, Notice, WorkspaceLeaf, MarkdownView } from "obsidian";
import { parseConversationId } from "../../../packages/converter/index.ts";
import { runExport } from "../export";

interface RefreshSettings {
  exportFolder: string;
  artifactsFolder: string;
  chromePath: string;
  templatePath: string;
  includeThinking: boolean;
  includeToolCalls: boolean;
  enableToc: boolean;
  claudePath: string;
}

// Claude logo centered inside circular refresh arrows
const REFRESH_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2"><g transform="translate(22, 20) scale(2.3)" fill="currentColor" stroke="none"><path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"/></g><g fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M80 15l0 17h-17"/><path d="M20 85l0-17h17"/><path d="M80 32 A38 38 0 0 1 85 50 A38 38 0 0 1 50 88"/><path d="M20 68 A38 38 0 0 1 15 50 A38 38 0 0 1 50 12"/></g></svg>`;

function injectSpinnerStyles() {
  const id = "claude-export-spinner-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    @keyframes claude-export-spin {
      from { transform: rotate(0deg); }
      to   { transform: rotate(360deg); }
    }
    .claude-reexport-action.is-spinning svg {
      animation: claude-export-spin 1s linear infinite;
      transform-origin: center;
    }
  `;
  document.head.appendChild(style);
}

export function setupExportButton(
  app: App,
  getSettings: () => RefreshSettings
) {
  injectSpinnerStyles();

  const onLeafChange = (leaf: WorkspaceLeaf | null) => {
    // Remove from all leaves first
    app.workspace.iterateAllLeaves((l) => {
      l.view.containerEl
        .querySelectorAll(".claude-reexport-action")
        .forEach((el) => el.remove());
    });
    if (!leaf) return;
    setTimeout(() => injectButton(leaf, app, getSettings), 300);
  };

  return onLeafChange;
}

export function getConversationIdFromFrontmatter(frontmatter: Record<string, unknown>): string | null {
  for (const value of Object.values(frontmatter)) {
    if (typeof value === "string") {
      const id = parseConversationId(value);
      if (id) return id;
    }
  }
  return null;
}

function injectButton(
  leaf: WorkspaceLeaf,
  app: App,
  getSettings: () => RefreshSettings
) {
  const view = leaf.view;
  if (!(view instanceof MarkdownView)) return;

  const file = view.file;
  if (!file) return;

  const cache = app.metadataCache.getFileCache(file);
  if (!cache?.frontmatter) return;

  const conversationId = getConversationIdFromFrontmatter(cache.frontmatter);
  if (!conversationId) return;

  // Find the view-actions bar in the header
  const container = leaf.view.containerEl;
  const actionsBar = container.querySelector(".view-actions");
  if (!actionsBar) return;

  // Avoid duplicates
  if (actionsBar.querySelector(".claude-reexport-action")) return;

  const btn = document.createElement("a");
  btn.className = "view-action clickable-icon claude-reexport-action";
  btn.setAttribute("aria-label", "Re-export from Claude");
  btn.innerHTML = REFRESH_ICON;

  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    btn.addClass("is-spinning");

    try {
      const result = await runExport(
        app,
        getSettings(),
        conversationId,
        (msg) => {
          btn.setAttribute("aria-label", msg);
        }
      );
      const delta = result.previousMessageCount !== undefined ? result.messageCount - result.previousMessageCount : undefined;
      const msgSummary = delta !== undefined && delta > 0
        ? `added ${delta} messages`
        : `${result.messageCount} messages`;
      new Notice(`Exported "${result.title}" (${msgSummary})`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`Export failed: ${msg}`);
    } finally {
      btn.removeClass("is-spinning");
      btn.setAttribute("aria-label", "Re-export from Claude");
    }
  });

  // Insert at the beginning of the actions bar
  actionsBar.insertBefore(btn, actionsBar.firstChild);
}
