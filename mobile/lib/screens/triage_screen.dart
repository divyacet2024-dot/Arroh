/// Offline-first triage screen.
///
/// Triage runs locally on every submission. The backend is consulted only as
/// a *secondary* source when the device is online — never as a hard
/// dependency. Records are always written to the local DB and queued for
/// sync.

import 'package:flutter/material.dart';

import '../offline/app_state.dart';
import '../offline/models.dart';
import '../offline/offline_triage.dart';

class TriageScreen extends StatefulWidget {
  const TriageScreen({super.key, required this.state, this.patientLocalUuid});
  final AppState state;
  final String? patientLocalUuid;

  @override
  State<TriageScreen> createState() => _TriageScreenState();
}

class _TriageScreenState extends State<TriageScreen> {
  LocalPatient? _patient;
  final Set<String> _selectedSymptoms = <String>{};
  final Map<String, String> _vitals = {};
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final id = ModalRoute.of(context)?.settings.arguments as String?;
    if (id != null && (_patient == null || _patient!.localUuid != id)) {
      widget.state.patientRepository.findById(id).then((p) {
        if (mounted) setState(() => _patient = p);
      });
    }
  }

  Future<void> _bootstrap() async {
    final id = widget.patientLocalUuid;
    if (id != null) {
      _patient = await widget.state.patientRepository.findById(id);
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _assess() async {
    if (_patient == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Select a patient first from the Patients tab.')),
      );
      return;
    }
    final vitals = <String, dynamic>{};
    for (final entry in _vitals.entries) {
      if (entry.value.isEmpty) continue;
      final number = double.tryParse(entry.value);
      vitals[entry.key] = number ?? entry.value;
    }
    final verdict = assessOfflineTriage(
      symptoms: _selectedSymptoms.toList(),
      vitals: vitals,
    );
    await widget.state.triageRepository.record(
      patientLocalUuid: _patient!.localUuid,
      symptoms: _selectedSymptoms.toList(),
      vitals: vitals,
      triageStatus: verdict.triageLevel,
      riskScore: verdict.riskScore,
      recommendedActions: verdict.recommendedActions,
      highRiskRespiratory: verdict.highRiskRespiratory,
      highRiskMaternal: verdict.highRiskMaternal,
      maternalConditions: verdict.maternalConditions,
      missingVitals: verdict.missingVitals,
      source: 'offline',
      transcript: null,
    );
    if (!mounted) return;
    showDialog<void>(
      context: context,
      builder: (_) => _VerdictDialog(verdict: verdict),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Offline triage')),
      body: Form(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (_patient != null)
              Card(
                child: ListTile(
                  leading: CircleAvatar(child: Text(_patient!.name.isNotEmpty ? _patient!.name[0] : '?')),
                  title: Text(_patient!.name),
                  subtitle: Text('${_patient!.village ?? _patient!.district} · ${_patient!.triageStatus}'),
                  trailing: Text(_patient!.syncedAt == null ? 'local' : 'synced',
                      style: TextStyle(
                        fontSize: 11,
                        color: _patient!.syncedAt == null ? const Color(0xFFB26A00) : const Color(0xFF1B5E20),
                        fontWeight: FontWeight.w700,
                      )),
                ),
              ),
            const SizedBox(height: 12),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Symptoms', style: TextStyle(fontWeight: FontWeight.w700)),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: _symptomChips.map(
                        (chip) => FilterChip(
                          label: Text(chip),
                          selected: _selectedSymptoms.contains(chip),
                          onSelected: (selected) => setState(() {
                            if (selected) {
                              _selectedSymptoms.add(chip);
                            } else {
                              _selectedSymptoms.remove(chip);
                            }
                          }),
                        ),
                      ).toList(),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Vitals', style: TextStyle(fontWeight: FontWeight.w700)),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(child: _vitalField('spo2', 'SpO2 %')),
                        const SizedBox(width: 8),
                        Expanded(child: _vitalField('systolic_bp', 'Systolic BP')),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(child: _vitalField('diastolic_bp', 'Diastolic BP')),
                        const SizedBox(width: 8),
                        Expanded(child: _vitalField('heart_rate', 'HR (bpm)')),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(child: _vitalField('temperature', 'Temp °C')),
                        const SizedBox(width: 8),
                        Expanded(child: _vitalField('hemoglobin', 'Hb g/dL')),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              icon: const Icon(Icons.assessment_outlined),
              label: const Text('Assess & save locally'),
              onPressed: _assess,
            ),
            const SizedBox(height: 8),
            Text(
              'Triage is computed locally using the ARROH deterministic rules. The result '
              'is saved to the device immediately and queued for sync. This is '
              'AI-assisted decision support, not a diagnosis.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }

  Widget _vitalField(String key, String label) {
    return TextFormField(
      decoration: InputDecoration(labelText: label, border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)), filled: true, fillColor: Colors.white),
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      onChanged: (value) => _vitals[key] = value,
    );
  }

  static const _symptomChips = [
    'chest pain',
    'shortness of breath',
    'high fever',
    'abnormal bleeding',
    'snakebite',
    'pregnant',
    'pre-eclampsia',
    'severe headache',
    'facial swelling',
    'unconscious',
    'head injury',
  ];
}

class _VerdictDialog extends StatelessWidget {
  const _VerdictDialog({required this.verdict});
  final OfflineTriageVerdict verdict;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('${verdict.triageLevel} Priority'),
      content: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Risk score: ${verdict.riskScore}/100'),
            const SizedBox(height: 8),
            const Text('Recommended actions', style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            ...verdict.recommendedActions.map((action) => Text('• $action')),
            if (verdict.maternalConditions.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text('Maternal markers: ${verdict.maternalConditions.join(', ')}', style: const TextStyle(color: Color(0xFFAD1457), fontWeight: FontWeight.w700)),
            ],
            if (verdict.missingVitals.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text('Missing vitals: ${verdict.missingVitals.join(', ')}'),
            ],
            const SizedBox(height: 12),
            const Text(
              'Decision support only. Not a diagnosis. Refer for professional evaluation when needed.',
              style: TextStyle(fontStyle: FontStyle.italic),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Close')),
      ],
    );
  }
}