/// Tri-state connectivity badge.
///
/// 🟢 ONLINE  — backend is reachable
/// 🟠 SYNCING — sync engine is running
/// 🔴 OFFLINE — backend is unreachable (either Wi-Fi/data is off OR the
///              FastAPI process is not running)

import 'package:flutter/material.dart';

import '../offline/connectivity_monitor.dart';

class ConnectivityBadge extends StatelessWidget {
  const ConnectivityBadge({
    super.key,
    required this.state,
    required this.syncing,
  });

  final ConnectivityState state;
  final bool syncing;

  @override
  Widget build(BuildContext context) {
    final label = _label();
    final color = _color();
    final icon = _icon();
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: Colors.white),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }

  String _label() {
    if (!state.online) return 'OFFLINE';
    if (syncing) return 'SYNCING';
    if (state.backend == BackendReachability.unreachable) return 'NO BACKEND';
    return 'ONLINE';
  }

  Color _color() {
    if (!state.online) return const Color(0xFF8D6E63);
    if (syncing) return const Color(0xFFB26A00);
    if (state.backend == BackendReachability.unreachable) return const Color(0xFFC62828);
    return const Color(0xFF1B5E20);
  }

  IconData _icon() {
    if (!state.online) return Icons.signal_cellular_connected_no_internet_0_bar;
    if (syncing) return Icons.sync;
    if (state.backend == BackendReachability.unreachable) return Icons.cloud_off;
    return Icons.signal_cellular_4_bar;
  }
}