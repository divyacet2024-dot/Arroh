/// ASHA Home dashboard — Step 5 "Today" surface.
///
/// Shows today's priorities (open visits, due follow-ups, escalation queue)
/// and quick-action tiles that route into the field workflows. All counts
/// come from the local SQLite database so the screen is fully offline.

import 'package:flutter/material.dart';

import '../offline/app_state.dart';
import '../offline/models.dart';

class AshaHomeScreen extends StatefulWidget {
  const AshaHomeScreen({super.key, required this.state});

  final AppState state;

  @override
  State<AshaHomeScreen> createState() => _AshaHomeScreenState();
}

class _AshaHomeScreenState extends State<AshaHomeScreen> {
  late Future<_AshaHomeData> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_AshaHomeData> _load() async {
    final visitRepo = widget.state.visitRepository;
    final followUpRepo = widget.state.followUpRepository;
    final patients = await widget.state.patientRepository.list(limit: 200);
    final today = await visitRepo.listToday();
    final open = await visitRepo.listOpen();
    final due = await followUpRepo.listDue();
    final overdue = await followUpRepo.listOverdue();
    final pending = await widget.state.syncQueueRepository.pendingCount();
    final failed = await widget.state.syncQueueRepository.failedCount();
    final synced = await widget.state.syncQueueRepository.successCount();
    return _AshaHomeData(
      today: today,
      openVisits: open,
      dueFollowUps: due,
      overdueFollowUps: overdue,
      patients: patients,
      pendingSync: pending,
      failedSync: failed,
      syncedCount: synced,
    );
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: () async => setState(() => _future = _load()),
      child: FutureBuilder<_AshaHomeData>(
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
              Row(
                children: [
                  Expanded(child: _Stat('Today\'s visits', data.today.length, Icons.event_available, const Color(0xFF1F7773))),
                  const SizedBox(width: 8),
                  Expanded(child: _Stat('Open visits', data.openVisits.length, Icons.assignment_outlined, const Color(0xFF0B6BCB))),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(child: _Stat('Due follow-ups', data.dueFollowUps.length, Icons.event_note, const Color(0xFFB26A00))),
                  const SizedBox(width: 8),
                  Expanded(child: _Stat('Overdue', data.overdueFollowUps.length, Icons.warning_amber, const Color(0xFFC62828))),
                ],
              ),
              const SizedBox(height: 16),
              _SyncBanner(pending: data.pendingSync, failed: data.failedSync, synced: data.syncedCount),
              const SizedBox(height: 16),
              _ActionTile(
                icon: Icons.add_task,
                title: 'Start a visit',
                subtitle: 'Begin a home visit and capture symptoms + vitals offline.',
                color: const Color(0xFF1F7773),
                onTap: () => Navigator.of(context).pushNamed('/visits/start'),
              ),
              const SizedBox(height: 8),
              _ActionTile(
                icon: Icons.people,
                title: 'Patient list',
                subtitle: 'Browse assigned patients and review their continuity summary.',
                color: const Color(0xFF0B6BCB),
                onTap: () => Navigator.of(context).pushNamed('/patients'),
              ),
              const SizedBox(height: 8),
              _ActionTile(
                icon: Icons.event_note_outlined,
                title: 'Follow-ups',
                subtitle: '${data.dueFollowUps.length} due · ${data.overdueFollowUps.length} overdue.',
                color: const Color(0xFF1565C0),
                onTap: () => Navigator.of(context).pushNamed('/follow-ups'),
              ),
              const SizedBox(height: 8),
              _ActionTile(
                icon: Icons.assignment_turned_in,
                title: 'Tasks',
                subtitle: 'Visit-generated tasks queued for this worker.',
                color: const Color(0xFF6A1B9A),
                onTap: () => Navigator.of(context).pushNamed('/tasks'),
              ),
              const SizedBox(height: 8),
              _ActionTile(
                icon: Icons.cloud_sync,
                title: 'Sync status',
                subtitle: '${data.pendingSync} pending · ${data.failedSync} retained · ${data.syncedCount} synced.',
                color: const Color(0xFFB26A00),
                onTap: () => Navigator.of(context).pushNamed('/sync'),
              ),
              const SizedBox(height: 16),
              Text("Today's visits", style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: 8),
              if (data.today.isEmpty)
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.event_busy, color: Color(0xFF90A4AE)),
                    title: const Text('No visits recorded today yet.'),
                    subtitle: const Text('Tap "Start a visit" to record your first one.'),
                  ),
                )
              else
                ...data.today.take(5).map((visit) {
                  final patient = data.patients.firstWhere(
                    (p) => p.localUuid == visit.patientLocalUuid,
                    orElse: () => LocalPatient(
                      localUuid: visit.patientLocalUuid,
                      name: 'Patient',
                      gender: 'unknown',
                      birthDate: '1970-01-01',
                      district: '',
                      state: '',
                      createdAt: visit.visitedAt,
                      updatedAt: visit.visitedAt,
                    ),
                  );
                  return Card(
                    child: ListTile(
                      leading: const Icon(Icons.assignment_outlined),
                      title: Text('${patient.name} · ${visit.visitType}'),
                      subtitle: Text(
                        visit.completedAt == null
                            ? 'In progress · risk ${visit.riskLevel}'
                            : 'Completed · ${visit.outcome} · risk ${visit.riskLevel}',
                      ),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => Navigator.of(context).pushNamed(
                        '/patients/${visit.patientLocalUuid}/summary',
                      ),
                    ),
                  );
                }),
            ],
          );
        },
      ),
    );
  }
}

class _AshaHomeData {
  _AshaHomeData({
    required this.today,
    required this.openVisits,
    required this.dueFollowUps,
    required this.overdueFollowUps,
    required this.patients,
    required this.pendingSync,
    required this.failedSync,
    required this.syncedCount,
  });

  final List<LocalVisit> today;
  final List<LocalVisit> openVisits;
  final List<LocalFollowUp> dueFollowUps;
  final List<LocalFollowUp> overdueFollowUps;
  final List<LocalPatient> patients;
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
            const CircleAvatar(child: Icon(Icons.person_outline)),
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

class _ActionTile extends StatelessWidget {
  const _ActionTile({required this.icon, required this.title, required this.subtitle, required this.color, required this.onTap});

  final IconData icon;
  final String title;
  final String subtitle;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              CircleAvatar(backgroundColor: color.withValues(alpha: 0.12), child: Icon(icon, color: color)),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 4),
                    Text(subtitle, style: const TextStyle(fontSize: 12, color: Color(0xFF455A64))),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right),
            ],
          ),
        ),
      ),
    );
  }
}
