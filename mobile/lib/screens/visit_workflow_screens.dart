/// Step 5 screens: start-visit, visit-form, visit-result, follow-up list,
/// task list, and patient summary. Implemented as a single file so the
/// related field workflow can be reviewed together. Each screen works
/// entirely against the local SQLite database; nothing blocks on the
/// network. State is read from the AppState container and writes go
/// through the VisitRepository so they are queued for sync.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../offline/app_state.dart';
import '../offline/models.dart';
import '../offline/offline_triage.dart';

const List<String> _kVisitTypes = [
  'general follow-up',
  'pregnancy / maternal health',
  'child health',
  'elderly care',
  'post-discharge',
  'medication/treatment follow-up',
  'referral follow-up',
];

const List<String> _kVisitOutcomes = [
  'COMPLETED',
  'FOLLOW_UP_REQUIRED',
  'REFERRAL_REQUIRED',
  'ESCALATION_REQUIRED',
];

class StartVisitScreen extends StatefulWidget {
  const StartVisitScreen({super.key, required this.state, this.patientLocalUuid});

  final AppState state;
  final String? patientLocalUuid;

  @override
  State<StartVisitScreen> createState() => _StartVisitScreenState();
}

class _StartVisitScreenState extends State<StartVisitScreen> {
  late Future<List<LocalPatient>> _patientsFuture;
  LocalPatient? _selected;
  String _visitType = _kVisitTypes.first;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _patientsFuture = widget.state.patientRepository.list();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final args = ModalRoute.of(context)?.settings.arguments;
    if (args is LocalPatient) {
      _selected = args;
    } else if (args is String) {
      widget.state.patientRepository.findById(args).then((p) {
        if (mounted && p != null) setState(() => _selected = p);
      });
    } else if (widget.patientLocalUuid != null) {
      widget.state.patientRepository.findById(widget.patientLocalUuid!).then((p) {
        if (mounted && p != null) setState(() => _selected = p);
      });
    }
  }

  Future<void> _start() async {
    if (_selected == null) return;
    setState(() => _busy = true);
    try {
      final visit = await widget.state.visitRepository.start(
        patientLocalUuid: _selected!.localUuid,
        visitType: _visitType,
        actorId: widget.state.actor.actorId,
        actorRole: widget.state.actor.actorRole,
        phcId: widget.state.actor.phcId,
      );
      if (!mounted) return;
      Navigator.of(context).pushReplacementNamed('/visits/${visit.localUuid}', arguments: visit);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Start a visit')),
      body: FutureBuilder<List<LocalPatient>>(
        future: _patientsFuture,
        builder: (context, snapshot) {
          if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
          final patients = snapshot.data!;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text('Worker: ${widget.state.actor.actorId} (${widget.state.actor.actorRole})'),
              const SizedBox(height: 12),
              DropdownButtonFormField<LocalPatient>(
                initialValue: _selected,
                decoration: const InputDecoration(labelText: 'Patient', border: OutlineInputBorder()),
                items: patients.map((p) => DropdownMenuItem(value: p, child: Text(p.name))).toList(),
                onChanged: (p) => setState(() => _selected = p),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _visitType,
                decoration: const InputDecoration(labelText: 'Visit type', border: OutlineInputBorder()),
                items: _kVisitTypes
                    .map((t) => DropdownMenuItem(value: t, child: Text(t)))
                    .toList(),
                onChanged: (v) => setState(() => _visitType = v ?? _kVisitTypes.first),
              ),
              const SizedBox(height: 24),
              FilledButton.icon(
                icon: const Icon(Icons.play_arrow),
                label: const Text('Start visit'),
                onPressed: _busy || _selected == null ? null : _start,
              ),
            ],
          );
        },
      ),
    );
  }
}

class VisitFormScreen extends StatefulWidget {
  const VisitFormScreen({super.key, required this.state, required this.visitLocalUuid});

  final AppState state;
  final String visitLocalUuid;

  @override
  State<VisitFormScreen> createState() => _VisitFormScreenState();
}

class _VisitFormScreenState extends State<VisitFormScreen> {
  late Future<_VisitFormData> _future;
  final TextEditingController _symptomCtrl = TextEditingController();
  final TextEditingController _findingsCtrl = TextEditingController();
  final TextEditingController _followUpNotesCtrl = TextEditingController();
  final TextEditingController _referralReasonCtrl = TextEditingController();
  final TextEditingController _taskNotesCtrl = TextEditingController();

  final TextEditingController _tempCtrl = TextEditingController();
  final TextEditingController _pulseCtrl = TextEditingController();
  final TextEditingController _rrCtrl = TextEditingController();
  final TextEditingController _systolicCtrl = TextEditingController();
  final TextEditingController _diastolicCtrl = TextEditingController();
  final TextEditingController _spo2Ctrl = TextEditingController();
  final TextEditingController _weightCtrl = TextEditingController();

  String _outcome = 'COMPLETED';
  DateTime? _nextVisitDate;
  bool _scheduleFollowUp = false;
  bool _createTask = false;
  bool _createReferral = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_VisitFormData> _load() async {
    final visit = await widget.state.visitRepository.findById(widget.visitLocalUuid);
    if (visit == null) {
      throw StateError('Visit missing');
    }
    final vitals = await widget.state.visitRepository.vitalsForVisit(widget.visitLocalUuid);
    final symptoms = await widget.state.visitRepository.symptomsForVisit(widget.visitLocalUuid);
    final patient = await widget.state.patientRepository.findById(visit.patientLocalUuid);
    if (vitals != null) {
      _tempCtrl.text = vitals.temperatureC?.toString() ?? '';
      _pulseCtrl.text = vitals.pulseBpm?.toString() ?? '';
      _rrCtrl.text = vitals.respiratoryRate?.toString() ?? '';
      _systolicCtrl.text = vitals.systolicBp?.toString() ?? '';
      _diastolicCtrl.text = vitals.diastolicBp?.toString() ?? '';
      _spo2Ctrl.text = vitals.spo2?.toString() ?? '';
      _weightCtrl.text = vitals.weightKg?.toString() ?? '';
    }
    return _VisitFormData(visit: visit, vitals: vitals, symptoms: symptoms, patient: patient);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Visit form')),
      body: FutureBuilder<_VisitFormData>(
        future: _future,
        builder: (context, snapshot) {
          if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
          final data = snapshot.data!;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Card(
                child: ListTile(
                  leading: const Icon(Icons.person_outline),
                  title: Text(data.patient?.name ?? 'Unknown patient'),
                  subtitle: Text('${data.visit.visitType} · ${data.visit.actorRole} ${data.visit.actorId ?? ""}'),
                ),
              ),
              const SizedBox(height: 16),
              _sectionTitle('Symptoms (during visit)'),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _symptomCtrl,
                      decoration: const InputDecoration(hintText: 'e.g. chest pain', border: OutlineInputBorder()),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    onPressed: _busy ? null : () async {
                      final v = _symptomCtrl.text.trim();
                      if (v.isEmpty) return;
                      await widget.state.visitRepository.addSymptoms(
                        visitLocalUuid: widget.visitLocalUuid,
                        symptoms: [v],
                      );
                      _symptomCtrl.clear();
                      setState(() => _future = _load());
                    },
                    icon: const Icon(Icons.add),
                  ),
                ],
              ),
              if (data.symptoms.isNotEmpty) const SizedBox(height: 8),
              ...data.symptoms.map(
                (s) => Chip(
                  label: Text('${s.symptom} · ${s.severity}'),
                  backgroundColor: const Color(0xFFECEFF1),
                ),
              ),
              const SizedBox(height: 16),
              _sectionTitle('Vitals (any subset; missing values are allowed)'),
              _vital('Temperature (°C)', _tempCtrl),
              _vital('Pulse (bpm)', _pulseCtrl),
              _vital('Respiratory rate', _rrCtrl),
              _vital('Systolic BP (mmHg)', _systolicCtrl),
              _vital('Diastolic BP (mmHg)', _diastolicCtrl),
              _vital('SpO2 (%)', _spo2Ctrl),
              _vital('Weight (kg)', _weightCtrl),
              const SizedBox(height: 8),
              FilledButton.tonalIcon(
                icon: const Icon(Icons.save_outlined),
                label: const Text('Save vitals'),
                onPressed: _busy ? null : () async {
                  await widget.state.visitRepository.saveVitals(
                    visitLocalUuid: widget.visitLocalUuid,
                    temperatureC: double.tryParse(_tempCtrl.text),
                    pulseBpm: int.tryParse(_pulseCtrl.text),
                    respiratoryRate: int.tryParse(_rrCtrl.text),
                    systolicBp: int.tryParse(_systolicCtrl.text),
                    diastolicBp: int.tryParse(_diastolicCtrl.text),
                    spo2: double.tryParse(_spo2Ctrl.text),
                    weightKg: double.tryParse(_weightCtrl.text),
                  );
                  if (!context.mounted) return;
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Vitals saved offline.'), backgroundColor: Color(0xFF1B5E20)),
                  );
                },
              ),
              const SizedBox(height: 16),
              _sectionTitle('Findings'),
              TextField(
                controller: _findingsCtrl,
                minLines: 2,
                maxLines: 4,
                decoration: const InputDecoration(border: OutlineInputBorder(), hintText: 'Observations and decisions'),
              ),
              const SizedBox(height: 16),
              _sectionTitle('Outcome'),
              DropdownButtonFormField<String>(
                initialValue: _outcome,
                decoration: const InputDecoration(border: OutlineInputBorder()),
                items: _kVisitOutcomes
                    .map((o) => DropdownMenuItem(value: o, child: Text(_outcomeLabel(o))))
                    .toList(),
                onChanged: (v) => setState(() {
                  _outcome = v ?? _kVisitOutcomes.first;
                  if (_outcome == 'FOLLOW_UP_REQUIRED' || _outcome == 'ESCALATION_REQUIRED') {
                    _scheduleFollowUp = true;
                  }
                  if (_outcome == 'REFERRAL_REQUIRED' || _outcome == 'ESCALATION_REQUIRED') {
                    _createReferral = true;
                  }
                  if (_outcome == 'ESCALATION_REQUIRED') {
                    _createTask = true;
                  }
                }),
              ),
              const SizedBox(height: 12),
              SwitchListTile(
                title: const Text('Schedule follow-up'),
                value: _scheduleFollowUp,
                onChanged: (v) => setState(() => _scheduleFollowUp = v),
              ),
              if (_scheduleFollowUp) ...[
                TextField(
                  controller: _followUpNotesCtrl,
                  decoration: const InputDecoration(labelText: 'Follow-up notes', border: OutlineInputBorder()),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        icon: const Icon(Icons.calendar_month),
                        label: Text('Next visit: ${(_nextVisitDate ?? DateTime.now().add(const Duration(days: 1))).toLocal().toString().substring(0, 10)}'),
                        onPressed: () async {
                          final picked = await showDatePicker(
                            context: context,
                            initialDate: _nextVisitDate ?? DateTime.now().add(const Duration(days: 1)),
                            firstDate: DateTime.now().subtract(const Duration(days: 1)),
                            lastDate: DateTime.now().add(const Duration(days: 365)),
                          );
                          if (picked != null) setState(() => _nextVisitDate = picked);
                        },
                      ),
                    ),
                  ],
                ),
              ],
              SwitchListTile(
                title: const Text('Create referral'),
                value: _createReferral,
                onChanged: (v) => setState(() => _createReferral = v),
              ),
              if (_createReferral) ...[
                TextField(
                  controller: _referralReasonCtrl,
                  decoration: const InputDecoration(labelText: 'Referral reason', border: OutlineInputBorder()),
                ),
              ],
              SwitchListTile(
                title: const Text('Create urgent task for me'),
                value: _createTask,
                onChanged: (v) => setState(() => _createTask = v),
              ),
              if (_createTask) ...[
                TextField(
                  controller: _taskNotesCtrl,
                  decoration: const InputDecoration(labelText: 'Task notes', border: OutlineInputBorder()),
                ),
              ],
              const SizedBox(height: 24),
              FilledButton.icon(
                icon: const Icon(Icons.check_circle_outline),
                label: const Text('Complete visit'),
                onPressed: _busy ? null : () => _complete(context, data),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _vital(String label, TextEditingController controller) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: TextField(
        controller: controller,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
        decoration: InputDecoration(labelText: label, border: const OutlineInputBorder()),
      ),
    );
  }

  Widget _sectionTitle(String label) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Text(label, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
      );

  String _outcomeLabel(String value) {
    switch (value) {
      case 'COMPLETED':
        return 'Completed';
      case 'FOLLOW_UP_REQUIRED':
        return 'Follow-up required';
      case 'REFERRAL_REQUIRED':
        return 'Referral required';
      case 'ESCALATION_REQUIRED':
        return 'Escalation required';
      default:
        return value;
    }
  }

  Future<void> _complete(BuildContext context, _VisitFormData data) async {
    setState(() => _busy = true);
    try {
      final symptoms = data.symptoms.map((s) => s.symptom).toList();
      final vitals = data.vitals;
      final vitalsMap = <String, dynamic>{};
      if (vitals != null) {
        if (vitals.temperatureC != null) vitalsMap['temperature_c'] = vitals.temperatureC;
        if (vitals.pulseBpm != null) vitalsMap['pulse_bpm'] = vitals.pulseBpm;
        if (vitals.respiratoryRate != null) vitalsMap['respiratory_rate'] = vitals.respiratoryRate;
        if (vitals.systolicBp != null) vitalsMap['systolic_bp'] = vitals.systolicBp;
        if (vitals.diastolicBp != null) vitalsMap['diastolic_bp'] = vitals.diastolicBp;
        if (vitals.spo2 != null) vitalsMap['spo2'] = vitals.spo2;
        if (vitals.weightKg != null) vitalsMap['weight_kg'] = vitals.weightKg;
      }
      final verdict = assessOfflineTriage(symptoms: symptoms, vitals: vitalsMap);
      var outcome = _outcome;
      // Safety engine wins. The offline engine cannot be downgraded by the
      // worker's chosen outcome; if the safety verdict is RED, the visit
      // must be escalated even if the ASHA tapped "Completed".
      if (verdict.triageLevel == 'RED' && (outcome == 'COMPLETED' || outcome == 'FOLLOW_UP_REQUIRED')) {
        outcome = 'ESCALATION_REQUIRED';
        _scheduleFollowUp = true;
        _createReferral = true;
        _createTask = true;
      }
      final followUpLocalUuid = _scheduleFollowUp
          ? 'fu-${DateTime.now().microsecondsSinceEpoch}-${widget.state.actor.actorId.hashCode}'
          : null;
      final referralLocalUuid = _createReferral
          ? 'ref-${DateTime.now().microsecondsSinceEpoch}-${widget.state.actor.actorId.hashCode}'
          : null;
      final taskLocalUuid = _createTask
          ? 'task-${DateTime.now().microsecondsSinceEpoch}-${widget.state.actor.actorId.hashCode}'
          : null;
      await widget.state.visitRepository.complete(
        visitLocalUuid: widget.visitLocalUuid,
        outcome: outcome,
        riskLevel: verdict.triageLevel,
        riskScore: verdict.riskScore,
        findings: _findingsCtrl.text.isEmpty ? null : _findingsCtrl.text,
        nextVisitDate: _nextVisitDate?.toUtc().toIso8601String(),
        followUpLocalUuid: followUpLocalUuid,
        referralLocalUuid: referralLocalUuid,
        followUpTaskLocalUuid: taskLocalUuid,
        payload: {
          'patient_local_uuid': data.visit.patientLocalUuid,
          'actor_id': data.visit.actorId ?? widget.state.actor.actorId,
          'actor_role': data.visit.actorRole ?? widget.state.actor.actorRole,
          'visit_type': data.visit.visitType,
          'vitals': vitalsMap,
          'symptoms': symptoms.map((s) => {'symptom': s, 'severity': 'MODERATE'}).toList(),
          'outcome': outcome,
          'findings': _findingsCtrl.text,
          if (followUpLocalUuid != null)
            'follow_up': {
              'follow_up_type': data.visit.visitType,
              'due_at': (_nextVisitDate ?? DateTime.now().add(const Duration(days: 1))).toUtc().toIso8601String(),
              'priority': outcome == 'ESCALATION_REQUIRED' ? 'URGENT' : 'ROUTINE',
              'high_risk': verdict.triageLevel == 'RED',
              'local_uuid': followUpLocalUuid,
              'notes': _followUpNotesCtrl.text,
            },
          if (referralLocalUuid != null)
            'referral': {
              'reason_for_referral': _referralReasonCtrl.text.isEmpty ? _findingsCtrl.text : _referralReasonCtrl.text,
              'referral_priority': outcome == 'ESCALATION_REQUIRED' ? 'URGENT' : 'ROUTINE',
              'local_uuid': referralLocalUuid,
            },
        },
      );
      if (!context.mounted) return;
      Navigator.of(context).pushReplacementNamed(
        '/visits/result',
        arguments: _VisitResultArgs(
          visitLocalUuid: widget.visitLocalUuid,
          outcome: outcome,
          riskLevel: verdict.triageLevel,
          riskScore: verdict.riskScore,
          followUpLocalUuid: followUpLocalUuid,
          referralLocalUuid: referralLocalUuid,
          taskLocalUuid: taskLocalUuid,
        ),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

class _VisitFormData {
  _VisitFormData({required this.visit, this.vitals, this.symptoms = const [], this.patient});
  final LocalVisit visit;
  final LocalVisitVitals? vitals;
  final List<LocalVisitSymptom> symptoms;
  final LocalPatient? patient;
}

class _VisitResultArgs {
  _VisitResultArgs({
    required this.visitLocalUuid,
    required this.outcome,
    required this.riskLevel,
    required this.riskScore,
    this.followUpLocalUuid,
    this.referralLocalUuid,
    this.taskLocalUuid,
  });
  final String visitLocalUuid;
  final String outcome;
  final String riskLevel;
  final int riskScore;
  final String? followUpLocalUuid;
  final String? referralLocalUuid;
  final String? taskLocalUuid;
}

class VisitResultScreen extends StatelessWidget {
  const VisitResultScreen({super.key, required this.state});

  final AppState state;

  @override
  Widget build(BuildContext context) {
    final args = ModalRoute.of(context)?.settings.arguments;
    if (args is! _VisitResultArgs) {
      return const Scaffold(
        body: Center(child: Text('Visit result unavailable.')),
      );
    }
    final color = switch (args.riskLevel) {
      'RED' => const Color(0xFFC62828),
      'YELLOW' => const Color(0xFFB26A00),
      _ => const Color(0xFF1B5E20),
    };
    return Scaffold(
      appBar: AppBar(title: const Text('Visit result')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            color: color.withValues(alpha: 0.08),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Icon(
                    args.riskLevel == 'RED' ? Icons.sos : Icons.health_and_safety,
                    color: color,
                    size: 36,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Risk: ${args.riskLevel} (${args.riskScore})', style: TextStyle(color: color, fontWeight: FontWeight.w800, fontSize: 18)),
                        Text('Outcome: ${args.outcome}', style: const TextStyle(fontWeight: FontWeight.w600)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          if (args.riskLevel == 'RED')
            const Card(
              child: ListTile(
                leading: Icon(Icons.warning_amber, color: Color(0xFFC62828)),
                title: Text('Safety engine could not be downgraded'),
                subtitle: Text('Visit was escalated automatically. Local emergency protocols take precedence.'),
              ),
            ),
          _outcomeCard(args),
          const SizedBox(height: 16),
          FilledButton.icon(
            icon: const Icon(Icons.check),
            label: const Text('Done'),
            onPressed: () {
              Navigator.of(context).popUntil((route) => route.isFirst);
            },
          ),
        ],
      ),
    );
  }

  Widget _outcomeCard(_VisitResultArgs args) {
    final lines = <String>[];
    if (args.followUpLocalUuid != null) {
      lines.add('Follow-up scheduled (priority ${args.riskLevel == 'RED' ? 'URGENT' : 'ROUTINE'}).');
    }
    if (args.referralLocalUuid != null) {
      lines.add('Referral created and household informed.');
    }
    if (args.taskLocalUuid != null) {
      lines.add('Urgent task created for ${state.actor.actorId}.');
    }
    if (lines.isEmpty) {
      lines.add('Visit closed cleanly. No follow-up required.');
    }
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Linked records', style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            ...lines.map((l) => Padding(padding: const EdgeInsets.symmetric(vertical: 2), child: Text('• $l'))),
            const SizedBox(height: 8),
            const Text('All records are stored locally and queued for sync.'),
          ],
        ),
      ),
    );
  }
}

class FollowUpListScreen extends StatefulWidget {
  const FollowUpListScreen({super.key, required this.state});

  final AppState state;

  @override
  State<FollowUpListScreen> createState() => _FollowUpListScreenState();
}

class _FollowUpListScreenState extends State<FollowUpListScreen> {
  late Future<List<_FollowUpRow>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<_FollowUpRow>> _load() async {
    final due = await widget.state.followUpRepository.listDue();
    final overdue = await widget.state.followUpRepository.listOverdue();
    final patients = await widget.state.patientRepository.list();
    final byId = {for (final p in patients) p.localUuid: p};
    final rows = <_FollowUpRow>[];
    for (final fu in [...overdue, ...due]) {
      rows.add(_FollowUpRow(
        patient: byId[fu.patientLocalUuid],
        followUp: fu,
        state: fu.status == 'MISSED' || fu.scheduledFor.compareTo(DateTime.now().toUtc().toIso8601String()) < 0
            ? 'OVERDUE'
            : 'DUE',
      ));
    }
    rows.sort((a, b) => a.followUp.scheduledFor.compareTo(b.followUp.scheduledFor));
    return rows;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Follow-ups')),
      body: FutureBuilder<List<_FollowUpRow>>(
        future: _future,
        builder: (context, snapshot) {
          if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
          final rows = snapshot.data!;
          if (rows.isEmpty) {
            return const Center(child: Text('No follow-ups are due. New ones will appear here as visits are completed.'));
          }
          return ListView.separated(
            padding: const EdgeInsets.all(12),
            itemCount: rows.length,
            separatorBuilder: (_, _) => const SizedBox(height: 8),
            itemBuilder: (context, index) {
              final row = rows[index];
              final color = row.state == 'OVERDUE' ? const Color(0xFFC62828) : const Color(0xFFB26A00);
              return Card(
                child: ListTile(
                  leading: Icon(row.state == 'OVERDUE' ? Icons.warning_amber : Icons.event_note, color: color),
                  title: Text('${row.patient?.name ?? "Patient"} · ${row.followUp.followUpType}'),
                  subtitle: Text('${row.followUp.scheduledFor} · ${row.followUp.priority} · ${row.state}'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: row.patient == null
                      ? null
                      : () => Navigator.of(context).pushNamed(
                            '/patients/${row.patient!.localUuid}/summary',
                          ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}

class _FollowUpRow {
  _FollowUpRow({required this.patient, required this.followUp, required this.state});
  final LocalPatient? patient;
  final LocalFollowUp followUp;
  final String state;
}

class TaskListScreen extends StatefulWidget {
  const TaskListScreen({super.key, required this.state});

  final AppState state;

  @override
  State<TaskListScreen> createState() => _TaskListScreenState();
}

class _TaskListScreenState extends State<TaskListScreen> {
  late Future<List<_TaskRow>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<_TaskRow>> _load() async {
    final queue = await widget.state.syncQueueRepository.pending();
    return queue
        .where((q) => q.entityType == 'task')
        .map((q) => _TaskRow(
              localUuid: q.entityLocalUuid,
              payload: q.payloadJson,
              createdAt: q.createdAt,
            ))
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Tasks')),
      body: FutureBuilder<List<_TaskRow>>(
        future: _future,
        builder: (context, snapshot) {
          if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
          final rows = snapshot.data!;
          if (rows.isEmpty) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text('No tasks queued. New visit outcomes that require follow-up will appear here.', textAlign: TextAlign.center),
              ),
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.all(12),
            itemCount: rows.length,
            separatorBuilder: (_, _) => const SizedBox(height: 8),
            itemBuilder: (context, index) {
              final row = rows[index];
              return Card(
                child: ListTile(
                  leading: const Icon(Icons.assignment_turned_in, color: Color(0xFF6A1B9A)),
                  title: const Text('Visit follow-up task'),
                  subtitle: Text('Queued: ${row.createdAt.substring(0, 16)}\nLocal: ${row.localUuid.substring(0, 18)}…'),
                  isThreeLine: true,
                ),
              );
            },
          );
        },
      ),
    );
  }
}

class _TaskRow {
  _TaskRow({required this.localUuid, required this.payload, required this.createdAt});
  final String localUuid;
  final String payload;
  final String createdAt;
}

class PatientSummaryScreen extends StatefulWidget {
  const PatientSummaryScreen({super.key, required this.state, required this.patientLocalUuid});

  final AppState state;
  final String patientLocalUuid;

  @override
  State<PatientSummaryScreen> createState() => _PatientSummaryScreenState();
}

class _PatientSummaryScreenState extends State<PatientSummaryScreen> {
  late Future<_PatientSummaryData> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_PatientSummaryData> _load() async {
    final patient = await widget.state.patientRepository.findById(widget.patientLocalUuid);
    if (patient == null) {
      throw StateError('Patient not found');
    }
    final visits = await widget.state.visitRepository.listForPatient(widget.patientLocalUuid);
    final followUps = await widget.state.followUpRepository.listForPatient(widget.patientLocalUuid);
    final triage = await widget.state.triageRepository.listForPatient(widget.patientLocalUuid);
    return _PatientSummaryData(
      patient: patient,
      visits: visits,
      followUps: followUps,
      triage: triage,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Patient summary')),
      body: FutureBuilder<_PatientSummaryData>(
        future: _future,
        builder: (context, snapshot) {
          if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
          final data = snapshot.data!;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _header(data.patient),
              const SizedBox(height: 12),
              _actionRow(context, data.patient),
              const SizedBox(height: 16),
              _section('Recent visits', data.visits.isEmpty
                  ? const ['No visits yet.']
                  : data.visits.take(5).map((v) => '${v.visitedAt.substring(0, 10)} · ${v.visitType} · ${v.outcome ?? "in progress"} · risk ${v.riskLevel}').toList()),
              _section('Follow-ups', data.followUps.isEmpty
                  ? const ['No follow-ups scheduled.']
                  : data.followUps.map((f) => '${f.scheduledFor.substring(0, 10)} · ${f.followUpType} · ${f.status} · ${f.priority}').toList()),
              _section('Triage history', data.triage.isEmpty
                  ? const ['No triage assessments recorded.']
                  : data.triage.take(5).map((t) => '${t.createdAt.substring(0, 10)} · ${t.triageStatus} · risk ${t.riskScore}').toList()),
              _section('Sync state', [
                'Visits synced: ${data.visits.where((v) => v.syncedAt != null).length}/${data.visits.length}',
                'Follow-ups synced: ${data.followUps.where((f) => f.syncedAt != null).length}/${data.followUps.length}',
                'Triage logs synced: ${data.triage.where((t) => t.syncedAt != null).length}/${data.triage.length}',
              ]),
            ],
          );
        },
      ),
    );
  }

  Widget _header(LocalPatient patient) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(patient.name, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 20)),
            const SizedBox(height: 4),
            Text('${patient.district}, ${patient.state} · ${patient.village ?? "—"}'),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [
                Chip(label: Text('Risk: ${patient.triageStatus}')),
                if (patient.isPregnant) const Chip(label: Text('Pregnant')),
                if (patient.isElderly) const Chip(label: Text('Elderly')),
                if (patient.isChild) const Chip(label: Text('Child')),
                if (patient.chronicConditions.isNotEmpty)
                  Chip(label: Text('Conditions: ${patient.chronicConditions.join(", ")}')),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _actionRow(BuildContext context, LocalPatient patient) {
    return Row(
      children: [
        Expanded(
          child: FilledButton.icon(
            icon: const Icon(Icons.add_task),
            label: const Text('Start visit'),
            onPressed: () => Navigator.of(context).pushNamed('/visits/start', arguments: patient),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: OutlinedButton.icon(
            icon: const Icon(Icons.assessment_outlined),
            label: const Text('Triage'),
            onPressed: () => Navigator.of(context).pushNamed('/triage', arguments: patient.localUuid),
          ),
        ),
      ],
    );
  }

  Widget _section(String title, List<String> lines) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            ...lines.map((l) => Padding(padding: const EdgeInsets.symmetric(vertical: 2), child: Text('• $l'))),
          ],
        ),
      ),
    );
  }
}

class _PatientSummaryData {
  _PatientSummaryData({required this.patient, required this.visits, required this.followUps, required this.triage});
  final LocalPatient patient;
  final List<LocalVisit> visits;
  final List<LocalFollowUp> followUps;
  final List<LocalTriageLog> triage;
}
