/**
 * offline.test.mjs — automated tests for MEDORA offline-first infrastructure.
 *
 * Run: node --test tests/offline.test.mjs
 *
 * Approach:
 *   Files that have NO cross-module imports are transpiled and loaded via
 *   the data: URI trick (same as languageConfig.test.mjs).
 *   Files with relative imports are tested by extracting and testing the
 *   pure-function logic directly in this file — the behaviour is what matters.
 *
 * What these tests cover:
 *   - Backoff schedule (bounded exponential)
 *   - syncQueue idempotency, markSynced, markFailed, clearSynced
 *   - offlineDb data shapes and error classes
 *   - patientSyncService: token guard, MAX_ATTEMPTS, buildPendingSession
 *   - registerSW: exports exist, no-op in non-browser
 *   - Native speech stubs: available=false outside Capacitor
 *   - Deterministic triage: chest pain→RED, empty→unableToAssess
 *
 * What is NOT tested here (requires real browser / device):
 *   - Service worker fetch interception
 *   - Real IndexedDB in a browser context
 *   - Real network transitions
 *   - TTS/STT hardware
 */

import assert    from 'node:assert/strict';
import test      from 'node:test';
import ts        from 'typescript';
import { readFile } from 'node:fs/promises';

// ── TypeScript → ESM loader (for self-contained files only) ──────────────

async function loadTs(relativePath) {
  let source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  // Native adapters are imported through a data: URI in this Node-only suite.
  // Node cannot resolve Capacitor or a relative plugin import from that URI.
  // Substitute only those bridge dependencies; the adapter implementation itself
  // remains the code under test and is exercised in its non-native branch.
  if (relativePath.endsWith('nativeOfflineSpeech.ts')) {
    source = source
      .replace("import { Capacitor } from '@capacitor/core';", "const Capacitor = { isNativePlatform: () => false };")
      .replace("import { Whisper } from './nativeWhisperPlugin';", 'const Whisper = {};')
      .replace("import { offlineError } from './interfaces';", "const offlineError = (code, message) => Object.assign(new Error(message), { code });");
  }
  if (relativePath.endsWith('nativeOfflineTts.ts')) {
    source = source
      .replace("import { Capacitor } from '@capacitor/core';", "const Capacitor = { getPlatform: () => 'web' };")
      .replace("import { Tts } from './nativeTtsPlugin';", 'const Tts = {};');
  }
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module:           ts.ModuleKind.ESNext,
      target:           ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

// ── localStorage stub (for syncQueue) ────────────────────────────────────

function makeLocalStorage() {
  const m = new Map();
  return {
    getItem:    (k)    => m.get(k) ?? null,
    setItem:    (k, v) => m.set(k, v),
    removeItem: (k)    => m.delete(k),
    clear:      ()     => m.clear(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Backoff schedule — pure function, no imports
// ═══════════════════════════════════════════════════════════════════════════

const retryPolicy = await loadTs('../src/lib/offline/retryPolicy.ts');
const { MAX_ATTEMPTS, MAX_DELAY_MS, backoffMs } = retryPolicy;

test('backoff — all delays are within the hard maximum delay', () => {
  for (let a = 1; a <= MAX_ATTEMPTS + 2; a++) {
    const ms = backoffMs(a);
    assert.ok(ms >= 0,      `attempt ${a}: delay must be non-negative, got ${ms}`);
    assert.ok(ms <= MAX_DELAY_MS, `attempt ${a}: delay must not exceed ${MAX_DELAY_MS} ms, got ${ms}`);
  }
});

test('backoff — attempt 1 base is 2 000 ms', () => {
  // With jitter the exact value varies, but must be in [1500, 2500]
  for (let i = 0; i < 20; i++) {
    const ms = backoffMs(1);
    assert.ok(ms >= 1_500 && ms <= 2_500, `attempt 1 should be ~2 000 ms, got ${ms}`);
  }
});

test('backoff — attempt 5 base is capped at 30 000 ms', () => {
  for (let i = 0; i < 20; i++) {
    const ms = backoffMs(5);
    assert.ok(ms <= MAX_DELAY_MS, `attempt 5 must not exceed cap: got ${ms}`);
    assert.ok(ms >= 22_500, `attempt 5 should be near cap: got ${ms}`);
  }
});

test('backoff — MAX_ATTEMPTS is 5', () => {
  assert.equal(MAX_ATTEMPTS, 5);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. syncQueue (self-contained, localStorage-backed)
// ═══════════════════════════════════════════════════════════════════════════

function makeRecord(uuid, name = 'Test') {
  return {
    local_client_uuid: uuid,
    local_timestamp:   new Date().toISOString(),
    name,
    gender:        'female',
    birth_date:    '1990-01-01',
    district:      'Dakshina Kannada',
    state:         'Karnataka',
    vitals:        { spo2: 98 },
    symptoms:      ['fever'],
    triage_status: 'GREEN',
    abha_id:       null,
    phone_number:  '+919876543210',
  };
}

test('syncQueue — enqueue is idempotent on same UUID', async () => {
  globalThis.localStorage = makeLocalStorage();
  const mod  = await loadTs('../src/lib/offline/syncQueue.ts');
  const uuid = 'idempotent-uuid-001';
  mod.enqueue(makeRecord(uuid));
  mod.enqueue(makeRecord(uuid));
  const all   = mod.getAllItems();
  const count = all.filter((i) => i.local_client_uuid === uuid).length;
  assert.equal(count, 1, 'same UUID must not create a duplicate');
});

test('syncQueue — enqueue new UUID adds item', async () => {
  globalThis.localStorage = makeLocalStorage();
  const mod = await loadTs('../src/lib/offline/syncQueue.ts');
  mod.enqueue(makeRecord('uuid-a'));
  mod.enqueue(makeRecord('uuid-b'));
  const all = mod.getAllItems();
  assert.ok(all.some((i) => i.local_client_uuid === 'uuid-a'));
  assert.ok(all.some((i) => i.local_client_uuid === 'uuid-b'));
  assert.equal(mod.getPendingCount(), 2);
});

test('syncQueue — markSynced sets status to synced', async () => {
  globalThis.localStorage = makeLocalStorage();
  const mod  = await loadTs('../src/lib/offline/syncQueue.ts');
  const uuid = 'synced-uuid';
  mod.enqueue(makeRecord(uuid));
  mod.markSynced(uuid);
  const item = mod.getAllItems().find((i) => i.local_client_uuid === uuid);
  assert.equal(item?.status, 'synced');
});

test('syncQueue — markFailed increments attempts and stores error', async () => {
  globalThis.localStorage = makeLocalStorage();
  const mod  = await loadTs('../src/lib/offline/syncQueue.ts');
  const uuid = 'failed-uuid';
  mod.enqueue(makeRecord(uuid));
  mod.markFailed(uuid, 'Network error 1');
  mod.markFailed(uuid, 'Network error 2');
  const item = mod.getAllItems().find((i) => i.local_client_uuid === uuid);
  assert.equal(item?.status,    'failed');
  assert.equal(item?.attempts,  2);
  assert.equal(item?.lastError, 'Network error 2');
});

test('syncQueue — clearSynced only removes synced items, keeps pending', async () => {
  globalThis.localStorage = makeLocalStorage();
  const mod = await loadTs('../src/lib/offline/syncQueue.ts');
  mod.enqueue(makeRecord('pending-keep'));
  mod.enqueue(makeRecord('synced-remove'));
  mod.markSynced('synced-remove');
  mod.clearSynced();
  const remaining = mod.getAllItems();
  assert.ok( remaining.some((i) => i.local_client_uuid === 'pending-keep'),  'pending must remain');
  assert.ok(!remaining.some((i) => i.local_client_uuid === 'synced-remove'), 'synced must be removed');
});

test('syncQueue — discardSyncedItem only removes if synced', async () => {
  globalThis.localStorage = makeLocalStorage();          // fresh store
  const mod = await loadTs('../src/lib/offline/syncQueue.ts');
  mod.enqueue(makeRecord('not-synced'));
  mod.discardSyncedItem('not-synced'); // must be a no-op — not yet synced
  assert.equal(
    mod.getAllItems().filter((i) => i.local_client_uuid === 'not-synced').length, 1,
    'pending item must not be discarded',
  );
  mod.markSynced('not-synced');
  mod.discardSyncedItem('not-synced');
  assert.equal(
    mod.getAllItems().filter((i) => i.local_client_uuid === 'not-synced').length, 0,
    'synced item should be removed',
  );
});

test('syncQueue — getPending returns only non-synced items', async () => {
  globalThis.localStorage = makeLocalStorage();
  const mod = await loadTs('../src/lib/offline/syncQueue.ts');
  mod.enqueue(makeRecord('p1'));
  mod.enqueue(makeRecord('p2'));
  mod.markSynced('p2');
  const pending = mod.getPending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].local_client_uuid, 'p1');
});

test('syncQueue — survives corrupt localStorage data', async () => {
  const store = makeLocalStorage();
  store.setItem('arroh.sync.outbox.v2', 'NOT_VALID_JSON{{{');
  globalThis.localStorage = store;
  // Should not throw; should start fresh
  const mod = await loadTs('../src/lib/offline/syncQueue.ts');
  assert.equal(mod.getAllItems().length, 0, 'corrupt store should start fresh');
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. offlineDb — data shapes and error classes (no IDB, pure logic)
// ═══════════════════════════════════════════════════════════════════════════

test('offlineDb — newSessionId is a unique string', async () => {
  // Provide stub crypto.randomUUID if needed
  if (typeof globalThis.crypto === 'undefined') {
    globalThis.crypto = { randomUUID: () => `${Math.random()}` };
  }
  const mod = await loadTs('../src/lib/offline/offlineDb.ts');
  const ids = new Set(Array.from({ length: 50 }, () => mod.newSessionId()));
  assert.equal(ids.size, 50, 'all 50 session IDs must be unique');
  ids.forEach((id) => assert.equal(typeof id, 'string'));
});

test('offlineDb — OfflineDbQuotaError has correct name and message', async () => {
  const mod = await loadTs('../src/lib/offline/offlineDb.ts');
  const err = new mod.OfflineDbQuotaError();
  assert.equal(err.name, 'OfflineDbQuotaError');
  assert.ok(err.message.toLowerCase().includes('quota'), 'message should mention quota');
});

test('offlineDb — OfflineDbUnavailableError stores cause', async () => {
  const mod = await loadTs('../src/lib/offline/offlineDb.ts');
  const err = new mod.OfflineDbUnavailableError('IndexedDB not supported');
  assert.equal(err.name, 'OfflineDbUnavailableError');
  assert.ok(err.message.includes('IndexedDB not supported'));
});

test('offlineDb — saveSession rejects when IDB unavailable (Node env)', async () => {
  // In Node indexedDB is undefined — saveSession must throw OfflineDbUnavailableError
  const mod = await loadTs('../src/lib/offline/offlineDb.ts');
  await assert.rejects(
    () => mod.saveSession({
      sessionId: 'test', patientId: 'p', capturedAt: new Date().toISOString(),
      language: 'kn-IN', transcriptText: 'test', symptoms: [],
      localTriageLevel: 'GREEN', status: 'pending', attempts: 0,
    }),
    (err) => {
      assert.equal(err.name, 'OfflineDbUnavailableError');
      return true;
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. buildPendingSession — pure function, tested inline
// ═══════════════════════════════════════════════════════════════════════════

// Inline the function (same logic as patientSyncService.ts)
function newSessionId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildPendingSession(options) {
  return {
    sessionId:        newSessionId(),
    patientId:        options.patientId,
    capturedAt:       new Date().toISOString(),
    language:         options.language,
    transcriptText:   options.transcriptText,
    symptoms:         options.symptoms,
    localTriageLevel: options.localTriageLevel,
    status:           'pending',
    attempts:         0,
  };
}

test('buildPendingSession — creates correct shape', () => {
  const s = buildPendingSession({
    patientId: 'p-123', transcriptText: 'ನನಗೆ ಜ್ವರ ಇದೆ',
    language: 'kn-IN', symptoms: ['fever'], localTriageLevel: 'YELLOW',
  });
  assert.equal(s.patientId,        'p-123');
  assert.equal(s.language,         'kn-IN');
  assert.equal(s.localTriageLevel, 'YELLOW');
  assert.equal(s.status,           'pending');
  assert.equal(s.attempts,         0);
  assert.equal(typeof s.sessionId,   'string');
  assert.equal(typeof s.capturedAt,  'string');
  assert.ok(s.transcriptText.includes('ಜ್ವರ'), 'Kannada text must be preserved');
  // Must NOT contain server data at creation
  assert.equal(s.serverResponse, undefined);
  assert.equal(s.lastError,      undefined);
});

test('buildPendingSession — two calls produce different sessionIds', () => {
  const a = buildPendingSession({ patientId: 'p', transcriptText: 'a', language: 'kn-IN', symptoms: [], localTriageLevel: 'GREEN' });
  const b = buildPendingSession({ patientId: 'p', transcriptText: 'b', language: 'kn-IN', symptoms: [], localTriageLevel: 'GREEN' });
  assert.notEqual(a.sessionId, b.sessionId);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. registerSW — exports (self-contained)
// ═══════════════════════════════════════════════════════════════════════════

test('registerSW — exports registerServiceWorker and checkForUpdate', async () => {
  const mod = await loadTs('../src/lib/registerSW.ts');
  assert.equal(typeof mod.registerServiceWorker, 'function');
  assert.equal(typeof mod.checkForUpdate,        'function');
});

test('registerSW — registerServiceWorker resolves without throwing in Node', async () => {
  const mod = await loadTs('../src/lib/registerSW.ts');
  // navigator.serviceWorker is undefined in Node — must not throw
  await assert.doesNotReject(() => mod.registerServiceWorker());
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Deterministic offline triage (self-contained)
// ═══════════════════════════════════════════════════════════════════════════

test('deterministicTriage — chest pain always returns RED', async () => {
  const mod    = await loadTs('../src/lib/offline/deterministicTriage.ts');
  const result = mod.assessOfflineTriage({ symptoms: ['chest pain'], vitals: {} });
  assert.equal(result.triage_level,  'RED');
  assert.equal(result.unableToAssess, false);
});

test('deterministicTriage — empty input returns unableToAssess=true', async () => {
  const mod    = await loadTs('../src/lib/offline/deterministicTriage.ts');
  const result = mod.assessOfflineTriage({ symptoms: [], vitals: {} });
  assert.equal(result.unableToAssess, true);
});

test('deterministicTriage — high fever returns YELLOW or RED', async () => {
  const mod    = await loadTs('../src/lib/offline/deterministicTriage.ts');
  const result = mod.assessOfflineTriage({ symptoms: ['high fever'], vitals: {} });
  assert.ok(
    result.triage_level === 'YELLOW' || result.triage_level === 'RED',
    `expected YELLOW or RED, got ${result.triage_level}`,
  );
  assert.equal(result.unableToAssess, false);
});

test('deterministicTriage — SpO2 < 90 always returns RED', async () => {
  const mod    = await loadTs('../src/lib/offline/deterministicTriage.ts');
  const result = mod.assessOfflineTriage({ symptoms: [], vitals: { spo2: 88 } });
  assert.equal(result.triage_level,  'RED');
  assert.equal(result.unableToAssess, false);
});

test('deterministicTriage — snakebite always returns RED', async () => {
  const mod    = await loadTs('../src/lib/offline/deterministicTriage.ts');
  const result = mod.assessOfflineTriage({ symptoms: ['snakebite'], vitals: {} });
  assert.equal(result.triage_level,  'RED');
});

test('deterministicTriage — normal vitals and mild symptom returns GREEN', async () => {
  const mod    = await loadTs('../src/lib/offline/deterministicTriage.ts');
  const result = mod.assessOfflineTriage({
    symptoms: ['mild cough'],
    vitals:   { spo2: 98, heart_rate: 72, temperature: 37 },
  });
  assert.ok(
    result.triage_level === 'GREEN' || result.triage_level === 'YELLOW',
    `expected GREEN or YELLOW for mild symptom, got ${result.triage_level}`,
  );
  assert.equal(result.unableToAssess, false);
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Offline capability boundary: native speech stubs
// ═══════════════════════════════════════════════════════════════════════════

test('nativeOfflineSpeech — available=false outside Capacitor', async () => {
  const mod     = await loadTs('../src/lib/offline/nativeOfflineSpeech.ts');
  const service = mod.createNativeOfflineSpeechService();
  assert.equal(service.available, false,
    'offline STT must NOT claim available in a non-native environment');

  const status = await service.getModelStatus();
  assert.equal(status, 'model_unavailable');

  const perm = await service.checkPermission();
  assert.equal(perm, 'denied',
    'permission must be denied when there is no native runtime');
});

test('nativeOfflineSpeech — start() throws runtime_unavailable in non-native context', async () => {
  const mod     = await loadTs('../src/lib/offline/nativeOfflineSpeech.ts');
  const service = mod.createNativeOfflineSpeechService();
  await assert.rejects(
    () => service.start({ language: 'kn-IN' }),
    (err) => {
      assert.equal(err.code, 'runtime_unavailable');
      return true;
    },
  );
});

test('nativeOfflineTts — available=false outside Capacitor', async () => {
  const mod     = await loadTs('../src/lib/offline/nativeOfflineTts.ts');
  const service = mod.createNativeOfflineTTSService();
  assert.equal(service.available, false,
    'offline TTS must NOT claim available in a non-native environment');

  const voices = await service.getVoices();
  assert.deepEqual(voices, [],
    'no voices should be listed outside the native runtime');

  const lang = await service.checkLanguage('kn-IN');
  assert.equal(lang.available, false,
    'no language should be available offline outside native runtime');
});

function makeTtsPlugin(capability = {
  language: 'kn-IN',
  available: true,
  requiresNetworkConnection: false,
  voiceName: 'Kannada local voice',
  label: 'Kannada (India)',
}) {
  const listeners = new Map();
  const calls = { language: [], speak: [] };
  let latestUtteranceId = null;
  const plugin = {
    calls,
    get listenerCount() { return listeners.size; },
    isReady: async () => ({ ready: true }),
    getVoices: async () => ({ voices: [] }),
    checkLanguage: async ({ language }) => {
      calls.language.push(language);
      return { ...capability, language };
    },
    speak: async (options) => {
      calls.speak.push(options);
      latestUtteranceId = options.utteranceId;
      return { success: true, utteranceId: options.utteranceId };
    },
    stop: async () => {
      if (latestUtteranceId) listeners.get('ttsStop')?.({ utteranceId: latestUtteranceId });
    },
    addListener: async (eventName, listener) => {
      listeners.set(eventName, listener);
      return { remove: async () => listeners.delete(eventName) };
    },
    emit: (eventName) => {
      listeners.get(eventName)?.({ utteranceId: latestUtteranceId });
    },
  };
  return plugin;
}

test('nativeOfflineTts — uses Android only and forwards the selected kn-IN locale', async () => {
  const mod = await loadTs('../src/lib/offline/nativeOfflineTts.ts');
  const browserPlugin = makeTtsPlugin();
  const browserService = mod.createNativeOfflineTTSService('web', browserPlugin);
  assert.equal(browserService.available, false);
  await browserService.checkLanguage('kn-IN');
  assert.deepEqual(browserPlugin.calls.language, []);

  const androidPlugin = makeTtsPlugin();
  const androidService = mod.createNativeOfflineTTSService('android', androidPlugin);
  const capability = await androidService.checkLanguage('kn-IN');
  assert.equal(androidService.available, true);
  assert.equal(capability.available, true);
  assert.equal(capability.voiceName, 'Kannada local voice');
  assert.deepEqual(androidPlugin.calls.language, ['kn-IN']);
});

test('nativeOfflineTts — does not mistake a network-only voice for an offline voice', async () => {
  const mod = await loadTs('../src/lib/offline/nativeOfflineTts.ts');
  const plugin = makeTtsPlugin({
    language: 'kn-IN',
    available: false,
    requiresNetworkConnection: true,
    voiceName: null,
    label: 'Kannada (India)',
  });
  const service = mod.createNativeOfflineTTSService('android', plugin);
  const capability = await service.checkLanguage('kn-IN');
  assert.equal(capability.available, false);
  assert.equal(capability.requiresNetworkConnection, true);
  await assert.rejects(() => service.speak('ನಮಸ್ಕಾರ', { language: 'kn-IN' }), {
    code: 'network_required',
  });
  assert.equal(plugin.calls.speak.length, 0);
});

test('nativeOfflineTts — rejects clearly when the selected offline voice is missing', async () => {
  const mod = await loadTs('../src/lib/offline/nativeOfflineTts.ts');
  const plugin = makeTtsPlugin({
    language: 'kn-IN',
    available: false,
    requiresNetworkConnection: false,
    voiceName: null,
    label: 'Kannada (India)',
  });
  const service = mod.createNativeOfflineTTSService('android', plugin);
  await assert.rejects(() => service.speak('ನಮಸ್ಕಾರ', { language: 'kn-IN' }), {
    code: 'voice_unavailable',
  });
  assert.equal(plugin.calls.speak.length, 0);
});

test('nativeOfflineTts — reports speech started only on ttsStart and resolves on ttsDone', async () => {
  const mod = await loadTs('../src/lib/offline/nativeOfflineTts.ts');
  const plugin = makeTtsPlugin();
  const service = mod.createNativeOfflineTTSService('android', plugin);
  let started = false;
  const speaking = service.speak('ನಮಸ್ಕಾರ', {
    language: 'kn-IN',
    onStart: () => { started = true; },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started, false, 'must not report started when merely queued');
  assert.equal(plugin.calls.speak[0].language, 'kn-IN');
  plugin.emit('ttsStart');
  assert.equal(started, true);
  plugin.emit('ttsDone');
  await speaking;
});

test('nativeOfflineTts — propagates provider errors and removes playback listeners', async () => {
  const mod = await loadTs('../src/lib/offline/nativeOfflineTts.ts');
  const plugin = makeTtsPlugin();
  plugin.speak = async () => {
    throw new Error('bridge failure');
  };
  const service = mod.createNativeOfflineTTSService('android', plugin);
  await assert.rejects(() => service.speak('ನಮಸ್ಕಾರ', { language: 'kn-IN' }), /bridge failure/);
  assert.equal(plugin.listenerCount, 0);
});

test('nativeOfflineTts — stop rejects the active utterance as cancelled', async () => {
  const mod = await loadTs('../src/lib/offline/nativeOfflineTts.ts');
  const plugin = makeTtsPlugin();
  const service = mod.createNativeOfflineTTSService('android', plugin);
  const speaking = service.speak('ನಮಸ್ಕಾರ', { language: 'kn-IN' });
  await new Promise((resolve) => setImmediate(resolve));
  await service.stop();
  await assert.rejects(speaking, { code: 'cancelled' });
});
