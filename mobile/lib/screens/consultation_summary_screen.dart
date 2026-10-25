/// Step 6 — Consultation summary (read-only).
///
/// Renders the doctor-authored consultation, linked prescriptions,
/// diagnostics, and discharge plan. All values come from the local
/// SQLite database and the consultation draft row; nothing here is
/// reconstructed or rewritten by an AI. The screen never blocks on
/// the network.

import 'package:flutter/material.dart';

import '../offline/app_state.dart';
import '../offline/models.dart';
import 'patient_summary_screen_helpers.dart' show riskColor, safeName, summarizeVitals;

class ConsultationSummaryScreen extends StatefulWidget {
  const ConsultationSummaryScreen({super.key, required this.state, required this.consultationLocalUuid});

  final AppState state;
  final String consultationLocalUuid;

  @override
  State<ConsultationSummaryScreen> createState() => _ConsultationSummaryScreenState();
}

class _ConsultationSummaryScreenState extends State<ConsultationSummaryScreen> {
  late Future<_SummaryData> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_SummaryData> _load() async {
    final draft = await widget.state.consultationDraftRepository.findConsultationDraft(widget.consultationLocalUuid);
    if (draft == null) throw StateError('Consultation draft not found');
    final patientLocal = draft['patient_local_uuid'] as String?;
    LocalPatient? patient;
    if (patientLocal != null) patient = await widget.state.patientRepository.findById(patientLocal);
    final pending = await widget.state.syncQueueRepository.pending();
    final consultationItems = pending.where((q) => q.entityType == 'consultation' && q.entityLocalUuid == widget.consultationLocalUuid).toList();
    final diagnostics = pending.where((q) => q.entityType == 'diagnostic_request' || q.entityType == 'diagnostic_result').toList();
    final discharge = pending.where((q) => q.entityType == 'discharge_plan').toList();
    final prescriptions = pending.where((q) => q.entityType == 'prescription').toList();
    return _SummaryData(
      draft: draft,
      patient: patient,
      consultationQueue: consultationItems,
      diagnosticQueue: diagnostics,
      dischargeQueue: discharge,
      prescriptionQueue: prescriptions,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Consultation summary')),
      body: FutureBuilder<_SummaryData>(
        future: _future,
        builder: (context, snapshot) {
          if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
          final data = snapshot.data!;
          final draft = data.draft;
          final status = (draft['status'] as String?) ?? 'STARTED';
          final priority = (draft['vitals'] as Map?)?['triage_level'] == 'RED' ? 'URGENT' : 'ROUTINE';
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Card(
                color: riskColor(data.patient?.triageStatus).withValues(alpha: 0.08),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(safeName(data.patient), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                      if (data.patient != null)
                        Text('${data.patient!.district}, ${data.patient!.state}'),
                      const SizedBox(height: 8),
                      Wrap(spacing: 8, children: [
                        Chip(label: Text('Status: $status')),
                        if (data.patient != null) Chip(label: Text('Risk: ${data.patient!.triageStatus}')),
                        Chip(label: Text('Follow-up: $priority')),
                        if (draft['server_consultation_id'] != null)
                          Chip(label: Text('Server id: ${(draft['server_consultation_id'] as String).substring(0, 8)}…'), backgroundColor: const Color(0xFFC8E6C9)),
                        if (draft['server_consultation_id'] == null)
                          const Chip(label: Text('Local draft only'), backgroundColor: Color(0xFFFFE0B2)),
                      ]),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              _section('Chief complaint', draft['chief_complaint'] as String?),
              _section('Clinical history', draft['history'] as String?),
              _section('Findings', draft['findings'] as String?),
              _section('Vitals', summarizeVitals((draft['vitals'] as Map?)?.cast<String, dynamic>())),
              _section('Assessment', draft['assessment'] as String?),
              _section('Clinical impression', draft['clinical_impression'] as String?),
              _section('Treatment plan', draft['treatment_plan'] as String?),
              const SizedBox(height: 16),
              _linkedSection(
                title: 'Prescriptions',
                count: data.prescriptionQueue.length,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: data.prescriptionQueue.isEmpty
                      ? [const Text('No prescription queued yet.')]
                      : data.prescriptionQueue
                          .map((q) => Text('• ${q.entityLocalUuid.substring(0, 14)}… queued'))
                          .toList(),
                ),
              ),
              _linkedSection(
                title: 'Diagnostics',
                count: data.diagnosticQueue.length,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: data.diagnosticQueue.isEmpty
                      ? [const Text('No diagnostics queued yet.')]
                      : data.diagnosticQueue
                          .map((q) => Text('• ${q.entityType} ${q.entityLocalUuid.substring(0, 14)}…'))
                          .toList(),
                ),
              ),
              _linkedSection(
                title: 'Discharge plan',
                count: data.dischargeQueue.length,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: data.dischargeQueue.isEmpty
                      ? [const Text('No discharge plan queued yet.')]
                      : data.dischargeQueue
                          .map((q) => Text('• ${q.entityLocalUuid.substring(0, 14)}… queued'))
                          .toList(),
                ),
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                icon: const Icon(Icons.assignment_turned_in),
                label: const Text('Back to consultations'),
                onPressed: () => Navigator.of(context).popUntil((route) => route.isFirst),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _section(String title, String? body) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            Text((body == null || body.isEmpty) ? '—' : body),
          ],
        ),
      ),
    );
  }

  Widget _linkedSection({required String title, required int count, required Widget child}) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: Text(title, style: const TextStyle(fontWeight: FontWeight.w700))),
                Chip(label: Text('$count queued')),
              ],
            ),
            const SizedBox(height: 8),
            child,
          ],
        ),
      ),
    );
  }
}

class _SummaryData {
  _SummaryData({
    required this.draft,
    required this.patient,
    required this.consultationQueue,
    required this.diagnosticQueue,
    required this.dischargeQueue,
    required this.prescriptionQueue,
  });
  final Map<String, dynamic> draft;
  final LocalPatient? patient;
  final List consultationQueue;
  final List diagnosticQueue;
  final List dischargeQueue;
  final List prescriptionQueue;
}
