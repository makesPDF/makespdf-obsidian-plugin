# MakesPDF — Obsidian Plugin

Export your Obsidian notes to beautifully typeset, accessible PDFs via [makespdf.com](https://makespdf.com).

## Features

- **Command palette:** "Export current note to PDF"
- **Ribbon icon:** PDF export button in the left sidebar
- Configurable page size, font family, font size, and output folder
- PDFs are PDF/A-2A + PDF/UA-1 compliant (accessible, archival quality)
- Syntax-highlighted code blocks, tables, GFM alerts, images, footnotes

## Setup

1. Install the plugin in Obsidian (Settings → Community Plugins → Browse → "MakesPDF")
2. Get an API key at [makespdf.com](https://makespdf.com) → Settings → API Keys
3. Open plugin settings and paste your API key

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| API key | — | Your makespdf.com API key |
| API URL | `https://makespdf.com` | Override for self-hosted or development |
| Page size | A4 | A3, A4, A5, Letter, or Legal |
| Font family | Inter | Inter or Noto Sans |
| Font size | 10 | Size in points (6–24) |
| Output folder | — | Save PDFs to a specific folder (empty = alongside note) |

## Development

### Prerequisites

The PDF service must be running locally:

```bash
# From the makesPDF monorepo root (for the API service)
pnpm dev
```

Then set the API URL in plugin settings to `http://localhost:8788`.

### Build

```bash
npm run build      # Production build
npm run dev        # Dev build (with sourcemaps)
npm run typecheck  # Type check
```

### Testing locally

1. Build the plugin: `npm run build`
2. Create a symlink from your vault's plugins folder to this repo:
   ```bash
   ln -s /path/to/makespdf-obsidian-plugin \
     /path/to/your-vault/.obsidian/plugins/makespdf
   ```
3. Enable the plugin in Obsidian → Settings → Community Plugins

### Publishing

To submit to the Obsidian community plugins directory:

1. Create a standalone GitHub repo (e.g. `makespdf-obsidian`)
2. Include `manifest.json`, `main.js`, and `styles.css` (if any) in the repo root
3. Create a GitHub release with those files attached
4. Submit a PR to [obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases) adding the plugin to `community-plugins.json`
