import { describe, expect, it } from 'vitest';
import { detectLanguage } from '../lib/languageDetection';

describe('language-agnostic behavior', () => {
  it('detects common languages by extension', () => {
    expect(detectLanguage('main.c')).toBe('c');
    expect(detectLanguage('main.cpp')).toBe('cpp');
    expect(detectLanguage('Main.cs')).toBe('csharp');
    expect(detectLanguage('Main.java')).toBe('java');
    expect(detectLanguage('Main.kt')).toBe('kotlin');
    expect(detectLanguage('build.gradle.kts')).toBe('kotlin');
    expect(detectLanguage('app.js')).toBe('javascript');
  });

  it('detects .ts as TypeScript (not JavaScript)', () => {
    expect(detectLanguage('app.ts')).toBe('typescript');
    expect(detectLanguage('app.tsx')).toBe('tsx');
    expect(detectLanguage('app.jsx')).toBe('jsx');
  });

  it('detects many languages', () => {
    expect(detectLanguage('main.py')).toBe('python');
    expect(detectLanguage('main.rs')).toBe('rust');
    expect(detectLanguage('main.go')).toBe('go');
    expect(detectLanguage('main.swift')).toBe('swift');
    expect(detectLanguage('main.dart')).toBe('dart');
    expect(detectLanguage('main.php')).toBe('php');
    expect(detectLanguage('main.rb')).toBe('ruby');
    expect(detectLanguage('main.lua')).toBe('lua');
    expect(detectLanguage('main.zig')).toBe('zig');
  });

  it('detects shell variants', () => {
    expect(detectLanguage('script.sh')).toBe('bash');
    expect(detectLanguage('script.bash')).toBe('bash');
    expect(detectLanguage('script.zsh')).toBe('bash');
  });

  it('detects QML, GLSL-like, proto', () => {
    expect(detectLanguage('view.qml')).toBe('qml');
    expect(detectLanguage('schema.proto')).toBe('proto');
  });

  it('detects special filenames', () => {
    expect(detectLanguage('Dockerfile')).toBe('docker');
    expect(detectLanguage('Dockerfile.dev')).toBe('docker');
    expect(detectLanguage('Makefile')).toBe('makefile');
    expect(detectLanguage('CMakeLists.txt')).toBe('cmake');
    expect(detectLanguage('.gitignore')).toBe('ignore');
  });

  it('returns null for unknown extensions — does NOT crash', () => {
    // This is the critical "language-agnostic" guarantee: unknown extensions
    // don't fail; they just become plain text.
    expect(detectLanguage('file.unknownextension')).toBeNull();
    expect(detectLanguage('file.xyz123')).toBeNull();
    expect(detectLanguage('README')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(detectLanguage('')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(detectLanguage('MAIN.JAVA')).toBe('java');
    expect(detectLanguage('App.TSX')).toBe('tsx');
    expect(detectLanguage('DOCKERFILE')).toBe('docker');
  });

  it('treats unknown languages as importable — they do not throw', () => {
    // The function itself is just a lookup; the highlighter falls back to
    // plaintext for languages Shiki doesn't know about.
    const fn = () => detectLanguage('weird.definitely-not-a-real-extension');
    expect(fn).not.toThrow();
    expect(fn()).toBeNull();
  });
});
