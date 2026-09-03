/// Central application state container.
///
/// Routes read + write through this object so the UI never blocks on the
/// backend. The local SQLite database is the source of truth; the FastAPI
/// backend is the durable system of record and is reached via the
/// `SyncEngine`.

import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'actor_context.dart';
import 'connectivity_monitor.dart';
import 'database.dart';
import 'repositories.dart';
import 'sync_engine.dart';
import 'sync_queue_repository.dart';

class AppState {
  AppState({
    required this.database,
    required this.connectivity,
    required this.syncEngine,
    required this.patientRepository,
    required this.triageRepository,
    required this.followUpRepository,
    required this.pregnancyRepository,
    required this.childRepository,
    required this.emergencyRepository,
    required this.visitRepository,
    required this.syncQueueRepository,
    required this.consultationDraftRepository,
    required this.actor,
  });

  final ArrohDatabase database;
  final ConnectivityMonitor connectivity;
  final SyncEngine syncEngine;

  final PatientRepository patientRepository;
  final TriageRepository triageRepository;
  final FollowUpRepository followUpRepository;
  final PregnancyRepository pregnancyRepository;
  final ChildRepository childRepository;
  final EmergencyRepository emergencyRepository;
  final VisitRepository visitRepository;
  final SyncQueueRepository syncQueueRepository;
  final ConsultationDraftRepository consultationDraftRepository;

  /// The currently signed-in field worker. Step 5 uses this value as
  /// ``actor_id`` and ``actor_role`` on every visit and follow-up write.
  /// The mobile app keeps this in shared preferences; the backend treats
  /// the headers + the embedded payload as the authoritative identity.
  ActorContext actor;

  Stream<SyncReport> get syncReports => syncEngine.reports;

  String? _cachedLanguage;
  String? get preferredLanguage {
    final cached = _cachedLanguage;
    if (cached != null) return cached;
    return null;
  }

  Future<String> loadPreferredLanguage() async {
    final prefs = await SharedPreferences.getInstance();
    final lang = prefs.getString('arroh_language') ?? 'en';
    _cachedLanguage = lang;
    return lang;
  }

  Future<void> updateActor(ActorContext next) async {
    await ActorContextRepository().save(next);
    actor = next;
  }
}

Future<AppState> buildAppState({
  required String backendBaseUrl,
  http.Client? httpClient,
}) async {
  final database = ArrohDatabase.instance;
  // Eagerly open so the very first screen does not block on disk I/O.
  await database.database;

  final client = httpClient ?? http.Client();
  final connectivity = ConnectivityMonitor(
    probe: () async {
      try {
        final result = await Connectivity().checkConnectivity();
        if (result.contains(ConnectivityResult.none)) return false;
        final response = await client
            .get(Uri.parse('$backendBaseUrl/health'))
            .timeout(const Duration(seconds: 3));
        return response.statusCode == 200;
      } catch (_) {
        return false;
      }
    },
  );
  await connectivity.start();

  final engine = SyncEngine(
    database: database,
    baseUrl: backendBaseUrl,
    httpClient: client,
  );

  final actor = await ActorContextRepository().load();

  return AppState(
    database: database,
    connectivity: connectivity,
    syncEngine: engine,
    patientRepository: PatientRepository(database),
    triageRepository: TriageRepository(database),
    followUpRepository: FollowUpRepository(database),
    pregnancyRepository: PregnancyRepository(database),
    childRepository: ChildRepository(database),
    emergencyRepository: EmergencyRepository(database),
    visitRepository: VisitRepository(database),
    syncQueueRepository: SyncQueueRepository(database),
    consultationDraftRepository: ConsultationDraftRepository(database),
    actor: actor,
  );
}