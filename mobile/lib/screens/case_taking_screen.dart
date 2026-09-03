/// ASHA case-taking screen.
///
/// Flow:
/// 1. ASHA selects a registered patient (or starts a new case).
/// 2. The patient / ASHA speaks or types in any supported language.
/// 3. The transcript is sent to the backend (or the offline fallback) which
///    returns a structured case + follow-up questions.
/// 4. ASHA reviews the extracted symptoms, confirms or edits them, then
///    enters vitals.
/// 5. The deterministic safety engine produces the disposition.
/// 6. The case is saved locally + queued for sync.

library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../offline/app_state.dart';
import '../offline/case_taking_client.dart';
import '../offline/speech.dart';

class CaseTakingScreen extends StatefulWidget {
  const CaseTakingScreen({super.key, required this.state});

  final AppState state;

  @override
  State<CaseTakingScreen> createState() => _CaseTakingScreenState();
}

class _CaseTakingScreenState extends State<CaseTakingScreen> {
  final TextEditingController _transcriptController = TextEditingController();
  final TextEditingController _vitalsController = TextEditingController();
  CaseSession? _session;
  String _language = 'en';
  bool _busy = false;
  String? _error;
  StreamSubscription<SpeechStatus>? _statusSub;
  StreamSubscription<SpeechResult>? _resultSub;
  SpeechStatus _speechStatus = SpeechStatus.idle;
  late final SpeechInputService _stt = SpeechInputFactory.build();
  late final TextToSpeechService _tts = TtsFactory.build();

  @override
  void initState() {
    super.initState();
    _loadLanguage();
    _statusSub = _stt.status.listen((status) {
      if (mounted) setState(() => _speechStatus = status);
    });
    _resultSub = _stt.results.listen((result) {
      if (mounted) setState(() => _transcriptController.text = result.transcript);
    });
  }

  @override
  void dispose() {
    _statusSub?.cancel();
    _resultSub?.cancel();
    _transcriptController.dispose();
    _vitalsController.dispose();
    super.dispose();
  }

  Future<void> _loadLanguage() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() => _language = prefs.getString('arroh_language') ?? 'en');
  }

  Future<void> _startCase() async {
    final transcript = _transcriptController.text.trim();
    if (transcript.isEmpty) {
      setState(() => _error = 'Type or speak the patient complaint first.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final client = CaseTakingClient(
        backendBaseUrl: 'http://127.0.0.1:8000',
        httpClient: http.Client(),
      );
      CaseSession session;
      try {
        final result = await client.startCase(transcript: transcript, language: _language);
        session = result.session;
      } catch (_) {
        session = OfflineCaseTakingService().startCase(transcript: transcript, language: _language);
      }
      if (!mounted) return;
      setState(() => _session = session);
      await _tts.speak(
        _session!.emergencyIntentDetected
            ? 'Emergency mode. I will ask only the most important questions.'
            : 'I have understood the complaint. Please answer the next question.',
        languageCode: _language,
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _answer(FollowUpQuestion question, String answer) async {
    if (_session == null) return;
    setState(() => _busy = true);
    try {
      final client = CaseTakingClient(backendBaseUrl: 'http://127.0.0.1:8000', httpClient: http.Client());
      CaseSession updated;
      try {
        updated = await client.answerQuestion(session: _session!, questionId: question.questionId, answer: answer);
      } catch (_) {
        updated = OfflineCaseTakingService().answerQuestion(_session!, question.questionId, answer);
      }
      if (!mounted) return;
      setState(() => _session = updated);
      await _tts.speak(updated.followUpQuestions.isNotEmpty ? updated.followUpQuestions.first.localized(updated.language) : 'Thank you.', languageCode: _language);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _confirm() async {
    if (_session == null) return;
    setState(() => _busy = true);
    try {
      final localUuid = 'case-${DateTime.now().millisecondsSinceEpoch}';
      final db = await widget.state.database.database;
      await db.insert('case_sessions_local', {
        'local_uuid': localUuid,
        'case_id': _session!.caseId,
        'patient_local_uuid': _session!.patientLocalUuid,
        'language': _session!.language,
        'session_json': jsonEncode(_session!.toJson()),
        'triage_level': _session!.triageResult['triage_level'] ?? 'UNKNOWN',
        'completed': _session!.completed ? 1 : 0,
        'created_at': DateTime.now().toUtc().toIso8601String(),
      });
      await widget.state.syncQueueRepository.enqueue(
        entityType: 'case_session',
        entityLocalUuid: localUuid,
        operation: 'create',
        payload: _session!.toJson(),
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Case saved locally. Triage: ${_session!.triageResult['triage_level'] ?? 'pending'}. Sync queued.'),
          backgroundColor: const Color(0xFF1B5E20),
        ),
      );
      setState(() => _session = null);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = 'Failed to save case: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _toggleMic() async {
    if (_speechStatus == SpeechStatus.listening) {
      await _stt.stop();
      return;
    }
    final ok = await _stt.requestPermission();
    if (!ok) {
      setState(() => _error = 'Microphone permission was denied.');
      return;
    }
    await _stt.start(_language);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('AI case-taking')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_session == null) _buildInputPanel() else _buildSessionPanel(),
              if (_error != null) ...[
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: const Color(0xFFFFEBEE), borderRadius: BorderRadius.circular(8)),
                  child: Text(_error!, style: const TextStyle(color: Color(0xFFB71C1C))),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildInputPanel() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(color: const Color(0xFFE3F0FF), borderRadius: BorderRadius.circular(12)),
          child: const Text(
            'The AI will read the patient\'s complaint, ask only the most important safety questions, and never override the deterministic safety engine. ASHA workers can always edit the extracted information before it becomes a clinical record.',
          ),
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          initialValue: _language,
          decoration: const InputDecoration(labelText: 'Language', border: OutlineInputBorder()),
          items: const [
            DropdownMenuItem(value: 'en', child: Text('English')),
            DropdownMenuItem(value: 'kn', child: Text('ಕನ್ನಡ Kannada')),
            DropdownMenuItem(value: 'hi', child: Text('हिन्दी Hindi')),
            DropdownMenuItem(value: 'ta', child: Text('தமிழ் Tamil')),
          ],
          onChanged: (value) => setState(() => _language = value ?? 'en'),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _transcriptController,
          maxLines: 5,
          decoration: const InputDecoration(
            labelText: 'Patient complaint (type or speak)',
            border: OutlineInputBorder(),
            hintText: 'e.g. ನನಗೆ ತೀವ್ರ ತಲೆನೋವು ಮತ್ತು ಮಸುಕು ದೃಷ್ಟಿ ಇದೆ',
          ),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: FilledButton.icon(
                icon: Icon(_speechStatus == SpeechStatus.listening ? Icons.mic : Icons.mic_none),
                label: Text(_speechStatus == SpeechStatus.listening ? 'Stop listening' : 'Speak'),
                onPressed: _toggleMic,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: FilledButton.icon(
                icon: const Icon(Icons.play_arrow),
                label: const Text('Start case'),
                onPressed: _busy ? null : _startCase,
              ),
            ),
          ],
        ),
        if (_speechStatus == SpeechStatus.unavailable)
          const Padding(
            padding: EdgeInsets.only(top: 8),
            child: Text(
              'Voice input is unavailable on this device. Type the complaint instead.',
              style: TextStyle(color: Color(0xFF6D4C41)),
            ),
          ),
      ],
    );
  }

  Widget _buildSessionPanel() {
    final session = _session!;
    final symptoms = session.patientCase.symptoms;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _buildTriageBanner(session),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Extracted symptoms', style: TextStyle(fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                if (symptoms.isEmpty) const Text('No symptoms extracted yet.'),
                if (symptoms.isNotEmpty)
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: symptoms
                        .map((s) => Chip(label: Text('${s.symptom} (${(s.confidence * 100).round()}%)')))
                        .toList(),
                  ),
                const SizedBox(height: 8),
                Text('Pregnancy: ${session.patientCase.pregnancyStatus ?? "unknown"}'),
                Text('Severity: ${session.patientCase.severity ?? "unknown"}'),
                Text('Duration: ${session.patientCase.duration ?? "unknown"}'),
                Text('Emergency intent detected: ${session.emergencyIntentDetected ? "YES" : "no"}'),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _vitalsController,
          decoration: const InputDecoration(
            labelText: 'Vitals (SpO2 / HR / BP / Temp, optional)',
            border: OutlineInputBorder(),
            hintText: 'e.g. spo2 96 hr 110 bp 140/90',
          ),
        ),
        const SizedBox(height: 12),
        if (session.followUpQuestions.isNotEmpty) ...[
          const Text('Next safety question', style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          ...session.followUpQuestions.map((q) => _buildQuestionCard(session, q)),
        ],
        const SizedBox(height: 12),
        FilledButton.icon(
          icon: const Icon(Icons.check_circle),
          label: const Text('Confirm and save case'),
          onPressed: _busy ? null : _confirm,
        ),
        TextButton(
          onPressed: _busy ? null : () => setState(() => _session = null),
          child: const Text('Discard and start over'),
        ),
      ],
    );
  }

  Widget _buildTriageBanner(CaseSession session) {
    final level = session.triageResult['triage_level'] as String? ?? 'UNKNOWN';
    final color = switch (level) {
      'RED' => const Color(0xFFC62828),
      'YELLOW' => const Color(0xFFB26A00),
      'GREEN' => const Color(0xFF1B5E20),
      _ => const Color(0xFF455A64),
    };
    final actions = ((session.triageResult['recommended_actions'] as List?) ?? const []).cast<String>();
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Triage: $level', style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 18)),
          if (actions.isNotEmpty) ...[
            const SizedBox(height: 6),
            for (final action in actions.take(3)) Text('• $action'),
          ],
          if (session.safetyFlags.isNotEmpty) ...[
            const SizedBox(height: 6),
            Wrap(
              spacing: 4,
              children: session.safetyFlags
                  .map((flag) => Chip(label: Text(flag, style: const TextStyle(fontSize: 10))))
                  .toList(),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildQuestionCard(CaseSession session, FollowUpQuestion q) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(q.localized(session.language), style: const TextStyle(fontWeight: FontWeight.w700)),
            if (q.safetyReason.isNotEmpty)
              Text('Why: ${q.safetyReason}', style: const TextStyle(color: Color(0xFF455A64), fontSize: 12)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [
                FilledButton(
                  onPressed: _busy ? null : () => _answer(q, 'yes'),
                  child: const Text('Yes'),
                ),
                OutlinedButton(
                  onPressed: _busy ? null : () => _answer(q, 'no'),
                  child: const Text('No'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
