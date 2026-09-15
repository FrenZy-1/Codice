'use client';

/**
 * Help overlay — keyboard shortcuts + the full user guide (§23).
 *
 * The guide documents the ACTUAL current implementation: the File →
 * Section → Block → Field hierarchy, what binding means, the editors,
 * images, panels, export modes, and the terminology used across the app.
 * Content is data-driven so tests can assert coverage.
 */

import { useEffect, useState } from 'react';
import { X, Keyboard, Compass, BookOpen } from '@/components/common/Icons';

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
      note: 'Open or close the template customizer',
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
/* The guide (§23) — plain-language documentation of the real app      */
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
      id: 'hierarchy',
      title: 'The document hierarchy: File → Section → Block → Field',
      paragraphs: [
        'A Codice document is built from four nested concepts. Understanding them is the key to everything else.',
      ],
      terms: [
        {
          term: 'File',
          text: 'A source-code file you uploaded (or the whole uploaded set). The File Layout is the document skeleton: file-level content, then ordered Sections.',
        },
        {
          term: 'Section',
          text: 'A semantic grouping in the document — for example “Task 01”, “Task 02”, “Task 03”. Sections render once, top to bottom, in every document. A section holds its own content and one or more Blocks.',
        },
        {
          term: 'Block',
          text: 'A repeated PATTERN applied once to each file assigned to it. A Block is not a container for arbitrary content — it is the layout pattern used to render ONE assigned file. Example block: Heading “{fileName}”, Description, Code, Note. If three files are assigned, the pattern renders three times — once per file.',
        },
        {
          term: 'Field',
          text: 'A named content slot you fill with data. Section fields hold section-level content (Task Title, Output, Answer…) filled once per section. Block fields hold per-file content (a screenshot per file) filled in File properties.',
        },
      ],
    },
    {
      id: 'binding',
      title: 'What is binding?',
      paragraphs: [
        'Binding is how data gets into the layout. A layout node can be bound to a field: at render time the node displays the field’s value instead of static text. Static text never changes; a bound value comes from your content or your files.',
        'Example: a Heading node with the literal text “{fileName}” is bound to each file’s name — when the block renders for Main.java the heading reads “Main.java”. A Text node bound to the section field “Task Title” shows whatever you typed into that field in the Content dialog. An Image node bound to an image-kind field renders the actual image you picked.',
        'Tokens like {fileName}, {filePath}, {projectName}, {title}, {date} and {files} expand dynamically inside any literal text.',
      ],
    },
    {
      id: 'editors',
      title: 'The three editors',
      paragraphs: [],
      terms: [
        {
          term: 'File Layout editor',
          text: 'The top level: rename the template, add/reorder/delete Sections, add file-level standalone content (a document title heading, a closing summary…) and see the tray of files not yet assigned to any block.',
        },
        {
          term: 'Section editor',
          text: 'One section: rename it, append a starter structure (Section Type), edit its ordered content — standalone nodes, field nodes and file Blocks, top to bottom. The Section fields list is DERIVED from the content order: move a node and its field moves; delete a node and its field disappears.',
        },
        {
          term: 'Block editor',
          text: 'The per-file pattern: a node tree (heading, code, description, images, panels…) plus block fields filled per file. Assign files to the block here — each file renders the pattern exactly once.',
        },
      ],
    },
    {
      id: 'rules',
      title: 'The one-file-one-section rule',
      paragraphs: [
        'Every file belongs to exactly ONE section and renders in exactly ONE block instance. Files are moved automatically if you assign them elsewhere. A file assigned to a block disappears from every other assignment dropdown; unassign it to free it again. This is enforced in the model, not just the UI.',
      ],
    },
    {
      id: 'section-types',
      title: 'Section types',
      paragraphs: [
        'A Section Type (Task, Code + Output, Description + Answer, Summary…) is a STARTING structure, not a rigid schema. Append one with “Append structure” — each click adds the intended fields and content exactly once. Afterwards every section is fully customizable: add, remove, reorder, add more blocks, images, panels or standalone text. Different sections can look completely different.',
      ],
    },
    {
      id: 'images',
      title: 'Images',
      paragraphs: [
        'Upload images with the Images chip in the upload area (or drop them). They land in the image library — visible in the sidebar’s “Image library” panel. Attach images per file in File properties (they render where the File images node sits), or bind them to an image-kind section/block field via the Content dialog or a layout Image node.',
      ],
    },
    {
      id: 'panels',
      title: 'Panels, columns, dividers and shapes',
      paragraphs: [
        'Panels are bordered/filled containers that stack other nodes; columns render side-by-side stacks; dividers are horizontal rules; spacers add vertical space. Panels are identified by a stable internal node id — so two panels with identical text can be styled independently in Template editor → Theme Settings → Document Colors → Panels. Panels without their own colors use the preset’s panel fill/border/text defaults.',
      ],
    },
    {
      id: 'styling-vs-layout',
      title: 'Styling vs. layout templates',
      paragraphs: [
        'Two separate systems: the STYLE PRESET (Template editor) controls how things look — page size, margins, fonts, colors, headers/footers, Shiki theme, panel colors. The LAYOUT TEMPLATE (Layout studio) controls what the document contains and in what order — sections, fields, blocks. Neither hardcodes the other’s job.',
      ],
    },
    {
      id: 'export',
      title: 'Exporting: combined, separate, groups',
      paragraphs: [],
      terms: [
        {
          term: 'Combined',
          text: 'All selected projects flow into ONE document. Every section of the layout appears once, in order.',
        },
        {
          term: 'Separate',
          text: 'One document per project, packaged as a ZIP. Every per-project document keeps the FULL section structure of the layout — sections are never divided between projects; only the files inside blocks differ per project.',
        },
        {
          term: 'Export groups',
          text: 'Named, ordered project sets (e.g. Group A = Project A + C, Group B = B + A). A project may belong to any number of groups. Each group generates exactly its own combined document.',
        },
        {
          term: 'Merge / Unmerge',
          text: 'Explicitly merge projects into one and split them back — undoable, preserving file identity even when two projects contain the exact same path.',
        },
      ],
    },
    {
      id: 'order-outline',
      title: 'Document order, Outline and Statistics',
      paragraphs: [
        'The Document order panel in the sidebar (and the Outline panel’s ↑/↓) control the canonical file order used by the preview, Outline and all three exporters. The Output pill lists the document structure from the resolved document — headings, title page, TOC, projects and files (filename only; hover for the full path; duplicate filenames show paths to disambiguate). Statistics shows files, languages, sizes and more. Both popovers close on outside click and Escape.',
      ],
    },
    {
      id: 'page-setup',
      title: 'Pages, breaks, headers and footers',
      paragraphs: [
        'Page breaks are real page boundaries. Configure them per file/project/H1 or per layout section (“page break” checkbox). Headers and footers support left/center/right slots with tokens: {time}, {date}, {fileName}, {projectName}, page numbers, page count and lines-on-page, with offsets and spacing. TOC and title page are toggled in the Template editor.',
      ],
    },
    {
      id: 'presets',
      title: 'Presets and layout templates',
      paragraphs: [],
      terms: [
        {
          term: 'Save Preset',
          text: 'Store the current style (fonts, colors, page setup) as a reusable preset; import/export via the Template editor.',
        },
        {
          term: 'Layout templates',
          text: 'Layouts live in the Layout studio: create, duplicate, rename, delete, import/export as JSON. The applied layout drives the preview and exports; “Unapply” returns to the standard document flow.',
        },
        {
          term: 'Required fields',
          text: 'A required field without a value BLOCKS the export with a precise message (which section/block/file is missing what). Fill it in the Content dialog or File properties.',
        },
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
              {guide.map((section) => (
                <section key={section.id} aria-label={section.title}>
                  <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-primary">
                    <BookOpen size={13} className="text-secondary" />
                    {section.title}
                  </h3>
                  {section.paragraphs.map((p, i) => (
                    <p key={i} className="mb-1.5 text-xs leading-relaxed text-secondary">
                      {p}
                    </p>
                  ))}
                  {section.terms && (
                    <dl className="space-y-1.5">
                      {section.terms.map((t) => (
                        <div key={t.term} className="rounded-md border border-app px-2 py-1.5">
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
