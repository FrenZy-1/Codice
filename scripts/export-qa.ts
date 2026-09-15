/**
 * Export QA harness (NOT a test file — run manually with bun).
 *
 * Builds a REALISTIC DocumentModel (multiple projects, nested directories,
 * duplicate filenames, a large code file, a README with a Unicode tree,
 * .gitignore + config files) and exports DOCX / PDF / ODT with a configurable
 * header/footer setup so cross-format behavior can be inspected in real
 * office applications.
 *
 * Usage: bun scripts/export-qa.ts <scenario>
 *   scenarios: header-left | header-center | header-right | header-dual |
 *              header-triple | default
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DiscoveredFile, ProjectEntry, DocumentMetadata, FileHandle } from '@/types';
import { buildDocumentModel } from '@/lib/documentBuilder';
import { getExporter } from '@/lib/exporters';
import { presetToOptions } from '@/lib/presets/presetToOptions';
import { BUILT_IN_DOCUMENT_PRESETS } from '@/lib/presets/builtInPresets';
import type { DocumentPreset } from '@/lib/presets/documentPreset';

/* ----------------------------- fixtures ----------------------------- */

const JAVA_MAIN = `package com.example.app;

import java.util.List;

public class Main {
    private static final String GREETING = "Hello, Codice!";

    public static void main(String[] args) {
        System.out.println(GREETING);
        List<String> names = List.of("alpha", "beta", "gamma");
        for (String n : names) {
            System.out.printf(" - %s%n", n);
        }
    }
}
`;

const LARGE_KT = Array.from({ length: 220 }, (_, i) => {
  if (i === 0) return 'class DataPipeline {';
  if (i === 219) return '}';
  if (i % 30 === 0)
    return `    // ${'x'.repeat(160)} long-line-${i} end`;
  return `    fun stage${i}(input: String): String = input.trim().lowercase().replace(" ", "_") + "${i}"`;
}).join('\n') + '\n';

const README = `# sclab2_0

## Project Structure

\`\`\`
project/
├── src/
│   ├── main/
│   │   └── App.java
│   └── test/
│       └── AppTest.java
├── build.gradle.kts
└── README.md
\`\`\`

## Notes

The pipeline reads every source file, highlights it, and emits a
single consolidated report document.
`;

const GITIGNORE = `build/
.gradle/
*.class
.idea/
`;

const GRADLE_PROPS = `org.gradle.jvmargs=-Xmx2048m
kotlin.code.style=official
`;

function makeFile(
  projectId: string,
  idx: number,
  relativePath: string,
  language: string | null,
  content: string,
  isConfig = false,
): DiscoveredFile {
  return {
    id: `${projectId}-f${idx}`,
    projectId,
    relativePath,
    name: relativePath.split('/').pop() || relativePath,
    directory: relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : '',
    size: content.length,
    language,
    isConfig,
    binary: false,
    excluded: false,
    fileHandle: { getText: async () => content } as unknown as FileHandle,
  };
}

function buildProjects(): ProjectEntry[] {
  const p1Files = [
    makeFile('p1', 0, 'app/src/main/java/com/example/App.java', 'java', JAVA_MAIN),
    makeFile('p1', 1, 'app/src/main/java/com/example/Student.java', 'java', 'public class Student {\n    String name;\n}\n'),
    makeFile('p1', 2, 'app/src/test/java/com/example/AppTest.java', 'java', 'public class AppTest {\n}\n'),
    makeFile('p1', 3, '.gitignore', null, GITIGNORE, true),
    makeFile('p1', 4, 'README.md', 'markdown', README),
    makeFile('p1', 5, 'gradle.properties', null, GRADLE_PROPS, true),
  ];
  const p2Files = [
    // duplicate filenames across projects (App.java) + nested dirs
    makeFile('p2', 0, 'src/main/kotlin/DataPipeline.kt', 'kotlin', LARGE_KT),
    makeFile('p2', 1, 'src/main/kotlin/App.java', 'java', '// a same-named file in another project\nobject Bridge\n'),
    makeFile('p2', 2, 'settings.gradle.kts', null, 'rootProject.name = "sclab2_1"\n', true),
    makeFile('p2', 3, 'docs/notes/readme.md', 'markdown', '# nested duplicate readme\n', false),
  ];
  const mkProject = (id: string, label: string, files: DiscoveredFile[]): ProjectEntry => ({
    id,
    label,
    folderName: label,
    files,
    selectedCount: files.length,
    selectedSize: files.reduce((acc, f) => acc + f.size, 0),
    warnings: [],
    addedAt: Date.now(),
  });
  return [
    mkProject('p1', 'sclab2_0', p1Files),
    mkProject('p2', 'sclab2_1', p2Files),
  ];
}

/* ----------------------------- scenarios ----------------------------- */

function applyScenario(preset: DocumentPreset, scenario: string): DocumentPreset {
  const p: DocumentPreset = structuredClone(preset);
  p.page.pageHeaderShow = true;
  p.page.pageFooterShow = true;
  switch (scenario) {
    case 'header-left':
      p.page.pageHeaderLayout = 'single';
      p.page.pageHeaderAlign = 'left';
      p.page.pageHeaderCenter = '{fileName}';
      break;
    case 'header-center':
      p.page.pageHeaderLayout = 'single';
      p.page.pageHeaderAlign = 'center';
      p.page.pageHeaderCenter = '{projectName}';
      break;
    case 'header-right':
      p.page.pageHeaderLayout = 'single';
      p.page.pageHeaderAlign = 'right';
      p.page.pageHeaderCenter = '{date}';
      break;
    case 'header-dual':
      p.page.pageHeaderLayout = 'dual';
      p.page.pageHeaderLeft = '{projectName}';
      p.page.pageHeaderRight = '{fileName}';
      break;
    case 'header-triple':
      p.page.pageHeaderLayout = 'triple';
      p.page.pageHeaderLeft = '{projectName}';
      p.page.pageHeaderCenter = '{fileName}';
      p.page.pageHeaderRight = '{date}';
      break;
    default:
      // keep built-in defaults (typical footer tokens)
      break;
  }
  return p;
}

/* ----------------------------- main ----------------------------- */

const scenario = process.argv[2] ?? 'header-left';
const presetArg = process.argv[3] ?? '';
const outDir = resolve(process.cwd(), 'download/exports-qa');
mkdirSync(outDir, { recursive: true });

const base = presetArg
  ? BUILT_IN_DOCUMENT_PRESETS.find((p) => p.id === presetArg) ?? BUILT_IN_DOCUMENT_PRESETS[0]
  : BUILT_IN_DOCUMENT_PRESETS[0];
const preset = applyScenario(base, scenario);
const options = presetToOptions(preset);
const projects = buildProjects();
const metadata: DocumentMetadata = {
  title: 'Project Report',
  subtitle: 'Codice export QA',
  author: 'QA Harness',
  course: '',
  university: '',
  date: '',
  version: '1.0',
  description: 'Realistic export verification document.',
};

const model = await buildDocumentModel(
  projects.map((p) => ({ project: p, selectedFileIds: new Set(p.files.map((f) => f.id)) })),
  options,
  metadata,
);

for (const fmt of ['docx', 'pdf', 'odt'] as const) {
  const exporter = getExporter(fmt);
  const result = await exporter.export(model, { format: fmt, filename: `qa-${scenario}` });
  const buf = Buffer.from(await result.blob.arrayBuffer());
  const target = resolve(outDir, `qa-${scenario}${presetArg ? '-' + presetArg : ''}.${fmt}`);
  writeFileSync(target, buf);
  console.log(`${fmt}: ${target} (${buf.length} bytes, ${Math.round(result.elapsedMs)}ms)`);
}
