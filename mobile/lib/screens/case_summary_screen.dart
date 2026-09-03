/// ASHA worker review screen for an in-progress case-taking session.
///
/// The screen shows the structured case with explicit provenance:
///   * AI-extracted symptoms (editable)
///   * ASHA-entered vitals (authoritative)
///   * Patient-confirmed information
///   * Doctor-entered information (read-only here; web review edits)

library;

import 'package:flutter/material.dart';

import '../offline/app_state.dart';
import '../offline/case_taking_client.dart';

class CaseSummaryScreen extends StatelessWidget {
  const CaseSummaryScreen({super.key, required this.state, required this.session});

  final AppState state;
  final CaseSession session;

  @override
  Widget build(BuildContext context) {
    final level = session.triageResult['triage_level'] as String? ?? 'UNKNOWN';
    final color = switch (level) {
      'RED' => const Color(0xFFC62828),
      'YELLOW' => const Color(0xFFB26A00),
      'GREEN' => const Color(0xFF1B5E20),
      _ => const Color(0xFF455A64),
    };
    final actions = ((session.triageResult['recommended_actions'] as List?) ?? const []).cast<String>();
    return Scaffold(
      appBar: AppBar(title: const Text('Case summary')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Triage: $level', style: TextStyle(color: color, fontWeight: FontWeight.w800, fontSize: 20)),
                const SizedBox(height: 4),
                Text('Risk score: ${session.triageResult['risk_score'] ?? 'n/a'}'),
                if (actions.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  const Text('Recommended actions', style: TextStyle(fontWeight: FontWeight.w700)),
                  for (final action in actions) Text('• $action'),
                ],
              ],
            ),
          ),
          const SizedBox(height: 12),
          _section('Reported information', [
            _row('Chief concern', session.patientCase.symptoms.map((s) => s.symptom).join(', ')),
            _row('Duration', session.patientCase.duration ?? 'unknown'),
            _row('Severity', session.patientCase.severity ?? 'unknown'),
            _row('Pregnancy', session.patientCase.pregnancyStatus ?? 'unknown'),
            _row('Allergies', session.patientCase.allergies.isEmpty ? 'none reported' : session.patientCase.allergies.join(', ')),
          ]),
          const SizedBox(height: 8),
          _section('AI-extracted information', [
            for (final s in session.patientCase.symptoms)
              _row(s.symptom, 'confidence ${(s.confidence * 100).round()}% • source ${s.source}'),
            if (session.aiProposedCase.symptoms != session.patientCase.symptoms)
              _row('AI proposed vs confirmed', '${session.aiProposedCase.symptoms.length} vs ${session.patientCase.symptoms.length}'),
          ]),
          const SizedBox(height: 8),
          _section('Measured (vitals)', [
            if (session.patientCase.relevantVitals.isEmpty)
              const _InfoRow(label: 'No vitals recorded', value: '—')
            else
              for (final entry in session.patientCase.relevantVitals.entries)
                _row(entry.key, entry.value.toString()),
          ]),
          const SizedBox(height: 8),
          _section('Safety flags', [
            if (session.safetyFlags.isEmpty)
              const _InfoRow(label: 'No safety flags', value: '—')
            else
              for (final flag in session.safetyFlags) _row(flag, 'flag'),
          ]),
          if (session.timelineEvents.isNotEmpty) ...[
            const SizedBox(height: 8),
            _section('Timeline events', [
              for (final event in session.timelineEvents) _row(event['event_type']?.toString() ?? 'event', event['summary']?.toString() ?? ''),
            ]),
          ],
        ],
      ),
    );
  }

  Widget _section(String title, List<Widget> children) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
            const SizedBox(height: 6),
            ...children,
          ],
        ),
      ),
    );
  }

  Widget _row(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(width: 130, child: Text(label, style: const TextStyle(color: Color(0xFF455A64)))),
            Expanded(child: Text(value.isEmpty ? '—' : value)),
          ],
        ),
      );
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value});
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Text('$label: $value'),
      );
}
