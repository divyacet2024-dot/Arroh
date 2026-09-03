/// ISL quick-phrase cards for ASHA workers.
///
/// Phase 17 priority 1: a written, *non-interpretive* emergency communication
/// bridge. Every phrase is shown in English + the ASHA worker's selected
/// local language so the worker can flip between languages to match the
/// patient. The screen also surfaces a "request a sign-language interpreter"
/// action so that — when a live interpreter is available — the doctor portal
/// can be notified.

import 'package:flutter/material.dart';

import '../offline/app_state.dart';
import '../offline/isl_phrases.dart';

class IslScreen extends StatelessWidget {
  const IslScreen({super.key, required this.state});
  final AppState state;

  @override
  Widget build(BuildContext context) {
    final language = state.preferredLanguage ?? 'en';
    return Scaffold(
      appBar: AppBar(title: const Text('ISL quick phrases')),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(12),
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFE3F0FF),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.info_outline, color: Color(0xFF0B6BCB)),
                    SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        kIslSafetyNote,
                        style: TextStyle(color: Color(0xFF0A4C8A)),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            Expanded(
              child: ListView.builder(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 96),
                itemCount: kEmergencyIslPhrases.length,
                itemBuilder: (context, index) {
                  final phrase = kEmergencyIslPhrases[index];
                  return Card(
                    child: ListTile(
                      leading: Text(phrase.icon, style: const TextStyle(fontSize: 28)),
                      title: Text(phrase.translations[language] ?? phrase.english),
                      subtitle: Text(phrase.english),
                      onTap: () => _showPhrase(context, phrase, language),
                    ),
                  );
                },
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  icon: const Icon(Icons.accessibility_new),
                  label: const Text('Request sign-language interpreter'),
                  onPressed: () => _requestInterpreter(context),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _requestInterpreter(BuildContext context) async {
    await state.emergencyRepository.record(
      spokenText: 'ASHA worker requested a sign-language interpreter for an upcoming consultation.',
      language: state.preferredLanguage ?? 'en',
      triageStatus: 'YELLOW',
      facilityName: 'Interpreter booking (offline)',
      transportAdvice: 'Interpreter will be paged when the backend is reachable.',
      firstAidProtocol: 'No clinical action required — communication support only.',
    );
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Interpreter request saved locally. Will dispatch on next sync.'),
        backgroundColor: Color(0xFF1B5E20),
      ),
    );
  }

  void _showPhrase(BuildContext context, IslPhrase phrase, String language) {
    showDialog<void>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text('${phrase.icon} ${phrase.translations[language] ?? phrase.english}'),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(phrase.english),
              const SizedBox(height: 8),
              const Text('Other languages:', style: TextStyle(fontWeight: FontWeight.w700)),
              ...phrase.translations.entries.map(
                (entry) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Text('${kSupportedLanguageNames[entry.key]}: ${entry.value}'),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Close')),
        ],
      ),
    );
  }
}