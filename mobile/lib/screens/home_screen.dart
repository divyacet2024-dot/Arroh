/// Home dashboard — at-a-glance overview of today's work.
///
/// Reads exclusively from the local SQLite database; never blocks on the
/// backend. Every patient / triage / follow-up count is real data, not a
/// placeholder.

import 'package:flutter/material.dart';

import '../offline/app_state.dart';
import '../offline/models.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.state});
  final AppState state;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late Future<_DashboardData> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _future = _load();
  }

  Future<_DashboardData> _load() async {
    final patients = await widget.state.patientRepository.list(limit: 50);
    final queue = widget.state.syncQueueRepository;
    return _DashboardData(
      patients: patients,
      pendingSync: await queue.pendingCount(),
      failedSync: await queue.failedCount(),
      syncedCount: await queue.successCount(),
    );
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: () async => setState(() => _future = _load()),
      child: FutureBuilder<_DashboardData>(
        future: _future,
        builder: (context, snapshot) {
          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final data = snapshot.data!;
          final redCount = data.patients.where((p) => p.triageStatus == 'RED').length;
          final yellowCount = data.patients.where((p) => p.triageStatus == 'YELLOW').length;
          final greenCount = data.patients.where((p) => p.triageStatus == 'GREEN').length;
          final unsynced = data.patients.where((p) => p.syncedAt == null).length;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Today', style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 8),
                      Text(
                        'All counts come from the on-device database — independent of '
                        'network availability. Use the sync tab to push updates to '
                        'the ARROH backend.',
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(child: _Stat('Patients', data.patients.length, Icons.people, const Color(0xFF1F7773))),
                  const SizedBox(width: 8),
                  Expanded(child: _Stat('RED', redCount, Icons.sos, const Color(0xFFC62828))),
                  const SizedBox(width: 8),
                  Expanded(child: _Stat('YELLOW', yellowCount, Icons.warning_amber, const Color(0xFFB26A00))),
                  const SizedBox(width: 8),
                  Expanded(child: _Stat('GREEN', greenCount, Icons.check_circle_outline, const Color(0xFF1B5E20))),
                ],
              ),
              const SizedBox(height: 12),
              Card(
                child: ListTile(
                  leading: const Icon(Icons.cloud_sync),
                  title: const Text('Sync queue'),
                  subtitle: Text('${data.pendingSync} pending · ${data.failedSync} retained · ${data.syncedCount} synced'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.of(context).pushNamed('/sync'),
                ),
              ),
              const SizedBox(height: 12),
              Card(
                child: ListTile(
                  leading: const Icon(Icons.cloud_off),
                  title: const Text('Unsynced records'),
                  subtitle: Text('$unsynced patients have not been acknowledged by the backend yet.'),
                ),
              ),
              const SizedBox(height: 12),
              Text('Recent patients', style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: 8),
              ...data.patients.take(5).map(
                    (p) => Card(
                      child: ListTile(
                        leading: CircleAvatar(child: Text(p.name.isNotEmpty ? p.name[0] : '?')),
                        title: Text(p.name),
                        subtitle: Text('${p.district} · ${p.triageStatus} · ${p.syncedAt == null ? "local" : "synced"}'),
                        trailing: IconButton(
                          icon: const Icon(Icons.chevron_right),
                          onPressed: () => Navigator.of(context).pushNamed('/triage', arguments: p.localUuid),
                        ),
                      ),
                    ),
                  ),
            ],
          );
        },
      ),
    );
  }
}

class _DashboardData {
  _DashboardData({required this.patients, required this.pendingSync, required this.failedSync, required this.syncedCount});
  final List<LocalPatient> patients;
  final int pendingSync;
  final int failedSync;
  final int syncedCount;
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
      padding: const EdgeInsets.all(12),
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