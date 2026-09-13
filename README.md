# Codice

**Turn a folder of source code into a polished, shareable document — DOCX, PDF or ODT — entirely in your browser.**

Codice is a local-first documentation generator. Upload a project (or drop loose files), pick the files you want, customize a document template, live-preview the paginated result, and export a submission-ready report as **.docx**, **.pdf** or **.odt** — or bundle everything into a **.zip**. Nothing is uploaded to a server: all parsing, highlighting and document generation happens client-side.

---

## ✨ Feature Highlights

### Project intake
- **Upload a `.zip` archive** (or multiple archives) or **drag & drop a folder** — files are discovered recursively with common noise (`node_modules`, `.git`, build output, binaries, oversized files) excluded automatically.
- **Multi-project support** — several archives side by side, each with its own label, file tree and selection.
- **Loose-file drop** — dropping individual files creates a synthetic "Loose files" project; binary-only input is rejected with a clear error instead of silently adding junk.
- **File tree with real relative paths** — `├ └ │ ─` box-drawing structure view, per-file language detection, size display.
- **Duplicate filenames stay unambiguous** — files with the same name in different folders are distinguished by their relative paths everywhere (tree, selection, document, exports).
- **Bulk selection** — All / None / Invert operating on the *currently filtered* tree, plus search, extension filter and a live selection progress bar (N/M files, selected size).
- **Per-project selection rules** — include/exclude rule presets (by path, extension, pattern) evaluated against the filtered tree.

### Template editor (4 top-level sections)
1. **Page & Layout** — page size/orientation/margins, title page, project structure tree (toggle what appears in it), file & project headers (Single / Dual / Triple columns), table of contents, code behavior, document density, page breaks, advanced page options.
2. **Fonts Settings** — four groups: Body, Headings (Title | H1–H4 tab pages), Code and Project Structure, each with family/size/weight/color controls.
3. **Theme Settings** — syntax highlighting theme, 12 document colors (accents, headers, table rows, …) and the code-block theme (background, border style ☑ solid/dotted/dashed, padding).
4. **Save Preset** — persist the current template as a named preset; load it back later. Built-in presets ship with the app, and older/custom preset JSON is auto-migrated with defaults filled in.

### Live preview
- **True multi-page preview** with real pagination — page size, orientation and margins respond instantly.
- Every meaningful setting is visible: headers/footers (per-column content), vertical alignment (Top / Center / Bottom), code borders, colors and fonts.
- **Change highlighting** — a ~1 s subtle flash marks the section affected by your last edit (preview-only; never exported).
- **Outline panel** — clickable document map (title → TOC → project → Project Structure / Source Files → files) with scroll-spy, glyph tones and a one-click **copy outline as indented text**.
- **Print-friendly preview** — a print stylesheet so the preview doubles as a paper draft.

### Export
- **DOCX** (via `docx`), **PDF** (via `jsPDF`, with embedded DejaVu fonts so Unicode box-drawing glyphs render correctly) and **ODT** — all three share the same document model, so what you preview is what you get.
- **Single document** or **separate mode** — one document per project, zipped together (with collision-safe filenames: `demo.docx`, `demo_2.docx`, …).
- **Source ZIP export** — bundle the selected files exactly as shown in the tree.
- **Before-you-build archive previews** — inspect the exact ZIP contents (tree + sizes / planned document names) before committing to the export.
- **Export history** — the last 5 generated documents are kept in memory for one-click re-download; export stats (files, pages, words, duration) are reported per run.

### Workspace niceties
- **Light / dark UI themes**, **stats panel** (projects/files/lines/words), **metadata dialog** per project, **guided onboarding tour** (7 steps), **help dialog**, keyboard-accessible dialogs with Escape handling, reduced-motion support and ARIA labeling throughout.

---

## 🚀 Running the Project

### Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js 18+** (20+ recommended) | *or* **Bun 1.1+** — either runtime works |
| npm / pnpm / yarn / bun | any package manager; examples below use npm & bun |

> Codice is a **client-side app** — no database, no authentication and no environment variables are required. All parsing, highlighting and document generation happen in your browser.

### 1. Install dependencies

```bash
# with npm
npm install

# or with bun
bun install
```

### 2. Start the dev server

```bash
# with npm
npm run dev

# or with bun
bun run dev
```

Then open **http://localhost:3000** in your browser. The dev server runs on port **3000** by default.

### 3. Production build & serve (optional)

```bash
# with npm
npm run build
npm start        # serves the standalone build on port 3000

# or with bun
bun run build
bun start
```

### 4. Quality checks

```bash
npm run lint         # ESLint (Next.js rules)
npm run test         # vitest unit suite (40 files, 443 tests)
npm run test:watch   # vitest in watch mode
npx tsc --noEmit     # strict TypeScript check
```

## 📜 npm scripts reference

| Script | What it does |
|---|---|
| `dev` | Next.js dev server on port 3000 (logs piped to `dev.log`) |
| `build` | Production build (standalone output) + copy `static/` and `public/` |
| `start` | Serve the standalone production build |
| `lint` | ESLint across the repo |
| `test` | Run the vitest unit suite once |
| `test:watch` | Run vitest in watch mode |


---

## 🧱 Tech Stack

- **Next.js 16** (App Router) + **TypeScript 5** — strict mode (Next provides the dev server & routing shell; the app itself is one client-side page)
- **React 19**, Tailwind CSS 4 + a purpose-built Codice design system (`src/app/codice.css`), Lucide icons
- **Shiki** for syntax highlighting, lazy-loaded and cached per file
- **docx** (DOCX), **jsPDF** (PDF), **JSZip** (archive I/O)
- **vitest** + Testing Library — 40 files / 443 unit & component tests
- Zero server-side dependencies: 8 runtime packages total (next, react, react-dom, docx, jspdf, jszip, shiki, lucide-react)

---

## 📁 Project Structure

```
src/
├── app/                    # Next.js App Router (page.tsx mounts CodiceApp)
├── components/
│   ├── CodiceApp.tsx       # Application shell (sidebar / editor / preview / export)
│   ├── ProjectUpload.tsx   # ZIP & folder intake, exclusions, error surfacing
│   ├── ProjectsSidebar.tsx # Multi-project list, search, bulk selection, rules
│   ├── FileTree/           # Tree view with Unicode connectors & relative paths
│   ├── Settings/           # TemplateCustomizer (4 sections) + TemplatePreview
│   ├── Preview/            # Paginated DocumentPreview, OutlinePanel, empty states
│   ├── ExportPanel.tsx     # Format/mode controls, progress, history
│   └── common/             # Dialogs (help, metadata, archive preview), stats, tour
├── hooks/                  # useAppState (single source of truth)
├── lib/
│   ├── presets/            # DocumentPreset model, built-ins, migration, options
│   ├── exporters/          # docx / pdf / odt exporters + Unicode fallback map
│   ├── themes/             # Syntax theme registry, UI theme tokens
│   ├── highlight/          # Shiki lazy highlighter (per-file cache)
│   ├── documentBuilder.ts  # Canonical preview document model
│   ├── fileDiscovery.ts    # Recursive discovery + default exclusions
│   ├── selectionRules.ts   # Per-project include/exclude rules
│   ├── archivePreview.ts   # Before-you-build ZIP tree model
│   ├── documentOutline.ts  # Outline model + copy-as-text formatter
│   ├── preview/            # SHARED pagination model (both previews + tests)
│   └── …
├── test/                   # vitest suite (unit + component + e2e-flow tests)
└── types/                  # Shared domain types
```

---

## 🖱️ Quick Usage Walkthrough

1. **Upload** — drop a project `.zip` or folder onto the upload zone (multiple projects welcome).
2. **Select files** — check the files you want in the tree; use search / extension filter / All-None-Invert; optionally attach selection rules per project.
3. **Customize the template** — open the editor and tune Page & Layout, Fonts and Theme; save presets you like.
4. **Preview** — watch the paginated, syntax-highlighted document update live; navigate via the outline panel; print it if you like.
5. **Export** — pick DOCX / PDF / ODT, single or separate-per-project mode, preview the archive contents, then download. Re-download anything recent from the export history.

---

## 📝 Notes

- **Privacy**: file parsing, highlighting and document generation run entirely in your browser; no source code ever leaves the machine. No server APIs, no database, no auth.
- **Unicode box-drawing** (`├ └ │ ─`) is preserved verbatim in preview, DOCX, PDF and ODT. The PDF exporter embeds DejaVu Sans Mono and applies a glyph-level font fallback so tree glyphs render on every platform.
- **Presets** are plain JSON and forward/backward compatible — the loader migrates older shapes and fills missing keys with defaults.
- This project derives from the original **Codice** (MIT, © Codice contributors — see `LICENSE`), ported to Next.js and extended substantially.

## 📄 License

MIT — see [LICENSE](./LICENSE).
