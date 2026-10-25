/// Repositories wrap the SQLite schema and return model objects.
///
/// Every write goes through one of these repositories, which in turn:
///   1. Inserts / updates the local row.
///   2. Enqueues a sync operation so the row reaches the backend later.
///
/// Reads never block on the network — the local database is the source of truth
/// for the field-work surface.

/// Repositories wrap the SQLite schema and return model objects.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:sqflite/sqflite.dart';

import 'database.dart';
import 'models.dart';
import 'sync_queue_repository.dart';

class PatientRepository {
  PatientRepository(this._db);

  final ArrohDatabase _db;

  Future<Database> get _conn => _db.database;

  /// Returns a fresh stable local UUID. The backend uses the same value as the
  /// idempotency key during sync, so a record created offline and then synced
  /// multiple times always maps to the same server row.
  String _newUuid() {
    final r = Random.secure();
    final bytes = List<int>.generate(16, (_) => r.nextInt(256));
    bytes[6] = (bytes[6] & 0x0F) | 0x40;
    bytes[8] = (bytes[8] & 0x3F) | 0x80;
    final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }

  Future<LocalPatient> register({
    required String name,
    required String gender,
    required String birthDate,
    required String district,
    required String state,
    String? abhaId,
    String? abhaAddress,
    String? phoneNumber,
    String? village,
    String? phcId,
    bool isPregnant = false,
    bool isElderly = false,
    bool isChild = false,
    List<String> chronicConditions = const [],
    String? notes,
  }) async {
    final now = DateTime.now().toUtc().toIso8601String();
    final localUuid = _newUuid();
    final patient = LocalPatient(
      localUuid: localUuid,
      name: name,
      gender: gender,
      birthDate: birthDate,
      abhaId: abhaId,
      abhaAddress: abhaAddress,
      phoneNumber: phoneNumber,
      village: village,
      district: district,
      state: state,
      phcId: phcId,
      isPregnant: isPregnant,
      isElderly: isElderly,
      isChild: isChild,
      chronicConditions: chronicConditions,
      notes: notes,
      createdAt: now,
      updatedAt: now,
    );
    final db = await _conn;
    await db.insert('patients', patient.toMap());
    await SyncQueueRepository(_db).enqueue(
      entityType: 'patient',
      entityLocalUuid: localUuid,
      operation: 'create',
      payload: _toBackendPayload(patient),
    );
    return patient;
  }

  Future<void> updateTriageStatus(String localUuid, String triageStatus) async {
    final db = await _conn;
    await db.update(
      'patients',
      {'triage_status': triageStatus, 'updated_at': DateTime.now().toUtc().toIso8601String()},
      where: 'local_uuid = ?',
      whereArgs: [localUuid],
    );
  }

  Future<void> markSynced(String localUuid, {required String serverId, required String syncedAt}) async {
    final db = await _conn;
    await db.update(
      'patients',
      {'server_id': serverId, 'synced_at': syncedAt},
      where: 'local_uuid = ?',
      whereArgs: [localUuid],
    );
  }

  Future<LocalPatient?> findById(String localUuid) async {
    final db = await _conn;
    final rows = await db.query('patients', where: 'local_uuid = ?', whereArgs: [localUuid], limit: 1);
    if (rows.isEmpty) return null;
    return LocalPatient.fromRow(rows.first);
  }

  Future<LocalPatient?> findByServerId(String serverId) async {
    final db = await _conn;
    final rows = await db.query('patients', where: 'server_id = ?', whereArgs: [serverId], limit: 1);
    if (rows.isEmpty) return null;
    return LocalPatient.fromRow(rows.first);
  }

  Future<List<LocalPatient>> list({String? phcId, int limit = 200}) async {
    final db = await _conn;
    final rows = await db.query(
      'patients',
      where: phcId == null ? null : 'phc_id = ?',
      whereArgs: phcId == null ? null : [phcId],
      orderBy: 'updated_at DESC',
      limit: limit,
    );
    return rows.map(LocalPatient.fromRow).toList();
  }

  Map<String, dynamic> _toBackendPayload(LocalPatient patient) => {
        'name': patient.name,
        'gender': patient.gender,
        'birth_date': patient.birthDate,
        if (patient.abhaId != null) 'abha_id': patient.abhaId,
        if (patient.abhaAddress != null) 'abha_address': patient.abhaAddress,
        if (patient.phoneNumber != null) 'phone_number': patient.phoneNumber,
        if (patient.village != null) 'village': patient.village,
        if (patient.phcId != null) 'phc_id': patient.phcId,
        'district': patient.district,
        'state': patient.state,
        'triage_status': patient.triageStatus,
        'is_synced_offline': true,
        // Stable idempotency key so retried syncs map to the same row.
        'local_client_uuid': patient.localUuid,
      };
}

class TriageRepository {
  TriageRepository(this._db);

  final ArrohDatabase _db;

  String _newUuid() {
    final r = Random.secure();
    final bytes = List<int>.generate(16, (_) => r.nextInt(256));
    return '${DateTime.now().microsecondsSinceEpoch}-${bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join()}';
  }

  Future<LocalTriageLog> record({
    required String patientLocalUuid,
    required List<String> symptoms,
    required Map<String, dynamic> vitals,
    required String triageStatus,
    required int riskScore,
    required List<String> recommendedActions,
    required bool highRiskRespiratory,
    required bool highRiskMaternal,
    required List<String> maternalConditions,
    required List<String> missingVitals,
    required String source,
    String? transcript,
  }) async {
    final now = DateTime.now().toUtc().toIso8601String();
    final log = LocalTriageLog(
      localUuid: _newUuid(),
      patientLocalUuid: patientLocalUuid,
      symptoms: symptoms,
      vitals: vitals,
      transcript: transcript,
      triageStatus: triageStatus,
      riskScore: riskScore,
      recommendedActions: recommendedActions,
      highRiskRespiratory: highRiskRespiratory,
      highRiskMaternal: highRiskMaternal,
      maternalConditions: maternalConditions,
      missingVitals: missingVitals,
      source: source,
      createdAt: now,
    );
    final db = await _db.database;
    await db.insert('triage_logs', log.toMap());
    await PatientRepository(_db).updateTriageStatus(patientLocalUuid, triageStatus);
    await SyncQueueRepository(_db).enqueue(
      entityType: 'triage_log',
      entityLocalUuid: log.localUuid,
      operation: 'create',
      payload: _toBackendPayload(log),
    );
    return log;
  }

  Future<void> markSynced(String localUuid, {required String serverId, required String syncedAt}) async {
    final db = await _db.database;
    await db.update(
      'triage_logs',
      {'server_id': serverId, 'synced_at': syncedAt},
      where: 'local_uuid = ?',
      whereArgs: [localUuid],
    );
  }

  Future<List<LocalTriageLog>> listForPatient(String patientLocalUuid) async {
    final db = await _db.database;
    final rows = await db.query(
      'triage_logs',
      where: 'patient_local_uuid = ?',
      whereArgs: [patientLocalUuid],
      orderBy: 'created_at DESC',
    );
    return rows.map(LocalTriageLog.fromRow).toList();
  }

  Map<String, dynamic> _toBackendPayload(LocalTriageLog log) => {
      'local_uuid': log.localUuid,
        'patient_local_uuid': log.patientLocalUuid,
        'symptoms': log.symptoms,
        'vitals': log.vitals,
        'transcript': log.transcript,
        'triage_status': log.triageStatus,
        'risk_score': log.riskScore,
        'recommended_actions': log.recommendedActions,
        'high_risk_respiratory': log.highRiskRespiratory,
        'high_risk_maternal': log.highRiskMaternal,
        'maternal_conditions': log.maternalConditions,
        'missing_vitals': log.missingVitals,
        'source': log.source,
        'created_at': log.createdAt,
      };
}

class FollowUpRepository {
  FollowUpRepository(this._db);

  final ArrohDatabase _db;

  String _newUuid() => 'fu-${DateTime.now().microsecondsSinceEpoch}-${Random.secure().nextInt(1 << 32)}';

  Future<LocalFollowUp> schedule({
    required String patientLocalUuid,
    required String followUpType,
    required String scheduledFor,
    String? notes,
  }) async {
    final now = DateTime.now().toUtc().toIso8601String();
    final fu = LocalFollowUp(
      localUuid: _newUuid(),
      patientLocalUuid: patientLocalUuid,
      followUpType: followUpType,
      scheduledFor: scheduledFor,
      notes: notes,
      createdAt: now,
    );
    final db = await _db.database;
    await db.insert('follow_ups', fu.toMap());
    await SyncQueueRepository(_db).enqueue(
      entityType: 'follow_up',
      entityLocalUuid: fu.localUuid,
      operation: 'create',
      payload: {
        'local_uuid': fu.localUuid,
        'patient_local_uuid': fu.patientLocalUuid,
        'follow_up_type': fu.followUpType,
        'scheduled_for': fu.scheduledFor,
        'notes': fu.notes,
        'status': fu.status,
        'priority': fu.priority,
        'high_risk': fu.highRisk,
        'created_at': fu.createdAt,
      },
    );
    return fu;
  }

  Future<List<LocalFollowUp>> listForPatient(String patientLocalUuid) async {
    final db = await _db.database;
    final rows = await db.query(
      'follow_ups',
      where: 'patient_local_uuid = ?',
      whereArgs: [patientLocalUuid],
      orderBy: 'scheduled_for ASC',
    );
    return rows.map(LocalFollowUp.fromRow).toList();
  }

  Future<List<LocalFollowUp>> listDue({DateTime? now}) async {
    final db = await _db.database;
    final rows = await db.query('follow_ups', where: "status = 'DUE' AND scheduled_for <= ?", whereArgs: [(now ?? DateTime.now().toUtc()).toIso8601String()], orderBy: 'scheduled_for ASC');
    return rows.map(LocalFollowUp.fromRow).toList();
  }

  Future<List<LocalFollowUp>> listOverdue({DateTime? now, Duration threshold = const Duration(hours: 48)}) async {
    final db = await _db.database;
    final cutoff = (now ?? DateTime.now().toUtc()).subtract(threshold).toIso8601String();
    final rows = await db.query('follow_ups', where: "scheduled_for <= ? AND status NOT IN ('COMPLETED', 'CANCELLED')", whereArgs: [cutoff], orderBy: 'scheduled_for ASC');
    return rows.map(LocalFollowUp.fromRow).toList();
  }
}

class PregnancyRepository {
  PregnancyRepository(this._db);

  final ArrohDatabase _db;

  String _newUuid() => 'preg-${DateTime.now().microsecondsSinceEpoch}-${Random.secure().nextInt(1 << 32)}';

  Future<LocalPregnancy> start({
    required String patientLocalUuid,
    String? lmpDate,
    String? eddDate,
    int? gravida,
    int? para,
    int? currentWeek,
    String riskLevel = 'GREEN',
    String? notes,
  }) async {
    final now = DateTime.now().toUtc().toIso8601String();
    final rec = LocalPregnancy(
      localUuid: _newUuid(),
      patientLocalUuid: patientLocalUuid,
      lmpDate: lmpDate,
      eddDate: eddDate,
      gravida: gravida,
      para: para,
      currentWeek: currentWeek,
      riskLevel: riskLevel,
      notes: notes,
      createdAt: now,
    );
    final db = await _db.database;
    await db.insert('pregnancy_records', rec.toMap());
    await SyncQueueRepository(_db).enqueue(
      entityType: 'pregnancy',
      entityLocalUuid: rec.localUuid,
      operation: 'create',
      payload: rec.toMap(),
    );
    return rec;
  }

  Future<LocalAncFollowup> recordAnc({
    required String pregnancyLocalUuid,
    required String visitDate,
    double? weightKg,
    int? bpSystolic,
    int? bpDiastolic,
    double? hemoglobin,
    int? fetalHeartRate,
    String? notes,
    String? nextVisitDate,
  }) async {
    final now = DateTime.now().toUtc().toIso8601String();
    final rec = LocalAncFollowup(
      localUuid: 'anc-${DateTime.now().microsecondsSinceEpoch}-${Random.secure().nextInt(1 << 32)}',
      pregnancyLocalUuid: pregnancyLocalUuid,
      visitDate: visitDate,
      weightKg: weightKg,
      bpSystolic: bpSystolic,
      bpDiastolic: bpDiastolic,
      hemoglobin: hemoglobin,
      fetalHeartRate: fetalHeartRate,
      notes: notes,
      nextVisitDate: nextVisitDate,
      createdAt: now,
    );
    final db = await _db.database;
    await db.insert('anc_followups', rec.toMap());
    await SyncQueueRepository(_db).enqueue(
      entityType: 'anc_followup',
      entityLocalUuid: rec.localUuid,
      operation: 'create',
      payload: rec.toMap(),
    );
    return rec;
  }
}

class ChildRepository {
  ChildRepository(this._db);

  final ArrohDatabase _db;

  Future<LocalChildRecord> start({
    required String patientLocalUuid,
    double? birthWeightKg,
    String? deliveryType,
    String? birthComplications,
    double? currentWeightKg,
    String? notes,
  }) async {
    final now = DateTime.now().toUtc().toIso8601String();
    final rec = LocalChildRecord(
      localUuid: 'child-${DateTime.now().microsecondsSinceEpoch}-${Random.secure().nextInt(1 << 32)}',
      patientLocalUuid: patientLocalUuid,
      birthWeightKg: birthWeightKg,
      deliveryType: deliveryType,
      birthComplications: birthComplications,
      currentWeightKg: currentWeightKg,
      notes: notes,
      createdAt: now,
    );
    final db = await _db.database;
    await db.insert('child_records', rec.toMap());
    await SyncQueueRepository(_db).enqueue(
      entityType: 'child_record',
      entityLocalUuid: rec.localUuid,
      operation: 'create',
      payload: rec.toMap(),
    );
    return rec;
  }

  Future<LocalVaccination> recordVaccination({
    required String childLocalUuid,
    required String vaccineName,
    required int doseNumber,
    String? scheduledDate,
    String? administeredDate,
    String? administeredBy,
    String? notes,
  }) async {
    final now = DateTime.now().toUtc().toIso8601String();
    final rec = LocalVaccination(
      localUuid: 'vac-${DateTime.now().microsecondsSinceEpoch}-${Random.secure().nextInt(1 << 32)}',
      childLocalUuid: childLocalUuid,
      vaccineName: vaccineName,
      doseNumber: doseNumber,
      scheduledDate: scheduledDate,
      administeredDate: administeredDate,
      administeredBy: administeredBy,
      notes: notes,
      createdAt: now,
    );
    final db = await _db.database;
    await db.insert('vaccination_records', rec.toMap());
    await SyncQueueRepository(_db).enqueue(
      entityType: 'vaccination',
      entityLocalUuid: rec.localUuid,
      operation: 'create',
      payload: rec.toMap(),
    );
    return rec;
  }
}

class EmergencyRepository {
  EmergencyRepository(this._db);

  final ArrohDatabase _db;

  Future<LocalEmergency> record({
    String? patientLocalUuid,
    required String spokenText,
    required String language,
    required String triageStatus,
    String? facilityName,
    String? transportAdvice,
    String? firstAidProtocol,
  }) async {
    final now = DateTime.now().toUtc().toIso8601String();
    final rec = LocalEmergency(
      localUuid: 'emg-${DateTime.now().microsecondsSinceEpoch}-${Random.secure().nextInt(1 << 32)}',
      patientLocalUuid: patientLocalUuid,
      spokenText: spokenText,
      language: language,
      triageStatus: triageStatus,
      facilityName: facilityName,
      transportAdvice: transportAdvice,
      firstAidProtocol: firstAidProtocol,
      createdAt: now,
    );
    final db = await _db.database;
    await db.insert('emergencies', rec.toMap());
    await SyncQueueRepository(_db).enqueue(
      entityType: 'emergency',
      entityLocalUuid: rec.localUuid,
      operation: 'create',
      payload: rec.toMap(),
    );
    return rec;
  }
}

class VisitRepository {
  VisitRepository(this._db);

  final ArrohDatabase _db;

  String _newUuid(String prefix) => '$prefix-${DateTime.now().microsecondsSinceEpoch}-${Random.secure().nextInt(1 << 32)}';

  Future<LocalVisit> start({
    required String patientLocalUuid,
    required String visitType,
    required String actorId,
    required String actorRole,
    String? phcId,
  }) async {
    final now = DateTime.now().toUtc().toIso8601String();
    final visit = LocalVisit(
      localUuid: _newUuid('visit'),
      patientLocalUuid: patientLocalUuid,
      visitType: visitType,
      visitedAt: now,
      createdAt: now,
      actorId: actorId,
      actorRole: actorRole,
      payloadJson: jsonEncode({
        'patient_local_uuid': patientLocalUuid,
        'actor_id': actorId,
        'actor_role': actorRole,
        'visit_type': visitType,
        'phc_id': phcId,
        'phc_id_optional': true,
      }),
    );
    final db = await _db.database;
    await db.insert('visits', visit.toMap());
    await SyncQueueRepository(_db).enqueue(
      entityType: 'visit',
      entityLocalUuid: visit.localUuid,
      operation: 'create',
      payload: visit.toMap().cast<String, dynamic>()..remove('synced_at'),
    );
    return visit;
  }

  Future<LocalVisitVitals?> saveVitals({
    required String visitLocalUuid,
    double? temperatureC,
    int? pulseBpm,
    int? respiratoryRate,
    int? systolicBp,
    int? diastolicBp,
    double? spo2,
    double? weightKg,
  }) async {
    final db = await _db.database;
    final existing = await db.query(
      'local_visit_vitals',
      where: 'visit_local_uuid = ?',
      whereArgs: [visitLocalUuid],
      limit: 1,
    );
    final now = DateTime.now().toUtc().toIso8601String();
    if (existing.isEmpty) {
      final v = LocalVisitVitals(
        localUuid: _newUuid('vv'),
        visitLocalUuid: visitLocalUuid,
        temperatureC: temperatureC,
        pulseBpm: pulseBpm,
        respiratoryRate: respiratoryRate,
        systolicBp: systolicBp,
        diastolicBp: diastolicBp,
        spo2: spo2,
        weightKg: weightKg,
        recordedAt: now,
      );
      await db.insert('local_visit_vitals', v.toMap());
      return v;
    } else {
      final row = existing.first;
      final existingRecord = LocalVisitVitals.fromRow(row);
      final updated = LocalVisitVitals(
        localUuid: existingRecord.localUuid,
        visitLocalUuid: visitLocalUuid,
        temperatureC: temperatureC ?? existingRecord.temperatureC,
        pulseBpm: pulseBpm ?? existingRecord.pulseBpm,
        respiratoryRate: respiratoryRate ?? existingRecord.respiratoryRate,
        systolicBp: systolicBp ?? existingRecord.systolicBp,
        diastolicBp: diastolicBp ?? existingRecord.diastolicBp,
        spo2: spo2 ?? existingRecord.spo2,
        weightKg: weightKg ?? existingRecord.weightKg,
        recordedAt: now,
      );
      await db.update('local_visit_vitals', updated.toMap(), where: 'local_uuid = ?', whereArgs: [updated.localUuid]);
      return updated;
    }
  }

  Future<List<LocalVisitSymptom>> addSymptoms({
    required String visitLocalUuid,
    required List<String> symptoms,
  }) async {
    if (symptoms.isEmpty) return const [];
    final db = await _db.database;
    final now = DateTime.now().toUtc().toIso8601String();
    final created = <LocalVisitSymptom>[];
    for (final s in symptoms) {
      final cleaned = s.trim();
      if (cleaned.isEmpty) continue;
      final rec = LocalVisitSymptom(
        localUuid: _newUuid('vs'),
        visitLocalUuid: visitLocalUuid,
        symptom: cleaned,
        recordedAt: now,
      );
      await db.insert('local_visit_symptoms', rec.toMap());
      created.add(rec);
    }
    return created;
  }

  Future<LocalVisit> complete({
    required String visitLocalUuid,
    required String outcome,
    required String riskLevel,
    required int riskScore,
    String? findings,
    String? nextVisitDate,
    String? followUpLocalUuid,
    String? referralLocalUuid,
    String? followUpTaskLocalUuid,
    required Map<String, dynamic> payload,
  }) async {
    final db = await _db.database;
    final rows = await db.query('visits', where: 'local_uuid = ?', whereArgs: [visitLocalUuid], limit: 1);
    if (rows.isEmpty) {
      throw StateError('Visit not found: $visitLocalUuid');
    }
    final existing = LocalVisit.fromRow(rows.first);
    final now = DateTime.now().toUtc().toIso8601String();
    final updated = LocalVisit(
      localUuid: existing.localUuid,
      serverId: existing.serverId,
      patientLocalUuid: existing.patientLocalUuid,
      visitType: existing.visitType,
      visitedAt: existing.visitedAt,
      findings: findings ?? existing.findings,
      nextVisitDate: nextVisitDate ?? existing.nextVisitDate,
      createdAt: existing.createdAt,
      syncedAt: null,
      outcome: outcome,
      riskLevel: riskLevel,
      riskScore: riskScore,
      actorId: existing.actorId,
      actorRole: existing.actorRole,
      completedAt: now,
      followUpLocalUuid: followUpLocalUuid,
      referralLocalUuid: referralLocalUuid,
      followUpTaskLocalUuid: followUpTaskLocalUuid,
      escalated: outcome == 'ESCALATION_REQUIRED',
      payloadJson: jsonEncode(payload),
    );
    await db.update('visits', updated.toMap(), where: 'local_uuid = ?', whereArgs: [updated.localUuid]);
    // Re-enqueue so the backend receives the completion.
    await SyncQueueRepository(_db).enqueue(
      entityType: 'visit',
      entityLocalUuid: updated.localUuid,
      operation: 'update',
      payload: updated.toMap().cast<String, dynamic>()..remove('synced_at'),
    );
    if (followUpTaskLocalUuid != null) {
      await SyncQueueRepository(_db).enqueue(
        entityType: 'task',
        entityLocalUuid: followUpTaskLocalUuid,
        operation: 'create',
        payload: {
          'follow_up_id': followUpLocalUuid,
          'visit_id': visitLocalUuid,
          'task_type': 'HOME_VISIT',
          'priority': outcome == 'ESCALATION_REQUIRED' ? 'URGENT' : 'ROUTINE',
          'due_at': nextVisitDate ?? DateTime.now().add(const Duration(days: 1)).toUtc().toIso8601String(),
          'actor_id': existing.actorId,
          'local_uuid': followUpTaskLocalUuid,
        },
      );
    }
    return updated;
  }

  Future<LocalVisit?> findById(String localUuid) async {
    final db = await _db.database;
    final rows = await db.query('visits', where: 'local_uuid = ?', whereArgs: [localUuid], limit: 1);
    if (rows.isEmpty) return null;
    return LocalVisit.fromRow(rows.first);
  }

  Future<LocalVisitVitals?> vitalsForVisit(String visitLocalUuid) async {
    final db = await _db.database;
    final rows = await db.query('local_visit_vitals', where: 'visit_local_uuid = ?', whereArgs: [visitLocalUuid], limit: 1);
    if (rows.isEmpty) return null;
    return LocalVisitVitals.fromRow(rows.first);
  }

  Future<List<LocalVisitSymptom>> symptomsForVisit(String visitLocalUuid) async {
    final db = await _db.database;
    final rows = await db.query('local_visit_symptoms', where: 'visit_local_uuid = ?', whereArgs: [visitLocalUuid], orderBy: 'recorded_at ASC');
    return rows.map(LocalVisitSymptom.fromRow).toList();
  }

  Future<List<LocalVisit>> listForPatient(String patientLocalUuid, {int limit = 50}) async {
    final db = await _db.database;
    final rows = await db.query(
      'visits',
      where: 'patient_local_uuid = ?',
      whereArgs: [patientLocalUuid],
      orderBy: 'visited_at DESC',
      limit: limit,
    );
    return rows.map(LocalVisit.fromRow).toList();
  }

  Future<List<LocalVisit>> listOpen({int limit = 100}) async {
    final db = await _db.database;
    final rows = await db.query(
      'visits',
      where: 'completed_at IS NULL',
      orderBy: 'visited_at DESC',
      limit: limit,
    );
    return rows.map(LocalVisit.fromRow).toList();
  }

  Future<List<LocalVisit>> listToday({DateTime? now}) async {
    final moment = (now ?? DateTime.now()).toLocal();
    final start = DateTime(moment.year, moment.month, moment.day);
    final end = start.add(const Duration(days: 1));
    final db = await _db.database;
    final rows = await db.query(
      'visits',
      where: 'visited_at >= ? AND visited_at < ?',
      whereArgs: [start.toUtc().toIso8601String(), end.toUtc().toIso8601String()],
      orderBy: 'visited_at DESC',
    );
    return rows.map(LocalVisit.fromRow).toList();
  }

  Future<void> markSynced(String localUuid, {required String serverId, required String syncedAt}) async {
    final db = await _db.database;
    await db.update(
      'visits',
      {'server_id': serverId, 'synced_at': syncedAt},
      where: 'local_uuid = ?',
      whereArgs: [localUuid],
    );
  }
}

class OfflineEntityRepository {
  OfflineEntityRepository(this._db);

  final ArrohDatabase _db;

  Future<void> _save(String table, String entityType, String localUuid, Map<String, Object?> values) async {
    final db = await _db.database;
    await db.insert(table, values);
    await SyncQueueRepository(_db).enqueue(
      entityType: entityType,
      entityLocalUuid: localUuid,
      operation: 'create',
      payload: Map<String, dynamic>.from(values)..remove('synced_at'),
    );
  }

  Future<void> saveReferral(LocalReferral referral) => _save('referrals', 'referral', referral.localUuid, referral.toMap());
  Future<void> saveVisit(LocalVisit visit) => _save('visits', 'visit', visit.localUuid, visit.toMap());
  Future<void> saveTask(LocalTask task) => _save('tasks', 'task', task.localUuid, task.toMap());

  Future<void> updateFollowUp(LocalFollowUp followUp) async {
    final db = await _db.database;
    await db.update('follow_ups', followUp.toMap(), where: 'local_uuid = ?', whereArgs: [followUp.localUuid]);
    await SyncQueueRepository(_db).enqueue(
      entityType: 'follow_up',
      entityLocalUuid: followUp.localUuid,
      operation: 'update',
      payload: followUp.toMap().cast<String, dynamic>(),
    );
  }

  Future<void> transitionFollowUp(LocalFollowUp followUp, String status) async {
    final updated = LocalFollowUp(
      localUuid: followUp.localUuid,
      serverId: followUp.serverId,
      patientLocalUuid: followUp.patientLocalUuid,
      followUpType: followUp.followUpType,
      scheduledFor: followUp.scheduledFor,
      completedAt: followUp.completedAt,
      outcome: followUp.outcome,
      notes: followUp.notes,
      status: status,
      priority: followUp.priority,
      highRisk: followUp.highRisk,
      createdAt: followUp.createdAt,
      syncedAt: null,
    );
    await updateFollowUp(updated);
  }
}

class ConsultationDraftRepository {
  /// Local persistence for in-progress doctor consultations.
  ///
  /// The mobile app is offline-first: a doctor can start a consultation,
  /// record findings, attach prescriptions / diagnostics / discharge plans
  /// and close the app. Every write is captured here and replayed through
  /// the typed-sync envelope (see ``SyncEngine._dispatch``). The
  /// ``local_uuid`` is the stable idempotency key — a retried sync never
  /// creates a second consultation row on the server.
  ConsultationDraftRepository(this._db);
  final ArrohDatabase _db;

  String _newUuid(String prefix) =>
      '$prefix-${DateTime.now().microsecondsSinceEpoch}-${Random.secure().nextInt(1 << 32)}';

  Future<Database> get _conn => _db.database;

  /// Persist a structured consultation payload. The first call enqueues a
  /// ``create`` operation; subsequent calls enqueue ``update``. The row
  /// is always replaced in the ``consultation_drafts`` table so the local
  /// database mirrors the doctor's current state.
  Future<void> saveConsultation({
    required String localUuid,
    String? patientLocalUuid,
    required Map<String, dynamic> payload,
  }) async {
    final db = await _conn;
    final now = DateTime.now().toUtc().toIso8601String();
    final existing = await db.query('consultation_drafts',
        columns: ['local_uuid'], where: 'local_uuid = ?', whereArgs: [localUuid], limit: 1);
    final isCreate = existing.isEmpty;
    await db.insert(
      'consultation_drafts',
      {
        'local_uuid': localUuid,
        'patient_local_uuid': patientLocalUuid,
        'session_json': jsonEncode(payload),
        'updated_at': now,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
    final resolved = await _resolveForSync(payload, patientLocalUuid: patientLocalUuid, consultationLocalUuid: localUuid);
    if (resolved == null) {
      // The patient is not yet synced. The draft is safe locally and will
      // be picked up the next time ``flushPendingDrafts`` runs after the
      // patient sync completes.
      return;
    }
    await SyncQueueRepository(_db).enqueue(
      entityType: 'consultation',
      entityLocalUuid: localUuid,
      operation: isCreate ? 'create' : 'update',
      payload: resolved,
    );
  }

  /// Resolves a draft payload to a backend-ready payload. Returns null
  /// when the patient has not been synced yet — the draft must remain
  /// local until the patient is uploaded.
  Future<Map<String, dynamic>?> _resolveForSync(
    Map<String, dynamic> payload, {
    required String? patientLocalUuid,
    required String consultationLocalUuid,
  }) async {
    final out = Map<String, dynamic>.from(payload)..['local_uuid'] = consultationLocalUuid;
    if (patientLocalUuid == null) return out;
    final patient = await PatientRepository(_db).findById(patientLocalUuid);
    final serverId = patient?.serverId;
    if (serverId == null || serverId.isEmpty) {
      return null;
    }
    out['patient_id'] = serverId;
    return out;
  }

  /// Force a re-enqueue of every draft whose patient has just been
  /// synced. The sync engine calls this after a successful patient
  /// sync so dependent drafts are not stranded.
  Future<int> flushPendingDrafts() async {
    final drafts = await listDrafts();
    int requeued = 0;
    for (final draft in drafts) {
      final localUuid = draft['local_uuid'] as String;
      final patientLocalUuid = draft['patient_local_uuid'] as String?;
      final session = await findConsultationDraft(localUuid);
      if (session == null) continue;
      final resolved = await _resolveForSync(
        session,
        patientLocalUuid: patientLocalUuid,
        consultationLocalUuid: localUuid,
      );
      if (resolved == null) continue;
      // Re-enqueue only if the existing queue row is already SYNCED or
      // missing (e.g. patient sync came in after the draft save).
      await SyncQueueRepository(_db).enqueue(
        entityType: 'consultation',
        entityLocalUuid: localUuid,
        operation: 'update',
        payload: resolved,
      );
      requeued += 1;
    }
    return requeued;
  }

  /// Enqueue a typed diagnostic request. ``consultation_local_uuid`` is
  /// the mobile-local identifier; the backend resolves it on upload.
  Future<String> enqueueDiagnosticRequest({
    required String consultationLocalUuid,
    required String investigationName,
    String? indication,
    required String requestedBy,
  }) async {
    final localUuid = _newUuid('diag');
    final consultationId = await _resolveConsultationServerId(consultationLocalUuid);
    if (consultationId == null) {
      // The consultation is not yet synced. We still record the request
      // in a pending-bucket so it can be re-enqueued after the
      // consultation finishes syncing. See ``requeueDependents``.
      await _recordPendingDependent(
        entityType: 'diagnostic_request',
        localUuid: localUuid,
        consultationLocalUuid: consultationLocalUuid,
        payload: {
          'investigation_name': investigationName,
          if (indication != null) 'indication': indication,
          'requested_by': requestedBy,
        },
      );
      return localUuid;
    }
    final payload = {
      'consultation_id': consultationId,
      'investigation_name': investigationName,
      if (indication != null) 'indication': indication,
      'requested_by': requestedBy,
      'local_uuid': localUuid,
    };
    await SyncQueueRepository(_db).enqueue(
      entityType: 'diagnostic_request',
      entityLocalUuid: localUuid,
      operation: 'create',
      payload: payload,
    );
    return localUuid;
  }

  /// Enqueue a typed diagnostic result. ``investigation_local_uuid`` is
  /// the mobile-local identifier of the diagnostic request this answers.
  Future<String> enqueueDiagnosticResult({
    required String investigationLocalUuid,
    required String resultValue,
    String? units,
    String? referenceRange,
    required String verifiedBy,
  }) async {
    final localUuid = _newUuid('diagr');
    final investigationId = await _resolveInvestigationServerId(investigationLocalUuid);
    if (investigationId == null) {
      await _recordPendingDependent(
        entityType: 'diagnostic_result',
        localUuid: localUuid,
        investigationLocalUuid: investigationLocalUuid,
        payload: {
          'result_value': resultValue,
          if (units != null) 'units': units,
          if (referenceRange != null) 'reference_range': referenceRange,
          'verified_by': verifiedBy,
        },
      );
      return localUuid;
    }
    final payload = {
      'investigation_id': investigationId,
      'result_value': resultValue,
      if (units != null) 'units': units,
      if (referenceRange != null) 'reference_range': referenceRange,
      'performed_at': DateTime.now().toUtc().toIso8601String(),
      if (verifiedBy.isNotEmpty) 'verified_by': verifiedBy,
      'local_uuid': localUuid,
    };
    await SyncQueueRepository(_db).enqueue(
      entityType: 'diagnostic_result',
      entityLocalUuid: localUuid,
      operation: 'create',
      payload: payload,
    );
    return localUuid;
  }

  /// Enqueue a typed discharge plan. ``consultation_local_uuid`` is the
  /// mobile-local consultation identifier; the server resolves it on
  /// upload. The plan is the doctor-authored source of truth — no
  /// autonomous rewrite happens after this call.
  Future<String> enqueueDischargePlan({
    required String consultationLocalUuid,
    required String doctorId,
    required String diagnosis,
    required String treatmentInstructions,
    required String emergencyReturnInstructions,
    List<Map<String, dynamic>> medicationInstructions = const [],
    String? activityDietInstructions,
    List<String> warningSigns = const [],
    bool followUpRequired = false,
    DateTime? followUpDueAt,
    String? referralInstructions,
  }) async {
    final localUuid = _newUuid('disch');
    final consultationId = await _resolveConsultationServerId(consultationLocalUuid);
    if (consultationId == null) {
      await _recordPendingDependent(
        entityType: 'discharge_plan',
        localUuid: localUuid,
        consultationLocalUuid: consultationLocalUuid,
        payload: {
          'doctor_id': doctorId,
          'diagnosis': diagnosis,
          'treatment_instructions': treatmentInstructions,
          'medication_instructions': medicationInstructions,
          if (activityDietInstructions != null) 'activity_diet_instructions': activityDietInstructions,
          'warning_signs': warningSigns,
          'emergency_return_instructions': emergencyReturnInstructions,
          'follow_up_required': followUpRequired,
          if (followUpRequired && followUpDueAt != null)
            'follow_up_due_at': followUpDueAt.toUtc().toIso8601String(),
          if (referralInstructions != null) 'referral_instructions': referralInstructions,
        },
      );
      return localUuid;
    }
    final payload = {
      'consultation_id': consultationId,
      'doctor_id': doctorId,
      'diagnosis': diagnosis,
      'treatment_instructions': treatmentInstructions,
      'medication_instructions': medicationInstructions,
      if (activityDietInstructions != null) 'activity_diet_instructions': activityDietInstructions,
      'warning_signs': warningSigns,
      'emergency_return_instructions': emergencyReturnInstructions,
      'follow_up_required': followUpRequired,
      if (followUpRequired && followUpDueAt != null)
        'follow_up_due_at': followUpDueAt.toUtc().toIso8601String(),
      if (referralInstructions != null) 'referral_instructions': referralInstructions,
      'local_uuid': localUuid,
    };
    await SyncQueueRepository(_db).enqueue(
      entityType: 'discharge_plan',
      entityLocalUuid: localUuid,
      operation: 'create',
      payload: payload,
    );
    return localUuid;
  }

  /// Enqueue a typed prescription linked to a consultation. Reuses the
  /// existing ``CarePrescriptionCreateSchema`` contract — the form
  /// contract below mirrors its required fields so a doctor never
  /// fabricates values the backend cannot validate.
  Future<String> enqueuePrescription({
    required String patientServerId,
    required String doctorId,
    required String diagnosis,
    required List<Map<String, dynamic>> medications,
    String language = 'english',
    int followUpInDays = 3,
    String? consultationLocalUuid,
  }) async {
    final localUuid = _newUuid('rx');
    final payload = {
      'patient_id': patientServerId,
      'doctor_id': doctorId,
      'diagnosis': diagnosis,
      'medications': medications,
      'language': language,
      'follow_up_in_days': followUpInDays,
      if (consultationLocalUuid != null) 'consultation_local_uuid': consultationLocalUuid,
    };
    // The bulk-sync envelope carries a single record per call, so we use
    // the existing ``prescription`` entity_type and route through the
    // dedicated /prescriptions/create endpoint via a custom dispatch
    // entry handled by the sync engine (see SyncEngine._syncPrescription).
    await SyncQueueRepository(_db).enqueue(
      entityType: 'prescription',
      entityLocalUuid: localUuid,
      operation: 'create',
      payload: payload,
    );
    return localUuid;
  }

  Future<Map<String, dynamic>?> findConsultationDraft(String localUuid) async {
    final db = await _conn;
    final rows = await db.query('consultation_drafts',
        where: 'local_uuid = ?', whereArgs: [localUuid], limit: 1);
    if (rows.isEmpty) return null;
    return (jsonDecode(rows.first['session_json']! as String) as Map).cast<String, dynamic>();
  }

  Future<List<Map<String, dynamic>>> listDrafts() async {
    final db = await _conn;
    final rows = await db.query('consultation_drafts', orderBy: 'updated_at DESC');
    return rows.map((row) {
      final session = (jsonDecode(row['session_json']! as String) as Map).cast<String, dynamic>();
      return {
        'local_uuid': row['local_uuid']! as String,
        'patient_local_uuid': row['patient_local_uuid'] as String?,
        'updated_at': row['updated_at']! as String,
        'status': (session['status'] as String?) ?? 'STARTED',
        'chief_complaint': session['chief_complaint'] as String?,
        'patient_id': session['patient_id'] as String?,
      };
    }).toList();
  }

  Future<void> deleteDraft(String localUuid) async {
    final db = await _conn;
    await db.delete('consultation_drafts', where: 'local_uuid = ?', whereArgs: [localUuid]);
  }

  // ------------------------------------------------------------------
  // Dependent-resolution helpers
  // ------------------------------------------------------------------
  // Diagnostic requests / discharge plans reference ``consultation_id``
  // (server UUID). The mobile only knows the consultation by its
  // ``local_uuid`` until the consultation row has been uploaded and the
  // server id has been written back. Until then, the dependent payload
  // is parked in ``consultation_dependents`` and re-enqueued by
  // ``requeueDependents`` once the server id is available.
  //
  // Diagnostic results reference ``investigation_id``; the same
  // mechanism applies through the consultation_dependents table.

  Future<String?> _resolveConsultationServerId(String consultationLocalUuid) async {
    final db = await _conn;
    final rows = await db.query('sync_queue',
        columns: ['server_id'],
        where: "entity_type = 'consultation' AND entity_local_uuid = ? AND server_id IS NOT NULL",
        whereArgs: [consultationLocalUuid],
        limit: 1);
    if (rows.isNotEmpty) {
      return rows.first['server_id'] as String?;
    }
    // Fallback: some sync engine paths update a row's server_id on
    // ``markSynced`` but store the result in a side table for
    // consultation (the consultation_drafts table). Look in the draft
    // session_json for any server_id the form already knows about.
    final draftRows = await db.query('consultation_drafts',
        where: 'local_uuid = ?', whereArgs: [consultationLocalUuid], limit: 1);
    if (draftRows.isNotEmpty) {
      final session = jsonDecode(draftRows.first['session_json']! as String) as Map;
      final cached = session['server_consultation_id'];
      if (cached is String && cached.isNotEmpty) return cached;
    }
    return null;
  }

  Future<String?> _resolveInvestigationServerId(String investigationLocalUuid) async {
    final db = await _conn;
    final rows = await db.query('clinical_server_ids',
        columns: ['server_id'],
        where: "entity_type = 'diagnostic_request' AND local_uuid = ?",
        whereArgs: [investigationLocalUuid],
        limit: 1);
    if (rows.isNotEmpty) {
      return rows.first['server_id'] as String?;
    }
    return null;
  }

  Future<void> _recordPendingDependent({
    required String entityType,
    required String localUuid,
    String? consultationLocalUuid,
    String? investigationLocalUuid,
    required Map<String, dynamic> payload,
  }) async {
    final db = await _conn;
    await db.insert(
      'consultation_dependents',
      {
        'local_uuid': localUuid,
        'entity_type': entityType,
        'consultation_local_uuid': consultationLocalUuid,
        'investigation_local_uuid': investigationLocalUuid,
        'payload_json': jsonEncode(payload),
        'created_at': DateTime.now().toUtc().toIso8601String(),
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  /// Called by the sync engine after a consultation, diagnostic_request,
  /// diagnostic_result or discharge_plan successfully uploads. Re-enqueues
  /// any dependents that were waiting on the server id.
  Future<int> requeueDependents({
    String? consultationLocalUuid,
    String? investigationLocalUuid,
  }) async {
    final db = await _conn;
    final whereClauses = <String>[];
    final args = <Object?>[];
    if (consultationLocalUuid != null) {
      whereClauses.add('consultation_local_uuid = ?');
      args.add(consultationLocalUuid);
    }
    if (investigationLocalUuid != null) {
      whereClauses.add('investigation_local_uuid = ?');
      args.add(investigationLocalUuid);
    }
    if (whereClauses.isEmpty) return 0;
    final rows = await db.query('consultation_dependents',
        where: whereClauses.join(' OR '), whereArgs: args);
    int requeued = 0;
    for (final row in rows) {
      final type = row['entity_type'] as String;
      final localUuid = row['local_uuid'] as String;
      final consLocal = row['consultation_local_uuid'] as String?;
      final invLocal = row['investigation_local_uuid'] as String?;
      final basePayload = (jsonDecode(row['payload_json']! as String) as Map).cast<String, dynamic>();
      if (type == 'diagnostic_request' && consLocal != null) {
        final serverConsultationId = await _resolveConsultationServerId(consLocal);
        if (serverConsultationId == null) continue;
        await SyncQueueRepository(_db).enqueue(
          entityType: 'diagnostic_request',
          entityLocalUuid: localUuid,
          operation: 'create',
          payload: {
            ...basePayload,
            'consultation_id': serverConsultationId,
            'local_uuid': localUuid,
          },
        );
        await db.delete('consultation_dependents', where: 'local_uuid = ?', whereArgs: [localUuid]);
        requeued += 1;
      } else if (type == 'diagnostic_result' && invLocal != null) {
        final serverInvestigationId = await _resolveInvestigationServerId(invLocal);
        if (serverInvestigationId == null) continue;
        await SyncQueueRepository(_db).enqueue(
          entityType: 'diagnostic_result',
          entityLocalUuid: localUuid,
          operation: 'create',
          payload: {
            ...basePayload,
            'investigation_id': serverInvestigationId,
            'performed_at': DateTime.now().toUtc().toIso8601String(),
            'local_uuid': localUuid,
          },
        );
        await db.delete('consultation_dependents', where: 'local_uuid = ?', whereArgs: [localUuid]);
        requeued += 1;
      } else if (type == 'discharge_plan' && consLocal != null) {
        final serverConsultationId = await _resolveConsultationServerId(consLocal);
        if (serverConsultationId == null) continue;
        await SyncQueueRepository(_db).enqueue(
          entityType: 'discharge_plan',
          entityLocalUuid: localUuid,
          operation: 'create',
          payload: {
            ...basePayload,
            'consultation_id': serverConsultationId,
            'local_uuid': localUuid,
          },
        );
        await db.delete('consultation_dependents', where: 'local_uuid = ?', whereArgs: [localUuid]);
        requeued += 1;
      }
    }
    return requeued;
  }

  /// Persist a freshly-allocated server ``consultation_id`` on the
  /// matching draft so future dependents can resolve it without waiting
  /// for the next sync pass.
  Future<void> rememberConsultationServerId({
    required String consultationLocalUuid,
    required String serverConsultationId,
  }) async {
    final db = await _conn;
    final rows = await db.query('consultation_drafts',
        where: 'local_uuid = ?', whereArgs: [consultationLocalUuid], limit: 1);
    if (rows.isEmpty) return;
    final session = (jsonDecode(rows.first['session_json']! as String) as Map).cast<String, dynamic>();
    session['server_consultation_id'] = serverConsultationId;
    await db.update(
      'consultation_drafts',
      {
        'session_json': jsonEncode(session),
        'synced_at': DateTime.now().toUtc().toIso8601String(),
        'updated_at': DateTime.now().toUtc().toIso8601String(),
      },
      where: 'local_uuid = ?',
      whereArgs: [consultationLocalUuid],
    );
  }
}