'use client';

/**
 * Help overlay — keyboard shortcuts + the full user guide (§41).
 *
 * The guide documents the ACTUAL v3 implementation: the File → (standalone
 * nodes + Sections) → Section → (standalone nodes + Blocks) → Node/Field
 * model, binding, section types, file assignment, the image library,
 * export groups, cover pages, and every supporting feature. Content is
 * data-driven so tests can assert coverage.
 */

import { useEffect, useState } from 'react';
import { X, Keyboard, Compass } from '@/components/common/Icons';

export interface ShortcutDef {
  keys: string[];
  label: string;
  /** Optional note shown under the label. */
  note?: string;
  /** Platform-dependent display: pass the platform-correct key list. */
}

/** Global shortcut catalogue (single source of truth for docs + tests). */
export function getShortcuts(isMac: boolean): ShortcutDef[] {
  const mod = isMac ? '⌘ Cmd' : 'Ctrl';
  return [
    {
      keys: [mod, 'E'],
      label: 'Export document',
      note: 'Generate DOCX / PDF / ODT for the current selection',
    },
    {
      keys: [mod, 'T'],
      label: 'Toggle template editor',
      note: 'Open or close the Template editor (styling)',
    },
    {
      keys: [mod, 'L'],
      label: 'Toggle layout editor',
      note: 'Open or close the Layout studio (document structure)',
    },
    {
      keys: [mod, 'D'],
      label: 'Toggle light / dark theme',
    },
    {
      keys: [mod, 'K'],
      label: 'Focus file search',
      note: 'Jump to the file filter box in the sidebar',
    },
    {
      keys: [mod, 'O'],
      label: 'Toggle document outline',
      note: 'Jump between title page, projects and files in the preview',
    },
    {
      keys: ['?'],
      label: 'Show this help',
      note: 'Shift + / on most keyboards',
    },
    {
      keys: ['Esc'],
      label: 'Close dialogs and the template editor',
    },
  ];
}

/* ------------------------------------------------------------------ */
/* The guide (§41) — plain-language documentation of the real app      */
/* ------------------------------------------------------------------ */

export interface GuideSection {
  id: string;
  title: string;
  /** Short paragraphs. */
  paragraphs: string[];
  /** Optional term → explanation list. */
  terms?: Array<{ term: string; text: string }>;
}

export function getGuideSections(): GuideSection[] {
  return [
    {
      id: 'model',
      title: 'How a Codice document is built',
      paragraphs: [
        'Every export file follows one layout. The layout is an ordered stack that starts with the File — the whole export document — and works inward. You compose it top to bottom in the Layout editor (the Layouts button in the top bar):',
        'A File can mix standalone nodes and Sections freely in one order. For example: a title heading, then Section 1, a spacer, Section 2, and a closing note AFTER the sections — anything, in any order.',
        'Inside a Section the same freedom applies: standalone nodes (a heading, an image, some text) plus Blocks, in one order.',
      ],
      terms: [
        {
          term: 'File',
          text: 'One export document — one generated .docx/.pdf/.odt. Its layout is the ordered list of standalone nodes and Sections you see in the Layout editor.',
        },
        {
          term: 'Section',
          text: 'A subsection of the document, e.g. “Task 01” or “Core classes”. A Section renders once and contains standalone nodes plus its Blocks.',
        },
        {
          term: 'Block',
          text: 'A per-file pattern. Whatever you put in a Block (a “{fileName}” heading, a description, the code, a note…) is repeated ONCE for each file assigned to it. Assign 3 files → the pattern renders 3 times, once per file.',
        },
        {
          term: 'Node / Field',
          text: 'The content primitives you build everything from: Text, Heading, Image, Code, Panel, Columns, Divider, Spacer, TOC (table of contents) and Page break. A Field is a named content slot you fill in later (see Binding).',
        },
      ],
    },
    {
      id: 'binding',
      title: 'Binding: where a node gets its content',
      paragraphs: [
        'Binding tells a node where to get its content. A node can hold static text you type once, or it can be bound to a field whose value arrives at render time.',
        'Static: a Heading node with the text “Task 01” always reads “Task 01”. Bound: a Heading bound to the current file’s name reads “Main.java” for Main.java, “App.kt” for App.kt — the same node, different content per file. A Code node bound to the code field renders the actual source of the current file with syntax highlighting.',
        'The context matters. Inside a Block, “current file” means the file whose instance is being rendered — that is why one pattern can serve every file. Section fields are filled once per section (Task title, Output, Answer…); document fields are filled once per file/export at the top level. A required field with no value blocks the export and tells you exactly which field is missing where.',
        'Tokens like {fileName}, {filePath}, {projectName}, {title}, {date}, {time}, {files}, {page} and {pages} expand inside any literal text.',
      ],
    },
    {
      id: 'section-types',
      title: 'Section types are starting templates',
      paragraphs: [
        'When you add a Section you pick a Section Type — Task, Code + Output, Description + Answer, Summary and friends. That choice only pre-fills a sensible structure; it is not a rigid schema.',
        'Afterwards the section is fully yours: add or remove nodes, reorder them, append another starter structure, add more Blocks, images, panels or standalone text. Two sections of the same type can end up looking completely different.',
      ],
    },
    {
      id: 'file-assignment',
      title: 'Assigning files to sections and blocks',
      paragraphs: [
        'One file appears in exactly one section and one block instance — never twice. Assigning a file to a block automatically removes it from every other selector, so you cannot double-book it by accident.',
        'Files you have not assigned anywhere are collected in the “unassigned” tray at the bottom of the Layout editor, and the Layouts button in the top bar shows an attention dot while any selected file is unassigned (the same dot appears when required fields are missing). Unassigned files simply do not appear in that layout’s export — nothing is silently lost.',
      ],
    },
    {
      id: 'images',
      title: 'Images and the image library',
      paragraphs: [
        'There is exactly ONE Image primitive in the layout, and it picks its pixels from one of three sources:',
        'Captions are optional text rendered under the image. Set them once in the sidebar library (the pencil icon) or per attachment in File properties — they render in the preview and every export format.',
      ],
      terms: [
        {
          term: 'Library image',
          text: 'A fixed image chosen from the library — the same picture every time. Good for logos and diagrams.',
        },
        {
          term: 'Bound image field',
          text: 'An image-kind field: the picture is chosen per section or per file when you fill the field, so each instance can show a different screenshot.',
        },
        {
          term: 'Images attached to the current file',
          text: 'Inside a Block, the Image node can render the images you attached to that specific file in File properties — one node, every file’s own pictures.',
        },
        {
          term: 'The library',
          text: 'Upload images with the Images pill in the upload area (or just drop them). They appear in the sidebar’s “Image library” panel with thumbnails, names and captions — one storage shared by the preview and all exporters. Remove an image there and it is gone everywhere. The library stays in your browser across sessions (up to 40 images); when that limit is exceeded the oldest are dropped from storage first and a warning names them.',
        },
      ],
    },
    {
      id: 'exports',
      title: 'Multiple exports: modes, groups, tabs',
      paragraphs: [
        'You are not limited to one output document. The export mode decides how many files you get:',
        'Export groups can also be given their own layout and their own first page. With “same layout for all exports” enabled, every export follows the globally applied layout; turn it off to assign a different layout per export. The preview shows one export at a time in browser-style tabs, so you can flip through what each document will contain.',
      ],
      terms: [
        {
          term: 'Combined',
          text: 'All selected projects flow into ONE document. Each section of the layout appears once, in order.',
        },
        {
          term: 'Separate (one per project)',
          text: 'One document per project, packaged as a ZIP. Each per-project document keeps the full section structure — only the files inside the blocks differ.',
        },
        {
          term: 'Export groups',
          text: 'Named, ordered project sets (Group A = Project A + C, Group B = B + A). A project may belong to any number of groups; each group exports exactly its own document. Groups persist across sessions: names, per-export layout/first-page/filename choices survive a reload, and projects simply get re-assigned after you upload them again. Each row shows a live summary — how many projects, files and bytes the export would contain right now.',
        },
        {
          term: 'Managing groups (duplicate, rename, reorder, assign)',
          text: 'Duplicate a group with the copy button — a full scaffold copy (projects, layout, first page, filename override) is inserted right under the source as “name (copy)”. Rename a group with the pencil button (or double-click its name). Reorder groups by dragging the row handle — or focus it and press ↑/↓. Assign projects three ways: click "+ Add projects" in the row, or drag a project from the sidebar straight onto the group row (click order = document order). Inside a group, drag a project chip or use its ↑/↓ buttons to fine-tune the document assembly order. Each group can also override its output file name (tokens: {title}, {group}, {date}) — leave it empty for the default “filename_group”. A chip dragged onto ANOTHER group’s row moves the project there (the row says “move here” so you can tell a move from an add) — or press the ▸ button on a chip for a “Move to…” list of the other groups, no drag needed.',
        },
        {
          term: 'Generate all (one click per scaffold)',
          text: 'The “Generate all” button in the groups header runs every group that has projects with selected files, one after another in scaffold order. Empty groups are skipped and counted in the summary toast instead of stopping the run; each document still gets its own per-group filename and success toast.',
        },
        {
          term: 'Recent exports (re-download)',
          text: 'The last few generated documents stay listed under “Recent exports” — click one to download it again without re-running the export. History persists in your browser across reloads (up to 5); “Clear history” frees both the memory and the saved copies.',
        },
        {
          term: 'Export tabs',
          text: 'The tabs above the preview switch between the documents you are about to export — one tab per export.',
        },
      ],
    },
    {
      id: 'workflows',
      title: 'Common workflows, step by step',
      paragraphs: [
        'Recipes for the things people build with Codice most often. Everything below happens in the Layout editor (structure) unless the recipe says otherwise.',
      ],
      terms: [
        {
          term: 'A document over MANY files',
          text: 'Add a Block to a section, put a “{fileName}” Heading, some text and a Code node inside it, then assign files to the block (one file per instance — assign several, the pattern repeats per file). This is the repeat-per-file pattern: one layout, every file rendered the same way with its own content.',
        },
        {
          term: 'Content OUTSIDE any section',
          text: 'At File level, add standalone nodes before, between or after Sections — an intro Heading, a Spacer, a closing Panel. They render exactly where they sit in the order; sections and standalone nodes interleave freely.',
        },
        {
          term: 'Repeating a section per file',
          text: 'Sections themselves are not per-file patterns — use a Section with one Block inside it. The section renders once; the block inside repeats for every assigned file.',
        },
        {
          term: 'Several DIFFERENT exports (e.g. report + answer sheet)',
          text: 'Switch the export mode to “Export groups”, create two groups, and assign different projects (or the same projects in a different order) to each. Generate each group with its own button — or run the whole scaffold at once with “Generate all”. Each group is exactly its own document, no content leaks between exports.',
        },
        {
          term: 'A different layout PER export',
          text: 'Turn “Use the same layout for all exports” off; each group row gains a Layout select. Leave it on and every export follows the one applied layout (shared layout mode).',
        },
        {
          term: 'Appearance-only changes',
          text: 'Restyle in the Template editor (fonts, colors, density, Shiki theme) — the layout structure is untouched, so you can flip presets without rebuilding the document.',
        },
        {
          term: 'A custom cover page',
          text: 'Import a one-page .docx in the Cover pages panel, then set the group\u2019s (or the export\u2019s) First page to “Cover page”. DOCX keeps it exactly as authored; PDF and ODT re-create it from its text, formatting and images (best effort).',
        },
        {
          term: 'Filling content later (fields)',
          text: 'Bind nodes to fields instead of static text. Required fields with no value block the export with a precise message and a “Fill content” affordance — nothing exports half-empty by surprise.',
        },
      ],
    },
    {
      id: 'covers',
      title: 'Cover pages',
      paragraphs: [
        'Codice does not design cover pages for you — you import one. Provide a one-page .docx (a cover you made in Word, Google Docs or exported from a design tool) and Codice uses its FIRST PAGE ONLY, kept as raw document data — never redesigned by Codice.',
        'Each export then chooses its own first page: the generated title page, or the imported cover instead of it. If the uploaded document has several pages, everything after page one is ignored.',
        'Imported cover pages stay in your browser across sessions (up to 20) — reload Codice and your cover library is still there.',
        'Cover pages apply to DOCX, PDF and ODT exports. DOCX preserves the cover exactly as authored; PDF and ODT re-create it from its text, formatting and images (best effort — exotic shapes may simplify).',
      ],
    },
    {
      id: 'selection-rules',
      title: 'Selection rules & default file selection',
      paragraphs: [
        'Uploading a folder grabs everything — but you rarely want everything. Two mechanisms keep the selection useful:',
        'Selection RULES (per project, in the sidebar) are gitignore-like glob patterns. Exclude rules deselect matching files (build/**, node_modules/**, *.log); include rules rescue files that would be excluded (**/*.kt, src/**). Rules apply live — the tree, statistics and exports update instantly — and you can still include or exclude any individual file afterwards: a manual override always wins over the rules. Save rule sets as presets and re-apply or share them as JSON.',
        'Default file-selection preferences (the “Defaults” button in the upload area) define what happens the moment a project is uploaded: default excluded extensions, force-included extensions, exclude/include patterns and excluded directories. The precedence is fixed and displayed in the dialog: default rules first, then per-project rules, then manual overrides. Changing the defaults never rewrites projects that are already loaded — the rules apply to the next upload.',
      ],
      terms: [
        {
          term: 'Pattern syntax',
          text: '* matches within one path segment, ** crosses directories, and a pattern without a slash (like *.java) matches the file name anywhere. Patterns are matched against the path relative to the project root.',
        },
        {
          term: 'Where the rules live',
          text: 'Exclude and include tabs live in the sidebar for the selected project. The upload-area “Defaults” button opens the global default selection preferences dialog.',
        },
      ],
    },
    {
      id: 'panels',
      title: 'Panels: structure vs. styling',
      paragraphs: [
        'A Panel is a visual container — fill, border, rounded corners, padding — with content stacked inside it. Columns place two or three stacks side by side.',
        'The split of responsibilities: the LAYOUT editor decides that a panel exists, where it sits, its padding, height and border width. The TEMPLATE editor (Theme → Panels) owns the colors: the preset-wide panel fill/border/text defaults plus a per-panel override list that lets you style each individual panel of the applied layout by its stable id — two panels both labelled “Output” can have completely different colors.',
        'The panel text color really colors the text inside the panel: children without their own color inherit it, in the preview and in DOCX, PDF and ODT exports alike.',
      ],
    },
    {
      id: 'projects',
      title: 'Projects: merge, unmerge, order, outline, statistics',
      paragraphs: [
        'Projects can be merged into one (the merge button on a project row) and split back apart with Unmerge — undoable, with every file keeping its identity even when two projects contain the exact same path.',
        'The Document order panel in the sidebar sets the canonical file order used by the preview, the Outline and all exporters. Projects with many files collapse like accordions (click a project header to fold or unfold it); drag or use ↑/↓ inside a project — files never cross project boundaries.',
        'The Outline pill above the preview lists the real document structure — headings, title page, TOC, sections and files (file names only; hover for the full path; duplicate names show enough path to tell them apart). The Statistics pill shows files, languages, sizes and more. Both popovers close on outside click and Escape.',
      ],
    },
    {
      id: 'pages',
      title: 'Pages, headers, footers, TOC',
      paragraphs: [
        'Page settings (size, margins, headers and footers) live in the Layout editor — they are structure. Document Density (how tight the spacing is) stays in the Template editor — it is styling.',
        'Headers and footers have left/center/right slots with tokens: {title}, {author}, {date}, {time} (e.g. {time:HH:mm} for a formatted clock), {page}, {pages}, {files}, {projectName}, {fileName} and {lines}, plus offsets and spacing.',
        'Page breaks are real page boundaries — insert them as layout nodes, or configure them per file/project/heading. The table of contents is a node too: drop a TOC node where you want it, or toggle it with the title page in the Template editor.',
      ],
    },
    {
      id: 'styling',
      title: 'Layout templates vs. style presets',
      paragraphs: [
        'Two systems, two questions. The LAYOUT TEMPLATE (Layouts button) answers “what does the document contain, in what order”. The STYLE PRESET (Template button) answers “how does it look”.',
        'Because they are separate, you can restyle any document without touching its structure — and reuse one layout across completely different presets.',
      ],
      terms: [
        {
          term: 'Style Preset',
          text: 'Fonts, colors, Shiki syntax theme, panel styling, Document Density. Save the current look as a preset, import/export presets from the Template editor.',
        },
        {
          term: 'Layout Template',
          text: 'Sections, blocks, nodes, fields. Create, duplicate, rename and delete layouts in the Layout editor; import/export them as JSON to share or back them up. The applied layout drives the preview and every export.',
        },
        {
          term: 'Shiki theme',
          text: 'The syntax-highlighting color scheme for code blocks — picked in the Template editor, applied consistently in the preview and all export formats.',
        },
      ],
    },
    {
      id: 'formats',
      title: 'Export formats',
      paragraphs: [
        'The same document exports to DOCX (Word), PDF and ODT (LibreOffice) from the export rail. Everything you configured — layout, styling, images, headers, cover pages where supported — carries into each format. Press Ctrl+E to start the export, or use the Generate button.',
        'Everything runs locally in your browser; your source code is never uploaded anywhere.',
      ],
    },
  ];
}

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <HelpDialogInner onClose={onClose} />;
}

function HelpDialogInner({ onClose }: { onClose: () => void }) {
  // Fresh mount on open → compute platform-correct shortcuts once.
  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const shortcuts = getShortcuts(isMac);
  const guide = getGuideSections();
  const [tab, setTab] = useState<'shortcuts' | 'guide'>('shortcuts');

  /** R12 — jump-to-section from the guide's chip navigation. */
  const jumpToSection = (id: string) => {
    setTab('guide');
    requestAnimationFrame(() => {
      document
        .getElementById(`help-sec-${id}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className="panel codice-fade-in relative flex max-h-[85vh] w-full max-w-2xl flex-col shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Help"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-app px-4 py-3">
          <div className="flex items-center gap-2">
            <Keyboard size={15} className="text-secondary" />
            <h2 className="text-sm font-semibold text-primary">Help</h2>
          </div>
          <button onClick={onClose} className="btn-ghost" aria-label="Close">
            <X size={15} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-app px-4 pt-2" role="tablist" aria-label="Help sections">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'shortcuts'}
            className={`rounded-t px-3 py-1.5 text-xs transition-colors ${
              tab === 'shortcuts' ? 'bg-app font-medium text-primary' : 'text-muted hover:text-primary'
            }`}
            onClick={() => setTab('shortcuts')}
          >
            Keyboard shortcuts
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'guide'}
            className={`rounded-t px-3 py-1.5 text-xs transition-colors ${
              tab === 'guide' ? 'bg-app font-medium text-primary' : 'text-muted hover:text-primary'
            }`}
            onClick={() => setTab('guide')}
          >
            Guide — how Codice works
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-4 py-3">
          {tab === 'shortcuts' ? (
            <ul className="space-y-1.5">
              {shortcuts.map((s) => (
                <li
                  key={s.label}
                  className="flex items-center justify-between gap-3 rounded-md border border-transparent px-2 py-1.5 transition-colors hover:border-app hover-surface"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-primary">{s.label}</div>
                    {s.note && (
                      <div className="text-xs text-muted">{s.note}</div>
                    )}
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    {s.keys.map((k) => (
                      <kbd key={k} className="kbd">
                        {k}
                      </kbd>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="space-y-4">
              {/* R12 — chip navigation: the guide is 12 sections deep now;
                  this row jumps straight to a topic without scrolling. */}
              <nav
                aria-label="Guide topics"
                className="flex flex-wrap gap-1 rounded-md border border-app bg-app/60 p-1.5"
              >
                {guide.map((section, i) => (
                  <button
                    key={section.id}
                    type="button"
                    className="rounded-full border border-transparent px-2 py-0.5 text-[10px] text-secondary transition-all hover:border-[var(--color-accent)] hover:text-primary focus-visible:outline focus-visible:outline-[var(--color-accent)]"
                    title={section.title}
                    onClick={() => jumpToSection(section.id)}
                  >
                    <span className="mr-0.5 text-muted tabular-nums">{i + 1}</span>
                    {section.title.length > 26 ? `${section.title.slice(0, 24)}…` : section.title}
                  </button>
                ))}
              </nav>
              {guide.map((section, i) => (
                <section
                  key={section.id}
                  id={`help-sec-${section.id}`}
                  aria-label={section.title}
                  className="scroll-mt-2"
                >
                  <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-primary">
                    <span
                      className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)] text-[9px] font-bold text-[var(--color-accent)]"
                      aria-hidden="true"
                    >
                      {i + 1}
                    </span>
                    {section.title}
                  </h3>
                  {section.paragraphs.map((p, j) => (
                    <p key={j} className="mb-1.5 text-xs leading-relaxed text-secondary">
                      {p}
                    </p>
                  ))}
                  {section.terms && (
                    <dl className="space-y-1.5">
                      {section.terms.map((t) => (
                        <div
                          key={t.term}
                          className="rounded-md border border-app border-l-2 border-l-[var(--color-accent)] px-2 py-1.5 transition-colors hover:bg-app/40"
                        >
                          <dt className="text-xs font-semibold text-primary">{t.term}</dt>
                          <dd className="mt-0.5 text-xs leading-relaxed text-secondary">{t.text}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="border-t border-app px-4 py-2 text-center text-[11px] text-muted">
          Shortcuts are ignored while typing in inputs or text areas.
          <div className="mt-0.5">
            New here? Click the{' '}
            <Compass size={10} className="inline align-[-1px]" style={{ color: 'var(--color-accent)' }} />{' '}
            compass in the top bar for a guided tour, or the “?” button inside the Layout studio.
          </div>
        </div>
      </div>
    </div>
  );
}
