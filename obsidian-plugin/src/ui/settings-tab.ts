import { App, PluginSettingTab, Setting } from "obsidian";
import ClaudeExporterPlugin from "../main";

export class ClaudeExporterSettingsTab extends PluginSettingTab {
  plugin: ClaudeExporterPlugin;

  constructor(app: App, plugin: ClaudeExporterPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Export folder")
      .setDesc("Vault-relative path for exported chats")
      .addText((text) =>
        text
          .setPlaceholder("claude-chats")
          .setValue(this.plugin.settings.exportFolder)
          .onChange(async (value) => {
            this.plugin.settings.exportFolder = value || "claude-chats";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Artifacts folder")
      .setDesc("Vault-relative path for artifact files")
      .addText((text) =>
        text
          .setPlaceholder("attachments")
          .setValue(this.plugin.settings.artifactsFolder)
          .onChange(async (value) => {
            this.plugin.settings.artifactsFolder = value || "attachments";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Chat file name")
      .setDesc("Template for the chat note filename (no extension). Variables: {{title}}, {{created}}, {{updated}}, {{exported}}, {{model}}, {{messages}}, {{artifacts}}")
      .addText((text) =>
        text
          .setPlaceholder("{{created}}_{{title}}")
          .setValue(this.plugin.settings.chatNameTemplate)
          .onChange(async (value) => {
            this.plugin.settings.chatNameTemplate = value || "{{created}}_{{title}}";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Artifact file name")
      .setDesc("Template for artifact filenames (no extension). Variables: {{seqNum}}, {{title}}, {{chatTitle}}, {{chatCreated}}")
      .addText((text) =>
        text
          .setPlaceholder("{{seqNum}}_{{title}}")
          .setValue(this.plugin.settings.artifactNameTemplate)
          .onChange(async (value) => {
            this.plugin.settings.artifactNameTemplate = value || "{{seqNum}}_{{title}}";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Note template")
      .setDesc("Vault path to a Markdown template file (e.g. _templates/claude-chat.md). Leave blank to use the built-in format.")
      .addText((text) =>
        text
          .setPlaceholder("_templates/claude-chat.md")
          .setValue(this.plugin.settings.templatePath)
          .onChange(async (value) => {
            this.plugin.settings.templatePath = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Chrome path")
      .setDesc("Path to Chrome binary. Leave blank to auto-detect.")
      .addText((text) =>
        text
          .setPlaceholder("auto-detect")
          .setValue(this.plugin.settings.chromePath)
          .onChange(async (value) => {
            this.plugin.settings.chromePath = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Include thinking")
      .setDesc("Include Claude's thinking/reasoning blocks")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeThinking)
          .onChange(async (value) => {
            this.plugin.settings.includeThinking = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Include tool calls")
      .setDesc("Include tool use details (search, web fetch, etc.)")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeToolCalls)
          .onChange(async (value) => {
            this.plugin.settings.includeToolCalls = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("AI Table of Contents")
      .setDesc("Generate a table of contents using Claude (requires claude CLI to be installed and logged in)")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableToc)
          .onChange(async (value) => {
            this.plugin.settings.enableToc = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.enableToc) {
      new Setting(containerEl)
        .setName("Claude executable path")
        .setDesc('Required. Run `which claude` in your terminal and paste the result here (e.g. /home/user/.nvm/versions/node/v22/bin/claude)')
        .addText((text) =>
          text
            .setPlaceholder("/usr/local/bin/claude")
            .setValue(this.plugin.settings.claudePath)
            .onChange(async (value) => {
              this.plugin.settings.claudePath = value.trim();
              await this.plugin.saveSettings();
            })
        );
    }
  }
}
