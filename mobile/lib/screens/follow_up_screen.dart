/// Follow-up scheduling — works entirely offline.
///
/// The screen supports several follow-up types:
///   * ANC visit for pregnant patients
///   * Post-discharge follow-up
///   * Chronic-condition review for elderly patients
///   * Vaccination reminder for children
///
/// All entries are written to the local DB and queued for sync.

import 'package:flutter/material.dart';

import '../offline/app_state.dart';
import '../offline/models.dart';

class FollowUpScreen extends StatefulWidget {
  const FollowUpScreen({super.key, required this.state});
  final AppState state;

  @override
  State<FollowUpScreen> createState() => _FollowUpScreenState();
}

class _FollowUpScreenState extends State<FollowUpScreen> {
  late Future<List<_FollowUpRow>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<_FollowUpRow>> _load() async {
    final patients = await widget.state.patientRepository.list();
    final rows = <_FollowUpRow>[];
    for (final p in patients) {
      final entries = await widget.state.followUpRepository.listForPatient(p.localUuid);
      for (final fu in entries) {
        rows.add(_FollowUpRow(patient: p, followUp: fu));
      }
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
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.event_note_outlined, size: 56, color: Color(0xFF90A4AE)),
                    const SizedBox(height: 12),
                    const Text(
                      'No follow-ups scheduled yet. Add the first one for a registered patient.',
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 12),
                    FilledButton.icon(
                      icon: const Icon(Icons.add),
                      label: const Text('Schedule follow-up'),
                      onPressed: () => _schedule(context),
                    ),
                  ],
                ),
              ),
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
            itemCount: rows.length,
            separatorBuilder: (_, _) => const SizedBox(height: 8),
            itemBuilder: (context, index) {
              final row = rows[index];
              return Card(
                child: ListTile(
                  leading: const Icon(Icons.event_note_outlined),
                  title: Text('${row.patient.name} · ${row.followUp.followUpType}'),
                  subtitle: Text('Scheduled: ${row.followUp.scheduledFor}\n${row.followUp.syncedAt == null ? 'local' : 'synced'}'),
                  isThreeLine: true,
                ),
              );
            },
          );
        },
      ),
      floatingActionButton: FloatingActionButton.extended(
        icon: const Icon(Icons.add),
        label: const Text('Schedule'),
        onPressed: () => _schedule(context),
      ),
    );
  }

  Future<void> _schedule(BuildContext context) async {
    final patients = await widget.state.patientRepository.list();
    if (!context.mounted) return;
    if (patients.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Register a patient first.')),
      );
      return;
    }
    LocalPatient? selected = patients.first;
    String type = 'ANC';
    DateTime scheduled = DateTime.now().add(const Duration(days: 3));
    final notesCtrl = TextEditingController();
    final result = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (sheetContext, setSheetState) {
            return Padding(
              padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(sheetContext).viewInsets.bottom + 16),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Schedule follow-up', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<LocalPatient>(
                    initialValue: selected,
                    decoration: const InputDecoration(labelText: 'Patient', border: OutlineInputBorder()),
                    items: patients
                        .map((p) => DropdownMenuItem(value: p, child: Text(p.name)))
                        .toList(),
                    onChanged: (value) => setSheetState(() => selected = value),
                  ),
                  const SizedBox(height: 8),
                  DropdownButtonFormField<String>(
                    initialValue: type,
                    decoration: const InputDecoration(labelText: 'Type', border: OutlineInputBorder()),
                    items: const [
                      DropdownMenuItem(value: 'ANC', child: Text('ANC visit')),
                      DropdownMenuItem(value: 'POST_DISCHARGE', child: Text('Post-discharge')),
                      DropdownMenuItem(value: 'CHRONIC', child: Text('Chronic review')),
                      DropdownMenuItem(value: 'VACCINATION', child: Text('Vaccination')),
                      DropdownMenuItem(value: 'CHILD', child: Text('Child growth check')),
                      DropdownMenuItem(value: 'ELDER', child: Text('Elderly review')),
                    ],
                    onChanged: (value) => setSheetState(() => type = value ?? 'ANC'),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    decoration: const InputDecoration(labelText: 'Notes', border: OutlineInputBorder()),
                    controller: notesCtrl,
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          icon: const Icon(Icons.calendar_month),
                          label: Text('Scheduled: ${scheduled.toLocal().toString().substring(0, 10)}'),
                          onPressed: () async {
                            final picked = await showDatePicker(
                              context: sheetContext,
                              initialDate: scheduled,
                              firstDate: DateTime.now().subtract(const Duration(days: 1)),
                              lastDate: DateTime.now().add(const Duration(days: 365)),
                            );
                            if (picked != null) setSheetState(() => scheduled = picked);
                          },
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    icon: const Icon(Icons.save_outlined),
                    label: const Text('Save follow-up'),
                    onPressed: () => Navigator.of(sheetContext).pop(true),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
    if (result == true && selected != null) {
      await widget.state.followUpRepository.schedule(
        patientLocalUuid: selected!.localUuid,
        followUpType: type,
        scheduledFor: scheduled.toIso8601String(),
        notes: notesCtrl.text.isEmpty ? null : notesCtrl.text,
      );
      if (!mounted) return;
      setState(() => _future = _load());
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Follow-up saved locally.'), backgroundColor: Color(0xFF1B5E20)),
      );
    }
  }
}

class _FollowUpRow {
  _FollowUpRow({required this.patient, required this.followUp});
  final LocalPatient patient;
  final LocalFollowUp followUp;
}