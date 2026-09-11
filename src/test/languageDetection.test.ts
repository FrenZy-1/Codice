import { describe, expect, it } from 'vitest';
import { detectLanguage, isConfigFile, languageLabel } from '../lib/languageDetection';

describe('detectLanguage', () => {
  it('detects common source extensions', () => {
    expect(detectLanguage('Main.java')).toBe('java');
    expect(detectLanguage('app.ts')).toBe('typescript');
    expect(detectLanguage('app.tsx')).toBe('tsx');
    expect(detectLanguage('main.py')).toBe('python');
    expect(detectLanguage('main.rs')).toBe('rust');
    expect(detectLanguage('main.go')).toBe('go');
    expect(detectLanguage('Main.kt')).toBe('kotlin');
    expect(detectLanguage('build.gradle.kts')).toBe('kotlin');
    expect(detectLanguage('script.sh')).toBe('bash');
    expect(detectLanguage('app.css')).toBe('css');
    expect(detectLanguage('styles.scss')).toBe('scss');
  });

  it('detects C/C++ extensions', () => {
    expect(detectLanguage('main.c')).toBe('c');
    expect(detectLanguage('header.h')).toBe('c');
    expect(detectLanguage('Main.cpp')).toBe('cpp');
    expect(detectLanguage('Main.cxx')).toBe('cpp');
    expect(detectLanguage('Main.cc')).toBe('cpp');
    expect(detectLanguage('header.hpp')).toBe('cpp');
  });

  it('detects special filenames', () => {
    expect(detectLanguage('Dockerfile')).toBe('docker');
    expect(detectLanguage('Dockerfile.dev')).toBe('docker');
    expect(detectLanguage('Makefile')).toBe('makefile');
    expect(detectLanguage('CMakeLists.txt')).toBe('cmake');
    expect(detectLanguage('.gitignore')).toBe('ignore');
  });

  it('returns null for unknown extensions', () => {
    expect(detectLanguage('unknown.xyz')).toBeNull();
    expect(detectLanguage('noextension')).toBeNull();
  });

  it('is case insensitive', () => {
    expect(detectLanguage('MAIN.JAVA')).toBe('java');
    expect(detectLanguage('App.TSX')).toBe('tsx');
  });
});

describe('isConfigFile', () => {
  it('recognizes build config filenames', () => {
    expect(isConfigFile('build.gradle')).toBe(true);
    expect(isConfigFile('build.gradle.kts')).toBe(true);
    expect(isConfigFile('settings.gradle')).toBe(true);
    expect(isConfigFile('CMakeLists.txt')).toBe(true);
    expect(isConfigFile('package.json')).toBe(true);
    expect(isConfigFile('pom.xml')).toBe(true);
    expect(isConfigFile('Cargo.toml')).toBe(true);
    expect(isConfigFile('requirements.txt')).toBe(true);
    expect(isConfigFile('Makefile')).toBe(true);
    expect(isConfigFile('Dockerfile')).toBe(true);
    expect(isConfigFile('.gitignore')).toBe(true);
  });

  it('recognizes config extensions', () => {
    expect(isConfigFile('app.yaml')).toBe(true);
    expect(isConfigFile('app.yml')).toBe(true);
    expect(isConfigFile('config.json')).toBe(true);
    expect(isConfigFile('settings.xml')).toBe(true);
    expect(isConfigFile('app.toml')).toBe(true);
    expect(isConfigFile('config.ini')).toBe(true);
    expect(isConfigFile('app.properties')).toBe(true);
  });

  it('does not flag source files as config', () => {
    expect(isConfigFile('Main.java')).toBe(false);
    expect(isConfigFile('app.ts')).toBe(false);
    expect(isConfigFile('main.py')).toBe(false);
  });
});

describe('languageLabel', () => {
  it('returns a friendly label', () => {
    expect(languageLabel('java')).toBe('Java');
    expect(languageLabel('typescript')).toBe('TypeScript');
    expect(languageLabel('cpp')).toBe('C++');
    expect(languageLabel('csharp')).toBe('C#');
  });

  it('returns "Plain text" for null', () => {
    expect(languageLabel(null)).toBe('Plain text');
  });
});
