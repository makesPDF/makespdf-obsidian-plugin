/**
 * MakesPDF - Obsidian plugin
 *
 * Exports the current note to a typeset, accessible PDF (PDF/A-2A + PDF/UA-1)
 * via the makespdf.com API.
 */

import {
  App,
  Modal,
  Notice,
  parseYaml,
  Plugin,
  PluginSettingTab,
  requireApiVersion,
  Setting,
  type SettingDefinitionItem,
  TFile,
  normalizePath,
  requestUrl,
} from "obsidian";

import { buildCanvasExport } from "./canvas";
import {
  buildProblemContext,
  sendFeedback,
  validateFeedbackMessage,
  type ExportFailureFacts,
  type FeedbackContext,
  type FeedbackKind,
} from "./feedback";
import { buildRenderHeaders } from "./client";
import { describeRenderFailure } from "./render-error";
import { openPluginSettingsTab, type SettingsModalApp } from "./plugin-settings";
import { inlineVaultImages } from "./images";
import { outputFolderError } from "./output-folder";
import { withNoteTitle } from "./note-title";
import {
  PAGE_NUMBER_FORMATS,
  PAGE_NUMBER_POSITIONS,
  buildExportOptions,
  isPageNumberFormat,
  isPageNumberPosition,
  type PageNumberFormat,
  type PageNumberPosition,
} from "./page-numbers";
import { preprocessObsidian } from "./preprocess";
import { resolveNoteEmbeds } from "./note-embeds";
import {
  buildPropertyTable,
  insertPropertyTable,
  splitFrontMatter,
} from "./properties";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

interface MakesPdfSettings {
  apiUrl: string;
  apiKey: string;
  pageSize: "A3" | "A4" | "A5" | "Letter" | "Legal";
  fontFamily: "Inter" | "NotoSans";
  fontSize: number;
  margins: [number, number, number, number];
  pageNumbers: PageNumberFormat;
  pageNumberPosition: PageNumberPosition;
  outputFolder: string;
  includeProperties: string;
}

const DEFAULT_SETTINGS: MakesPdfSettings = {
  apiUrl: "https://makespdf.com",
  apiKey: "",
  pageSize: "A4",
  fontFamily: "Inter",
  fontSize: 10,
  margins: [40, 40, 40, 40],
  pageNumbers: "off",
  pageNumberPosition: "right",
  outputFolder: "",
  includeProperties: "",
};

/** Setting copy and options, shared by both settings renderers below. */
const API_KEY_DESC =
  "Optional. Without a key, exports use the free anonymous path (rate-limited, up to 20 pages per render). Add a key from your makespdf.com account for higher limits and larger documents.";
const API_URL_DESC = "Override for self-hosted or development use.";
const FONT_SIZE_DESC = "Font size in points (6 to 24)";
const PAGE_NUMBERS_DESC =
  "Print a page number in the footer of exported notes. Off by default. When this is Off, a pageNumbers property in the note's frontmatter is used instead.";
const PAGE_NUMBER_POSITION_DESC =
  "Where the page number sits in the footer. Only used when page numbers are on.";
const OUTPUT_FOLDER_DESC =
  "A folder inside your vault. Leave empty to save alongside the note. PDFs are written into the vault, so paths outside it (such as ~/Downloads) are not supported.";
const INCLUDE_PROPERTIES_DESC =
  "Comma-separated property names to print as a table at the top of the PDF, for example status, owner, due. Use * to include every property. Leave empty to print none.";
const INCLUDE_PROPERTIES_PLACEHOLDER = "For example: status, owner, due";


const PAGE_SIZES: Record<MakesPdfSettings["pageSize"], string> = {
  A3: "A3",
  A4: "A4",
  A5: "A5",
  Letter: "Letter",
  Legal: "Legal",
};

const FONT_FAMILIES: Record<MakesPdfSettings["fontFamily"], string> = {
  Inter: "Inter",
  NotoSans: "Noto Sans",
};

const FEEDBACK_DESC =
  "Report a problem or send an idea to the MakesPDF team. Only the message you type is sent - never your notes.";
const ISSUES_URL = "https://github.com/makesPDF/makespdf-obsidian-plugin/issues";

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default class MakesPdfPlugin extends Plugin {
  settings: MakesPdfSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: "export-to-pdf",
      name: "Export current note to PDF",
      editorCallback: (_editor, view) => {
        if (view.file) {
          void this.exportToPdf(view.file);
        }
      },
    });

    this.addCommand({
      id: "export-canvas-to-pdf",
      name: "Export current canvas to PDF",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "canvas") return false;
        if (!checking) void this.exportCanvasToPdf(file);
        return true;
      },
    });

    this.addCommand({
      id: "send-feedback",
      name: "Send feedback",
      callback: () => this.openFeedback(),
    });

    this.addRibbonIcon("file-down", "Export to PDF", async () => {
      const file = this.app.workspace.getActiveFile();
      if (!file) {
        new Notice("No active note to export");
        return;
      }
      if (file.extension === "canvas") {
        await this.exportCanvasToPdf(file);
      } else {
        await this.exportToPdf(file);
      }
    });

    this.addSettingTab(new MakesPdfSettingTab(this.app, this));
  }

  async loadSettings() {
    const stored = (await this.loadData()) as Partial<MakesPdfSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored ?? {});

    // `data.json` is user-editable, and a value the API does not accept would
    // leave the dropdown with nothing selected and the request silently
    // footerless. Fall back to the defaults instead.
    if (!isPageNumberFormat(this.settings.pageNumbers)) {
      this.settings.pageNumbers = DEFAULT_SETTINGS.pageNumbers;
    }
    if (!isPageNumberPosition(this.settings.pageNumberPosition)) {
      this.settings.pageNumberPosition = DEFAULT_SETTINGS.pageNumberPosition;
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /**
   * Open the feedback modal. With `problem`, the kind is fixed and the
   * fingerprints of the failed export ride along as `context`; without it
   * the user picks a kind and no context is sent.
   */
  openFeedback(problem?: ExportFailureFacts) {
    new FeedbackModal(this.app, this, problem ? buildProblemContext(problem) : undefined).open();
  }

  /**
   * Error notice with a "Report problem" link that opens the feedback modal.
   * `offerSettingsLink` adds a link to this plugin's settings tab, for the
   * failures the user fixes there (the anonymous page cap).
   */
  private showExportError(
    message: string,
    facts: ExportFailureFacts,
    offerSettingsLink = false,
  ) {
    const fragment = createFragment((frag) => {
      frag.appendText(message);
      frag.createEl("br");
      if (offerSettingsLink) {
        const settingsLink = frag.createEl("a", {
          text: "Open settings",
          href: "#",
        });
        settingsLink.addEventListener("click", (event) => {
          event.preventDefault();
          notice.hide();
          this.openPluginSettings();
        });
        frag.appendText(" \u00b7 ");
      }
      const link = frag.createEl("a", { text: "Report problem", href: "#" });
      link.addEventListener("click", (event) => {
        event.preventDefault();
        notice.hide();
        this.openFeedback(facts);
      });
    });
    // Long enough to reach the links; a click anywhere else dismisses it.
    const notice = new Notice(fragment, 15_000);
  }

  /**
   * Open this plugin's tab in Obsidian's settings modal. `App.setting` is not
   * in the public typings, so the helper feature-detects it: a build without
   * it leaves the link a no-op rather than throwing.
   */
  private openPluginSettings() {
    // `App.setting` exists at runtime but is not in the public typings.
    openPluginSettingsTab(this.app as unknown as SettingsModalApp, this.manifest.id);
  }

  /**
   * Print the whitelisted front matter properties as a table directly after
   * the front matter block, leaving the block itself intact so the server
   * still reads `title`, `author` and the other option keys from it. With an
   * empty whitelist (the default) the note is returned unchanged.
   */
  private withPropertyTable(markdown: string): string {
    if (!this.settings.includeProperties.trim()) return markdown;

    const info = splitFrontMatter(markdown);
    if (!info.exists) return markdown;

    let frontmatter: unknown;
    try {
      frontmatter = parseYaml(info.frontmatter);
    } catch {
      // Malformed YAML: export continues without the properties table.
      return markdown;
    }

    const table = buildPropertyTable(frontmatter, this.settings.includeProperties);
    return table ? insertPropertyTable(markdown, info.contentStart, table) : markdown;
  }

  async exportToPdf(file: TFile) {
    if (file.extension !== "md") {
      new Notice("Active file is not a Markdown document");
      return;
    }

    const rawMarkdown = await this.app.vault.read(file);
    if (!rawMarkdown.trim()) {
      new Notice("Document is empty");
      return;
    }

    // 1. Prepend the note's own title as an H1, and the whitelisted
    //    properties table if any. Both run before the Obsidian-to-GFM pass so
    //    the inserted markdown is converted too. The title goes on top of the
    //    table, matching Obsidian's reading view: inline title, properties,
    //    body.
    const source = withNoteTitle(this.withPropertyTable(rawMarkdown), file.basename);

    // 2. Resolve note embeds (recursive, with depth + size limits)
    let markdown = await resolveNoteEmbeds(
      source,
      this.app.vault,
      (linkpath, sourcePath) =>
        this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath),
      file.path,
    );

    // 3. Convert Obsidian-specific syntax to GFM
    markdown = preprocessObsidian(markdown);

    // 4. Inline local images as data URIs
    markdown = await inlineVaultImages(
      markdown,
      this.app.vault,
      (linkpath, sourcePath) =>
        this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath),
      file.path,
    );

    // Fingerprints for "Report problem": sizes and settings, never the note
    // text, its path or the vault name. The failure's status and error code
    // are added where the render call fails.
    const facts: ExportFailureFacts = {
      pageSize: this.settings.pageSize,
      inputBytes: new TextEncoder().encode(markdown).length,
    };

    const base = (this.settings.apiUrl || DEFAULT_SETTINGS.apiUrl).replace(
      /\/+$/,
      "",
    );

    await this.renderPdf({
      url: `${base}/api/v1/md`,
      body: JSON.stringify({
        markdown,
        // Built in one tested helper (page-numbers.ts): the page-number keys
        // are absent entirely when the setting is Off, which both keeps the
        // request unchanged for existing users and lets the note's own
        // frontmatter keys take effect (explicit options win over frontmatter).
        options: buildExportOptions(
          {
            pageSize: this.settings.pageSize,
            fontFamily: this.settings.fontFamily,
            fontSize: this.settings.fontSize,
            margins: this.settings.margins,
          },
          file.basename,
          this.settings.pageNumbers,
          this.settings.pageNumberPosition,
        ),
      }),
      sourceFile: file,
      facts,
    });
  }

  /** Export a canvas board via POST /api/v1/canvas. */
  async exportCanvasToPdf(file: TFile) {
    if (file.extension !== "canvas") {
      new Notice("Active file is not a canvas board");
      return;
    }

    const canvasText = await this.app.vault.read(file);

    // Fingerprints for "Report problem", as for notes: sizes and settings,
    // never the board's text or its path. inputBytes becomes the encoded
    // request size once the body is built.
    const facts: ExportFailureFacts = {
      pageSize: this.settings.pageSize,
      inputBytes: new TextEncoder().encode(canvasText).length,
    };

    const result = await buildCanvasExport({
      canvasText,
      sourcePath: file.path,
      options: {
        pageSize: this.settings.pageSize,
        fontFamily: this.settings.fontFamily,
        title: file.basename,
      },
      deps: {
        vault: {
          resolve: (linkpath, sourcePath) =>
            this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath),
          // resolve() hands back the metadata cache's TFile; anything else
          // has no vault content to read and the builder skips the entry.
          readText: (target) =>
            target instanceof TFile
              ? this.app.vault.read(target)
              : Promise.reject(new Error("canvas reference is not a vault file")),
          readBinary: (target) =>
            target instanceof TFile
              ? this.app.vault.readBinary(target)
              : Promise.reject(new Error("canvas reference is not a vault file")),
        },
        withPropertyTable: (markdown) => this.withPropertyTable(markdown),
        createCanvas: () => createEl("canvas"),
      },
    });

    if (!result.ok) {
      this.showExportError(result.message, facts);
      return;
    }
    facts.inputBytes = result.bodyBytes;

    const base = (this.settings.apiUrl || DEFAULT_SETTINGS.apiUrl).replace(
      /\/+$/,
      "",
    );

    await this.renderPdf({
      url: `${base}/api/v1/canvas`,
      body: result.body,
      sourceFile: file,
      facts,
    });
  }

  /**
   * POST a render body, write the PDF beside the source file (or into the
   * output folder) and report the outcome — shared by the note and canvas
   * exports so their request, save and failure paths cannot drift.
   */
  private async renderPdf(args: {
    url: string;
    body: string;
    sourceFile: TFile;
    facts: ExportFailureFacts;
  }): Promise<void> {
    const { url, body, sourceFile, facts } = args;
    const notice = new Notice("Exporting to PDF...", 0);

    try {
      const headers = buildRenderHeaders({
        version: this.manifest.version,
        apiKey: this.settings.apiKey,
      });

      const response = await requestUrl({
        url,
        method: "POST",
        headers,
        throw: false,
        body,
      });

      if (response.status !== 200) {
        notice.hide();
        facts.httpStatus = response.status;
        const failure = describeRenderFailure({
          status: response.status,
          bodyText: new TextDecoder().decode(response.arrayBuffer),
          hasApiKey: Boolean(this.settings.apiKey),
        });
        facts.errorCode = failure.errorCode;
        this.showExportError(
          `PDF export failed: ${failure.message}`,
          facts,
          failure.offerSettingsLink,
        );
        return;
      }

      // Determine output path
      const pdfName = `${sourceFile.basename}.pdf`;
      let pdfPath: string;
      if (this.settings.outputFolder.trim()) {
        const folderError = outputFolderError(this.settings.outputFolder);
        if (folderError) {
          notice.hide();
          new Notice(`Output folder: ${folderError}`);
          return;
        }
        const folder = normalizePath(this.settings.outputFolder);
        if (!this.app.vault.getAbstractFileByPath(folder)) {
          await this.app.vault.createFolder(folder);
        }
        pdfPath = normalizePath(`${folder}/${pdfName}`);
      } else {
        // Save alongside the source file
        const dir = sourceFile.parent?.path;
        pdfPath = dir && dir !== "/" ? normalizePath(`${dir}/${pdfName}`) : pdfName;
      }

      // Write or overwrite the PDF
      const existing = this.app.vault.getAbstractFileByPath(pdfPath);
      if (existing instanceof TFile) {
        await this.app.vault.modifyBinary(existing, response.arrayBuffer);
      } else {
        await this.app.vault.createBinary(pdfPath, response.arrayBuffer);
      }

      // Build stats from response headers
      const pages = response.headers["x-pages"] ?? response.headers["X-Pages"];
      const ms =
        response.headers["x-render-ms"] ?? response.headers["X-Render-Ms"];
      const stats = [
        pages && `${pages} page${pages === "1" ? "" : "s"}`,
        ms && `${ms}ms`,
      ]
        .filter(Boolean)
        .join(", ");

      notice.hide();
      new Notice(`PDF saved: ${pdfName}${stats ? ` (${stats})` : ""}`);
    } catch (err) {
      notice.hide();
      const message = err instanceof Error ? err.message : String(err);

      if (
        message.includes("ECONNREFUSED") ||
        message.includes("net::ERR") ||
        message.includes("fetch failed")
      ) {
        this.showExportError(
          `Could not connect to MakesPDF at ${this.settings.apiUrl || DEFAULT_SETTINGS.apiUrl}. Check your settings.`,
          facts,
        );
      } else {
        this.showExportError(`PDF export failed: ${message}`, facts);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Feedback Modal
// ---------------------------------------------------------------------------

const FEEDBACK_KINDS: Record<FeedbackKind, string> = {
  problem: "Problem",
  idea: "Idea",
  praise: "Praise",
};

const PROBLEM_HINT = "What went wrong? Please don't paste note content.";
const RATE_LIMITED = "Too many feedback messages, try again later.";
const OTHER_HINT = "Your feedback. Please don't paste note content.";

class FeedbackModal extends Modal {
  private kind: FeedbackKind = "problem";
  private sending = false;

  constructor(
    app: App,
    private plugin: MakesPdfPlugin,
    /** Set for "Report problem": the kind is fixed and this is sent as context. */
    private problemContext?: FeedbackContext,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    this.titleEl.setText(this.problemContext ? "Report a problem" : "Send feedback");

    if (!this.problemContext) {
      new Setting(contentEl).setName("Kind").addDropdown((dropdown) =>
        dropdown
          .addOptions(FEEDBACK_KINDS)
          .setValue(this.kind)
          .onChange((value) => {
            this.kind = value as FeedbackKind;
            textarea.placeholder = this.kind === "problem" ? PROBLEM_HINT : OTHER_HINT;
          }),
      );
    }

    const textarea = contentEl.createEl("textarea", {
      cls: "makespdf-feedback-message",
      attr: { rows: "6", placeholder: PROBLEM_HINT, "aria-label": "Feedback message" },
    });
    const errorEl = contentEl.createDiv({ cls: "makespdf-feedback-error" });

    new Setting(contentEl).addButton((button) =>
      button
        .setButtonText("Send")
        .setCta()
        .onClick(async () => {
          if (this.sending) return;
          const problem = validateFeedbackMessage(textarea.value);
          errorEl.setText(problem ?? "");
          if (problem) return;
          this.sending = true;
          button.setDisabled(true);
          const failure = await this.send(textarea.value);
          if (failure === null) {
            this.close();
            return;
          }
          // Keep the modal and the typed message so nothing has to be
          // retyped; show why it failed and let the user try again.
          errorEl.empty();
          errorEl.appendText(failure);
          if (failure !== RATE_LIMITED) {
            errorEl.appendText(" ");
            errorEl.createEl("a", { text: "Open a GitHub issue instead", href: ISSUES_URL });
          }
          this.sending = false;
          button.setDisabled(false);
        }),
    );
    textarea.focus();
  }

  onClose() {
    this.contentEl.empty();
  }

  /** Send the feedback: null on success, else the message to show in the modal. */
  private async send(message: string): Promise<string | null> {
    const settings = this.plugin.settings;
    const result = await sendFeedback(
      {
        apiUrl: settings.apiUrl || DEFAULT_SETTINGS.apiUrl,
        version: this.plugin.manifest.version,
        apiKey: settings.apiKey,
        kind: this.problemContext ? "problem" : this.kind,
        message,
        context: this.problemContext,
      },
      (request) => requestUrl(request),
    );

    if (result.status === "sent") {
      new Notice("Thanks, feedback sent.");
      return null;
    }
    if (result.status === "rate-limited") return RATE_LIMITED;
    return `Could not send feedback: ${result.error}.`;
  }
}

// ---------------------------------------------------------------------------
// Settings Tab
// ---------------------------------------------------------------------------

class MakesPdfSettingTab extends PluginSettingTab {
  plugin: MakesPdfPlugin;

  constructor(app: App, plugin: MakesPdfPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Declarative definitions, used from Obsidian 1.13.0 onwards. Rendering and
   * persistence are handled by PluginSettingTab, which reads and writes
   * `this.plugin.settings` by key. Returning a non-empty array here means
   * display() below is never called on 1.13.0+; it remains as the fallback
   * for the older versions this plugin still supports.
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: "API key",
        desc: API_KEY_DESC,
        aliases: ["token", "authorization", "bearer"],
        control: {
          type: "text",
          key: "apiKey",
          placeholder: "Paste your API key",
          defaultValue: DEFAULT_SETTINGS.apiKey,
        },
      },
      {
        name: "API URL",
        desc: API_URL_DESC,
        aliases: ["endpoint", "self-hosted", "server"],
        control: {
          type: "text",
          key: "apiUrl",
          placeholder: DEFAULT_SETTINGS.apiUrl,
          defaultValue: DEFAULT_SETTINGS.apiUrl,
        },
      },
      {
        type: "group",
        heading: "Output",
        items: [
          {
            name: "Page size",
            control: {
              type: "dropdown",
              key: "pageSize",
              options: PAGE_SIZES,
              defaultValue: DEFAULT_SETTINGS.pageSize,
            },
          },
          {
            name: "Font family",
            control: {
              type: "dropdown",
              key: "fontFamily",
              options: FONT_FAMILIES,
              defaultValue: DEFAULT_SETTINGS.fontFamily,
            },
          },
          {
            name: "Font size",
            desc: FONT_SIZE_DESC,
            control: {
              type: "slider",
              key: "fontSize",
              min: 6,
              max: 24,
              step: 1,
              defaultValue: DEFAULT_SETTINGS.fontSize,
            },
          },
          {
            name: "Page numbers",
            desc: PAGE_NUMBERS_DESC,
            aliases: ["footer", "pagination", "numbering"],
            control: {
              type: "dropdown",
              key: "pageNumbers",
              options: PAGE_NUMBER_FORMATS,
              defaultValue: DEFAULT_SETTINGS.pageNumbers,
            },
          },
          {
            name: "Page number position",
            desc: PAGE_NUMBER_POSITION_DESC,
            aliases: ["footer", "align"],
            control: {
              type: "dropdown",
              key: "pageNumberPosition",
              options: PAGE_NUMBER_POSITIONS,
              defaultValue: DEFAULT_SETTINGS.pageNumberPosition,
              // The position only matters while a format is chosen, so leave
              // it greyed out at Off (as the /markdown tool does).
              disabled: () => this.plugin.settings.pageNumbers === "off",
            },
          },
          {
            name: "Output folder",
            desc: OUTPUT_FOLDER_DESC,
            aliases: ["destination", "save location"],
            control: {
              type: "folder",
              key: "outputFolder",
              placeholder: "Folder path",
              defaultValue: DEFAULT_SETTINGS.outputFolder,
              validate: (value) => outputFolderError(value),
            },
          },
          {
            name: "Properties to include",
            desc: INCLUDE_PROPERTIES_DESC,
            aliases: ["frontmatter", "metadata", "yaml"],
            control: {
              type: "text",
              key: "includeProperties",
              placeholder: INCLUDE_PROPERTIES_PLACEHOLDER,
              defaultValue: DEFAULT_SETTINGS.includeProperties,
            },
          },
        ],
      },
      {
        name: "Send feedback",
        desc: FEEDBACK_DESC,
        aliases: ["report", "problem", "bug", "support"],
        action: () => this.plugin.openFeedback(),
      },
    ];
  }

  /**
   * Persist a control's value through the plugin's own settings object, then
   * re-evaluate the declarative predicates: the page-number position control
   * is disabled while the format is Off, and `disabled` is only evaluated on
   * render, so a format change has to refresh the DOM state.
   *
   * Both APIs are 1.13.0+, and this method only exists for the declarative
   * renderer that version adds; older versions use display().
   */
  async setControlValue(key: string, value: unknown): Promise<void> {
    if (requireApiVersion("1.13.0")) {
      await super.setControlValue(key, value);
      if (key === "pageNumbers") this.refreshDomState();
    }
  }

  /** Fallback renderer for Obsidian versions older than 1.13.0. */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("API key")
      .setDesc(API_KEY_DESC)
      .addText((text) =>
        text
          .setPlaceholder("Paste your API key")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("API URL")
      .setDesc(API_URL_DESC)
      .addText((text) =>
        text
          .setPlaceholder("https://makespdf.com")
          .setValue(this.plugin.settings.apiUrl)
          .onChange(async (value) => {
            this.plugin.settings.apiUrl = value || DEFAULT_SETTINGS.apiUrl;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName("Output").setHeading();

    new Setting(containerEl)
      .setName("Page size")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions(PAGE_SIZES)
          .setValue(this.plugin.settings.pageSize)
          .onChange(async (value) => {
            this.plugin.settings.pageSize =
              value as MakesPdfSettings["pageSize"];
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Font family")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions(FONT_FAMILIES)
          .setValue(this.plugin.settings.fontFamily)
          .onChange(async (value) => {
            this.plugin.settings.fontFamily =
              value as MakesPdfSettings["fontFamily"];
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Font size")
      .setDesc(FONT_SIZE_DESC)
      .addSlider((slider) =>
        slider
          .setLimits(6, 24, 1)
          .setValue(this.plugin.settings.fontSize)
          .onChange(async (value) => {
            this.plugin.settings.fontSize = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Page numbers")
      .setDesc(PAGE_NUMBERS_DESC)
      .addDropdown((dropdown) =>
        dropdown
          .addOptions(PAGE_NUMBER_FORMATS)
          .setValue(this.plugin.settings.pageNumbers)
          .onChange(async (value) => {
            const wasOff = this.plugin.settings.pageNumbers === "off";
            this.plugin.settings.pageNumbers =
              value as MakesPdfSettings["pageNumbers"];
            await this.plugin.saveSettings();
            // The position control is disabled while the format is Off, so
            // re-render when the format crosses that boundary.
            if (wasOff !== (this.plugin.settings.pageNumbers === "off")) {
              this.display();
            }
          }),
      );

    new Setting(containerEl)
      .setName("Page number position")
      .setDesc(PAGE_NUMBER_POSITION_DESC)
      .addDropdown((dropdown) =>
        dropdown
          .addOptions(PAGE_NUMBER_POSITIONS)
          .setValue(this.plugin.settings.pageNumberPosition)
          // No effect while the format is Off, so leave it greyed out.
          .setDisabled(this.plugin.settings.pageNumbers === "off")
          .onChange(async (value) => {
            this.plugin.settings.pageNumberPosition =
              value as MakesPdfSettings["pageNumberPosition"];
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Output folder")
      .setDesc(OUTPUT_FOLDER_DESC)
      .addText((text) =>
        text
          .setPlaceholder("Folder path")
          .setValue(this.plugin.settings.outputFolder)
          .onChange(async (value) => {
            this.plugin.settings.outputFolder = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Properties to include")
      .setDesc(INCLUDE_PROPERTIES_DESC)
      .addText((text) =>
        text
          .setPlaceholder(INCLUDE_PROPERTIES_PLACEHOLDER)
          .setValue(this.plugin.settings.includeProperties)
          .onChange(async (value) => {
            this.plugin.settings.includeProperties = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Send feedback")
      .setDesc(FEEDBACK_DESC)
      .addButton((button) =>
        button.setButtonText("Send feedback").onClick(() => this.plugin.openFeedback()),
      );
  }
}
