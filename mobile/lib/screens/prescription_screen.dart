/// Step 6 — Doctor prescription authoring screen.
///
/// Reuses the backend's ``CarePrescriptionCreateSchema`` contract —
/// medicine name, dosage, frequency, duration, visual identifier, and
/// language. The form is intentionally simple: the doctor fills the
/// required fields, the payload is enqueued for sync via the existing
/// ``prescription`` entity type and the dedicated
/// ``/prescriptions/create`` endpoint.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../offline/app_state.dart';
import '../offline/models.dart';
import 'patient_summary_screen_helpers.dart' show safeName, summarizeVitals;

const List<String> _kFrequencies = [
  'ONCE_DAILY',
  'TWICE_DAILY',
  'THRICE_DAILY',
  'AS_NEEDED',
];

const List<String> _kLanguages = [
  'english',
  'hindi',
  'kannada',
  'tamil',
  'telugu',
];

class _MedicationDraft {
  _MedicationDraft();
  final TextEditingController name = TextEditingController();
  final TextEditingController dosage = TextEditingController();
  final TextEditingController visualIdentifier = TextEditingController();
  String frequency = 'TWICE_DAILY';
  int durationDays = 5;
}

class PrescriptionScreen extends StatefulWidget {
  const PrescriptionScreen({super.key, required this.state, required this.consultationLocalUuid, this.patientLocalUuid});

  final AppState state;
  final String consultationLocalUuid;
  final String? patientLocalUuid;

  @override
  State<PrescriptionScreen> createState() => _PrescriptionScreenState();
}

class _PrescriptionScreenState extends State<PrescriptionScreen> {
  final TextEditingController _diagnosisCtrl = TextEditingController();
  final List<_MedicationDraft> _medications = [_MedicationDraft()];
  String _language = 'english';
  int _followUpInDays = 3;
  bool _busy = false;
  LocalPatient? _patient;
  Map<String, dynamic>? _consultation;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _initialise());
  }

  @override
  void dispose() {
    for (final med in _medications) {
      med.name.dispose();
      med.dosage.dispose();
      med.visualIdentifier.dispose();
    }
    _diagnosisCtrl.dispose();
    super.dispose();
  }

  Future<void> _initialise() async {
    final draft = await widget.state.consultationDraftRepository.findConsultationDraft(widget.consultationLocalUuid);
    if (draft != null) {
      _consultation = draft;
      _diagnosisCtrl.text = (draft['clinical_impression'] as String?) ?? (draft['chief_complaint'] as String?) ?? '';
      if (widget.patientLocalUuid == null) {
        final pl = draft['patient_local_uuid'] as String?;
        if (pl != null) {
          _patient = await widget.state.patientRepository.findById(pl);
        }
      }
    }
    if (widget.patientLocalUuid != null) {
      _patient = await widget.state.patientRepository.findById(widget.patientLocalUuid!);
    }
    if (mounted) setState(() {});
  }

  void _addMedication() {
    setState(() => _medications.add(_MedicationDraft()));
  }

  void _removeMedication(int index) {
    if (_medications.length == 1) return;
    setState(() {
      final removed = _medications.removeAt(index);
      removed.name.dispose();
      removed.dosage.dispose();
      removed.visualIdentifier.dispose();
    });
  }

  Future<void> _save() async {
    if (_patient == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Patient missing. Open this from a consultation draft.'), backgroundColor: Color(0xFFC62828)),
      );
      return;
    }
    if (_patient!.serverId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Patient must sync to backend before a prescription can be issued. Local draft queued.'), backgroundColor: Color(0xFFB26A00)),
      );
    }
    if (_diagnosisCtrl.text.trim().length < 2) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('A diagnosis (≥ 2 chars) is required.'), backgroundColor: Color(0xFFC62828)),
      );
      return;
    }
    final meds = <Map<String, dynamic>>[];
    for (final med in _medications) {
      if (med.name.text.trim().isEmpty || med.dosage.text.trim().isEmpty) continue;
      meds.add({
        'name': med.name.text.trim(),
        'dosage': med.dosage.text.trim(),
        'frequency': med.frequency,
        'duration_days': med.durationDays,
        'visual_identifier': med.visualIdentifier.text.trim().isEmpty ? med.name.text.trim() : med.visualIdentifier.text.trim(),
      });
    }
    if (meds.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Add at least one medicine with name and dosage.'), backgroundColor: Color(0xFFC62828)),
      );
      return;
    }
    setState(() => _busy = true);
    try {
      await widget.state.consultationDraftRepository.enqueuePrescription(
        patientServerId: _patient!.serverId ?? _patient!.localUuid,
        doctorId: widget.state.actor.actorId,
        diagnosis: _diagnosisCtrl.text.trim(),
        medications: meds,
        language: _language,
        followUpInDays: _followUpInDays,
        consultationLocalUuid: widget.consultationLocalUuid,
      );
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Prescription queued for sync.'), backgroundColor: Color(0xFF1B5E20)),
      );
      Navigator.of(context).pop();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final patient = _patient;
    return Scaffold(
      appBar: AppBar(title: const Text('Prescription')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: ListTile(
              leading: const Icon(Icons.person_outline),
              title: Text(safeName(patient)),
              subtitle: Text(patient == null ? 'Patient must be set' : 'Consultation ${widget.consultationLocalUuid.substring(0, 14)}…'),
            ),
          ),
          const SizedBox(height: 12),
          if (_consultation != null)
            Card(
              color: const Color(0xFFE3F2FD),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Linked consultation: ${summarizeVitals((_consultation!['vitals'] as Map?)?.cast<String, dynamic>())}'),
                    if ((_consultation!['chief_complaint'] as String?)?.isNotEmpty == true)
                      Text('Complaint: ${_consultation!['chief_complaint']}'),
                  ],
                ),
              ),
            ),
          const SizedBox(height: 16),
          TextFormField(
            controller: _diagnosisCtrl,
            minLines: 2,
            maxLines: 4,
            decoration: const InputDecoration(
              labelText: 'Diagnosis',
              border: OutlineInputBorder(),
              helperText: 'Required by the backend; minimum 2 characters.',
            ),
          ),
          const SizedBox(height: 16),
          const Text('Medications', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
          const SizedBox(height: 8),
          ..._medications.asMap().entries.map((entry) => _medicationCard(entry.key, entry.value)),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            icon: const Icon(Icons.add),
            label: const Text('Add medication'),
            onPressed: _busy ? null : _addMedication,
          ),
          const SizedBox(height: 16),
          DropdownButtonFormField<String>(
            initialValue: _language,
            decoration: const InputDecoration(labelText: 'Patient language', border: OutlineInputBorder()),
            items: _kLanguages.map((l) => DropdownMenuItem(value: l, child: Text(l))).toList(),
            onChanged: (v) => setState(() => _language = v ?? 'english'),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              const Text('Follow-up in'),
              const SizedBox(width: 8),
              DropdownButton<int>(
                value: _followUpInDays,
                items: const [1, 2, 3, 5, 7, 14, 21, 30]
                    .map((d) => DropdownMenuItem(value: d, child: Text('$d day(s)')))
                    .toList(),
                onChanged: (v) => setState(() => _followUpInDays = v ?? 3),
              ),
            ],
          ),
          const SizedBox(height: 24),
          FilledButton.icon(
            icon: const Icon(Icons.save_outlined),
            label: const Text('Queue prescription'),
            onPressed: _busy ? null : _save,
          ),
        ],
      ),
    );
  }

  Widget _medicationCard(int index, _MedicationDraft med) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: Text('Medication ${index + 1}', style: const TextStyle(fontWeight: FontWeight.w700))),
                if (_medications.length > 1)
                  IconButton(
                    icon: const Icon(Icons.delete_outline),
                    onPressed: _busy ? null : () => _removeMedication(index),
                  ),
              ],
            ),
            TextFormField(
              controller: med.name,
              decoration: const InputDecoration(labelText: 'Medicine name', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 8),
            TextFormField(
              controller: med.dosage,
              decoration: const InputDecoration(labelText: 'Dosage (e.g. 500 mg)', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              initialValue: med.frequency,
              decoration: const InputDecoration(labelText: 'Frequency', border: OutlineInputBorder()),
              items: _kFrequencies.map((f) => DropdownMenuItem(value: f, child: Text(_frequencyLabel(f)))).toList(),
              onChanged: (v) => setState(() => med.frequency = v ?? 'TWICE_DAILY'),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                const Text('Duration'),
                const SizedBox(width: 8),
                Expanded(
                  child: TextFormField(
                    initialValue: med.durationDays.toString(),
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    decoration: const InputDecoration(border: OutlineInputBorder(), isDense: true),
                    onChanged: (v) => med.durationDays = int.tryParse(v) ?? med.durationDays,
                  ),
                ),
                const Text(' days'),
              ],
            ),
            const SizedBox(height: 8),
            TextFormField(
              controller: med.visualIdentifier,
              decoration: const InputDecoration(
                labelText: 'Visual identifier (e.g. small white tablet)',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _frequencyLabel(String value) {
    switch (value) {
      case 'ONCE_DAILY':
        return 'Once daily';
      case 'TWICE_DAILY':
        return 'Twice daily';
      case 'THRICE_DAILY':
        return 'Thrice daily';
      case 'AS_NEEDED':
        return 'As needed';
      default:
        return value;
    }
  }
}
