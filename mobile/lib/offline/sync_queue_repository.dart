/// Durable offline sync outbox.
///
/// Every mutation that should reach the FastAPI backend is recorded here as a
/// queue row. The sync engine drains the queue when the device is online and
/// the backend is reachable; on partial failure the failed rows are retained
/// with an exponential-backoff `next_attempt_at` so they survive app restart.

import 'dart:convert';
import 'dart:math';

import 'package:sqflite/sqflite.dart';

import 'database.dart';
import 'models.dart';

class SyncQueueRepository {
  SyncQueueRepository(this._db);

  final ArrohDatabase _db;

  Future<Database> get _conn => _db.database;

  String _newOperationId() {
    final r = Random.secure();
    final bytes = List<int>.generate(16, (_) => r.nextInt(256));
    final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
    return 'op-${DateTime.now().microsecondsSinceEpoch}-${hex.substring(0, 12)}';
  }

  Future<void> enqueue({
    required String entityType,
    required String entityLocalUuid,
    required String operation,
    required Map<String, dynamic> payload,
  }) async {
    final db = await _conn;
    final now = DateTime.now().toUtc().toIso8601String();
    await db.insert(
      'sync_queue',
      {
        'operation_id': _newOperationId(),
        'entity_type': entityType,
        'entity_local_uuid': entityLocalUuid,
        'operation': operation,
        'payload_json': jsonEncode(payload),
        'attempts': 0,
        'status': 'PENDING',
        'created_at': now,
        'next_attempt_at': now,
      },
      conflictAlgorithm: ConflictAlgorithm.abort,
    );
  }

  Future<List<SyncQueueItem>> pending({int limit = 50}) async {
    final db = await _conn;
    final now = DateTime.now().toUtc().toIso8601String();
    final rows = await db.query(
      'sync_queue',
      where: "(status = 'PENDING' OR status = 'FAILED') AND (next_attempt_at IS NULL OR next_attempt_at <= ?)",
      whereArgs: [now],
      orderBy: 'id ASC',
      limit: limit,
    );
    return rows.map(SyncQueueItem.fromRow).toList();
  }

  Future<int> pendingCount() async {
    final db = await _conn;
    final rows = await db.rawQuery(
      "SELECT COUNT(*) AS c FROM sync_queue WHERE status IN ('PENDING','FAILED')",
    );
    return (rows.first['c'] as int?) ?? 0;
  }

  Future<int> successCount() async {
    final db = await _conn;
    final rows = await db.rawQuery("SELECT COUNT(*) AS c FROM sync_queue WHERE status = 'SYNCED'");
    return (rows.first['c'] as int?) ?? 0;
  }

  Future<int> failedCount() async {
    final db = await _conn;
    final rows = await db.rawQuery("SELECT COUNT(*) AS c FROM sync_queue WHERE status = 'FAILED'");
    return (rows.first['c'] as int?) ?? 0;
  }

  Future<void> markSynced(int id) async {
    final db = await _conn;
    await db.update('sync_queue', {'status': 'SYNCED', 'last_error': null}, where: 'id = ?', whereArgs: [id]);
  }

  Future<void> markFailed(int id, String error, {int maxAttempts = 8}) async {
    final db = await _conn;
    final rows = await db.query('sync_queue', where: 'id = ?', whereArgs: [id], limit: 1);
    if (rows.isEmpty) return;
    final attempts = ((rows.first['attempts'] as int?) ?? 0) + 1;
    final nextDelaySeconds = (1 << attempts.clamp(1, 8)) * 15; // 30s, 60s, 120s, ...
    final nextAttempt = DateTime.now().toUtc().add(Duration(seconds: nextDelaySeconds)).toIso8601String();
    final permanent = attempts >= maxAttempts;
    await db.update(
      'sync_queue',
      {
        'status': permanent ? 'DEAD' : 'FAILED',
        'attempts': attempts,
        'last_error': error,
        'last_attempt_at': DateTime.now().toUtc().toIso8601String(),
        'next_attempt_at': permanent ? null : nextAttempt,
      },
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  Future<void> resetFailed() async {
    final db = await _conn;
    final now = DateTime.now().toUtc().toIso8601String();
    await db.update(
      'sync_queue',
      {'status': 'PENDING', 'next_attempt_at': now},
      where: "status = 'FAILED' OR status = 'DEAD'",
    );
  }

  Future<void> clearSynced() async {
    final db = await _conn;
    await db.delete('sync_queue', where: "status = 'SYNCED'");
  }
}