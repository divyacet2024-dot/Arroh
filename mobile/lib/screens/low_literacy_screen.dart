/// Low-literacy patient-facing case screen.
///
/// The patient answers the next safety question with large YES / NO
/// buttons. The screen uses icons and text-to-speech in the patient's
/// chosen language. There is no typing, no jargon, and no medical form.

library;

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../offline/app_state.dart';
import '../offline/case_taking_client.dart';
import '../offline/speech.dart';

class LowLiteracyScreen extends StatefulWidget {
  const LowLiteracyScreen({super.key, required this.state});

  final AppState state;

  @override
  State<LowLiteracyScreen> createState() => _LowLiteracyScreenState();
}

class _LowLiteracyScreenState extends State<LowLiteracyScreen> {
  CaseSession? _session;
  String _language = 'en';
  String _transcript = '';
  bool _busy = false;
  late final TextToSpeechService _tts = TtsFactory.build();

  @override
  void initState() {
    super.initState();
    _loadLanguage();
  }

  Future<void> _loadLanguage() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() => _language = prefs.getString('arroh_language') ?? 'en');
  }

  Future<void> _start() async {
    final controller = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('What is bothering you?'),
        content: TextField(
          controller: controller,
          maxLines: 3,
          decoration: const InputDecoration(
            border: OutlineInputBorder(),
            hintText: 'Say or type your problem',
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(null), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.of(ctx).pop(controller.text), child: const Text('Continue')),
        ],
      ),
    );
    if (result == null || result.trim().isEmpty) return;
    setState(() {
      _busy = true;
      _transcript = result.trim();
    });
    try {
      final offline = OfflineCaseTakingService();
      final session = offline.startCase(transcript: _transcript, language: _language);
      if (!mounted) return;
      setState(() => _session = session);
      await _tts.speak(
        session.emergencyIntentDetected
            ? 'I will help. I will ask a few simple questions.'
            : 'Thank you. Please tap the answer.',
        languageCode: _language,
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _answer(String answer) async {
    if (_session == null) return;
    final question = _session!.followUpQuestions.first;
    final updated = OfflineCaseTakingService().answerQuestion(_session!, question.questionId, answer);
    if (!mounted) return;
    setState(() => _session = updated);
    final next = updated.followUpQuestions.isNotEmpty ? updated.followUpQuestions.first : null;
    if (next != null) {
      await _tts.speak(next.localized(updated.language), languageCode: _language);
    } else {
      final level = updated.triageResult['triage_level'] ?? 'UNKNOWN';
      await _tts.speak('Thank you. The doctor has been notified. Your care level is $level.', languageCode: _language);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Talk to ARROH')),
      body: SafeArea(
        child: _session == null ? _buildIntro() : _buildQuestion(_session!),
      ),
    );
  }

  Widget _buildIntro() {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.hearing, size: 96, color: Color(0xFF1B5E20)),
          const SizedBox(height: 16),
          const Text(
            'Tell us what is wrong. ARROH will help you. Tap a big button to answer.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 32),
          FilledButton.icon(
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(80), textStyle: const TextStyle(fontSize: 24)),
            icon: const Icon(Icons.mic, size: 32),
            label: const Text('Begin'),
            onPressed: _busy ? null : _start,
          ),
        ],
      ),
    );
  }

  Widget _buildQuestion(CaseSession session) {
    final level = session.triageResult['triage_level'] as String? ?? 'UNKNOWN';
    final color = switch (level) {
      'RED' => const Color(0xFFC62828),
      'YELLOW' => const Color(0xFFB26A00),
      'GREEN' => const Color(0xFF1B5E20),
      _ => const Color(0xFF455A64),
    };
    final question = session.followUpQuestions.isNotEmpty ? session.followUpQuestions.first : null;
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
            child: Text('Care level: $level', style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 18)),
          ),
          const SizedBox(height: 16),
          if (question != null) ...[
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(color: const Color(0xFFE3F0FF), borderRadius: BorderRadius.circular(16)),
              child: Text(
                question.localized(session.language),
                style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700),
                textAlign: TextAlign.center,
              ),
            ),
            const SizedBox(height: 24),
            Row(
              children: [
                Expanded(
                  child: FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFF1B5E20),
                      minimumSize: const Size.fromHeight(96),
                      textStyle: const TextStyle(fontSize: 28, fontWeight: FontWeight.w700),
                    ),
                    onPressed: () => _answer('yes'),
                    child: const Text('YES'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: OutlinedButton(
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(96),
                      textStyle: const TextStyle(fontSize: 28, fontWeight: FontWeight.w700),
                    ),
                    onPressed: () => _answer('no'),
                    child: const Text('NO'),
                  ),
                ),
              ],
            ),
          ] else ...[
            const Icon(Icons.check_circle, color: Color(0xFF1B5E20), size: 96),
            const SizedBox(height: 12),
            const Text(
              'Thank you. The doctor will see your case now.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () => setState(() => _session = null),
              child: const Text('Start a new case'),
            ),
          ],
        ],
      ),
    );
  }
}
