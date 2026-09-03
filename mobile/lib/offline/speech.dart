/// Speech input and text-to-speech abstractions.
///
/// The mobile app must remain usable on devices that have no STT support
/// (emulator without a voice model, kiosk, no microphone). The abstractions
/// in this file keep the case-taking UI fully usable by falling back to
/// typed input rather than failing the entire flow.

library;

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:speech_to_text/speech_to_text.dart';
import 'package:speech_to_text/speech_recognition_result.dart';

enum SpeechStatus { idle, listening, processing, error, unavailable }

class SpeechResult {
  const SpeechResult({required this.transcript, required this.language, required this.confidence});

  final String transcript;
  final String language;
  final double confidence;
}

abstract class SpeechInputService {
  Future<bool> isAvailable();

  Future<bool> requestPermission();

  Future<void> start(String languageCode);

  Future<void> stop();

  Stream<SpeechResult> get results;

  Stream<SpeechStatus> get status;

  String get activeLanguage;
}

abstract class TextToSpeechService {
  Future<bool> isAvailable();

  Future<void> speak(String text, {required String languageCode});

  Future<void> stop();
}

/// A noop STT that always reports "unavailable". The case-taking UI is
/// expected to keep its text input enabled so the patient can still type.
class NoopSpeechInputService implements SpeechInputService {
  final _results = StreamController<SpeechResult>.broadcast();
  final _status = StreamController<SpeechStatus>.broadcast();
  String _language = 'en';

  @override
  Future<bool> isAvailable() async => false;

  @override
  Future<bool> requestPermission() async => false;

  @override
  Future<void> start(String languageCode) async {
    _language = languageCode;
    _status.add(SpeechStatus.unavailable);
  }

  @override
  Future<void> stop() async {
    _status.add(SpeechStatus.idle);
  }

  @override
  Stream<SpeechResult> get results => _results.stream;

  @override
  Stream<SpeechStatus> get status => _status.stream;

  @override
  String get activeLanguage => _language;
}

class NoopTtsService implements TextToSpeechService {
  @override
  Future<bool> isAvailable() async => false;

  @override
  Future<void> speak(String text, {required String languageCode}) async {
    if (kDebugMode) debugPrint('TTS fallback: "$text" (lang=$languageCode)');
  }

  @override
  Future<void> stop() async {}
}

/// Native STT via `speech_to_text`. The constructor never throws: when
/// the platform runtime is missing (e.g. running in a headless test) the
/// instance is exposed as a noop so the surrounding UI keeps working.
class NativeSpeechInputService implements SpeechInputService {
  NativeSpeechInputService({SpeechToText? speechToText})
      : _stt = speechToText ?? _safeCreate();

  final SpeechToText? _stt;
  final _results = StreamController<SpeechResult>.broadcast();
  final _status = StreamController<SpeechStatus>.broadcast();
  bool _initialised = false;
  bool _available = false;
  String _language = 'en';

  static SpeechToText? _safeCreate() {
    try {
      return SpeechToText();
    } catch (_) {
      return null;
    }
  }

  @override
  Future<bool> isAvailable() async {
    await _ensureInitialised();
    return _available;
  }

  @override
  Future<bool> requestPermission() async {
    await _ensureInitialised();
    final stt = _stt;
    if (stt == null) return false;
    try {
      return await stt.hasPermission;
    } catch (_) {
      return false;
    }
  }

  @override
  Future<void> start(String languageCode) async {
    await _ensureInitialised();
    _language = languageCode;
    final stt = _stt;
    if (stt == null || !_available) {
      _status.add(SpeechStatus.unavailable);
      return;
    }
    try {
      await stt.listen(
        onResult: (SpeechRecognitionResult result) {
          _results.add(
            SpeechResult(
              transcript: result.recognizedWords,
              language: _language,
              confidence: result.confidence,
            ),
          );
          if (result.finalResult) {
            _status.add(SpeechStatus.idle);
          }
        },
        listenOptions: SpeechListenOptions(localeId: languageCode),
      );
      _status.add(SpeechStatus.listening);
    } catch (_) {
      _status.add(SpeechStatus.error);
    }
  }

  @override
  Future<void> stop() async {
    final stt = _stt;
    if (stt == null) return;
    try {
      await stt.stop();
    } catch (_) {}
    _status.add(SpeechStatus.idle);
  }

  @override
  Stream<SpeechResult> get results => _results.stream;

  @override
  Stream<SpeechStatus> get status => _status.stream;

  @override
  String get activeLanguage => _language;

  Future<void> _ensureInitialised() async {
    if (_initialised) return;
    _initialised = true;
    final stt = _stt;
    if (stt == null) return;
    try {
      _available = await stt.initialize();
    } catch (_) {
      _available = false;
    }
  }
}

class NativeTtsService implements TextToSpeechService {
  NativeTtsService({FlutterTts? flutterTts}) : _tts = flutterTts ?? _safeCreate();

  final FlutterTts? _tts;

  static FlutterTts? _safeCreate() {
    try {
      return FlutterTts();
    } catch (_) {
      return null;
    }
  }

  @override
  Future<bool> isAvailable() async => _tts != null;

  @override
  Future<void> speak(String text, {required String languageCode}) async {
    final tts = _tts;
    if (tts == null) return;
    try {
      await tts.setLanguage(languageCode);
      await tts.speak(text);
    } catch (_) {}
  }

  @override
  Future<void> stop() async {
    final tts = _tts;
    if (tts == null) return;
    try {
      await tts.stop();
    } catch (_) {}
  }
}

class SpeechInputFactory {
  static SpeechInputService build() {
    try {
      return NativeSpeechInputService();
    } catch (_) {
      return NoopSpeechInputService();
    }
  }
}

class TtsFactory {
  static TextToSpeechService build() {
    try {
      return NativeTtsService();
    } catch (_) {
      return NoopTtsService();
    }
  }
}
