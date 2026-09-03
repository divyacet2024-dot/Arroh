/// Local data models mirroring the ARROH offline schema. Each model exposes a
/// factory that constructs it from a `Map<String, Object?>` row (so a future
/// migration to a different store is a one-file change) and a `toMap()` for
/// inserts/updates.

import 'dart:convert';

class LocalPatient {
  LocalPatient({
    required this.localUuid,
    required this.name,
    required this.gender,
    required this.birthDate,
    this.abhaId,
    this.abhaAddress,
    this.phoneNumber,
    this.village,
    required this.district,
    required this.state,
    this.phcId,
    this.triageStatus = 'GREEN',
    this.isPregnant = false,
    this.isElderly = false,
    this.isChild = false,
    this.chronicConditions = const [],
    this.notes,
    required this.createdAt,
    required this.updatedAt,
    this.syncedAt,
    this.serverId,
  });

  final String localUuid;
  final String? serverId;
  final String name;
  final String gender;
  final String birthDate;
  final String? abhaId;
  final String? abhaAddress;
  final String? phoneNumber;
  final String? village;
  final String district;
  final String state;
  final String? phcId;
  final String triageStatus;
  final bool isPregnant;
  final bool isElderly;
  final bool isChild;
  final List<String> chronicConditions;
  final String? notes;
  final String createdAt;
  final String updatedAt;
  final String? syncedAt;

  Map<String, Object?> toMap() => {
        'local_uuid': localUuid,
        'server_id': serverId,
        'name': name,
        'gender': gender,
        'birth_date': birthDate,
        'abha_id': abhaId,
        'abha_address': abhaAddress,
        'phone_number': phoneNumber,
        'village': village,
        'district': district,
        'state': state,
        'phc_id': phcId,
        'triage_status': triageStatus,
        'is_pregnant': isPregnant ? 1 : 0,
        'is_elderly': isElderly ? 1 : 0,
        'is_child': isChild ? 1 : 0,
        'chronic_conditions': jsonEncode(chronicConditions),
        'notes': notes,
        'created_at': createdAt,
        'updated_at': updatedAt,
        'synced_at': syncedAt,
      };

  factory LocalPatient.fromRow(Map<String, Object?> row) => LocalPatient(
        localUuid: row['local_uuid']! as String,
        serverId: row['server_id'] as String?,
        name: row['name']! as String,
        gender: row['gender']! as String,
        birthDate: row['birth_date']! as String,
        abhaId: row['abha_id'] as String?,
        abhaAddress: row['abha_address'] as String?,
        phoneNumber: row['phone_number'] as String?,
        village: row['village'] as String?,
        district: row['district']! as String,
        state: row['state']! as String,
        phcId: row['phc_id'] as String?,
        triageStatus: (row['triage_status'] as String?) ?? 'GREEN',
        isPregnant: ((row['is_pregnant'] as int?) ?? 0) == 1,
        isElderly: ((row['is_elderly'] as int?) ?? 0) == 1,
        isChild: ((row['is_child'] as int?) ?? 0) == 1,
        chronicConditions: _decodeList(row['chronic_conditions']),
        notes: row['notes'] as String?,
        createdAt: row['created_at']! as String,
        updatedAt: row['updated_at']! as String,
        syncedAt: row['synced_at'] as String?,
      );

  LocalPatient copyWith({String? triageStatus, String? syncedAt, String? serverId}) => LocalPatient(
        localUuid: localUuid,
        serverId: serverId ?? this.serverId,
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
        triageStatus: triageStatus ?? this.triageStatus,
        isPregnant: isPregnant,
        isElderly: isElderly,
        isChild: isChild,
        chronicConditions: chronicConditions,
        notes: notes,
        createdAt: createdAt,
        updatedAt: DateTime.now().toUtc().toIso8601String(),
        syncedAt: syncedAt ?? this.syncedAt,
      );
}

class LocalTriageLog {
  LocalTriageLog({
    required this.localUuid,
    required this.patientLocalUuid,
    required this.symptoms,
    required this.vitals,
    required this.transcript,
    required this.triageStatus,
    required this.riskScore,
    required this.recommendedActions,
    required this.highRiskRespiratory,
    required this.highRiskMaternal,
    required this.maternalConditions,
    required this.missingVitals,
    required this.source,
    required this.createdAt,
    this.syncedAt,
    this.serverId,
  });

  final String localUuid;
  final String? serverId;
  final String patientLocalUuid;
  final List<String> symptoms;
  final Map<String, dynamic> vitals;
  final String? transcript;
  final String triageStatus;
  final int riskScore;
  final List<String> recommendedActions;
  final bool highRiskRespiratory;
  final bool highRiskMaternal;
  final List<String> maternalConditions;
  final List<String> missingVitals;
  final String source;
  final String createdAt;
  final String? syncedAt;

  Map<String, Object?> toMap() => {
        'local_uuid': localUuid,
        'server_id': serverId,
        'patient_local_uuid': patientLocalUuid,
        'symptoms_json': jsonEncode(symptoms),
        'vitals_json': jsonEncode(vitals),
        'transcript': transcript,
        'triage_status': triageStatus,
        'risk_score': riskScore,
        'recommended_actions_json': jsonEncode(recommendedActions),
        'high_risk_respiratory': highRiskRespiratory ? 1 : 0,
        'high_risk_maternal': highRiskMaternal ? 1 : 0,
        'maternal_conditions_json': jsonEncode(maternalConditions),
        'missing_vitals_json': jsonEncode(missingVitals),
        'source': source,
        'created_at': createdAt,
        'synced_at': syncedAt,
      };

  factory LocalTriageLog.fromRow(Map<String, Object?> row) => LocalTriageLog(
        localUuid: row['local_uuid']! as String,
        serverId: row['server_id'] as String?,
        patientLocalUuid: row['patient_local_uuid']! as String,
        symptoms: _decodeList(row['symptoms_json']),
        vitals: _decodeMap(row['vitals_json']),
        transcript: row['transcript'] as String?,
        triageStatus: row['triage_status']! as String,
        riskScore: (row['risk_score'] as int?) ?? 0,
        recommendedActions: _decodeList(row['recommended_actions_json']),
        highRiskRespiratory: ((row['high_risk_respiratory'] as int?) ?? 0) == 1,
        highRiskMaternal: ((row['high_risk_maternal'] as int?) ?? 0) == 1,
        maternalConditions: _decodeList(row['maternal_conditions_json']),
        missingVitals: _decodeList(row['missing_vitals_json']),
        source: (row['source'] as String?) ?? 'offline',
        createdAt: row['created_at']! as String,
        syncedAt: row['synced_at'] as String?,
      );
}

class LocalFollowUp {
  LocalFollowUp({
    required this.localUuid,
    required this.patientLocalUuid,
    required this.followUpType,
    required this.scheduledFor,
    this.completedAt,
    this.outcome,
    this.notes,
    this.status = 'SCHEDULED',
    this.priority = 'ROUTINE',
    this.highRisk = false,
    required this.createdAt,
    this.syncedAt,
    this.serverId,
  });

  final String localUuid;
  final String? serverId;
  final String patientLocalUuid;
  final String followUpType;
  final String scheduledFor;
  final String? completedAt;
  final String? outcome;
  final String? notes;
  final String status;
  final String priority;
  final bool highRisk;
  final String createdAt;
  final String? syncedAt;

  Map<String, Object?> toMap() => {
        'local_uuid': localUuid,
        'server_id': serverId,
        'patient_local_uuid': patientLocalUuid,
        'follow_up_type': followUpType,
        'scheduled_for': scheduledFor,
        'completed_at': completedAt,
        'outcome': outcome,
        'notes': notes,
        'status': status,
        'priority': priority,
        'high_risk': highRisk ? 1 : 0,
        'created_at': createdAt,
        'synced_at': syncedAt,
      };

  factory LocalFollowUp.fromRow(Map<String, Object?> row) => LocalFollowUp(
        localUuid: row['local_uuid']! as String,
        serverId: row['server_id'] as String?,
        patientLocalUuid: row['patient_local_uuid']! as String,
        followUpType: row['follow_up_type']! as String,
        scheduledFor: row['scheduled_for']! as String,
        completedAt: row['completed_at'] as String?,
        outcome: row['outcome'] as String?,
        notes: row['notes'] as String?,
        status: (row['status'] as String?) ?? 'SCHEDULED',
        priority: (row['priority'] as String?) ?? 'ROUTINE',
        highRisk: ((row['high_risk'] as int?) ?? 0) == 1,
        createdAt: row['created_at']! as String,
        syncedAt: row['synced_at'] as String?,
      );
}

class LocalPregnancy {
  LocalPregnancy({
    required this.localUuid,
    required this.patientLocalUuid,
    this.lmpDate,
    this.eddDate,
    this.gravida,
    this.para,
    this.currentWeek,
    this.riskLevel = 'GREEN',
    this.notes,
    required this.createdAt,
    this.syncedAt,
    this.serverId,
  });

  final String localUuid;
  final String? serverId;
  final String patientLocalUuid;
  final String? lmpDate;
  final String? eddDate;
  final int? gravida;
  final int? para;
  final int? currentWeek;
  final String riskLevel;
  final String? notes;
  final String createdAt;
  final String? syncedAt;

  Map<String, Object?> toMap() => {
        'local_uuid': localUuid,
        'server_id': serverId,
        'patient_local_uuid': patientLocalUuid,
        'lmp_date': lmpDate,
        'edd_date': eddDate,
        'gravida': gravida,
        'para': para,
        'current_week': currentWeek,
        'risk_level': riskLevel,
        'notes': notes,
        'created_at': createdAt,
        'synced_at': syncedAt,
      };

  factory LocalPregnancy.fromRow(Map<String, Object?> row) => LocalPregnancy(
        localUuid: row['local_uuid']! as String,
        serverId: row['server_id'] as String?,
        patientLocalUuid: row['patient_local_uuid']! as String,
        lmpDate: row['lmp_date'] as String?,
        eddDate: row['edd_date'] as String?,
        gravida: row['gravida'] as int?,
        para: row['para'] as int?,
        currentWeek: row['current_week'] as int?,
        riskLevel: (row['risk_level'] as String?) ?? 'GREEN',
        notes: row['notes'] as String?,
        createdAt: row['created_at']! as String,
        syncedAt: row['synced_at'] as String?,
      );
}

class LocalAncFollowup {
  LocalAncFollowup({
    required this.localUuid,
    required this.pregnancyLocalUuid,
    required this.visitDate,
    this.weightKg,
    this.bpSystolic,
    this.bpDiastolic,
    this.hemoglobin,
    this.fetalHeartRate,
    this.notes,
    this.nextVisitDate,
    required this.createdAt,
    this.syncedAt,
    this.serverId,
  });

  final String localUuid;
  final String? serverId;
  final String pregnancyLocalUuid;
  final String visitDate;
  final double? weightKg;
  final int? bpSystolic;
  final int? bpDiastolic;
  final double? hemoglobin;
  final int? fetalHeartRate;
  final String? notes;
  final String? nextVisitDate;
  final String createdAt;
  final String? syncedAt;

  Map<String, Object?> toMap() => {
        'local_uuid': localUuid,
        'server_id': serverId,
        'pregnancy_local_uuid': pregnancyLocalUuid,
        'visit_date': visitDate,
        'weight_kg': weightKg,
        'bp_systolic': bpSystolic,
        'bp_diastolic': bpDiastolic,
        'hemoglobin': hemoglobin,
        'fetal_heart_rate': fetalHeartRate,
        'notes': notes,
        'next_visit_date': nextVisitDate,
        'created_at': createdAt,
        'synced_at': syncedAt,
      };

  factory LocalAncFollowup.fromRow(Map<String, Object?> row) => LocalAncFollowup(
        localUuid: row['local_uuid']! as String,
        serverId: row['server_id'] as String?,
        pregnancyLocalUuid: row['pregnancy_local_uuid']! as String,
        visitDate: row['visit_date']! as String,
        weightKg: (row['weight_kg'] as num?)?.toDouble(),
        bpSystolic: row['bp_systolic'] as int?,
        bpDiastolic: row['bp_diastolic'] as int?,
        hemoglobin: (row['hemoglobin'] as num?)?.toDouble(),
        fetalHeartRate: row['fetal_heart_rate'] as int?,
        notes: row['notes'] as String?,
        nextVisitDate: row['next_visit_date'] as String?,
        createdAt: row['created_at']! as String,
        syncedAt: row['synced_at'] as String?,
      );
}

class LocalChildRecord {
  LocalChildRecord({
    required this.localUuid,
    required this.patientLocalUuid,
    this.birthWeightKg,
    this.deliveryType,
    this.birthComplications,
    this.currentWeightKg,
    this.notes,
    required this.createdAt,
    this.syncedAt,
    this.serverId,
  });

  final String localUuid;
  final String? serverId;
  final String patientLocalUuid;
  final double? birthWeightKg;
  final String? deliveryType;
  final String? birthComplications;
  final double? currentWeightKg;
  final String? notes;
  final String createdAt;
  final String? syncedAt;

  Map<String, Object?> toMap() => {
        'local_uuid': localUuid,
        'server_id': serverId,
        'patient_local_uuid': patientLocalUuid,
        'birth_weight_kg': birthWeightKg,
        'delivery_type': deliveryType,
        'birth_complications': birthComplications,
        'current_weight_kg': currentWeightKg,
        'notes': notes,
        'created_at': createdAt,
        'synced_at': syncedAt,
      };

  factory LocalChildRecord.fromRow(Map<String, Object?> row) => LocalChildRecord(
        localUuid: row['local_uuid']! as String,
        serverId: row['server_id'] as String?,
        patientLocalUuid: row['patient_local_uuid']! as String,
        birthWeightKg: (row['birth_weight_kg'] as num?)?.toDouble(),
        deliveryType: row['delivery_type'] as String?,
        birthComplications: row['birth_complications'] as String?,
        currentWeightKg: (row['current_weight_kg'] as num?)?.toDouble(),
        notes: row['notes'] as String?,
        createdAt: row['created_at']! as String,
        syncedAt: row['synced_at'] as String?,
      );
}

class LocalVaccination {
  LocalVaccination({
    required this.localUuid,
    required this.childLocalUuid,
    required this.vaccineName,
    required this.doseNumber,
    this.scheduledDate,
    this.administeredDate,
    this.administeredBy,
    this.notes,
    required this.createdAt,
    this.syncedAt,
    this.serverId,
  });

  final String localUuid;
  final String? serverId;
  final String childLocalUuid;
  final String vaccineName;
  final int doseNumber;
  final String? scheduledDate;
  final String? administeredDate;
  final String? administeredBy;
  final String? notes;
  final String createdAt;
  final String? syncedAt;

  Map<String, Object?> toMap() => {
        'local_uuid': localUuid,
        'server_id': serverId,
        'child_local_uuid': childLocalUuid,
        'vaccine_name': vaccineName,
        'dose_number': doseNumber,
        'scheduled_date': scheduledDate,
        'administered_date': administeredDate,
        'administered_by': administeredBy,
        'notes': notes,
        'created_at': createdAt,
        'synced_at': syncedAt,
      };

  factory LocalVaccination.fromRow(Map<String, Object?> row) => LocalVaccination(
        localUuid: row['local_uuid']! as String,
        serverId: row['server_id'] as String?,
        childLocalUuid: row['child_local_uuid']! as String,
        vaccineName: row['vaccine_name']! as String,
        doseNumber: row['dose_number']! as int,
        scheduledDate: row['scheduled_date'] as String?,
        administeredDate: row['administered_date'] as String?,
        administeredBy: row['administered_by'] as String?,
        notes: row['notes'] as String?,
        createdAt: row['created_at']! as String,
        syncedAt: row['synced_at'] as String?,
      );
}

class LocalElderlyRecord {
  LocalElderlyRecord({
    required this.localUuid,
    required this.patientLocalUuid,
    this.chronicConditions = const [],
    this.medications = const [],
    this.lastReviewDate,
    this.nextReviewDate,
    this.notes,
    required this.createdAt,
    this.syncedAt,
    this.serverId,
  });

  final String localUuid;
  final String? serverId;
  final String patientLocalUuid;
  final List<String> chronicConditions;
  final List<String> medications;
  final String? lastReviewDate;
  final String? nextReviewDate;
  final String? notes;
  final String createdAt;
  final String? syncedAt;

  Map<String, Object?> toMap() => {
        'local_uuid': localUuid,
        'server_id': serverId,
        'patient_local_uuid': patientLocalUuid,
        'chronic_conditions_json': jsonEncode(chronicConditions),
        'medications_json': jsonEncode(medications),
        'last_review_date': lastReviewDate,
        'next_review_date': nextReviewDate,
        'notes': notes,
        'created_at': createdAt,
        'synced_at': syncedAt,
      };

  factory LocalElderlyRecord.fromRow(Map<String, Object?> row) => LocalElderlyRecord(
        localUuid: row['local_uuid']! as String,
        serverId: row['server_id'] as String?,
        patientLocalUuid: row['patient_local_uuid']! as String,
        chronicConditions: _decodeList(row['chronic_conditions_json']),
        medications: _decodeList(row['medications_json']),
        lastReviewDate: row['last_review_date'] as String?,
        nextReviewDate: row['next_review_date'] as String?,
        notes: row['notes'] as String?,
        createdAt: row['created_at']! as String,
        syncedAt: row['synced_at'] as String?,
      );
}

class LocalReferral {
  LocalReferral({
    required this.localUuid,
    required this.patientLocalUuid,
    this.targetFacilityId,
    required this.targetFacilityName,
    this.targetFacilityType,
    required this.priority,
    required this.reason,
    this.status = 'INITIATED',
    required this.createdAt,
    this.syncedAt,
    this.serverId,
  });

  final String localUuid;
  final String? serverId;
  final String patientLocalUuid;
  final String? targetFacilityId;
  final String targetFacilityName;
  final String? targetFacilityType;
  final String priority;
  final String reason;
  final String status;
  final String createdAt;
  final String? syncedAt;

  Map<String, Object?> toMap() => {
        'local_uuid': localUuid,
        'server_id': serverId,
        'patient_local_uuid': patientLocalUuid,
        'target_facility_id': targetFacilityId,
        'target_facility_name': targetFacilityName,
        'target_facility_type': targetFacilityType,
        'priority': priority,
        'reason': reason,
        'status': status,
        'created_at': createdAt,
        'synced_at': syncedAt,
      };

  factory LocalReferral.fromRow(Map<String, Object?> row) => LocalReferral(
        localUuid: row['local_uuid']! as String,
        serverId: row['server_id'] as String?,
        patientLocalUuid: row['patient_local_uuid']! as String,
        targetFacilityId: row['target_facility_id'] as String?,
        targetFacilityName: row['target_facility_name']! as String,
        targetFacilityType: row['target_facility_type'] as String?,
        priority: row['priority']! as String,
        reason: row['reason']! as String,
        status: (row['status'] as String?) ?? 'INITIATED',
        createdAt: row['created_at']! as String,
        syncedAt: row['synced_at'] as String?,
      );
}

class LocalVisit {
  LocalVisit({
    required this.localUuid,
    required this.patientLocalUuid,
    required this.visitType,
    required this.visitedAt,
    this.findings,
    this.nextVisitDate,
    required this.createdAt,
    this.syncedAt,
    this.serverId,
    this.outcome,
    this.riskLevel = 'GREEN',
    this.riskScore = 0,
    this.actorId,
    this.actorRole,
    this.completedAt,
    this.followUpLocalUuid,
    this.referralLocalUuid,
    this.followUpTaskLocalUuid,
    this.escalated = false,
    this.payloadJson,
  });

  final String localUuid;
  final String? serverId;
  final String patientLocalUuid;
  final String visitType;
  final String visitedAt;
  final String? findings;
  final String? nextVisitDate;
  final String createdAt;
  final String? syncedAt;
  final String? outcome;
  final String riskLevel;
  final int riskScore;
  final String? actorId;
  final String? actorRole;
  final String? completedAt;
  final String? followUpLocalUuid;
  final String? referralLocalUuid;
  final String? followUpTaskLocalUuid;
  final bool escalated;
  final String? payloadJson;

  Map<String, Object?> toMap() => {
        'local_uuid': localUuid,
        'server_id': serverId,
        'patient_local_uuid': patientLocalUuid,
        'visit_type': visitType,
        'visited_at': visitedAt,
        'findings': findings,
        'next_visit_date': nextVisitDate,
        'created_at': createdAt,
        'synced_at': syncedAt,
        'outcome': outcome,
        'risk_level': riskLevel,
        'risk_score': riskScore,
        'actor_id': actorId,
        'actor_role': actorRole,
        'completed_at': completedAt,
        'follow_up_local_uuid': followUpLocalUuid,
        'referral_local_uuid': referralLocalUuid,
        'follow_up_task_local_uuid': followUpTaskLocalUuid,
        'escalated': escalated ? 1 : 0,
        'payload_json': payloadJson,
      };

  factory LocalVisit.fromRow(Map<String, Object?> row) => LocalVisit(
        localUuid: row['local_uuid']! as String,
        serverId: row['server_id'] as String?,
        patientLocalUuid: row['patient_local_uuid']! as String,
        visitType: row['visit_type']! as String,
        visitedAt: row['visited_at']! as String,
        findings: row['findings'] as String?,
        nextVisitDate: row['next_visit_date'] as String?,
        createdAt: row['created_at']! as String,
        syncedAt: row['synced_at'] as String?,
        outcome: row['outcome'] as String?,
        riskLevel: (row['risk_level'] as String?) ?? 'GREEN',
        riskScore: (row['risk_score'] as int?) ?? 0,
        actorId: row['actor_id'] as String?,
        actorRole: row['actor_role'] as String?,
        completedAt: row['completed_at'] as String?,
        followUpLocalUuid: row['follow_up_local_uuid'] as String?,
        referralLocalUuid: row['referral_local_uuid'] as String?,
        followUpTaskLocalUuid: row['follow_up_task_local_uuid'] as String?,
        escalated: ((row['escalated'] as int?) ?? 0) == 1,
        payloadJson: row['payload_json'] as String?,
      );
}

class LocalVisitVitals {
  LocalVisitVitals({
    required this.localUuid,
    required this.visitLocalUuid,
    this.temperatureC,
    this.pulseBpm,
    this.respiratoryRate,
    this.systolicBp,
    this.diastolicBp,
    this.spo2,
    this.weightKg,
    required this.recordedAt,
    this.syncedAt,
  });

  final String localUuid;
  final String visitLocalUuid;
  final double? temperatureC;
  final int? pulseBpm;
  final int? respiratoryRate;
  final int? systolicBp;
  final int? diastolicBp;
  final double? spo2;
  final double? weightKg;
  final String recordedAt;
  final String? syncedAt;

  Map<String, Object?> toMap() => {
        'local_uuid': localUuid,
        'visit_local_uuid': visitLocalUuid,
        'temperature_c': temperatureC,
        'pulse_bpm': pulseBpm,
        'respiratory_rate': respiratoryRate,
        'systolic_bp': systolicBp,
        'diastolic_bp': diastolicBp,
        'spo2': spo2,
        'weight_kg': weightKg,
        'recorded_at': recordedAt,
        'synced_at': syncedAt,
      };

  factory LocalVisitVitals.fromRow(Map<String, Object?> row) => LocalVisitVitals(
        localUuid: row['local_uuid']! as String,
        visitLocalUuid: row['visit_local_uuid']! as String,
        temperatureC: (row['temperature_c'] as num?)?.toDouble(),
        pulseBpm: row['pulse_bpm'] as int?,
        respiratoryRate: row['respiratory_rate'] as int?,
        systolicBp: row['systolic_bp'] as int?,
        diastolicBp: row['diastolic_bp'] as int?,
        spo2: (row['spo2'] as num?)?.toDouble(),
        weightKg: (row['weight_kg'] as num?)?.toDouble(),
        recordedAt: row['recorded_at']! as String,
        syncedAt: row['synced_at'] as String?,
      );
}

class LocalVisitSymptom {
  LocalVisitSymptom({
    required this.localUuid,
    required this.visitLocalUuid,
    required this.symptom,
    this.severity = 'MODERATE',
    required this.recordedAt,
    this.syncedAt,
  });

  final String localUuid;
  final String visitLocalUuid;
  final String symptom;
  final String severity;
  final String recordedAt;
  final String? syncedAt;

  Map<String, Object?> toMap() => {
        'local_uuid': localUuid,
        'visit_local_uuid': visitLocalUuid,
        'symptom': symptom,
        'severity': severity,
        'recorded_at': recordedAt,
        'synced_at': syncedAt,
      };

  factory LocalVisitSymptom.fromRow(Map<String, Object?> row) => LocalVisitSymptom(
        localUuid: row['local_uuid']! as String,
        visitLocalUuid: row['visit_local_uuid']! as String,
        symptom: row['symptom']! as String,
        severity: (row['severity'] as String?) ?? 'MODERATE',
        recordedAt: row['recorded_at']! as String,
        syncedAt: row['synced_at'] as String?,
      );
}

class LocalEmergency {
  LocalEmergency({
    required this.localUuid,
    this.patientLocalUuid,
    required this.spokenText,
    required this.language,
    required this.triageStatus,
    this.facilityName,
    this.transportAdvice,
    this.firstAidProtocol,
    required this.createdAt,
    this.syncedAt,
    this.serverId,
  });

  final String localUuid;
  final String? serverId;
  final String? patientLocalUuid;
  final String spokenText;
  final String language;
  final String triageStatus;
  final String? facilityName;
  final String? transportAdvice;
  final String? firstAidProtocol;
  final String createdAt;
  final String? syncedAt;

  Map<String, Object?> toMap() => {
        'local_uuid': localUuid,
        'server_id': serverId,
        'patient_local_uuid': patientLocalUuid,
        'spoken_text': spokenText,
        'language': language,
        'triage_status': triageStatus,
        'facility_name': facilityName,
        'transport_advice': transportAdvice,
        'first_aid_protocol': firstAidProtocol,
        'created_at': createdAt,
        'synced_at': syncedAt,
      };

  factory LocalEmergency.fromRow(Map<String, Object?> row) => LocalEmergency(
        localUuid: row['local_uuid']! as String,
        serverId: row['server_id'] as String?,
        patientLocalUuid: row['patient_local_uuid'] as String?,
        spokenText: row['spoken_text']! as String,
        language: (row['language'] as String?) ?? 'en',
        triageStatus: row['triage_status']! as String,
        facilityName: row['facility_name'] as String?,
        transportAdvice: row['transport_advice'] as String?,
        firstAidProtocol: row['first_aid_protocol'] as String?,
        createdAt: row['created_at']! as String,
        syncedAt: row['synced_at'] as String?,
      );
}

class LocalTask {
  LocalTask({
    required this.localUuid,
    this.patientLocalUuid,
    required this.title,
    this.description,
    this.dueDate,
    this.status = 'PENDING',
    required this.createdAt,
    this.syncedAt,
    this.serverId,
  });

  final String localUuid;
  final String? serverId;
  final String? patientLocalUuid;
  final String title;
  final String? description;
  final String? dueDate;
  final String status;
  final String createdAt;
  final String? syncedAt;

  Map<String, Object?> toMap() => {
        'local_uuid': localUuid,
        'server_id': serverId,
        'patient_local_uuid': patientLocalUuid,
        'title': title,
        'description': description,
        'due_date': dueDate,
        'status': status,
        'created_at': createdAt,
        'synced_at': syncedAt,
      };

  factory LocalTask.fromRow(Map<String, Object?> row) => LocalTask(
        localUuid: row['local_uuid']! as String,
        serverId: row['server_id'] as String?,
        patientLocalUuid: row['patient_local_uuid'] as String?,
        title: row['title']! as String,
        description: row['description'] as String?,
        dueDate: row['due_date'] as String?,
        status: (row['status'] as String?) ?? 'PENDING',
        createdAt: row['created_at']! as String,
        syncedAt: row['synced_at'] as String?,
      );
}

class SyncQueueItem {
  SyncQueueItem({
    required this.id,
    required this.operationId,
    required this.entityType,
    required this.entityLocalUuid,
    required this.operation,
    required this.payloadJson,
    required this.attempts,
    required this.createdAt,
    this.lastError,
    this.lastAttemptAt,
    this.nextAttemptAt,
    this.status = 'PENDING',
  });

  final int id;
  final String operationId;
  final String entityType;
  final String entityLocalUuid;
  final String operation;
  final String payloadJson;
  final int attempts;
  final String? lastError;
  final String? lastAttemptAt;
  final String? nextAttemptAt;
  final String createdAt;
  final String status;

  factory SyncQueueItem.fromRow(Map<String, Object?> row) => SyncQueueItem(
        id: row['id']! as int,
        operationId: row['operation_id']! as String,
        entityType: row['entity_type']! as String,
        entityLocalUuid: row['entity_local_uuid']! as String,
        operation: row['operation']! as String,
        payloadJson: row['payload_json']! as String,
        attempts: (row['attempts'] as int?) ?? 0,
        lastError: row['last_error'] as String?,
        lastAttemptAt: row['last_attempt_at'] as String?,
        nextAttemptAt: row['next_attempt_at'] as String?,
        createdAt: row['created_at']! as String,
        status: (row['status'] as String?) ?? 'PENDING',
      );
}

List<String> _decodeList(dynamic raw) {
  if (raw is String && raw.isNotEmpty) {
    final decoded = jsonDecode(raw);
    if (decoded is List) {
      return decoded.map((e) => e.toString()).toList();
    }
  }
  return const [];
}

Map<String, dynamic> _decodeMap(dynamic raw) {
  if (raw is String && raw.isNotEmpty) {
    final decoded = jsonDecode(raw);
    if (decoded is Map) {
      return decoded.map((key, value) => MapEntry(key.toString(), value));
    }
  }
  return <String, dynamic>{};
}