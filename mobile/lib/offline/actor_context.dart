/// Lightweight, on-device worker identity for the ARROH field app.
///
/// Step 5 introduces per-visit actor tracking. The system-of-record backend
/// requires ``actor_id`` and ``actor_role`` on every visit write so the
/// audit trail records who performed the field work. We deliberately avoid
/// introducing a heavyweight auth model in this step; the worker is
/// declared in the app's Settings screen and persisted via
/// ``shared_preferences``. Real authentication is a follow-on concern.

import 'package:shared_preferences/shared_preferences.dart';

class ActorContext {
  const ActorContext({
    required this.actorId,
    required this.actorRole,
    required this.phcId,
  });

  final String actorId;
  final String actorRole;
  final String phcId;

  bool get isDeclared => actorId.isNotEmpty && actorRole.isNotEmpty;

  ActorContext copyWith({String? actorId, String? actorRole, String? phcId}) {
    return ActorContext(
      actorId: actorId ?? this.actorId,
      actorRole: actorRole ?? this.actorRole,
      phcId: phcId ?? this.phcId,
    );
  }
}

class ActorContextRepository {
  static const String _actorIdKey = 'arroh_worker_id';
  static const String _actorRoleKey = 'arroh_worker_role';
  static const String _phcIdKey = 'arroh_phc_id';

  static const ActorContext fallback = ActorContext(
    actorId: 'ASHA-OFFLINE',
    actorRole: 'ASHA',
    phcId: 'PHC-LOCAL',
  );

  Future<ActorContext> load() async {
    final prefs = await SharedPreferences.getInstance();
    final actorId = prefs.getString(_actorIdKey)?.trim();
    final actorRole = prefs.getString(_actorRoleKey)?.trim();
    final phcId = prefs.getString(_phcIdKey)?.trim();
    if ((actorId == null || actorId.isEmpty) && (actorRole == null || actorRole.isEmpty)) {
      return fallback;
    }
    return ActorContext(
      actorId: (actorId == null || actorId.isEmpty) ? fallback.actorId : actorId,
      actorRole: (actorRole == null || actorRole.isEmpty) ? fallback.actorRole : actorRole,
      phcId: (phcId == null || phcId.isEmpty) ? fallback.phcId : phcId,
    );
  }

  Future<void> save(ActorContext context) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_actorIdKey, context.actorId);
    await prefs.setString(_actorRoleKey, context.actorRole);
    await prefs.setString(_phcIdKey, context.phcId);
  }
}
