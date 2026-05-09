import { App, Modal, Setting, Notice } from "obsidian";
import { parseConversationId } from "../../../packages/converter/index.ts";
import { runExport, browseAndPick, type ExportSettings } from "../export";
import { CdpClient, shutdownChrome } from "../../../packages/chrome/index.ts";
import { StageError } from "../../../packages/orchestrator/index.ts";
import { RefreshAllModal } from "./refresh-all-modal";

export class ExportModal extends Modal {
  private settings: ExportSettings;
  private abortController: AbortController | null = null;
  private browseChild: import("child_process").ChildProcess | null = null;
  private browseCdp: CdpClient | null = null;

  constructor(app: App, settings: ExportSettings) {
    super(app);
    this.settings = settings;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Export Claude Chat" });

    let urlValue = "";
    let exportBtn: HTMLButtonElement;
    let statusEl: HTMLElement;

    new Setting(contentEl)
      .setName("Chat URL")
      .setDesc("Paste a claude.ai/chat/... URL")
      .addText((text) => {
        text.setPlaceholder("https://claude.ai/chat/...");
        text.onChange((value) => {
          urlValue = value.trim();
          const valid = !!parseConversationId(urlValue);
          exportBtn.disabled = !valid;
        });
        setTimeout(() => text.inputEl.focus(), 50);
      });

    statusEl = contentEl.createEl("p", { cls: "claude-export-status" });
    statusEl.style.fontStyle = "italic";
    statusEl.style.color = "var(--text-muted)";

    const buttonContainer = contentEl.createDiv({ cls: "claude-export-buttons" });
    buttonContainer.style.display = "flex";
    buttonContainer.style.gap = "8px";
    buttonContainer.style.justifyContent = "flex-end";
    buttonContainer.style.marginTop = "16px";

    const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => {
      this.abortController?.abort();
      this.close();
    });

    const refreshAllBtn = buttonContainer.createEl("button", { text: "Refresh All..." });
    refreshAllBtn.addEventListener("click", () => {
      new RefreshAllModal(this.app, this.settings).open();
    });

    // "Choose" button — opens Claude and waits for chat selection
    const chooseBtn = buttonContainer.createEl("button", { text: "Choose" });
    chooseBtn.title = "Open Claude in browser and pick a chat to export";
    chooseBtn.addEventListener("click", async () => {
      chooseBtn.disabled = true;
      exportBtn.disabled = true;
      cancelBtn.textContent = "Abort";
      this.abortController = new AbortController();

      try {
        const { conversationId, cdp, child } = await browseAndPick(
          this.settings,
          (msg) => { statusEl.textContent = msg; },
          this.abortController.signal
        );
        this.browseChild = child;
        this.browseCdp = cdp;

        // Chat selected — export it, reusing the CDP we already have open.
        // The orchestrator releases Chrome via onFetchComplete after fetching,
        // so onReleased nulls our refs to keep onClose's cleanup a no-op.
        statusEl.textContent = "Exporting...";
        const result = await runExport(
          this.app,
          this.settings,
          conversationId,
          (msg) => { statusEl.textContent = msg; },
          this.abortController.signal,
          {
            cdp,
            child,
            onReleased: () => {
              this.browseCdp = null;
              this.browseChild = null;
            },
          },
        );

        this.close();
        const delta = result.previousMessageCount !== undefined ? result.messageCount - result.previousMessageCount : undefined;
        const msgSummary = delta !== undefined && delta > 0
          ? `added ${delta} messages`
          : `${result.messageCount} messages`;
        new Notice(`Exported "${result.title}" (${msgSummary})`);

        const file = this.app.vault.getAbstractFileByPath(result.filePath);
        if (file) {
          await this.app.workspace.openLinkText(result.filePath, "", false);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === "Cancelled") {
          // silent — user-initiated
        } else if (e instanceof StageError && e.stage === "not_found") {
          statusEl.textContent = "Chat not found in Claude — skipped.";
          statusEl.style.color = "var(--text-muted)";
          new Notice("Chat not found in Claude — skipped.");
        } else {
          statusEl.textContent = `Error: ${msg}`;
          statusEl.style.color = "var(--text-error)";
          new Notice(`Export failed: ${msg}`);
        }
        chooseBtn.disabled = false;
        exportBtn.disabled = false;
        cancelBtn.textContent = "Cancel";
      }
    });

    exportBtn = buttonContainer.createEl("button", {
      text: "Export",
      cls: "mod-cta",
    });
    exportBtn.disabled = true;
    exportBtn.addEventListener("click", async () => {
      const conversationId = parseConversationId(urlValue);
      if (!conversationId) return;

      exportBtn.disabled = true;
      chooseBtn.disabled = true;
      cancelBtn.textContent = "Abort";
      this.abortController = new AbortController();

      try {
        const result = await runExport(
          this.app,
          this.settings,
          conversationId,
          (msg) => {
            statusEl.textContent = msg;
          },
          this.abortController.signal
        );

        this.close();
        const delta = result.previousMessageCount !== undefined ? result.messageCount - result.previousMessageCount : undefined;
        const msgSummary = delta !== undefined && delta > 0
          ? `added ${delta} messages`
          : `${result.messageCount} messages`;
        new Notice(`Exported "${result.title}" (${msgSummary})`);

        const file = this.app.vault.getAbstractFileByPath(result.filePath);
        if (file) {
          await this.app.workspace.openLinkText(result.filePath, "", false);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === "Cancelled") {
          // silent
        } else if (e instanceof StageError && e.stage === "not_found") {
          statusEl.textContent = "Chat not found in Claude — skipped.";
          statusEl.style.color = "var(--text-muted)";
          new Notice("Chat not found in Claude — skipped.");
        } else {
          statusEl.textContent = `Error: ${msg}`;
          statusEl.style.color = "var(--text-error)";
          new Notice(`Export failed: ${msg}`);
        }
        exportBtn.disabled = false;
        chooseBtn.disabled = false;
        cancelBtn.textContent = "Cancel";
      }
    });
  }

  onClose() {
    this.abortController?.abort();
    this.browseCdp?.close();
    this.browseCdp = null;
    shutdownChrome(this.browseChild);
    this.browseChild = null;
    this.contentEl.empty();
  }
}
