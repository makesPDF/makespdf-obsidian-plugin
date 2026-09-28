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
  Plugin,
  PluginSettingTab,
  Setting,
  type SettingDefinitionItem,
  TFile,
  normalizePath,
  requestUrl,
} from "obsidian";

import {
  buildProblemContext,
  errorFieldOf,
  sendFeedback,
  validateFeedbackMessage,
  type ExportFailureFacts,
  type FeedbackContext,
  type FeedbackKind,
} from "./feedback";
import { outputFolderError } from "./output-folder";
import { extractBlock, extractSection, preprocessObsidian } from "./preprocess";

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
  outputFolder: string;
}

const DEFAULT_SETTINGS: MakesPdfSettings = {
  apiUrl: "https://makespdf.com",
  apiKey: "",
  pageSize: "A4",
  fontFamily: "Inter",
  fontSize: 10,
  margins: [40, 40, 40, 40],
  outputFolder: "",
};

/** Setting copy and options, shared by both settings renderers below. */
const API_KEY_DESC =
  "Optional. Without a key, exports use the free anonymous path (rate-limited, up to 20 pages per render). Add a key from your makespdf.com account for higher limits and larger documents.";
const API_URL_DESC = "Override for self-hosted or development use.";
const FONT_SIZE_DESC = "Font size in points (6 to 24)";
const OUTPUT_FOLDER_DESC =
  "A folder inside your vault. Leave empty to save alongside the note. PDFs are written into the vault, so paths outside it (such as ~/Downloads) are not supported.";


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
// Note Embed Resolution
// ---------------------------------------------------------------------------

/** Max recursion depth for note embeds to prevent runaway transclusion. */
const MAX_EMBED_DEPTH = 3;

/** Max total size (in characters) of all inlined content to prevent payload bloat. */
const MAX_EMBED_TOTAL_CHARS = 200_000;

/** Image extension pattern, used to skip image embeds (handled separately). */
const IMAGE_EXT_PATTERN = /\.(?:png|jpe?g|gif|svg|webp|bmp|avif)$/i;

/**
 * Recursively resolve `![[note]]` and `![[note#heading]]` embeds by reading
 * the referenced notes from the vault and inlining their content.
 *
 * Guards:
 * - Max depth of 3 levels to prevent runaway recursion
 * - Max total inlined characters (200k) to prevent payload bloat
 * - Circular reference detection via a visited set
 * - Image embeds are skipped (handled by preprocessObsidian + inlineVaultImages)
 */
async function resolveNoteEmbeds(
  md: string,
  vault: { read(file: TFile): Promise<string> },
  resolveLink: (linkpath: string, sourcePath: string) => TFile | null,
  sourcePath: string,
  depth = 0,
  visited = new Set<string>(),
  totalChars = { value: 0 },
): Promise<string> {
  // Find all note embeds (not image embeds)
  const embedRe = /!\[\[([^\]]+)\]\]/g;
  // Every entry is a promise, including the literal slices, so the array is
  // uniformly awaitable rather than a mix of values and thenables.
  const parts: Promise<string>[] = [];
  let lastIndex = 0;
  let match;

  while ((match = embedRe.exec(md)) !== null) {
    const ref = match[1];
    const fullMatch = match[0];
    const matchStart = match.index;

    // Append text before this embed
    parts.push(Promise.resolve(md.slice(lastIndex, matchStart)));
    lastIndex = matchStart + fullMatch.length;

    // Skip image embeds (already handled)
    if (IMAGE_EXT_PATTERN.test(ref.split("|")[0])) {
      parts.push(Promise.resolve(fullMatch));
      continue;
    }

    // Parse ref: "Note Name" or "Note Name#Heading" or "Note Name#^block-id"
    const hashIdx = ref.indexOf("#");
    const notePath = hashIdx >= 0 ? ref.slice(0, hashIdx) : ref;
    const section = hashIdx >= 0 ? ref.slice(hashIdx + 1) : null;

    // Guard: depth limit
    if (depth >= MAX_EMBED_DEPTH) {
      parts.push(Promise.resolve(`*[embed depth limit: ${ref}]*`));
      continue;
    }

    // Guard: total size limit
    if (totalChars.value >= MAX_EMBED_TOTAL_CHARS) {
      parts.push(Promise.resolve(`*[embed size limit: ${ref}]*`));
      continue;
    }

    // Resolve the note
    const file = resolveLink(notePath, sourcePath);
    if (!file) {
      parts.push(Promise.resolve(`*[not found: ${ref}]*`));
      continue;
    }

    // Guard: circular reference
    if (visited.has(file.path)) {
      parts.push(Promise.resolve(`*[circular embed: ${ref}]*`));
      continue;
    }

    // Read and process the embedded note
    parts.push(
      (async () => {
        const newVisited = new Set(visited);
        newVisited.add(file.path);

        let content = await vault.read(file);

        // Strip YAML frontmatter from embedded notes
        if (content.startsWith("---")) {
          const endIdx = content.indexOf("\n---", 3);
          if (endIdx >= 0) {
            content = content.slice(endIdx + 4).trimStart();
          }
        }

        // If a heading section is specified, extract just that section
        if (section && !section.startsWith("^")) {
          content = extractSection(content, section);
        } else if (section?.startsWith("^")) {
          content = extractBlock(content, section.slice(1));
        }

        // Track total size
        totalChars.value += content.length;
        if (totalChars.value > MAX_EMBED_TOTAL_CHARS) {
          content = content.slice(0, MAX_EMBED_TOTAL_CHARS - totalChars.value + content.length);
          content += "\n\n*[truncated: embed size limit]*";
        }

        // Recursively resolve embeds in the inlined content
        content = await resolveNoteEmbeds(
          content, vault, resolveLink, file.path,
          depth + 1, newVisited, totalChars,
        );

        // Run the same syntax preprocessing on embedded content
        content = preprocessObsidian(content);

        return "\n\n" + content.trim() + "\n\n";
      })(),
    );
  }

  // Append remaining text after last embed
  parts.push(Promise.resolve(md.slice(lastIndex)));

  // Resolve all async parts
  const resolved = await Promise.all(parts);
  let result = resolved.join("");

  // Fallback: convert any remaining unresolved embeds to italic references
  result = result.replace(
    /!\[\[([^\]]+)\]\]/g,
    (_m, ref: string) => `*See: ${ref}*`,
  );

  return result;
}

/** MIME types for image extensions. */
const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  bmp: "image/bmp",
  avif: "image/avif",
};

/**
 * Resolve local image paths in the markdown to data: URIs by reading
 * from the Obsidian vault. Remote URLs (http/https) are left untouched
 * for the API server to fetch.
 */
async function inlineVaultImages(
  md: string,
  vault: { readBinary(file: TFile): Promise<ArrayBuffer> },
  resolveAttachment: (linkpath: string, sourcePath: string) => TFile | null,
  sourcePath: string,
): Promise<string> {
  // Collect all local image references: ![alt](path) and <img src="path">
  const localImages = new Map<string, string>(); // path -> data URI

  // Match ![...](path) where path doesn't start with http
  const mdImageRe = /!\[[^\]]*\]\(([^)]+)\)/g;
  const htmlImageRe = /<img\s[^>]*src="([^"]+)"/g;

  const paths = new Set<string>();
  for (const re of [mdImageRe, htmlImageRe]) {
    let m;
    while ((m = re.exec(md)) !== null) {
      const src = m[1];
      if (src && !src.startsWith("http://") && !src.startsWith("https://") && !src.startsWith("data:")) {
        paths.add(src);
      }
    }
  }

  // Read each local image from the vault
  await Promise.all(
    [...paths].map(async (path) => {
      try {
        // Resolve via Obsidian's attachment resolution (handles relative paths, attachment folders)
        const file = resolveAttachment(path, sourcePath);
        if (!file) return;

        const ext = file.extension.toLowerCase();
        const mime = IMAGE_MIME[ext];
        if (!mime) return;

        const buf = await vault.readBinary(file);

        // Convert to base64 data URI
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const b64 = btoa(binary);
        localImages.set(path, `data:${mime};base64,${b64}`);
      } catch {
        // File not found or unreadable, leave the path as-is
      }
    }),
  );

  if (localImages.size === 0) return md;

  // Replace all local paths with their data URIs
  let result = md;
  for (const [path, dataUri] of localImages) {
    // Escape for use in regex
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "g"), dataUri);
  }
  return result;
}

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
      await this.exportToPdf(file);
    });

    this.addSettingTab(new MakesPdfSettingTab(this.app, this));
  }

  async loadSettings() {
    const stored = (await this.loadData()) as Partial<MakesPdfSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored ?? {});
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

  /** Error notice with a "Report problem" link that opens the feedback modal. */
  private showExportError(message: string, facts: ExportFailureFacts) {
    const fragment = createFragment((frag) => {
      frag.appendText(message);
      frag.createEl("br");
      const link = frag.createEl("a", { text: "Report problem", href: "#" });
      link.addEventListener("click", (event) => {
        event.preventDefault();
        notice.hide();
        this.openFeedback(facts);
      });
    });
    // Long enough to reach the link; a click anywhere else dismisses it.
    const notice = new Notice(fragment, 15_000);
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

    // 1. Resolve note embeds (recursive, with depth + size limits)
    let markdown = await resolveNoteEmbeds(
      rawMarkdown,
      this.app.vault,
      (linkpath, sourcePath) =>
        this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath),
      file.path,
    );

    // 2. Convert Obsidian-specific syntax to GFM
    markdown = preprocessObsidian(markdown);

    // 3. Inline local images as data URIs
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

    const notice = new Notice("Exporting to PDF...", 0);

    try {
      const base = (this.settings.apiUrl || DEFAULT_SETTINGS.apiUrl).replace(
        /\/+$/,
        "",
      );
      const url = `${base}/api/v1/md`;
      const title = file.basename;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.settings.apiKey) {
        headers.Authorization = `Bearer ${this.settings.apiKey}`;
      }

      const response = await requestUrl({
        url,
        method: "POST",
        headers,
        throw: false,
        body: JSON.stringify({
          markdown,
          options: {
            pageSize: this.settings.pageSize,
            fontFamily: this.settings.fontFamily,
            fontSize: this.settings.fontSize,
            margins: this.settings.margins,
            title,
          },
        }),
      });

      if (response.status !== 200) {
        facts.httpStatus = response.status;
        let detail = `HTTP ${response.status}`;
        const serverError = errorFieldOf(new TextDecoder().decode(response.arrayBuffer));
        if (serverError !== undefined) {
          detail = serverError;
          facts.errorCode = serverError;
        }
        if (
          (response.status === 429 || response.status === 413) &&
          !this.settings.apiKey
        ) {
          detail += ". Add an API key in the MakesPDF settings for higher limits.";
        }
        throw new Error(detail);
      }

      // Determine output path
      const pdfName = `${title}.pdf`;
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
        // Save alongside the source note
        const dir = file.parent?.path;
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
          await this.send(textarea.value);
          this.close();
        }),
    );
    textarea.focus();
  }

  onClose() {
    this.contentEl.empty();
  }

  private async send(message: string) {
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
    } else if (result.status === "rate-limited") {
      new Notice("Too many feedback messages, try again later.");
    } else {
      new Notice(
        createFragment((frag) => {
          frag.appendText(`Could not send feedback: ${result.error}. `);
          frag.createEl("a", { text: "Open a GitHub issue instead", href: ISSUES_URL });
        }),
        15_000,
      );
    }
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
      .setName("Send feedback")
      .setDesc(FEEDBACK_DESC)
      .addButton((button) =>
        button.setButtonText("Send feedback").onClick(() => this.plugin.openFeedback()),
      );
  }
}
