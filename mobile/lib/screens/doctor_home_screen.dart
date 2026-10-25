/// Step 6 — Doctor Home dashboard.
///
/// Doctor-facing surface that lists:
///   * Patients available locally (cached from the ASHA/ANM workflow).
///   * Existing consultation drafts (with last-updated timestamps).
///   * Pending sync queue size.
///
/// The screen never blocks on the network. It only reads from the local
/// SQLite database. Tapping a patient navigates into the existing
/// ``PatientSummaryScreen``; tapping "Start consultation" opens the
/// draft-aware consultation form.

import 'package:flutter/material.dart';

import '../offline/app_state.dart';
import '../offline/models.dart';
import 'visit_workflow_screens.dart' show PatientSummaryScreen;

class DoctorHomeScreen extends StatefulWidget {
  const DoctorHomeScreen({super.key, required this.state});

  final AppState state;

  @override
  State<DoctorHomeScreen> createState() => _DoctorHomeScreenState();
}

class _DoctorHomeScreenState extends State<DoctorHomeScreen> {
  late Future<_DoctorHomeData> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_DoctorHomeData> _load() async {
    final patients = await widget.state.patientRepository.list(limit: 200);
    final drafts = await widget.state.consultationDraftRepository.listDrafts();
    final pendingSync = await widget.state.syncQueueRepository.pendingCount();
    final failedSync = await widget.state.syncQueueRepository.failedCount();
    final syncedCount = await widget.state.syncQueueRepository.successCount();
    return _DoctorHomeData(
      patients: patients,
      drafts: drafts,
      pendingSync: pendingSync,
      failedSync: failedSync,
      syncedCount: syncedCount,
    );
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: () async => setState(() => _future = _load()),
      child: FutureBuilder<_DoctorHomeData>(
        future: _future,
        builder: (context, snapshot) {
          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final data = snapshot.data!;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _WorkerBanner(actorId: widget.state.actor.actorId, actorRole: widget.state.actor.actorRole, phcId: widget.state.actor.phcId),
              const SizedBox(height: 12),
              _SyncBanner(pending: data.pendingSync, failed: data.failedSync, synced: data.syncedCount),
              const SizedBox(height: 16),
              _StatRow(patients: data.patients.length, drafts: data.drafts.length, redCount: data.patients.where((p) => p.triageStatus == 'RED').length),
              const SizedBox(height: 16),
              _SectionHeader(
                title: 'Open consultation drafts',
                action: TextButton.icon(
                  icon: const Icon(Icons.refresh),
                  label: const Text('Refresh'),
                  onPressed: () => setState(() => _future = _load()),
                ),
              ),
              if (data.drafts.isEmpty)
                const Card(
                  child: ListTile(
                    leading: Icon(Icons.note_alt_outlined, color: Color(0xFF90A4AE)),
                    title: Text('No drafts yet'),
                    subtitle: Text('Pick a patient below to start a consultation.'),
                  ),
                )
              else
                ...data.drafts.map((d) => _DraftCard(state: widget.state, draft: d, onChanged: () => setState(() => _future = _load()))),
              const SizedBox(height: 16),
              _SectionHeader(
                title: 'Patient queue',
                action: TextButton.icon(
                  icon: const Icon(Icons.person_search_outlined),
                  label: const Text('Browse'),
                  onPressed: () => Navigator.of(context).pushNamed('/patients'),
                ),
              ),
              if (data.patients.isEmpty)
                const Card(
                  child: ListTile(
                    leading: Icon(Icons.people_outline, color: Color(0xFF90A4AE)),
                    title: Text('No patients cached'),
                    subtitle: Text('Sync with the backend to import patients, or have an ASHA register them.'),
                  ),
                )
              else
                ...data.patients.take(8).map((p) => _PatientCard(state: widget.state, patient: p)),
            ],
          );
        },
      ),
    );
  }
}

class _DoctorHomeData {
  _DoctorHomeData({
    required this.patients,
    required this.drafts,
    required this.pendingSync,
    required this.failedSync,
    required this.syncedCount,
  });
  final List<LocalPatient> patients;
  final List<Map<String, dynamic>> drafts;
  final int pendingSync;
  final int failedSync;
  final int syncedCount;
}

class _WorkerBanner extends StatelessWidget {
  const _WorkerBanner({required this.actorId, required this.actorRole, required this.phcId});

  final String actorId;
  final String actorRole;
  final String phcId;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            const CircleAvatar(child: Icon(Icons.medical_services_outlined)),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(actorId, style: Theme.of(context).textTheme.titleMedium),
                  Text('$actorRole · PHC $phcId', style: Theme.of(context).textTheme.bodySmall),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SyncBanner extends StatelessWidget {
  const _SyncBanner({required this.pending, required this.failed, required this.synced});

  final int pending;
  final int failed;
  final int synced;

  @override
  Widget build(BuildContext context) {
    final color = failed > 0
        ? const Color(0xFFC62828)
        : pending > 0
            ? const Color(0xFFB26A00)
            : const Color(0xFF1B5E20);
    final message = failed > 0
        ? '$failed record(s) retained for retry. Queue preserved offline.'
        : pending > 0
            ? '$pending record(s) waiting to sync. Will upload when online.'
            : 'All records synced. Local data is safe.';
    return Card(
      color: color.withValues(alpha: 0.08),
      child: ListTile(
        leading: Icon(Icons.cloud_sync, color: color),
        title: Text('Sync status', style: TextStyle(color: color, fontWeight: FontWeight.w700)),
        subtitle: Text(message),
        trailing: TextButton(
          onPressed: () => Navigator.of(context).pushNamed('/sync'),
          child: const Text('Open'),
        ),
      ),
    );
  }
}

class _StatRow extends StatelessWidget {
  const _StatRow({required this.patients, required this.drafts, required this.redCount});

  final int patients;
  final int drafts;
  final int redCount;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(child: _Stat('Patients', patients, Icons.people, const Color(0xFF1F7773))),
        const SizedBox(width: 8),
        Expanded(child: _Stat('Drafts', drafts, Icons.note_alt_outlined, const Color(0xFF1565C0))),
        const SizedBox(width: 8),
        Expanded(child: _Stat('RED', redCount, Icons.sos, const Color(0xFFC62828))),
      ],
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat(this.label, this.value, this.icon, this.color);
  final String label;
  final int value;
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color),
          const SizedBox(height: 8),
          Text('$value', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: color)),
          Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, this.action});

  final String title;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(child: Text(title, style: Theme.of(context).textTheme.titleSmall)),
          if (action != null) action!,
        ],
      ),
    );
  }
}

class _DraftCard extends StatelessWidget {
  const _DraftCard({required this.state, required this.draft, required this.onChanged});

  final AppState state;
  final Map<String, dynamic> draft;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final localUuid = draft['local_uuid'] as String;
    final status = (draft['status'] as String?) ?? 'STARTED';
    final complaint = (draft['chief_complaint'] as String?) ?? '(no chief complaint yet)';
    final updatedAt = (draft['updated_at'] as String?) ?? '';
    return Card(
      child: ListTile(
        leading: Icon(
          status == 'COMPLETED' ? Icons.check_circle : Icons.edit_note,
          color: status == 'COMPLETED' ? const Color(0xFF1B5E20) : const Color(0xFF1565C0),
        ),
        title: Text(complaint, maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: Text('Status: $status · updated ${updatedAt.substring(0, 16)}'),
        trailing: const Icon(Icons.chevron_right),
        onTap: () async {
          await Navigator.of(context).pushNamed(
            '/consultation',
            arguments: localUuid,
          );
          onChanged();
        },
      ),
    );
  }
}

class _PatientCard extends StatelessWidget {
  const _PatientCard({required this.state, required this.patient});

  final AppState state;
  final LocalPatient patient;

  @override
  Widget build(BuildContext context) {
    final isRed = patient.triageStatus == 'RED';
    final color = isRed
        ? const Color(0xFFC62828)
        : patient.triageStatus == 'YELLOW'
            ? const Color(0xFFB26A00)
            : const Color(0xFF1B5E20);
    return Card(
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: color.withValues(alpha: 0.12),
          child: Text(patient.name.isNotEmpty ? patient.name[0] : '?'),
        ),
        title: Text(patient.name),
        subtitle: Text('${patient.district} · risk ${patient.triageStatus}${patient.syncedAt == null ? " · local" : ""}'),
        trailing: Wrap(
          spacing: 4,
          children: [
            IconButton(
              icon: const Icon(Icons.medical_services_outlined),
              tooltip: 'Start consultation',
              onPressed: () {
                Navigator.of(context).pushNamed(
                  '/consultation/new',
                  arguments: patient,
                );
              },
            ),
            IconButton(
              icon: const Icon(Icons.read_more),
              tooltip: 'Patient summary',
              onPressed: () {
                Navigator.of(context).pushNamed(
                  '/patients/${patient.localUuid}/summary',
                );
              },
            ),
          ],
        ),
        onTap: () {
          Navigator.of(context).push(
            MaterialPageRoute(
              settings: const RouteSettings(name: '/patients/summary'),
              builder: (_) => PatientSummaryScreen(state: state, patientLocalUuid: patient.localUuid),
            ),
          );
        },
      ),
    );
  }
}
