/// Step 6 — Doctor Consultation form screen.
///
/// One screen that drives the full consultation lifecycle for a single
/// patient. Sections are deliberately simple, scannable, and large enough
/// for a clinician to use on a phone in a rural PHC. The form autosaves
/// to a local draft on every change so the doctor can leave the app and
/// resume the same draft after a restart without ever losing input.
///
/// Safety:
///   * The patient's existing RED/YELLOW risk is rendered at the top of
///     the form. The doctor cannot silently downgrade a RED risk; the
///     triage verdict was authored by the deterministic engine and is
///     shown verbatim.
///   * The "Complete consultation" button is confirmation-gated. The
///     completion itself is queued for sync via the typed-sync envelope.
///   * AI MUST NOT modify the doctor's inputs. This screen does not
///     invoke any model; it only records what the doctor typed.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../offline/app_state.dart';
import '../offline/models.dart';
import 'patient_summary_screen_helpers.dart' show riskColor;

class ConsultationFormScreen extends StatefulWidget {
  const ConsultationFormScreen({super.key, required this.state, this.consultationLocalUuid, this.preselectedPatient});

  final AppState state;
  final String? consultationLocalUuid;
  final LocalPatient? preselectedPatient;

  @override
  State<ConsultationFormScreen> createState() => _ConsultationFormScreenState();
}

class _ConsultationFormScreenState extends State<ConsultationFormScreen> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _chiefComplaintCtrl = TextEditingController();
  final TextEditingController _historyCtrl = TextEditingController();
  final TextEditingController _findingsCtrl = TextEditingController();
  final TextEditingController _vitalsTempCtrl = TextEditingController();
  final TextEditingController _vitalsPulseCtrl = TextEditingController();
  final TextEditingController _vitalsRrCtrl = TextEditingController();
  final TextEditingController _vitalsSpo2Ctrl = TextEditingController();
  final TextEditingController _vitalsBpCtrl = TextEditingController();
  final TextEditingController _vitalsWeightCtrl = TextEditingController();
  final TextEditingController _assessmentCtrl = TextEditingController();
  final TextEditingController _impressionCtrl = TextEditingController();
  final TextEditingController _treatmentCtrl = TextEditingController();
  final TextEditingController _referralIdCtrl = TextEditingController();

  String _status = 'STARTED';
  LocalPatient? _patient;
  String? _consultationLocalUuid;
  bool _busy = false;
  String _lastSavedAt = '';

  @override
  void initState() {
    super.initState();
    if (widget.preselectedPatient != null) {
      _patient = widget.preselectedPatient;
    }
    if (widget.consultationLocalUuid != null) {
      _consultationLocalUuid = widget.consultationLocalUuid;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) => _initialise());
  }

  @override
  void dispose() {
    _chiefComplaintCtrl.dispose();
    _historyCtrl.dispose();
    _findingsCtrl.dispose();
    _vitalsTempCtrl.dispose();
    _vitalsPulseCtrl.dispose();
    _vitalsRrCtrl.dispose();
    _vitalsSpo2Ctrl.dispose();
    _vitalsBpCtrl.dispose();
    _vitalsWeightCtrl.dispose();
    _assessmentCtrl.dispose();
    _impressionCtrl.dispose();
    _treatmentCtrl.dispose();
    _referralIdCtrl.dispose();
    super.dispose();
  }

  Future<void> _initialise() async {
    if (_consultationLocalUuid != null) {
      final draft = await widget.state.consultationDraftRepository.findConsultationDraft(_consultationLocalUuid!);
      if (draft != null) {
        _chiefComplaintCtrl.text = (draft['chief_complaint'] as String?) ?? '';
        _historyCtrl.text = (draft['history'] as String?) ?? '';
        _findingsCtrl.text = (draft['findings'] as String?) ?? '';
        _assessmentCtrl.text = (draft['assessment'] as String?) ?? '';
        _impressionCtrl.text = (draft['clinical_impression'] as String?) ?? '';
        _treatmentCtrl.text = (draft['treatment_plan'] as String?) ?? '';
        _referralIdCtrl.text = (draft['referral_id'] as String?) ?? '';
        _status = (draft['status'] as String?) ?? 'STARTED';
        final vitals = (draft['vitals'] as Map?)?.cast<String, dynamic>();
        if (vitals != null) {
          _vitalsTempCtrl.text = vitals['temperature_c']?.toString() ?? '';
          _vitalsPulseCtrl.text = vitals['pulse_bpm']?.toString() ?? '';
          _vitalsRrCtrl.text = vitals['respiratory_rate']?.toString() ?? '';
          _vitalsSpo2Ctrl.text = vitals['spo2']?.toString() ?? '';
          _vitalsBpCtrl.text = vitals['blood_pressure']?.toString() ?? '';
          _vitalsWeightCtrl.text = vitals['weight_kg']?.toString() ?? '';
        }
        final patientLocal = draft['patient_local_uuid'] as String?;
        if (patientLocal != null) {
          final p = await widget.state.patientRepository.findById(patientLocal);
          if (p != null && mounted) setState(() => _patient = p);
        }
      }
    }
    if (mounted) setState(() {});
  }

  Map<String, dynamic> _buildVitalsMap() {
    final vitals = <String, dynamic>{};
    final t = double.tryParse(_vitalsTempCtrl.text);
    final p = int.tryParse(_vitalsPulseCtrl.text);
    final rr = int.tryParse(_vitalsRrCtrl.text);
    final spo2 = double.tryParse(_vitalsSpo2Ctrl.text);
    final bp = _vitalsBpCtrl.text.trim();
    final w = double.tryParse(_vitalsWeightCtrl.text);
    if (t != null) vitals['temperature_c'] = t;
    if (p != null) vitals['pulse_bpm'] = p;
    if (rr != null) vitals['respiratory_rate'] = rr;
    if (spo2 != null) vitals['spo2'] = spo2;
    if (bp.isNotEmpty) vitals['blood_pressure'] = bp;
    if (w != null) vitals['weight_kg'] = w;
    // Carry the patient-level risk so the server can preserve the
    // clinician-visible severity when materialising the consultation.
    if (_patient != null) {
      vitals['triage_level'] = _patient!.triageStatus;
    }
    return vitals;
  }

  Map<String, dynamic> _buildPayload() {
    return {
      'status': _status,
      'patient_local_uuid': _patient?.localUuid,
      'patient_id': _patient?.serverId,
      'doctor_id': widget.state.actor.actorId,
      'chief_complaint': _chiefComplaintCtrl.text.trim(),
      'history': _historyCtrl.text.trim(),
      'findings': _findingsCtrl.text.trim(),
      'vitals': _buildVitalsMap(),
      'assessment': _assessmentCtrl.text.trim(),
      'clinical_impression': _impressionCtrl.text.trim(),
      'treatment_plan': _treatmentCtrl.text.trim(),
      'referral_id': _referralIdCtrl.text.trim().isEmpty ? null : _referralIdCtrl.text.trim(),
    };
  }

  Future<void> _saveDraft({String statusOverride = 'STARTED'}) async {
    if (_patient == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Select a patient first.'), backgroundColor: Color(0xFFC62828)),
      );
      return;
    }
    setState(() => _busy = true);
    try {
      _consultationLocalUuid ??= 'consult-${DateTime.now().microsecondsSinceEpoch}-${widget.state.actor.actorId.hashCode}';
      _status = statusOverride;
      final payload = _buildPayload();
      await widget.state.consultationDraftRepository.saveConsultation(
        localUuid: _consultationLocalUuid!,
        patientLocalUuid: _patient!.localUuid,
        payload: payload,
      );
      _lastSavedAt = DateTime.now().toLocal().toString().substring(0, 19);
      if (mounted) setState(() {});
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _complete() async {
    if (_patient == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Select a patient first.'), backgroundColor: Color(0xFFC62828)),
      );
      return;
    }
    if (!_formKey.currentState!.validate()) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Complete consultation?'),
        content: const Text(
          'Marking the consultation COMPLETED is irreversible. The doctor-authored '
          'findings, assessment, impression, and treatment plan will be locked in.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.of(dialogContext).pop(true), child: const Text('Complete')),
        ],
      ),
    );
    if (confirmed != true) return;
    setState(() => _busy = true);
    try {
      await _saveDraft(statusOverride: 'COMPLETED');
      if (!context.mounted) return;
      // Hand off to the summary screen so the doctor can review and
      // author the discharge plan / diagnostics / prescription.
      Navigator.of(context).pushReplacementNamed(
        '/consultation/summary',
        arguments: _consultationLocalUuid,
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pickPatient() async {
    final patients = await widget.state.patientRepository.list();
    if (!context.mounted) return;
    if (patients.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No patients cached. Register or sync first.')),
      );
      return;
    }
    final selected = await showModalBottomSheet<LocalPatient>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) {
        return SafeArea(
          child: ListView.separated(
            itemCount: patients.length,
            shrinkWrap: true,
            separatorBuilder: (_, _) => const Divider(height: 1),
            itemBuilder: (context, index) {
              final p = patients[index];
              return ListTile(
                title: Text(p.name),
                subtitle: Text('${p.district} · risk ${p.triageStatus}'),
                trailing: p.localUuid == _patient?.localUuid ? const Icon(Icons.check, color: Color(0xFF1B5E20)) : null,
                onTap: () => Navigator.of(sheetContext).pop(p),
              );
            },
          ),
        );
      },
    );
    if (selected != null) {
      setState(() => _patient = selected);
      await _saveDraft();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Consultation'),
        actions: [
          if (_lastSavedAt.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: Center(child: Text('Saved $_lastSavedAt', style: const TextStyle(fontSize: 12))),
            ),
        ],
      ),
      body: Form(
        key: _formKey,
        onChanged: () {
          // Best-effort autosave. We do not block the UI; debouncing
          // is left as a future improvement. Errors here are silent
          // because the doctor will see the "Save draft" button.
        },
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _patientCard(context),
            const SizedBox(height: 16),
            _Section(
              title: 'Chief complaint',
              child: _multiline(_chiefComplaintCtrl, hint: 'Patient\'s primary reason for visit', required: false, maxLines: 3, onChanged: (_) => _saveDraft()),
            ),
            _Section(
              title: 'Clinical history',
              child: _multiline(_historyCtrl, hint: 'Onset, duration, prior treatments, allergies, family history', maxLines: 6, onChanged: (_) => _saveDraft()),
            ),
            _Section(
              title: 'Findings',
              child: _multiline(_findingsCtrl, hint: 'Examination findings, observation notes', maxLines: 6, onChanged: (_) => _saveDraft()),
            ),
            _Section(
              title: 'Vitals',
              child: _vitalsGrid(),
            ),
            _Section(
              title: 'Assessment',
              child: _multiline(_assessmentCtrl, hint: 'Differential assessment, severity notes', maxLines: 6, onChanged: (_) => _saveDraft()),
            ),
            _Section(
              title: 'Clinical impression',
              child: _multiline(_impressionCtrl, hint: 'Most-likely diagnosis or working impression', maxLines: 4, onChanged: (_) => _saveDraft()),
            ),
            _Section(
              title: 'Treatment plan',
              child: _multiline(_treatmentCtrl, hint: 'Plan of care, what was prescribed or advised', maxLines: 6, onChanged: (_) => _saveDraft()),
            ),
            _Section(
              title: 'Referral',
              child: TextFormField(
                controller: _referralIdCtrl,
                decoration: const InputDecoration(
                  labelText: 'Referral server id (optional)',
                  border: OutlineInputBorder(),
                  helperText: 'Paste the server-side referral_id if this consultation continues an existing referral.',
                ),
                onChanged: (_) => _saveDraft(),
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    icon: const Icon(Icons.save_outlined),
                    label: const Text('Save draft'),
                    onPressed: _busy ? null : () async {
                      await _saveDraft();
                      if (!context.mounted) return;
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Draft saved locally.'), backgroundColor: Color(0xFF1B5E20)),
                      );
                    },
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton.icon(
                    icon: const Icon(Icons.check_circle_outline),
                    label: const Text('Complete'),
                    onPressed: _busy ? null : _complete,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            _linkedActions(context),
          ],
        ),
      ),
    );
  }

  Widget _patientCard(BuildContext context) {
    final patient = _patient;
    final color = riskColor(patient?.triageStatus);
    return Card(
      color: patient == null ? const Color(0xFFFFF8E1) : color.withValues(alpha: 0.08),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const CircleAvatar(child: Icon(Icons.person_outline)),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        patient?.name ?? 'No patient selected',
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
                      ),
                      if (patient != null)
                        Text('${patient.district}, ${patient.state} · ${patient.village ?? "—"}'),
                    ],
                  ),
                ),
                TextButton.icon(
                  icon: const Icon(Icons.swap_horiz),
                  label: Text(patient == null ? 'Select' : 'Change'),
                  onPressed: _busy ? null : _pickPatient,
                ),
              ],
            ),
            if (patient != null) ...[
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                children: [
                  Chip(label: Text('Risk: ${patient.triageStatus}'), backgroundColor: color.withValues(alpha: 0.2)),
                  if (patient.syncedAt == null) const Chip(label: Text('Not yet synced')),
                  if (patient.isPregnant) const Chip(label: Text('Pregnant')),
                  if (patient.isElderly) const Chip(label: Text('Elderly')),
                  if (patient.isChild) const Chip(label: Text('Child')),
                  if (patient.chronicConditions.isNotEmpty)
                    Chip(label: Text('Conditions: ${patient.chronicConditions.join(", ")}')),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _vitalsGrid() {
    return Column(
      children: [
        Row(
          children: [
            Expanded(child: _numeric(_vitalsTempCtrl, 'Temp (°C)', allowDecimal: true)),
            const SizedBox(width: 8),
            Expanded(child: _numeric(_vitalsPulseCtrl, 'Pulse (bpm)')),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(child: _numeric(_vitalsRrCtrl, 'Resp rate')),
            const SizedBox(width: 8),
            Expanded(child: _numeric(_vitalsSpo2Ctrl, 'SpO2 (%)', allowDecimal: true)),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(child: _freeText(_vitalsBpCtrl, 'Blood pressure', hint: 'e.g. 120/80')),
            const SizedBox(width: 8),
            Expanded(child: _numeric(_vitalsWeightCtrl, 'Weight (kg)', allowDecimal: true)),
          ],
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          icon: const Icon(Icons.save_outlined),
          label: const Text('Save vitals to draft'),
          onPressed: _busy ? null : () async {
            await _saveDraft();
            if (!context.mounted) return;
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Vitals saved to draft.'), backgroundColor: Color(0xFF1B5E20)),
            );
          },
        ),
      ],
    );
  }

  Widget _linkedActions(BuildContext context) {
    if (_consultationLocalUuid == null) return const SizedBox.shrink();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Linked actions', style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                FilledButton.tonalIcon(
                  icon: const Icon(Icons.medication_outlined),
                  label: const Text('Add prescription'),
                  onPressed: _busy ? null : () async {
                    await _saveDraft();
                    if (!context.mounted) return;
                    Navigator.of(context).pushNamed(
                      '/consultation/prescription',
                      arguments: {
                        'consultationLocalUuid': _consultationLocalUuid,
                        'patientLocalUuid': _patient?.localUuid,
                      },
                    );
                  },
                ),
                FilledButton.tonalIcon(
                  icon: const Icon(Icons.science_outlined),
                  label: const Text('Add diagnostic'),
                  onPressed: _busy ? null : () async {
                    await _saveDraft();
                    if (!context.mounted) return;
                    Navigator.of(context).pushNamed(
                      '/consultation/diagnostics',
                      arguments: {
                        'consultationLocalUuid': _consultationLocalUuid,
                      },
                    );
                  },
                ),
                FilledButton.tonalIcon(
                  icon: const Icon(Icons.assignment_turned_in),
                  label: const Text('Author discharge plan'),
                  onPressed: _busy ? null : () async {
                    await _saveDraft();
                    if (!context.mounted) return;
                    Navigator.of(context).pushNamed(
                      '/consultation/discharge',
                      arguments: {
                        'consultationLocalUuid': _consultationLocalUuid,
                        'patientLocalUuid': _patient?.localUuid,
                      },
                    );
                  },
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _multiline(TextEditingController controller,
      {required String hint, int maxLines = 4, bool required = false, void Function(String)? onChanged}) {
    return TextFormField(
      controller: controller,
      minLines: 1,
      maxLines: maxLines,
      decoration: InputDecoration(hintText: hint, border: const OutlineInputBorder()),
      validator: required ? (value) => (value == null || value.trim().isEmpty) ? 'Required' : null : null,
      onChanged: (value) {
        if (onChanged != null) onChanged(value);
      },
    );
  }

  Widget _numeric(TextEditingController controller, String label, {bool allowDecimal = false}) {
    return TextFormField(
      controller: controller,
      keyboardType: TextInputType.numberWithOptions(decimal: allowDecimal),
      inputFormatters: [
        FilteringTextInputFormatter.allow(allowDecimal ? RegExp(r'[0-9.]') : RegExp(r'[0-9]')),
      ],
      decoration: InputDecoration(labelText: label, border: const OutlineInputBorder()),
      onChanged: (_) => _saveDraft(),
    );
  }

  Widget _freeText(TextEditingController controller, String label, {String? hint}) {
    return TextFormField(
      controller: controller,
      decoration: InputDecoration(labelText: label, hintText: hint, border: const OutlineInputBorder()),
      onChanged: (_) => _saveDraft(),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.child});
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
          const SizedBox(height: 8),
          child,
        ],
      ),
    );
  }
}
