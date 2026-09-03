/// Sync queue inspection — every pending / synced / failed row is shown with
/// its entity type, creation timestamp, retry count, and last error (if any).
///
/// Failed rows are NEVER deleted by the sync engine. The user can hit "Retry
/// failed" to push them back to the head of the queue with a fresh
/// `next_attempt_at`.

import 'package:flutter/material.dart';

import '../offline/app_state.dart';
import '../offline/models.dart';
import '../offline/sync_engine.dart';

class SyncScreen extends StatefulWidget {
  const SyncScreen({super.key, required this.state});
  final AppState state;

  @override
  State<SyncScreen> createState() => _SyncScreenState();
}

class _SyncScreenState extends State<SyncScreen> {
  late Future<List<SyncQueueItem>> _future;

  @override
  void initState() {
    super.initState();
    _future = widget.state.syncQueueRepository.pending(limit: 200);
    widget.state.syncQueueRepository.successCount();
    widget.state.syncQueueRepository.pendingCount();
    widget.state.syncReports.listen((_) {
      if (mounted) setState(() => _future = widget.state.syncQueueRepository.pending(limit: 200));
    });
  }

  Future<void> _runSync() async {
    final report = await widget.state.syncEngine.syncOnce();
    if (!mounted) return;
    final color = report.outcome == SyncOutcome.complete
        ? const Color(0xFF1B5E20)
        : report.outcome == SyncOutcome.networkBlocked
            ? const Color(0xFF8D6E63)
            : const Color(0xFFB26A00);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(report.message), backgroundColor: color),
    );
  }

  Future<void> _retryFailed() async {
    await widget.state.syncQueueRepository.resetFailed();
    await _runSync();
  }

  Future<void> _clearSynced() async {
    await widget.state.syncQueueRepository.clearSynced();
    if (!mounted) return;
    setState(() => _future = widget.state.syncQueueRepository.pending(limit: 200));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Sync queue')),
      body: FutureBuilder<List<SyncQueueItem>>(
        future: _future,
        builder: (context, snapshot) {
          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final items = snapshot.data!;
          if (items.isEmpty) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: const [
                    Icon(Icons.cloud_done_outlined, size: 56, color: Color(0xFF1B5E20)),
                    SizedBox(height: 12),
                    Text('Sync queue is empty.\nAll local records are up to date.',
                        textAlign: TextAlign.center),
                  ],
                ),
              ),
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
            itemCount: items.length,
            separatorBuilder: (_, _) => const Divider(height: 1),
            itemBuilder: (context, index) {
              final item = items[index];
              return ListTile(
                leading: Icon(_iconFor(item.entityType), color: _colorFor(item.status)),
                title: Text('${item.entityType} · ${item.operation}'),
                subtitle: Text(
                  [
                    'uuid: ${item.entityLocalUuid.substring(0, 8)}…',
                    'attempts: ${item.attempts}',
                    if (item.lastError != null) 'last: ${item.lastError}',
                  ].join('\n'),
                ),
                isThreeLine: item.lastError != null,
                trailing: _statusChip(item.status),
              );
            },
          );
        },
      ),
      floatingActionButton: Wrap(
        spacing: 8,
        direction: Axis.vertical,
        crossAxisAlignment: WrapCrossAlignment.end,
        children: [
          FloatingActionButton.extended(
            heroTag: 'sync-now',
            icon: const Icon(Icons.cloud_sync),
            label: const Text('Sync now'),
            onPressed: widget.state.syncEngine.isRunning ? null : _runSync,
          ),
          FloatingActionButton.extended(
            heroTag: 'retry-failed',
            icon: const Icon(Icons.refresh),
            label: const Text('Retry failed'),
            onPressed: widget.state.syncEngine.isRunning ? null : _retryFailed,
          ),
          FloatingActionButton.extended(
            heroTag: 'clear-synced',
            backgroundColor: const Color(0xFF607D8B),
            icon: const Icon(Icons.cleaning_services),
            label: const Text('Clear synced'),
            onPressed: _clearSynced,
          ),
        ],
      ),
    );
  }

  Widget _statusChip(String status) {
    final color = _colorFor(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(8)),
      child: Text(status, style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 11)),
    );
  }

  IconData _iconFor(String entityType) => switch (entityType) {
        'patient' => Icons.person,
        'triage_log' => Icons.medical_services,
        'follow_up' => Icons.event_note,
        'pregnancy' => Icons.pregnant_woman,
        'anc_followup' => Icons.event_available,
        'child_record' => Icons.child_care,
        'vaccination' => Icons.vaccines,
        'emergency' => Icons.emergency,
        _ => Icons.cloud_upload_outlined,
      };

  Color _colorFor(String status) => switch (status) {
        'SYNCED' => const Color(0xFF1B5E20),
        'PENDING' => const Color(0xFFB26A00),
        'FAILED' => const Color(0xFFC62828),
        'DEAD' => const Color(0xFF455A64),
        _ => const Color(0xFF455A64),
      };
}