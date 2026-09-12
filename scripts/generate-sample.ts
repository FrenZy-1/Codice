/**
 * Generate real .docx / .pdf / .odt files from the sample project and save
 * them to /home/z/my-project/download/ so the user can download and inspect.
 *
 * Uses the new DocumentPreset model.
 *
 * Run with: npx tsx scripts/generate-sample.ts
 */

import { docxExporter } from '../src/lib/exporters/docxExporter';
import { pdfExporter } from '../src/lib/exporters/pdfExporter';
import { odtExporter } from '../src/lib/exporters/odtExporter';
import { BUILT_IN_DOCUMENT_PRESETS } from '../src/lib/presets/builtInPresets';
import { presetToOptions } from '../src/lib/presets/presetToOptions';
import type { DocumentModel, HighlightedFile } from '../src/types';
import { writeFileSync, mkdirSync } from 'node:fs';

function makeHighlighted(
  path: string,
  language: string,
  source: string,
): HighlightedFile {
  const lines = source.split('\n');
  return {
    fileId: `f-${path}`,
    relativePath: path,
    language,
    lines: lines.map((text, i) => ({
      lineNumber: i + 1,
      text,
      tokens: [
        {
          start: 0,
          length: text.length,
          scopes: [],
          color: '#24292e',
        },
      ],
    })),
  };
}

async function main() {
  const preset = BUILT_IN_DOCUMENT_PRESETS[0]; // University
  const options = presetToOptions(preset);

  const model: DocumentModel = {
    metadata: {
      title: 'Sample Java Project — Documentation',
      author: 'Codice',
      course: 'CS 101',
      university: 'Demo University',
      version: '1.0',
      description:
        'Auto-generated documentation for the sample Gradle project included in the Codice repository.',
    },
    options,
    projects: [
      {
        id: 'p1',
        label: 'sample-project',
        folderName: 'sample-project',
        structurePaths: [
          'README.md',
          'build.gradle',
          'settings.gradle',
          'src/main/java/com/example/Main.java',
          'src/test/java/com/example/MainTest.java',
        ],
        files: [
          {
            projectId: 'p1',
            projectLabel: 'sample-project',
            relativePath: 'README.md',
            language: 'markdown',
            highlighted: makeHighlighted(
              'README.md',
              'markdown',
              `# Sample Project

A tiny Gradle-based Java project for testing Codice.

## Structure

\`\`\`
sample-project/
├── build.gradle
├── settings.gradle
├── README.md
└── src/
    ├── main/java/com/example/Main.java
    └── test/java/com/example/MainTest.java
\`\`\`

## Usage

Drag this entire folder onto the Codice upload area to see how
the app handles a typical Gradle project.`,
            ),
            sizeBytes: 512,
          },
          {
            projectId: 'p1',
            projectLabel: 'sample-project',
            relativePath: 'build.gradle',
            language: 'groovy',
            highlighted: makeHighlighted(
              'build.gradle',
              'groovy',
              `plugins {
    id 'application'
    id 'java'
}

repositories {
    mavenCentral()
}

dependencies {
    testImplementation 'org.junit.jupiter:junit-jupiter:5.10.0'
}

application {
    mainClass = 'com.example.Main'
}

test {
    useJUnitPlatform()
}`,
            ),
            sizeBytes: 384,
          },
          {
            projectId: 'p1',
            projectLabel: 'sample-project',
            relativePath: 'settings.gradle',
            language: 'groovy',
            highlighted: makeHighlighted(
              'settings.gradle',
              'groovy',
              `rootProject.name = 'sample-project'`,
            ),
            sizeBytes: 64,
          },
          {
            projectId: 'p1',
            projectLabel: 'sample-project',
            relativePath: 'src/main/java/com/example/Main.java',
            language: 'java',
            highlighted: makeHighlighted(
              'src/main/java/com/example/Main.java',
              'java',
              `package com.example;

import java.util.List;
import java.util.ArrayList;

/**
 * Simple demonstration main class.
 * Calculates the sum of a list of integers.
 */
public class Main {

    public static void main(String[] args) {
        List<Integer> numbers = new ArrayList<>();
        for (String arg : args) {
            try {
                numbers.add(Integer.parseInt(arg));
            } catch (NumberFormatException e) {
                System.err.println("Skipping invalid number: " + arg);
            }
        }

        int total = sum(numbers);
        System.out.println("Sum: " + total);
    }

    /**
     * Sums a list of integers.
     * @param numbers the list to sum
     * @return the total
     */
    public static int sum(List<Integer> numbers) {
        if (numbers == null || numbers.isEmpty()) {
            return 0;
        }
        return numbers.stream().mapToInt(Integer::intValue).sum();
    }
}`,
            ),
            sizeBytes: 1024,
          },
          {
            projectId: 'p1',
            projectLabel: 'sample-project',
            relativePath: 'src/test/java/com/example/MainTest.java',
            language: 'java',
            highlighted: makeHighlighted(
              'src/test/java/com/example/MainTest.java',
              'java',
              `package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import java.util.Arrays;

class MainTest {

    @Test
    void sumOfEmptyList() {
        assertEquals(0, Main.sum(List.of()));
    }

    @Test
    void sumOfSingleElement() {
        assertEquals(42, Main.sum(List.of(42)));
    }

    @Test
    void sumOfMultipleElements() {
        assertEquals(15, Main.sum(Arrays.asList(1, 2, 3, 4, 5)));
    }

    @Test
    void sumOfNullList() {
        assertEquals(0, Main.sum(null));
    }
}`,
            ),
            sizeBytes: 768,
          },
        ],
      },
    ],
    generatedAt: new Date().toISOString(),
  };

  const outDir = '/home/z/my-project/download';
  mkdirSync(outDir, { recursive: true });

  for (const format of ['docx', 'pdf', 'odt'] as const) {
    const exporter = { docx: docxExporter, pdf: pdfExporter, odt: odtExporter }[format];
    const result = await exporter.export(model, {
      format,
      filename: `codice-sample-${format}`,
    });
    const buf = Buffer.from(await result.blob.arrayBuffer());
    const outPath = `${outDir}/${result.filename}`;
    writeFileSync(outPath, buf);
    console.log(
      `✓ ${format.toUpperCase()}: ${outPath} (${(buf.length / 1024).toFixed(1)} KB, ${Math.round(result.elapsedMs)}ms)`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
