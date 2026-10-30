import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/languageConfig.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const languageConfig = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`,
);

const requiredLocales = ['kn-IN', 'hi-IN', 'ta-IN', 'te-IN', 'ml-IN', 'en-IN'];

test('all six supported locales have matching recognition and synthesis locales', () => {
  for (const locale of requiredLocales) {
    const config = languageConfig.getLanguageConfig(locale);
    assert.ok(config, `missing configuration for ${locale}`);
    assert.equal(config.speechRecognitionLocale, locale);
    assert.equal(config.ttsLocale, locale);
    assert.ok(languageConfig.LANGUAGE_CONFIGS.includes(config));
  }
});

test('Hindi speech text uses the approved spoken form of MEDORA only', () => {
  assert.equal(
    languageConfig.prepareSpeechText('Welcome to MEDORA.', 'hi-IN'),
    'Welcome to मेडोरा.',
  );
  assert.equal(
    languageConfig.prepareSpeechText('MEDORA helps you.', 'kn-IN'),
    'MEDORA helps you.',
  );
  assert.equal(
    languageConfig.prepareSpeechText('MEDORA helps you.', 'en-IN'),
    'MEDORA helps you.',
  );
});
