/// ARROH offline-first local SQLite database.
///
/// The mobile database is the **primary source of truth** for ASHA field
/// workflows. The FastAPI backend is the durable system of record; this
/// database is the offline-first mirror that survives app restarts and
/// connectivity loss. Schema covers:
///
///   * patients              — demographics
///   * triage_logs            — symptom + vital assessments
///   * follow_ups            — ANC / child / elderly / chronic / post-discharge
///   * pregnancy_records      — pregnancy / ANC visits
///   * child_records          — children with vaccination history
///   * vaccination_records    — per-vaccine dose tracking
///   * elderly_records        — chronic-condition follow-up
///   * referrals              — facility referrals
///   * visits                 — home-visit log
///   * emergencies            — emergency reports
///   * tasks                  — follow-up tasks
///   * sync_queue             — durable outbox for offline mutations
///
/// Schema is intentionally narrow: each row carries `local_uuid` (stable
/// idempotency key), `updated_at` (local clock), `synced_at` (nullable; the
/// moment the server acknowledged the row), and `server_id` (the canonical
/// backend UUID, set on first successful sync).
library;

import 'dart:async';

import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

class ArrohDatabase {
  ArrohDatabase._();
  static final ArrohDatabase instance = ArrohDatabase._();

  Database? _db;
  Future<Database>? _opening;

  Future<Database> get database async {
    if (_db != null) return _db!;
    return _opening ??= _open();
  }

  Future<Database> _open() async {
    final dbPath = await getDatabasesPath();
    final path = p.join(dbPath, 'arroh_field.db');
    final database = await openDatabase(
      path,
      version: 5,
      onCreate: (db, version) async {
        final batch = db.batch();
        for (final statement in _schema) {
          batch.execute(statement);
        }
        for (final statement in _schemaV2) {
          batch.execute(statement);
        }
        for (final statement in _schemaV3) {
          batch.execute(statement);
        }
        await batch.commit(noResult: true);
      },
      onUpgrade: (db, oldVersion, newVersion) async {
        if (oldVersion < 2) {
          final batch = db.batch();
          for (final statement in _schemaV2) {
            batch.execute(statement);
          }
          await batch.commit(noResult: true);
        }
        if (oldVersion < 3) {
          await db.execute("ALTER TABLE follow_ups ADD COLUMN status TEXT NOT NULL DEFAULT 'SCHEDULED'");
          await db.execute("ALTER TABLE follow_ups ADD COLUMN priority TEXT NOT NULL DEFAULT 'ROUTINE'");
          await db.execute("ALTER TABLE follow_ups ADD COLUMN high_risk INTEGER NOT NULL DEFAULT 0");
        }
        if (oldVersion < 4) {
          final batch = db.batch();
          for (final statement in _schemaV3) {
            batch.execute(statement);
          }
          await batch.commit(noResult: true);
          // The Step 5 visit lifecycle adds columns to the existing
          // ``visits`` table. ``ALTER TABLE ADD COLUMN`` is idempotent on
          // SQLite only when the column is missing, so guard each step.
          await _addColumnIfMissing(db, 'visits', 'outcome', "TEXT");
          await _addColumnIfMissing(db, 'visits', 'risk_level', "TEXT NOT NULL DEFAULT 'GREEN'");
          await _addColumnIfMissing(db, 'visits', 'risk_score', "INTEGER NOT NULL DEFAULT 0");
          await _addColumnIfMissing(db, 'visits', 'actor_id', "TEXT");
          await _addColumnIfMissing(db, 'visits', 'actor_role', "TEXT");
          await _addColumnIfMissing(db, 'visits', 'findings', "TEXT");
          await _addColumnIfMissing(db, 'visits', 'completed_at', "TEXT");
          await _addColumnIfMissing(db, 'visits', 'next_visit_date', "TEXT");
          await _addColumnIfMissing(db, 'visits', 'follow_up_local_uuid', "TEXT");
          await _addColumnIfMissing(db, 'visits', 'referral_local_uuid', "TEXT");
          await _addColumnIfMissing(db, 'visits', 'follow_up_task_local_uuid', "TEXT");
          await _addColumnIfMissing(db, 'visits', 'escalated', "INTEGER NOT NULL DEFAULT 0");
          await _addColumnIfMissing(db, 'visits', 'payload_json', "TEXT");
        }
        if (oldVersion < 5) {
          for (final statement in _schemaV4) {
            await db.execute(statement);
          }
        }
      },
    );
    _db = database;
    _opening = null;
    return database;
  }

  Future<void> close() async {
    await _db?.close();
    _db = null;
  }

  /// Open a separate, in-memory database with the same schema. Used by
  /// automated tests so each test gets a clean slate without touching the
  /// device's on-disk file.
  static Future<ArrohDatabase> openForTesting() async {
    final database = await openDatabase(
      inMemoryDatabasePath,
      version: 5,
      onCreate: (db, version) async {
        final batch = db.batch();
        for (final statement in _schema) {
          batch.execute(statement);
        }
        for (final statement in _schemaV2) {
          batch.execute(statement);
        }
        for (final statement in _schemaV3) {
          batch.execute(statement);
        }
        for (final statement in _schemaV4) {
          batch.execute(statement);
        }
        await batch.commit(noResult: true);
        // v1 schema now carries the Step 5 columns on a fresh install;
        // v3 schema contributes the new child tables. The legacy ALTER
        // TABLE statements below remain for any test fixtures that build
        // a custom schema, so guard each step.
        await _addColumnIfMissing(db, 'follow_ups', 'status', "TEXT NOT NULL DEFAULT 'SCHEDULED'");
        await _addColumnIfMissing(db, 'follow_ups', 'priority', "TEXT NOT NULL DEFAULT 'ROUTINE'");
        await _addColumnIfMissing(db, 'follow_ups', 'high_risk', "INTEGER NOT NULL DEFAULT 0");
      },
    );
    final wrapper = ArrohDatabase._();
    wrapper._db = database;
    return wrapper;
  }

  Future<void> closeForTesting() async {
    await _db?.close();
    _db = null;
  }

  /// The full schema. All statements are idempotent per version.
  static const List<String> _schema = [
    '''
    CREATE TABLE patients (
      local_uuid TEXT PRIMARY KEY,
      server_id TEXT,
      name TEXT NOT NULL,
      gender TEXT NOT NULL,
      birth_date TEXT NOT NULL,
      abha_id TEXT,
      abha_address TEXT,
      phone_number TEXT,
      village TEXT,
      district TEXT NOT NULL,
      state TEXT NOT NULL,
      phc_id TEXT,
      triage_status TEXT NOT NULL DEFAULT 'GREEN',
      is_pregnant INTEGER NOT NULL DEFAULT 0,
      is_elderly INTEGER NOT NULL DEFAULT 0,
      is_child INTEGER NOT NULL DEFAULT 0,
      chronic_conditions TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      synced_at TEXT
    )
    ''',
    '''
    CREATE TABLE triage_logs (
      local_uuid TEXT PRIMARY KEY,
      server_id TEXT,
      patient_local_uuid TEXT NOT NULL,
      symptoms_json TEXT NOT NULL,
      vitals_json TEXT NOT NULL,
      transcript TEXT,
      triage_status TEXT NOT NULL,
      risk_score INTEGER NOT NULL,
      recommended_actions_json TEXT NOT NULL,
      high_risk_respiratory INTEGER NOT NULL DEFAULT 0,
      high_risk_maternal INTEGER NOT NULL DEFAULT 0,
      maternal_conditions_json TEXT,
      missing_vitals_json TEXT,
      source TEXT NOT NULL DEFAULT 'offline',
      created_at TEXT NOT NULL,
      synced_at TEXT,
      FOREIGN KEY (patient_local_uuid) REFERENCES patients(local_uuid) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE pregnancy_records (
      local_uuid TEXT PRIMARY KEY,
      server_id TEXT,
      patient_local_uuid TEXT NOT NULL,
      lmp_date TEXT,
      edd_date TEXT,
      gravida INTEGER,
      para INTEGER,
      current_week INTEGER,
      risk_level TEXT NOT NULL DEFAULT 'GREEN',
      notes TEXT,
      created_at TEXT NOT NULL,
      synced_at TEXT,
      FOREIGN KEY (patient_local_uuid) REFERENCES patients(local_uuid) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE anc_followups (
      local_uuid TEXT PRIMARY KEY,
      server_id TEXT,
      pregnancy_local_uuid TEXT NOT NULL,
      visit_date TEXT NOT NULL,
      weight_kg REAL,
      bp_systolic INTEGER,
      bp_diastolic INTEGER,
      hemoglobin REAL,
      fetal_heart_rate INTEGER,
      notes TEXT,
      next_visit_date TEXT,
      created_at TEXT NOT NULL,
      synced_at TEXT,
      FOREIGN KEY (pregnancy_local_uuid) REFERENCES pregnancy_records(local_uuid) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE child_records (
      local_uuid TEXT PRIMARY KEY,
      server_id TEXT,
      patient_local_uuid TEXT NOT NULL,
      birth_weight_kg REAL,
      delivery_type TEXT,
      birth_complications TEXT,
      current_weight_kg REAL,
      notes TEXT,
      created_at TEXT NOT NULL,
      synced_at TEXT,
      FOREIGN KEY (patient_local_uuid) REFERENCES patients(local_uuid) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE vaccination_records (
      local_uuid TEXT PRIMARY KEY,
      server_id TEXT,
      child_local_uuid TEXT NOT NULL,
      vaccine_name TEXT NOT NULL,
      dose_number INTEGER NOT NULL,
      scheduled_date TEXT,
      administered_date TEXT,
      administered_by TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      synced_at TEXT,
      FOREIGN KEY (child_local_uuid) REFERENCES child_records(local_uuid) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE elderly_records (
      local_uuid TEXT PRIMARY KEY,
      server_id TEXT,
      patient_local_uuid TEXT NOT NULL,
      chronic_conditions_json TEXT,
      medications_json TEXT,
      last_review_date TEXT,
      next_review_date TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      synced_at TEXT,
      FOREIGN KEY (patient_local_uuid) REFERENCES patients(local_uuid) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE referrals (
      local_uuid TEXT PRIMARY KEY,
      server_id TEXT,
      patient_local_uuid TEXT NOT NULL,
      target_facility_id TEXT,
      target_facility_name TEXT NOT NULL,
      target_facility_type TEXT,
      priority TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'INITIATED',
      created_at TEXT NOT NULL,
      synced_at TEXT,
      FOREIGN KEY (patient_local_uuid) REFERENCES patients(local_uuid) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE follow_ups (
      local_uuid TEXT PRIMARY KEY,
      server_id TEXT,
      patient_local_uuid TEXT NOT NULL,
      follow_up_type TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      completed_at TEXT,
      outcome TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      synced_at TEXT,
      FOREIGN KEY (patient_local_uuid) REFERENCES patients(local_uuid) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE visits (
      local_uuid TEXT PRIMARY KEY,
      server_id TEXT,
      patient_local_uuid TEXT NOT NULL,
      visit_type TEXT NOT NULL,
      visited_at TEXT NOT NULL,
      findings TEXT,
      next_visit_date TEXT,
      created_at TEXT NOT NULL,
      synced_at TEXT,
      outcome TEXT,
      risk_level TEXT NOT NULL DEFAULT 'GREEN',
      risk_score INTEGER NOT NULL DEFAULT 0,
      actor_id TEXT,
      actor_role TEXT,
      completed_at TEXT,
      follow_up_local_uuid TEXT,
      referral_local_uuid TEXT,
      follow_up_task_local_uuid TEXT,
      escalated INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT,
      FOREIGN KEY (patient_local_uuid) REFERENCES patients(local_uuid) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE emergencies (
      local_uuid TEXT PRIMARY KEY,
      server_id TEXT,
      patient_local_uuid TEXT,
      spoken_text TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'en',
      triage_status TEXT NOT NULL,
      facility_name TEXT,
      transport_advice TEXT,
      first_aid_protocol TEXT,
      created_at TEXT NOT NULL,
      synced_at TEXT
    )
    ''',
    '''
    CREATE TABLE tasks (
      local_uuid TEXT PRIMARY KEY,
      server_id TEXT,
      patient_local_uuid TEXT,
      title TEXT NOT NULL,
      description TEXT,
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL,
      synced_at TEXT
    )
    ''',
    '''
    CREATE TABLE sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_id TEXT NOT NULL UNIQUE,
      entity_type TEXT NOT NULL,
      entity_local_uuid TEXT NOT NULL,
      operation TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      last_attempt_at TEXT,
      created_at TEXT NOT NULL,
      next_attempt_at TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING'
    )
    ''',
    'CREATE INDEX idx_sync_queue_status ON sync_queue(status, next_attempt_at)',
    'CREATE INDEX idx_patients_phc ON patients(phc_id)',
    'CREATE INDEX idx_triage_patient ON triage_logs(patient_local_uuid)',
    'CREATE INDEX idx_followups_patient ON follow_ups(patient_local_uuid)',
  ];

  /// Schema additions introduced in version 2 of the database. Existing
  /// installations are migrated via ``onUpgrade``. The case_sessions_local
  /// table mirrors the backend's ``case_sessions`` table for offline-first
  /// case-taking sessions created on the field app.
  static const List<String> _schemaV2 = [
    '''
    CREATE TABLE case_sessions_local (
      local_uuid TEXT PRIMARY KEY,
      case_id TEXT NOT NULL UNIQUE,
      patient_local_uuid TEXT,
      language TEXT NOT NULL DEFAULT 'unknown',
      session_json TEXT NOT NULL,
      triage_level TEXT,
      completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      synced_at TEXT
    )
    ''',
    'CREATE INDEX idx_case_sessions_patient ON case_sessions_local(patient_local_uuid)',
    'CREATE INDEX idx_case_sessions_completed ON case_sessions_local(completed)',
  ];

  /// Schema additions introduced in version 4 of the database. Step 5
  /// (ASHA/ANM home-visit lifecycle) introduces per-visit vitals and
  /// symptoms. The visit envelope is kept in the existing ``visits``
  /// table, which is extended via ``ALTER TABLE`` migrations in
  /// ``onUpgrade`` to preserve the on-disk data of existing installations.
  static const List<String> _schemaV3 = [
    '''
    CREATE TABLE local_visit_vitals (
      local_uuid TEXT PRIMARY KEY,
      visit_local_uuid TEXT NOT NULL,
      temperature_c REAL,
      pulse_bpm INTEGER,
      respiratory_rate INTEGER,
      systolic_bp INTEGER,
      diastolic_bp INTEGER,
      spo2 REAL,
      weight_kg REAL,
      recorded_at TEXT NOT NULL,
      synced_at TEXT,
      FOREIGN KEY (visit_local_uuid) REFERENCES visits(local_uuid) ON DELETE CASCADE
    )
    ''',
    '''
    CREATE TABLE local_visit_symptoms (
      local_uuid TEXT PRIMARY KEY,
      visit_local_uuid TEXT NOT NULL,
      symptom TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'MODERATE',
      recorded_at TEXT NOT NULL,
      synced_at TEXT,
      FOREIGN KEY (visit_local_uuid) REFERENCES visits(local_uuid) ON DELETE CASCADE
    )
    ''',
    'CREATE INDEX idx_local_visit_vitals_visit ON local_visit_vitals(visit_local_uuid)',
    'CREATE INDEX idx_local_visit_symptoms_visit ON local_visit_symptoms(visit_local_uuid)',
  ];

  static const List<String> _schemaV4 = [
    '''
    CREATE TABLE consultation_drafts (
      local_uuid TEXT PRIMARY KEY,
      patient_local_uuid TEXT,
      session_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      synced_at TEXT
    )
    ''',
    '''
    CREATE TABLE consultation_dependents (
      local_uuid TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      consultation_local_uuid TEXT,
      investigation_local_uuid TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
    ''',
    '''
    CREATE TABLE clinical_server_ids (
      entity_type TEXT NOT NULL,
      local_uuid TEXT NOT NULL,
      server_id TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      PRIMARY KEY (entity_type, local_uuid)
    )
    ''',
    'CREATE INDEX idx_consultation_dependents_consultation ON consultation_dependents(consultation_local_uuid)',
    'CREATE INDEX idx_consultation_dependents_investigation ON consultation_dependents(investigation_local_uuid)',
  ];
}

Future<void> _addColumnIfMissing(Database db, String table, String column, String type) async {
  final result = await db.rawQuery('PRAGMA table_info($table)');
  final existing = result.map((row) => row['name']).toSet();
  if (existing.contains(column)) return;
  await db.execute('ALTER TABLE $table ADD COLUMN $column $type');
}