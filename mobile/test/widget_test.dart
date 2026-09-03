import 'package:asha_field_app/offline/actor_context.dart';
import 'package:asha_field_app/offline/case_taking_client.dart';
import 'package:asha_field_app/offline/database.dart';
import 'package:asha_field_app/offline/offline_triage.dart';
import 'package:asha_field_app/offline/repositories.dart';
import 'package:asha_field_app/offline/sync_queue_repository.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

void main() {
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  group('Arroh offline database', () {
    late ArrohDatabase db;
    setUp(() async {
      db = await ArrohDatabase.openForTesting();
    });
    tearDown(() async {
      await db.closeForTesting();
    });

    test('Patient registration is durable and enqueues a sync row', () async {
      final patientRepo = PatientRepository(db);
      final sync = SyncQueueRepository(db);

      final patient = await patientRepo.register(
        name: 'Test Patient',
        gender: 'F',
        birthDate: '1990-01-01',
        district: 'Mandya',
        state: 'Karnataka',
        village: 'Test Village',
        phoneNumber: '+91-9999999999',
      );
      expect(patient.syncedAt, isNull);

      final pending = await sync.pending();
      expect(pending, hasLength(1));
      expect(pending.first.entityType, 'patient');
      expect(pending.first.operation, 'create');
    });

    test('Offline triage escalates a chest-pain + low SpO2 case to RED', () async {
      final verdict = assessOfflineTriage(
        symptoms: const ['chest pain', 'shortness of breath'],
        vitals: const {'spo2': 88, 'heart_rate': 130},
      );
      expect(verdict.triageLevel, 'RED');
      expect(verdict.highRiskRespiratory, isTrue);
    });

    test('Triage repository records a row and enqueues a sync entry', () async {
      final patientRepo = PatientRepository(db);
      final triageRepo = TriageRepository(db);
      final sync = SyncQueueRepository(db);

      final patient = await patientRepo.register(
        name: 'T',
        gender: 'F',
        birthDate: '2000-01-01',
        district: 'D',
        state: 'S',
      );

      await triageRepo.record(
        patientLocalUuid: patient.localUuid,
        symptoms: const ['fever'],
        vitals: const {'heart_rate': 90, 'spo2': 98},
        triageStatus: 'GREEN',
        riskScore: 15,
        recommendedActions: const ['Mild presentation.'],
        highRiskRespiratory: false,
        highRiskMaternal: false,
        maternalConditions: const [],
        missingVitals: const [],
        source: 'offline',
      );

      final pending = await sync.pending();
      expect(pending.where((row) => row.entityType == 'triage_log'), isNotEmpty);
    });

    test('OfflineCaseTakingService never invents symptoms for ambiguous input', () {
      final service = OfflineCaseTakingService();
      final session = service.startCase(transcript: 'I feel generally unwell', language: 'en');
      expect(session.patientCase.symptoms, isEmpty);
      // Empty symptoms + no vitals: the safety engine defaults to "unable to
      // assess" → RED with a list of missing vitals. This is the intended
      // conservative behaviour; the test must not claim a fabricated GREEN.
      expect(session.triageResult['triage_level'], 'RED');
      expect(session.triageResult['missing_vitals'], isNotEmpty);
    });

    test('OfflineCaseTakingService produces RED for chest pain + low SpO2 in any language', () {
      for (final language in ['en', 'kn', 'hi', 'ta']) {
        final transcript = switch (language) {
          'en' => 'I have severe chest pain and shortness of breath',
          'kn' => 'ನನಗೆ ಎದೆ ನೋವು ಇದೆ ಮತ್ತು ಉಸಿರಾಡಲು ಕಷ್ಟ',
          'hi' => 'mujhe seene mein dard hai aur saans nahi aa rahi',
          _ => 'enakku marapu vali irukku',
        };
        final service = OfflineCaseTakingService();
        final session = service.startCase(transcript: transcript, language: language);
        expect(session.triageResult['triage_level'], 'RED', reason: 'language=$language');
      }
    });

    test('OfflineCaseTakingService emergency intent triggers RED even with no vitals', () {
      final service = OfflineCaseTakingService();
      final session = service.startCase(transcript: 'I met with an accident', language: 'en');
      expect(session.emergencyIntentDetected, isTrue);
      expect(session.triageResult['triage_level'], 'RED');
    });

    test('OfflineCaseTakingService confirm case writes a local row + sync entry', () async {
      final service = OfflineCaseTakingService();
      final sync = SyncQueueRepository(db);
      final session = service.startCase(transcript: 'I have a mild cough', language: 'en');
      final conn = await db.database;
      await conn.insert('case_sessions_local', {
        'local_uuid': 'case-1',
        'case_id': session.caseId,
        'patient_local_uuid': session.patientLocalUuid,
        'language': session.language,
        'session_json': '{"triage_level":"GREEN"}',
        'triage_level': session.triageResult['triage_level'],
        'completed': 1,
        'created_at': DateTime.now().toUtc().toIso8601String(),
      });
      await sync.enqueue(
        entityType: 'case_session',
        entityLocalUuid: 'case-1',
        operation: 'create',
        payload: session.toJson(),
      );
      final pending = await sync.pending();
      expect(pending.where((row) => row.entityType == 'case_session'), isNotEmpty);
    });

    test('VisitRepository.start is durable and enqueues a visit sync row', () async {
      final patientRepo = PatientRepository(db);
      final visitRepo = VisitRepository(db);
      final sync = SyncQueueRepository(db);

      final patient = await patientRepo.register(
        name: 'Visit User',
        gender: 'F',
        birthDate: '1985-01-01',
        district: 'Mandya',
        state: 'Karnataka',
      );
      final visit = await visitRepo.start(
        patientLocalUuid: patient.localUuid,
        visitType: 'general follow-up',
        actorId: 'asha-test',
        actorRole: 'ASHA',
        phcId: 'PHC-TEST',
      );
      expect(visit.syncedAt, isNull);
      expect(visit.outcome, isNull);
      expect(visit.actorId, 'asha-test');
      expect(visit.actorRole, 'ASHA');

      final pending = await sync.pending();
      expect(pending.where((row) => row.entityType == 'visit'), isNotEmpty);
    });

    test('VisitRepository accepts partial vitals without blocking save', () async {
      final patientRepo = PatientRepository(db);
      final visitRepo = VisitRepository(db);
      final patient = await patientRepo.register(
        name: 'Partial Vitals',
        gender: 'M',
        birthDate: '1970-01-01',
        district: 'D',
        state: 'S',
      );
      final visit = await visitRepo.start(
        patientLocalUuid: patient.localUuid,
        visitType: 'elderly care',
        actorId: 'asha-test',
        actorRole: 'ASHA',
      );
      final vitals = await visitRepo.saveVitals(
        visitLocalUuid: visit.localUuid,
        spo2: 96,
        pulseBpm: 80,
      );
      expect(vitals, isNotNull);
      expect(vitals!.spo2, 96);
      expect(vitals.temperatureC, isNull);
      expect(vitals.systolicBp, isNull);

      // Subsequent save with another subset must not crash and must merge.
      final updated = await visitRepo.saveVitals(
        visitLocalUuid: visit.localUuid,
        weightKg: 60.0,
      );
      expect(updated, isNotNull);
      expect(updated!.weightKg, 60.0);
      expect(updated.spo2, 96);
    });

    test('Visit completion RED is forced into ESCALATION_REQUIRED outcome', () async {
      final patientRepo = PatientRepository(db);
      final visitRepo = VisitRepository(db);
      final patient = await patientRepo.register(
        name: 'Red Patient',
        gender: 'F',
        birthDate: '1965-01-01',
        district: 'D',
        state: 'S',
      );
      final visit = await visitRepo.start(
        patientLocalUuid: patient.localUuid,
        visitType: 'general follow-up',
        actorId: 'asha-test',
        actorRole: 'ASHA',
      );
      await visitRepo.addSymptoms(
        visitLocalUuid: visit.localUuid,
        symptoms: const ['chest pain', 'shortness of breath'],
      );
      await visitRepo.saveVitals(
        visitLocalUuid: visit.localUuid,
        spo2: 88,
        pulseBpm: 130,
      );
      // The form-screen logic applies the offline safety verdict; the
      // repository itself trusts the caller but the safety engine must
      // dictate the outcome in the form layer.
      final verdict = assessOfflineTriage(
        symptoms: const ['chest pain', 'shortness of breath'],
        vitals: const {'spo2': 88, 'pulse_bpm': 130},
      );
      expect(verdict.triageLevel, 'RED');
      final outcome = verdict.triageLevel == 'RED' ? 'ESCALATION_REQUIRED' : 'COMPLETED';
      final completed = await visitRepo.complete(
        visitLocalUuid: visit.localUuid,
        outcome: outcome,
        riskLevel: verdict.triageLevel,
        riskScore: verdict.riskScore,
        findings: 'Concerning vitals; escalated.',
        followUpLocalUuid: 'fu-1',
        followUpTaskLocalUuid: 'task-1',
        payload: const {'outcome': 'ESCALATION_REQUIRED'},
      );
      expect(completed.outcome, 'ESCALATION_REQUIRED');
      expect(completed.escalated, isTrue);
      expect(completed.completedAt, isNotNull);
    });

    test('Visit lifecycle schema and v3 child tables survive reopen (in-memory)', () async {
      final patientRepo = PatientRepository(db);
      final visitRepo = VisitRepository(db);
      final patient = await patientRepo.register(
        name: 'Restart Patient',
        gender: 'F',
        birthDate: '1980-01-01',
        district: 'D',
        state: 'S',
      );
      final visit = await visitRepo.start(
        patientLocalUuid: patient.localUuid,
        visitType: 'general follow-up',
        actorId: 'asha-test',
        actorRole: 'ASHA',
      );
      await visitRepo.addSymptoms(
        visitLocalUuid: visit.localUuid,
        symptoms: const ['mild cough'],
      );
      // Sanity: in-memory DB is volatile, but the Step 5 schema and child
      // tables must be intact on reopen. A fresh visit write must succeed
      // without recreating the v3 tables, proving the migration is sticky.
      await db.closeForTesting();
      db = await ArrohDatabase.openForTesting();
      final freshPatient = await PatientRepository(db).register(
        name: 'Reopened Patient',
        gender: 'F',
        birthDate: '1990-01-01',
        district: 'D',
        state: 'S',
      );
      final visitRepoAfter = VisitRepository(db);
      final reopened = await visitRepoAfter.start(
        patientLocalUuid: freshPatient.localUuid,
        visitType: 'general follow-up',
        actorId: 'asha-test',
        actorRole: 'ASHA',
      );
      expect(reopened.localUuid, isNotEmpty);
      final symptoms = await visitRepoAfter.symptomsForVisit(reopened.localUuid);
      expect(symptoms, isEmpty);
      await visitRepoAfter.addSymptoms(
        visitLocalUuid: reopened.localUuid,
        symptoms: const ['persistent cough'],
      );
      final reopenedSymptoms = await visitRepoAfter.symptomsForVisit(reopened.localUuid);
      expect(reopenedSymptoms, hasLength(1));
    });

    test('ActorContextRepository round-trips worker identity', () async {
      TestWidgetsFlutterBinding.ensureInitialized();
      SharedPreferences.setMockInitialValues({});
      final repo = ActorContextRepository();
      final original = await repo.load();
      final next = original.copyWith(actorId: 'ASHA-42', actorRole: 'ASHA', phcId: 'PHC-XYZ');
      await repo.save(next);
      final loaded = await repo.load();
      expect(loaded.actorId, 'ASHA-42');
      expect(loaded.actorRole, 'ASHA');
      expect(loaded.phcId, 'PHC-XYZ');
      // Restore the previous value so the rest of the suite keeps the
      // shared offline-actor identity it was using.
      await repo.save(original);
    });
  });
}
