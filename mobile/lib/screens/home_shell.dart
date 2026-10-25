/// Root home screen — entry point for every ASHA workflow.
///
/// The screen is intentionally navigation-only on startup so the database can
/// boot, connectivity can settle, and a sync can be initiated. Every button
/// corresponds to a route that works entirely offline.

import 'package:flutter/material.dart';

import '../offline/app_state.dart';
import 'asha_home_screen.dart';
import 'connectivity_badge.dart';

class HomeShell extends StatefulWidget {
  const HomeShell({super.key, required this.state});

  final AppState state;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final pages = <Widget>[
      AshaHomeScreen(state: widget.state),
      _ActionList(state: widget.state),
      _SyncTeaser(state: widget.state),
    ];
    final titles = ['Today', 'Quick actions', 'Sync'];
    return StreamBuilder<Object>(
      stream: widget.state.connectivity.changes,
      initialData: widget.state.connectivity.current,
      builder: (context, _) {
        final syncing = widget.state.syncEngine.isRunning;
        return Scaffold(
          appBar: AppBar(
            title: Text(titles[_index]),
            actions: [
              Padding(
                padding: const EdgeInsets.only(right: 12),
                child: ConnectivityBadge(state: widget.state.connectivity.current, syncing: syncing),
              ),
            ],
          ),
          body: pages[_index],
          bottomNavigationBar: NavigationBar(
            selectedIndex: _index,
            onDestinationSelected: (next) => setState(() => _index = next),
            destinations: const [
              NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Today'),
              NavigationDestination(icon: Icon(Icons.bolt_outlined), selectedIcon: Icon(Icons.bolt), label: 'Actions'),
              NavigationDestination(icon: Icon(Icons.cloud_sync_outlined), selectedIcon: Icon(Icons.cloud_sync), label: 'Sync'),
            ],
          ),
        );
      },
    );
  }
}

class _ActionList extends StatelessWidget {
  const _ActionList({required this.state});
  final AppState state;

  @override
  Widget build(BuildContext context) {
    final actions = <_Action>[
      _Action(Icons.add_task, 'Start a visit', '/visits/start', const Color(0xFF1F7773)),
      _Action(Icons.person_add_alt_1, 'Register patient', '/register', const Color(0xFF0B6BCB)),
      _Action(Icons.assessment_outlined, 'Run triage', '/triage', const Color(0xFFC62828)),
      _Action(Icons.record_voice_over, 'AI case-taking', '/case-taking', const Color(0xFF0B6BCB)),
      _Action(Icons.hearing, 'Patient low-literacy', '/low-literacy', const Color(0xFF6A1B9A)),
      _Action(Icons.event_note_outlined, 'Follow-ups', '/follow-ups', const Color(0xFF1565C0)),
      _Action(Icons.assignment_turned_in, 'Tasks', '/tasks', const Color(0xFF6A1B9A)),
      _Action(Icons.accessibility_new, 'ISL quick phrases', '/isl', const Color(0xFF8E24AA)),
      _Action(Icons.cloud_sync, 'Sync queue', '/sync', const Color(0xFFB26A00)),
      _Action(Icons.medical_services_outlined, 'Doctor consultation', '/doctor', const Color(0xFF0B6BCB)),
      _Action(Icons.settings_outlined, 'Settings', '/settings', const Color(0xFF455A64)),
    ];
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: actions.length,
      separatorBuilder: (_, _) => const SizedBox(height: 12),
      itemBuilder: (context, index) {
        final action = actions[index];
        return Material(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          child: InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: () => Navigator.of(context).pushNamed(action.route),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  CircleAvatar(
                    backgroundColor: action.color.withValues(alpha: 0.12),
                    child: Icon(action.icon, color: action.color),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Text(action.title,
                        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                  ),
                  const Icon(Icons.chevron_right),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

class _Action {
  _Action(this.icon, this.title, this.route, this.color);
  final IconData icon;
  final String title;
  final String route;
  final Color color;
}

class _SyncTeaser extends StatelessWidget {
  const _SyncTeaser({required this.state});
  final AppState state;

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<_SyncSummary>(
      future: _summary(state),
      builder: (context, snapshot) {
        if (!snapshot.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final summary = snapshot.data!;
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Offline-first sync',
                        style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                    Text(
                      'All ASHA workflows write to the local database immediately. '
                      'Queued records reach the backend as soon as connectivity returns.',
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            _statTile(context, 'Pending', summary.pending, const Color(0xFFB26A00)),
            _statTile(context, 'Synced', summary.synced, const Color(0xFF1B5E20)),
            _statTile(context, 'Failed (retained)', summary.failed, const Color(0xFFC62828)),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: () => Navigator.of(context).pushNamed('/sync'),
              icon: const Icon(Icons.cloud_sync),
              label: const Text('Open sync queue'),
            ),
          ],
        );
      },
    );
  }

  Widget _statTile(BuildContext context, String label, int value, Color color) {
    return ListTile(
      leading: CircleAvatar(backgroundColor: color.withValues(alpha: 0.12), child: Text('$value', style: TextStyle(color: color, fontWeight: FontWeight.w700))),
      title: Text(label),
    );
  }

  Future<_SyncSummary> _summary(AppState state) async {
    final queue = state.syncQueueRepository;
    return _SyncSummary(
      pending: await queue.pendingCount(),
      synced: await queue.successCount(),
      failed: await queue.failedCount(),
    );
  }
}

class _SyncSummary {
  _SyncSummary({required this.pending, required this.synced, required this.failed});
  final int pending;
  final int synced;
  final int failed;
}