/**
 * MakesPDF — Obsidian plugin
 *
 * Exports the current note to a beautifully typeset, accessible PDF
 * via the makespdf.com API.
 */

import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  requestUrl,
} from "obsidian";

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

// ---------------------------------------------------------------------------
// Obsidian → GFM Preprocessor
// ---------------------------------------------------------------------------

/**
 * Map of Obsidian callout types to the closest GFM alert type.
 * Types not listed here default to NOTE.
 */
const CALLOUT_MAP: Record<string, string> = {
  // Direct GFM equivalents
  note: "NOTE",
  tip: "TIP",
  hint: "TIP",
  important: "IMPORTANT",
  warning: "WARNING",
  attention: "WARNING",
  caution: "CAUTION",
  // Obsidian extras → closest GFM match
  info: "NOTE",
  abstract: "NOTE",
  summary: "NOTE",
  tldr: "NOTE",
  todo: "NOTE",
  success: "TIP",
  check: "TIP",
  done: "TIP",
  question: "NOTE",
  help: "NOTE",
  faq: "NOTE",
  failure: "CAUTION",
  fail: "CAUTION",
  missing: "CAUTION",
  danger: "CAUTION",
  error: "CAUTION",
  bug: "CAUTION",
  example: "NOTE",
  quote: "NOTE",
  cite: "NOTE",
};

/**
 * Converts Obsidian-flavoured markdown to GFM-compatible markdown.
 *
 * Handles: wikilinks, image embeds with resize, highlights, comments,
 * block references, tags, callout titles/types, and image resize syntax.
 */
function preprocessObsidian(md: string): string {
  let result = md;

  // 1. Strip comments %%...%% (block and inline)
  result = result.replace(/%%[\s\S]*?%%/g, "");

  // 2. Strip block reference IDs (trailing ^block-id)
  result = result.replace(/ \^[\w-]+$/gm, "");

  // 3. Image embeds: ![[file.ext]] and ![[file.ext|300]] (files with image extensions)
  result = result.replace(
    /!\[\[([^\]|]+\.(?:png|jpe?g|gif|svg|webp|bmp|avif))(?:\|(\d+(?:x\d+)?))?\]\]/gi,
    (_match, path: string, size?: string) => {
      if (size && size.includes("x")) {
        const [w, h] = size.split("x");
        return `<img src="${path}" width="${w}" height="${h}" alt="${path}">`;
      } else if (size) {
        return `<img src="${path}" width="${size}" alt="${path}">`;
      }
      return `![${path}](${path})`;
    },
  );

  // 4. Non-image embeds: ![[note]] and ![[note#heading]]
  //    Left as-is here — resolved by resolveNoteEmbeds() which has vault access.
  //    If not resolved (e.g. depth limit hit), fallback converts to italic ref.

  // 5. Wikilinks: [[page|alias]] → alias, [[page#heading]] → heading, [[page]] → page
  result = result.replace(
    /\[\[([^\]|]+?)(?:#([^\]|]*?))?(?:\|([^\]]*?))?\]\]/g,
    (_match, page: string, _heading?: string, alias?: string) => {
      if (alias) return alias;
      if (_heading) return _heading;
      return page;
    },
  );

  // 6. Highlights: ==text== → <mark>text</mark>
  result = result.replace(/==(.+?)==/g, "<mark>$1</mark>");

  // 7. Image resize in standard syntax: ![alt|300](url) → <img>
  result = result.replace(
    /!\[([^|\]]*)\|(\d+(?:x\d+)?)\]\(([^)]+)\)/g,
    (_match, alt: string, size: string, url: string) => {
      if (size.includes("x")) {
        const [w, h] = size.split("x");
        return `<img src="${url}" width="${w}" height="${h}" alt="${alt}">`;
      }
      return `<img src="${url}" width="${size}" alt="${alt}">`;
    },
  );

  // 8. Tags: #tag and #nested/tag → inline code (but not inside headings or #! patterns)
  //    Avoid matching inside headings (# Heading), hex colors (#fff), or numbered refs (#123)
  result = result.replace(
    /(?<=\s|^)#([a-zA-Z][a-zA-Z0-9_/-]*)/gm,
    (_match, tag: string) => `\`#${tag}\``,
  );

  // 9. Callouts: convert Obsidian types/titles to GFM alerts
  //    > [!type]  or  > [!type] Title  or  > [!type]- / > [!type]+
  result = result.replace(
    /^(>\s*)\[!(\w+)\]([+-])?(?:[ \t]+(.+))?$/gm,
    (_match, prefix: string, type: string, _foldable?: string, title?: string) => {
      const gfmType = CALLOUT_MAP[type.toLowerCase()] ?? "NOTE";
      const titleLine = title ? `\n${prefix}**${title}**\n${prefix}` : "";
      return `${prefix}[!${gfmType}]${titleLine}`;
    },
  );

  return result;
}

// ---------------------------------------------------------------------------
// Note Embed Resolution
// ---------------------------------------------------------------------------

/** Max recursion depth for note embeds to prevent runaway transclusion. */
const MAX_EMBED_DEPTH = 3;

/** Max total size (in characters) of all inlined content to prevent payload bloat. */
const MAX_EMBED_TOTAL_CHARS = 200_000;

/** Image extension pattern — used to skip image embeds (handled separately). */
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
  const parts: (string | Promise<string>)[] = [];
  let lastIndex = 0;
  let match;

  while ((match = embedRe.exec(md)) !== null) {
    const ref = match[1];
    const fullMatch = match[0];
    const matchStart = match.index;

    // Append text before this embed
    parts.push(md.slice(lastIndex, matchStart));
    lastIndex = matchStart + fullMatch.length;

    // Skip image embeds (already handled)
    if (IMAGE_EXT_PATTERN.test(ref.split("|")[0])) {
      parts.push(fullMatch);
      continue;
    }

    // Parse ref: "Note Name" or "Note Name#Heading" or "Note Name#^block-id"
    const hashIdx = ref.indexOf("#");
    const notePath = hashIdx >= 0 ? ref.slice(0, hashIdx) : ref;
    const section = hashIdx >= 0 ? ref.slice(hashIdx + 1) : null;

    // Guard: depth limit
    if (depth >= MAX_EMBED_DEPTH) {
      parts.push(`*\u2014 ${ref} (embed depth limit)\u00A0\u2014*`);
      continue;
    }

    // Guard: total size limit
    if (totalChars.value >= MAX_EMBED_TOTAL_CHARS) {
      parts.push(`*\u2014 ${ref} (embed size limit)\u00A0\u2014*`);
      continue;
    }

    // Resolve the note
    const file = resolveLink(notePath, sourcePath);
    if (!file) {
      parts.push(`*\u2014 ${ref} (not found)\u00A0\u2014*`);
      continue;
    }

    // Guard: circular reference
    if (visited.has(file.path)) {
      parts.push(`*\u2014 ${ref} (circular embed)\u00A0\u2014*`);
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
          content += "\n\n*\u2014 (truncated: embed size limit) \u2014*";
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
  parts.push(md.slice(lastIndex));

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

/**
 * Extract a heading section from markdown content.
 * Returns everything from the heading to the next heading of equal or higher level.
 */
function extractSection(content: string, heading: string): string {
  const lines = content.split("\n");
  let startIdx = -1;
  let startLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const headingMatch = lines[i].match(/^(#{1,6})\s+(.+)/);
    if (!headingMatch) continue;

    const level = headingMatch[1].length;
    const text = headingMatch[2].trim();

    if (startIdx < 0 && text.toLowerCase() === heading.toLowerCase()) {
      startIdx = i;
      startLevel = level;
    } else if (startIdx >= 0 && level <= startLevel) {
      return lines.slice(startIdx, i).join("\n");
    }
  }

  return startIdx >= 0 ? lines.slice(startIdx).join("\n") : content;
}

/**
 * Extract a block by its ^block-id reference.
 */
function extractBlock(content: string, blockId: string): string {
  const lines = content.split("\n");
  for (const line of lines) {
    if (line.includes(`^${blockId}`)) {
      return line.replace(` ^${blockId}`, "").trim();
    }
  }
  return content;
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

/** Image extensions we can inline. */
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|svg|webp|bmp|avif)$/i;

/**
 * Resolve local image paths in the markdown to data: URIs by reading
 * from the Obsidian vault. Remote URLs (http/https) are left untouched
 * for the API server to fetch.
 */
async function inlineVaultImages(
  md: string,
  vault: { adapter: { readBinary(path: string): Promise<ArrayBuffer> } },
  resolveAttachment: (linkpath: string, sourcePath: string) => TFile | null,
  sourcePath: string,
): Promise<string> {
  // Collect all local image references: ![alt](path) and <img src="path">
  const localImages = new Map<string, string>(); // path → data URI

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

        const buf = await vault.adapter.readBinary(file.path);
        const ext = file.extension.toLowerCase();
        const mime = IMAGE_MIME[ext];
        if (!mime) return;

        // Convert to base64 data URI
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const b64 = btoa(binary);
        localImages.set(path, `data:${mime};base64,${b64}`);
      } catch {
        // File not found or unreadable — leave the path as-is
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
          this.exportToPdf(view.file);
        }
      },
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
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

    const notice = new Notice("Exporting to PDF...", 0);

    try {
      const url = `${this.settings.apiUrl.replace(/\/+$/, "")}/api/v1/md`;
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
        let detail: string;
        try {
          detail = JSON.parse(new TextDecoder().decode(response.arrayBuffer)).error;
        } catch {
          detail = `HTTP ${response.status}`;
        }
        if (
          (response.status === 429 || response.status === 413) &&
          !this.settings.apiKey
        ) {
          detail += " — add an API key in Settings → MakesPDF for higher limits.";
        }
        throw new Error(detail);
      }

      // Determine output path
      const pdfName = `${title}.pdf`;
      let pdfPath: string;
      if (this.settings.outputFolder) {
        // Ensure folder exists
        const folder = this.settings.outputFolder.replace(/\/+$/, "");
        if (!this.app.vault.getAbstractFileByPath(folder)) {
          await this.app.vault.createFolder(folder);
        }
        pdfPath = `${folder}/${pdfName}`;
      } else {
        // Save alongside the source note
        const dir = file.parent?.path;
        pdfPath = dir && dir !== "/" ? `${dir}/${pdfName}` : pdfName;
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
        new Notice(
          `Could not connect to MakesPDF at ${this.settings.apiUrl}. Check your settings.`,
        );
      } else {
        new Notice(`PDF export failed: ${message}`);
      }
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

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "MakesPDF Settings" });

    new Setting(containerEl)
      .setName("API key")
      .setDesc(
        "Optional. Without a key, exports use the free anonymous path (rate-limited, up to 20 pages per render). Add a key from makespdf.com → Settings → API Keys for higher limits and larger documents.",
      )
      .addText((text) =>
        text
          .setPlaceholder("mpdf_...")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("API URL")
      .setDesc("Override for self-hosted or development use.")
      .addText((text) =>
        text
          .setPlaceholder("https://makespdf.com")
          .setValue(this.plugin.settings.apiUrl)
          .onChange(async (value) => {
            this.plugin.settings.apiUrl = value || DEFAULT_SETTINGS.apiUrl;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Page size")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            A3: "A3",
            A4: "A4",
            A5: "A5",
            Letter: "Letter",
            Legal: "Legal",
          })
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
          .addOptions({ Inter: "Inter", NotoSans: "Noto Sans" })
          .setValue(this.plugin.settings.fontFamily)
          .onChange(async (value) => {
            this.plugin.settings.fontFamily =
              value as MakesPdfSettings["fontFamily"];
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Font size")
      .setDesc("Font size in points (6–24)")
      .addSlider((slider) =>
        slider
          .setLimits(6, 24, 1)
          .setValue(this.plugin.settings.fontSize)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.fontSize = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Output folder")
      .setDesc(
        "Save PDFs to a specific folder. Leave empty to save alongside the note.",
      )
      .addText((text) =>
        text
          .setPlaceholder("e.g. exports/pdf")
          .setValue(this.plugin.settings.outputFolder)
          .onChange(async (value) => {
            this.plugin.settings.outputFolder = value;
            await this.plugin.saveSettings();
          }),
      );
  }
}
