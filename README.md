# Codice

**Codice turns project folders into polished, syntax-highlighted documents — DOCX, PDF and ODT — entirely in your browser.**

Point Codice at a source-code project (or a dozen), pick the files that matter, compose the document you want section by section, and generate submission-ready `.docx`, `.pdf` and `.odt` files. Nothing is ever uploaded: parsing, highlighting, layout, preview and export all run locally.

- Repository: <https://github.com/FrenZy-1/Codice>

---

## Why Codice

Handing in coursework, audit packs or code reviews usually means copy-pasting source files into Word and fighting with formatting. Codice automates the whole pipeline:

- Upload one or many projects (folders, ZIPs, drag-and-drop).
- Select the relevant files with search, bulk actions and glob include/exclude rules.
- Compose the document — title, table of contents, sections, per-file code blocks, images, panels — with a visual layout editor.
- Style it with presets (fonts, colors, syntax themes).
- Generate pixel-faithful DOCX / PDF / ODT output with real pagination, headers, footers and cover pages.

---

## Feature overview

- **Multi-project workspace** — upload folders, ZIP archives or standalone files; split multi-project folders into separate projects; merge and unmerge projects without losing files (duplicate paths stay independent).
- **Smart file selection** — extension/language filters, search, All/None/Invert bulk actions, gitignore-like include/exclude rule sets with presets, and configurable *default* selection preferences applied automatically at upload.
- **Layout editor** — compose exactly what the document contains (see the model below), with a live preview resolved against your real data.
- **Multi-export** — one document, one per project, or arbitrary export groups; each export can have its own layout, first page (title or imported cover), filename pattern and project set.
- **Images** — a persistent image library with thumbnails and captions; attach images to files or bind them to layout nodes; images flow into the preview and every export format.
- **Cover pages & title pages** — import a one-page `.docx` cover (kept exactly as authored for DOCX) or let Codice generate a title page; each export chooses independently.
- **Real pagination** — the preview shows true pages with headers/footers, page numbers, `{time}`-style tokens, and page breaks you control.
- **Outline & statistics** — the Outline pill lists the real document structure (headings, panels, dividers, images, files); the Statistics pill shows counts, sizes, languages and duplicate-name warnings.
- **Syntax highlighting** — Shiki-powered, with the full theme catalog, in the preview and in all three export formats (including box-drawing characters like `├ └ │ ─` in PDF via an embedded Unicode font).

---

## The document model: File → Section → Block → Node/Field

Understanding four words is enough to use the Layout editor:

```
Export (one output document)
└── File layout                      ← ONE ordered list
    ├── standalone node              ← e.g. Title, Panel, Text
    ├── Section                      ← renders once
    │   ├── standalone node          ← e.g. Heading, Image
    │   ├── Block                    ← repeats ONCE per assigned file
    │   │   ├── node ({fileName})
    │   │   └── node (Code)
    │   └── standalone node
    ├── standalone node              ← between sections, if you like
    └── Section
```

- **File** — one export document. Its layout is a single ordered sequence: standalone nodes and Sections interleave freely, so content can appear *before*, *between* and *after* sections.
- **Section** — a document subsection (“Task 01”, “Core classes”). Contains standalone nodes plus Blocks, in one order. Section Types (Task, Code + Output, Description + Answer, …) are one-click starter structures, not rigid schemas.
- **Block** — the per-file pattern. Whatever the Block contains renders once for every file assigned to it. One file lives in exactly one block — assigning it elsewhere moves it, never duplicates it.
- **Node / Field** — the content primitives: Text, Heading, Image, Code, File metadata (name/path/language/size/lines), Panel, Columns, Divider, Spacer, TOC, Page break, Metadata. A *field* is a named slot a node can bind to; values are filled per file, per section or once per document. Section field settings are **derived from the section content** — add a node and its field appears, delete the node and every trace disappears (validation included).

### Binding

Binding means “this node gets its content from this data”:

| Node content | Result |
| --- | --- |
| Static text `Task 01` | Always renders `Task 01` |
| Bound to `{fileName}` | Renders the current file's name — `Main.java`, `App.kt`, … |
| Bound to `{filePath}` | Renders the file's path relative to its project root |
| Bound to a custom field | Renders the value you fill in per file / section / document |
| Code node | Renders the current file's real source, syntax-highlighted |

Tokens like `{title}`, `{author}`, `{date}`, `{time}`, `{files}`, `{projectName}`, `{page}` and `{pages}` also work inside headers, footers and any literal text.

---

## Layout, page & template settings

Codice deliberately splits *what the document is* from *how it looks*:

| Area (button) | Owns |
| --- | --- |
| **Layout editor → File Layout** | Document structure: standalone nodes, sections, blocks, binding |
| **Layout editor → Page Settings** | Page size, orientation, margins, headers/footers, title-page layout, project structure, file headers, TOC, page breaks |
| **Layout editor → Assignment** | Files → blocks pool; projects → exports; per-export first page |
| **Template editor** | Fonts (per heading level), document & code colors, panel colors (with per-panel overrides), Shiki syntax theme, Document Density, style presets |

No control exists in both places, so nothing can drift out of sync.

### Multi-export

- **Combined** — all projects in one document.
- **Separate** — one document per project, delivered as a ZIP.
- **Export groups** — arbitrary named groups (Project 1+3 → “Client pack”, Project 2+1 → “Full set”). Each group can use a different layout (turn off *same layout for all exports* and per-export tabs appear in the Layout editor), its own title/cover first page, and its own filename pattern (`{title}`, `{group}`, `{date}`). *Generate all* runs every group in one click.

### Layout templates

Save, duplicate, rename, import and export layouts as versioned JSON. Older v1/v2 templates migrate automatically — file-bound blocks, standalone nodes, fields and ordering are preserved.

### Style presets

Four built-in presets (University, Developer, Minimal, Dark Code) plus your own saved presets, importable and exportable as JSON. Legacy presets migrate on load.

---

## Images

Upload images with the *Images* pill (or drop them straight in). They live in one canonical library in the sidebar — visible, captionable, removable — and persist in your browser. Use them three ways in a layout: a fixed library image, a bound image field filled per instance, or “images attached to the current file” inside a Block. Images are normalized to PNG/JPEG data URLs at import so all three exporters embed real pixels — never a temporary URL.

## Cover pages

Codice does not design covers — you import one. Upload a one-page `.docx` and its **first page only** is kept as raw document data and prepended as-is: DOCX output splices the original OOXML in verbatim; PDF and ODT re-render the page (text, formatting, images — best effort). Each export picks a cover **or** the generated title page, never both. Covers persist across sessions.

---

## Supported inputs

Source and text files in any language Codice's Shiki catalog knows: C, C++, C#, Java, Kotlin, Scala, Groovy, Python, Ruby, PHP, Lua, Perl, JavaScript, TypeScript, Rust, Go, Swift, Dart, Zig, shell scripts, HTML/CSS/SCSS/Less, Vue, Svelte, JSON, YAML, TOML, XML, INI, SQL, Markdown, reStructuredText, Dockerfile, Makefile, CMake, QML, Protocol Buffers, GraphQL and more — plus config files (all detected automatically). Upload via folder picker, multi-folder drag-and-drop, ZIP archive (unpacked locally) or loose files; a persistent **Standalone files** project holds anything uploaded without a folder. Common noise (build outputs, VCS dirs, binaries, lockfiles) is excluded by default and configurable.

## Output formats

| Format | Fidelity notes |
| --- | --- |
| **DOCX** | Full layout support: headings, panels (fill/border/text color), columns, images, page breaks, structured headers/footers with live page-number fields, TOC placeholder + static entries, verbatim cover splice. |
| **PDF** | True pagination with code blocks that never split mid-line, panel boxes with radius, embedded Unicode fallback font so `├ └ │ ─` stay literal, per-page header/footer overlay. |
| **ODT** | Complete layout support with panel tables, images in `Pictures/`, page-break styles, live page-number fields. |

## Architecture

Codice is a **local, browser-only application** — there is no server, no account and no telemetry. Everything (projects, layouts, presets, images, covers, export history) is stored on your device: preferences in `localStorage`, binary assets in IndexedDB. One canonical pipeline feeds every consumer:

```
Projects + selection + layout + content + style preset
        ↓
   Canonical resolver (one ordered resolved-document stream)
        ↓
   Shared paginator
        ↓
Main preview · Outline · Statistics · DOCX/PDF/ODT exporters
```

Preview and exports therefore always agree — what you see is literally the same data the exporters receive.

---

## Development

```bash
# install
npm install        # or: bun install

# dev server (Turbopack)
npm run dev        # http://localhost:3000

# lint & type-check
npm run lint
npx tsc --noEmit

# unit tests (Vitest + jsdom)
npm test           # one-shot
npm run test:watch # watch mode

# production build
npm run build
npm start
```

The test suite covers the document model, resolver, assignment invariants, multi-export behavior, migrations, selection rules, pagination, outline/statistics, cover-page splicing and the three exporters (including golden-path export matrix tests).

## Known limitations

- The PDF/ODT cover render is best-effort: exotic Word shapes/effects may simplify (DOCX keeps covers byte-exact; the UI warns whenever a cover could not be rendered).
- The DOCX table of contents is a static list plus Word's field placeholder — press “Update field” in Word for live page numbers.
- PDF panel boxes wrap only measurable children; code blocks inside a panel render below the box at full width.
- Very large previews are capped at 25 files (exports always include everything).

## License & links

- Repository: <https://github.com/FrenZy-1/Codice>
- Issues and PRs welcome.
