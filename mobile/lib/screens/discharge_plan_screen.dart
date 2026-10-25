/// Step 6 — Doctor-authored discharge plan screen.
///
/// SAFETY:
///   * The discharge plan is the doctor's source of truth. No AI logic
///     runs in this screen; the form only records what the doctor typed.
///   * The backend schema (``DischargePlanCreateSchema``) requires
///     ``diagnosis``, ``treatment_instructions`` and
///     ``emergency_return_instructions``. These are validated client
///     side before the payload is enqueued.
///   * If the patient is RED, the plan's follow-up is forced to URGENT
///     (server-side); the UI mirrors this in the priority label so the
///     doctor is never surprised by an escalated follow-up.

import 'package:flutter/material.dart';

import '../offline/app_state.dart';
import '../offline/models.dart';
import 'patient_summary_screen_helpers.dart' show riskColor, safeName;

class DischargePlanScreen extends StatefulWidget {
  const DischargePlanScreen({super.key, required this.state, required this.consultationLocalUuid, this.patientLocalUuid});

  final AppState state;
  final String consultationLocalUuid;
  final String? patientLocalUuid;

  @override
  State<DischargePlanScreen> createState() => _DischargePlanScreenState();
}

class _DischargePlanScreenState extends State<DischargePlanScreen> {
  final TextEditingController _diagnosisCtrl = TextEditingController();
  final TextEditingController _treatmentCtrl = TextEditingController();
  final TextEditingController _activityCtrl = TextEditingController();
  final TextEditingController _emergencyReturnCtrl = TextEditingController();
  final TextEditingController _referralInstructionsCtrl = TextEditingController();
  final TextEditingController _warningSignsCtrl = TextEditingController();
  final List<_MedicationDraft> _medications = [];

  bool _followUpRequired = true;
  DateTime? _followUpDueAt;
  bool _busy = false;
  LocalPatient? _patient;
  bool _patientIsRed = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _initialise());
  }

  @override
  void dispose() {
    _diagnosisCtrl.dispose();
    _treatmentCtrl.dispose();
    _activityCtrl.dispose();
    _emergencyReturnCtrl.dispose();
    _referralInstructionsCtrl.dispose();
    _warningSignsCtrl.dispose();
    for (final med in _medications) {
      med.name.dispose();
      med.dosage.dispose();
      med.instructions.dispose();
    }
    super.dispose();
  }

  Future<void> _initialise() async {
    final draft = await widget.state.consultationDraftRepository.findConsultationDraft(widget.consultationLocalUuid);
    if (draft != null) {
      _diagnosisCtrl.text = (draft['clinical_impression'] as String?) ?? (draft['chief_complaint'] as String?) ?? '';
      _treatmentCtrl.text = (draft['treatment_plan'] as String?) ?? '';
      final pl = draft['patient_local_uuid'] as String?;
      if (pl != null) {
        _patient = await widget.state.patientRepository.findById(pl);
      }
    }
    if (widget.patientLocalUuid != null) {
      _patient = await widget.state.patientRepository.findById(widget.patientLocalUuid!);
    }
    _patientIsRed = (_patient?.triageStatus ?? '').toUpperCase() == 'RED';
    if (mounted) setState(() {});
  }

  void _addMedication() => setState(() => _medications.add(_MedicationDraft()));

  void _removeMedication(int index) {
    setState(() {
      final removed = _medications.removeAt(index);
      removed.name.dispose();
      removed.dosage.dispose();
      removed.instructions.dispose();
    });
  }

  Future<void> _pickDate() async {
    final initial = _followUpDueAt ?? DateTime.now().add(const Duration(days: 3));
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime.now().subtract(const Duration(days: 1)),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (picked != null) setState(() => _followUpDueAt = picked);
  }

  Future<void> _save() async {
    final diagnosis = _diagnosisCtrl.text.trim();
    final treatment = _treatmentCtrl.text.trim();
    final emergencyReturn = _emergencyReturnCtrl.text.trim();
    if (diagnosis.isEmpty || treatment.isEmpty || emergencyReturn.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Diagnosis, treatment instructions, and emergency return instructions are required.'),
          backgroundColor: Color(0xFFC62828),
        ),
      );
      return;
    }
    if (_followUpRequired && _followUpDueAt == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Follow-up date is required when follow-up is requested.'), backgroundColor: Color(0xFFC62828)),
      );
      return;
    }
    setState(() => _busy = true);
    try {
      final warnings = _warningSignsCtrl.text
          .split(RegExp(r'[\n,]'))
          .map((s) => s.trim())
          .where((s) => s.isNotEmpty)
          .toList();
      final meds = _medications
          .where((m) => m.name.text.trim().isNotEmpty)
          .map((m) => {
                'name': m.name.text.trim(),
                'dose': m.dosage.text.trim().isEmpty ? 'as recorded' : m.dosage.text.trim(),
                'instructions': m.instructions.text.trim().isEmpty ? 'as recorded' : m.instructions.text.trim(),
              })
          .toList();
      await widget.state.consultationDraftRepository.enqueueDischargePlan(
        consultationLocalUuid: widget.consultationLocalUuid,
        doctorId: widget.state.actor.actorId,
        diagnosis: diagnosis,
        treatmentInstructions: treatment,
        emergencyReturnInstructions: emergencyReturn,
        medicationInstructions: meds,
        activityDietInstructions: _activityCtrl.text.trim().isEmpty ? null : _activityCtrl.text.trim(),
        warningSigns: warnings,
        followUpRequired: _followUpRequired,
        followUpDueAt: _followUpRequired ? _followUpDueAt : null,
        referralInstructions: _referralInstructionsCtrl.text.trim().isEmpty ? null : _referralInstructionsCtrl.text.trim(),
      );
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Discharge plan queued for sync.'), backgroundColor: Color(0xFF1B5E20)),
      );
      Navigator.of(context).pop();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final patient = _patient;
    final priorityLabel = (_patientIsRed || patient?.triageStatus == 'RED') ? 'URGENT (forced by RED risk)' : 'ROUTINE';
    return Scaffold(
      appBar: AppBar(title: const Text('Discharge plan')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (patient != null)
            Card(
              color: riskColor(patient.triageStatus).withValues(alpha: 0.08),
              child: ListTile(
                leading: const Icon(Icons.warning_amber),
                title: Text(safeName(patient)),
                subtitle: Text('Risk: ${patient.triageStatus} · follow-up will be ${priorityLabel.toLowerCase()}'),
              ),
            ),
          const SizedBox(height: 12),
          TextFormField(
            controller: _diagnosisCtrl,
            minLines: 2,
            maxLines: 4,
            decoration: const InputDecoration(labelText: 'Diagnosis / clinical impression', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 8),
          TextFormField(
            controller: _treatmentCtrl,
            minLines: 3,
            maxLines: 6,
            decoration: const InputDecoration(labelText: 'Treatment instructions', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 8),
          TextFormField(
            controller: _activityCtrl,
            minLines: 2,
            maxLines: 4,
            decoration: const InputDecoration(labelText: 'Activity / diet instructions (optional)', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 16),
          const Text('Medications / instructions', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
          const SizedBox(height: 8),
          ..._medications.asMap().entries.map((entry) => _medicationCard(entry.key, entry.value)),
          OutlinedButton.icon(
            icon: const Icon(Icons.add),
            label: const Text('Add medication'),
            onPressed: _busy ? null : _addMedication,
          ),
          const SizedBox(height: 16),
          TextFormField(
            controller: _warningSignsCtrl,
            minLines: 2,
            maxLines: 4,
            decoration: const InputDecoration(
              labelText: 'Warning signs (one per line)',
              border: OutlineInputBorder(),
              helperText: 'The patient and ASHA are alerted to these before discharge.',
            ),
          ),
          const SizedBox(height: 8),
          TextFormField(
            controller: _emergencyReturnCtrl,
            minLines: 2,
            maxLines: 4,
            decoration: const InputDecoration(
              labelText: 'Emergency return instructions',
              border: OutlineInputBorder(),
              helperText: 'Required. When to come back to the PHC or CHC immediately.',
            ),
          ),
          const SizedBox(height: 16),
          SwitchListTile(
            title: const Text('Follow-up required'),
            value: _followUpRequired,
            onChanged: (v) => setState(() => _followUpRequired = v),
          ),
          if (_followUpRequired)
            ListTile(
              leading: const Icon(Icons.calendar_month),
              title: Text('Follow-up date: ${_followUpDueAt == null ? "not set" : _followUpDueAt!.toLocal().toString().substring(0, 10)}'),
              trailing: OutlinedButton(onPressed: _busy ? null : _pickDate, child: const Text('Pick')),
            ),
          TextFormField(
            controller: _referralInstructionsCtrl,
            minLines: 2,
            maxLines: 4,
            decoration: const InputDecoration(labelText: 'Referral instructions (optional)', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 24),
          FilledButton.icon(
            icon: const Icon(Icons.save_outlined),
            label: const Text('Queue discharge plan'),
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
              decoration: const InputDecoration(labelText: 'Dose', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 8),
            TextFormField(
              controller: med.instructions,
              minLines: 1,
              maxLines: 3,
              decoration: const InputDecoration(labelText: 'Instructions', border: OutlineInputBorder()),
            ),
          ],
        ),
      ),
    );
  }
}

class _MedicationDraft {
  final TextEditingController name = TextEditingController();
  final TextEditingController dosage = TextEditingController();
  final TextEditingController instructions = TextEditingController();
}
