import { App, Modal, TFile, Notice } from "obsidian";
import { runExport } from "../export";
import { getConversationIdFromFrontmatter } from "./refresh-button";

interface RefreshAllSettings {
  exportFolder: string;
  artifactsFolder: string;
  chromePath: string;
  templatePath: string;
  includeThinking: boolean;
  includeToolCalls: boolean;
  enableToc: boolean;
  claudePath: string;
}

type EntryStatus = "pending" | "running" | "done" | "error";

interface FileEntry {
  file: TFile;
  conversationId: string;
  selected: boolean;
  checkboxEl: HTMLInputElement | null;
  statusEl: HTMLElement | null;
  status: EntryStatus;
}

export class RefreshAllModal extends Modal {
  private settings: RefreshAllSettings;
  private entries: FileEntry[] = [];
  private abortController: AbortController | null = null;

  constructor(app: App, settings: RefreshAllSettings) {
    super(app);
    this.settings = settings;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Refresh All Chats" });

    const folderPath = this.settings.exportFolder;
    const prefix = folderPath ? folderPath + "/" : "";

    const matchingFiles = this.app.vault.getFiles().filter((f) => {
      if (f.extension !== "md") return false;
      if (prefix && !f.path.startsWith(prefix)) return false;
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      if (!fm) return false;
      return !!getConversationIdFromFrontmatter(fm);
    });

    if (matchingFiles.length === 0) {
      contentEl.createEl("p", {
        text: "No exported Claude chats found in the export folder.",
        cls: "claude-refresh-empty",
      });
      const closeBtn = contentEl.createEl("button", { text: "Close" });
      closeBtn.style.marginTop = "12px";
      closeBtn.addEventListener("click", () => this.close());
      return;
    }

    this.entries = matchingFiles.map((f) => {
      const fm = this.app.metadataCache.getFileCache(f)!.frontmatter!;
      return {
        file: f,
        conversationId: getConversationIdFromFrontmatter(fm)!,
        selected: true,
        checkboxEl: null,
        statusEl: null,
        status: "pending" as EntryStatus,
      };
    });

    // Select-all row
    const selectAllRow = contentEl.createDiv({ cls: "claude-refresh-select-all" });
    selectAllRow.style.cssText =
      "display:flex;align-items:center;gap:8px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--background-modifier-border)";

    const selectAllCb = selectAllRow.createEl("input") as HTMLInputElement;
    selectAllCb.type = "checkbox";
    selectAllCb.checked = true;
    selectAllRow.createEl("span", { text: "Select all" });

    // File list
    const listEl = contentEl.createDiv({ cls: "claude-refresh-list" });
    listEl.style.cssText = "max-height:320px;overflow-y:auto;margin-bottom:16px";

    for (const entry of this.entries) {
      const row = listEl.createDiv({ cls: "claude-refresh-row" });
      row.style.cssText =
        "display:flex;align-items:center;gap:8px;padding:4px 0";

      const cb = row.createEl("input") as HTMLInputElement;
      cb.type = "checkbox";
      cb.checked = true;
      entry.checkboxEl = cb;

      row.createEl("span", { text: entry.file.basename, cls: "claude-refresh-name" });
      row.createEl("span", { cls: "claude-refresh-spacer" }).style.flex = "1";

      const statusEl = row.createEl("span", { cls: "claude-refresh-status" });
      statusEl.style.cssText = "font-size:0.85em;color:var(--text-muted);min-width:80px;text-align:right";
      entry.statusEl = statusEl;
    }

    // Wire checkboxes
    const updateSelectAll = () => {
      const total = this.entries.length;
      const checked = this.entries.filter((e) => e.selected).length;
      selectAllCb.indeterminate = checked > 0 && checked < total;
      selectAllCb.checked = checked === total;
      refreshBtn.disabled = checked === 0;
      const label = checked > 0 ? `Refresh ${checked}` : "Refresh";
      refreshBtn.textContent = label;
    };

    for (const entry of this.entries) {
      entry.checkboxEl!.addEventListener("change", () => {
        entry.selected = entry.checkboxEl!.checked;
        updateSelectAll();
      });
    }

    selectAllCb.addEventListener("change", () => {
      for (const entry of this.entries) {
        entry.selected = selectAllCb.checked;
        entry.checkboxEl!.checked = selectAllCb.checked;
      }
      updateSelectAll();
    });

    // Buttons
    const buttonContainer = contentEl.createDiv({ cls: "claude-refresh-buttons" });
    buttonContainer.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:8px";

    // Cancel button — phase-dependent behavior dispatched via a closure variable
    // so we never have to remove or layer event handlers. Pre-run: close the
    // modal. Mid-run: abort but leave the modal open so per-item status stays
    // visible. Post-run: close the modal.
    const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
    let onCancel: () => void = () => this.close();
    cancelBtn.addEventListener("click", () => onCancel());

    const refreshBtn = buttonContainer.createEl("button", {
      text: `Refresh ${this.entries.length}`,
      cls: "mod-cta",
    }) as HTMLButtonElement;

    refreshBtn.addEventListener("click", () => {
      this.runRefresh(selectAllRow, cancelBtn, refreshBtn, (h) => { onCancel = h; });
    });
  }

  private async runRefresh(
    selectAllRow: HTMLElement,
    cancelBtn: HTMLButtonElement,
    refreshBtn: HTMLButtonElement,
    setCancelHandler: (h: () => void) => void,
  ) {
    // Lock selection UI
    selectAllRow.style.display = "none";
    for (const entry of this.entries) {
      if (entry.checkboxEl) entry.checkboxEl.disabled = true;
    }
    refreshBtn.style.display = "none";
    cancelBtn.textContent = "Abort";

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Mid-run: abort only — the modal stays open so per-item status remains visible.
    setCancelHandler(() => this.abortController?.abort());

    const selected = this.entries.filter((e) => e.selected);
    let doneCount = 0;
    let errorCount = 0;

    for (const entry of selected) {
      if (signal.aborted) {
        this.setEntryStatus(entry, "error", "Aborted");
        continue;
      }

      this.setEntryStatus(entry, "running", "Exporting...");

      try {
        const result = await runExport(
          this.app,
          this.settings,
          entry.conversationId,
          (msg) => this.setEntryStatus(entry, "running", msg),
          signal
        );
        const delta = result.previousMessageCount !== undefined ? result.messageCount - result.previousMessageCount : undefined;
        const added = delta !== undefined && delta > 0
          ? `+${delta}`
          : `${result.messageCount}`;
        this.setEntryStatus(entry, "done", `✓ ${added} msgs`);
        doneCount++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "Cancelled") {
          this.setEntryStatus(entry, "error", "Aborted");
        } else {
          this.setEntryStatus(entry, "error", `Error: ${msg}`);
          errorCount++;
        }
      }
    }

    cancelBtn.textContent = "Close";
    setCancelHandler(() => this.close());

    const summary = errorCount > 0
      ? `Refreshed ${doneCount}, ${errorCount} failed`
      : `Refreshed ${doneCount} chat${doneCount !== 1 ? "s" : ""}`;
    new Notice(summary);
  }

  private setEntryStatus(entry: FileEntry, status: EntryStatus, text: string) {
    entry.status = status;
    if (!entry.statusEl) return;
    entry.statusEl.textContent = text;
    entry.statusEl.style.color =
      status === "done"
        ? "var(--color-green)"
        : status === "error"
        ? "var(--text-error)"
        : "var(--text-muted)";
  }

  onClose() {
    this.abortController?.abort();
    this.contentEl.empty();
  }
}
