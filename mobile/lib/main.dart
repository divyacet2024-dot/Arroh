// ARROH Care — ASHA Mobile Field App
//
// Offline-first rural healthcare field worker application.
// Local SQLite database is the primary source of truth; FastAPI backend is
// the durable system of record reached via the durable sync queue.
//
// Communication modes:
//   * Deaf / Sign      -> bold visual action captions + interpreter request
//   * Tap / Speech     -> icon AAC grid that builds the payload without typing
//   * Voice-First      -> standard voice intake (default)
//   * Low Literacy     -> a short read-aloud script
//
// Offline workflows:
//   * Patient registration          -> saved locally, queued for sync
//   * Triage                        -> deterministic offline engine
//   * Follow-ups (ANC / post-discharge / chronic)
//   * Pregnancy / ANC visits
//   * Child + vaccination records
//   * Emergency reports
//   * ISL quick phrases (Phase 17 priority 1)

import 'dart:async';

import 'package:flutter/material.dart';

import 'offline/app_state.dart';
import 'offline/connectivity_monitor.dart';
import 'offline/models.dart';
import 'offline/sync_engine.dart';
import 'screens/asha_home_screen.dart';
import 'screens/case_taking_screen.dart';
import 'screens/consultation_form_screen.dart';
import 'screens/consultation_summary_screen.dart';
import 'screens/diagnostic_screen.dart';
import 'screens/discharge_plan_screen.dart';
import 'screens/doctor_home_screen.dart';
import 'screens/follow_up_screen.dart';
import 'screens/isl_screen.dart';
import 'screens/low_literacy_screen.dart';
import 'screens/patient_register_screen.dart';
import 'screens/patients_screen.dart';
import 'screens/prescription_screen.dart';
import 'screens/settings_screen.dart';
import 'screens/sync_screen.dart';
import 'screens/triage_screen.dart';
import 'screens/visit_workflow_screens.dart';

const String kApiBaseUrl = 'http://127.0.0.1:8000/api/v1';
const String kBackendRootUrl = 'http://127.0.0.1:8000';

const String kCommsModePrefKey = 'arroh_comms_mode';
const String kLanguagePrefKey = 'arroh_language';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final state = await buildAppState(backendBaseUrl: kBackendRootUrl);
  runApp(ArrohFieldApp(state: state));
}

class ArrohFieldApp extends StatefulWidget {
  const ArrohFieldApp({super.key, required this.state});

  final AppState state;

  @override
  State<ArrohFieldApp> createState() => _ArrohFieldAppState();
}

class _ArrohFieldAppState extends State<ArrohFieldApp> {
  @override
  void initState() {
    super.initState();
    // Auto-sync whenever the backend becomes reachable.
    widget.state.connectivity.changes.listen((change) {
      if (change.online && change.backend == BackendReachability.reachable) {
        unawaited(widget.state.syncEngine.syncOnce());
      }
    });
    widget.state.syncReports.listen((report) {
      if (!mounted) return;
      final messenger = ScaffoldMessenger.maybeOf(context);
      if (messenger == null) return;
      if (report.outcome == SyncOutcome.partial || report.outcome == SyncOutcome.backendError) {
        messenger.showSnackBar(SnackBar(
          content: Text('Sync finished. ${report.succeeded} synced, ${report.failed} retained.'),
          backgroundColor: const Color(0xFFB26A00),
        ));
      } else if (report.outcome == SyncOutcome.complete && report.processed > 0) {
        messenger.showSnackBar(SnackBar(
          content: Text('Synced ${report.succeeded} record(s) to the ARROH backend.'),
          backgroundColor: const Color(0xFF1B5E20),
        ));
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = ColorScheme.fromSeed(
      seedColor: const Color(0xFF00695C),
      brightness: Brightness.light,
    );
    return MaterialApp(
      title: 'ARROH Care — ASHA',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: colorScheme,
        scaffoldBackgroundColor: const Color(0xFFF4F7F6),
        appBarTheme: AppBarTheme(
          backgroundColor: colorScheme.primary,
          foregroundColor: colorScheme.onPrimary,
          elevation: 2,
        ),
        snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
      ),
      routes: {
        '/': (_) => AshaHomeScreen(state: widget.state),
        '/patients': (_) => PatientsScreen(state: widget.state),
        '/register': (_) => PatientRegisterScreen(state: widget.state),
        '/triage': (_) => TriageScreen(state: widget.state),
        '/followups': (_) => FollowUpScreen(state: widget.state),
        '/follow-ups': (_) => FollowUpListScreen(state: widget.state),
        '/tasks': (_) => TaskListScreen(state: widget.state),
        '/visits/start': (_) => StartVisitScreen(state: widget.state),
        '/visits/result': (_) => VisitResultScreen(state: widget.state),
        '/sync': (_) => SyncScreen(state: widget.state),
        '/isl': (_) => IslScreen(state: widget.state),
        '/settings': (_) => SettingsScreen(state: widget.state),
        '/case-taking': (_) => CaseTakingScreen(state: widget.state),
        '/low-literacy': (_) => LowLiteracyScreen(state: widget.state),
      },
      onGenerateRoute: (settings) {
        final name = settings.name ?? '';
        if (name.startsWith('/patients/') && name.endsWith('/summary')) {
          final segments = name.split('/');
          final patientLocalUuid = segments.length >= 4 ? segments[2] : '';
          return MaterialPageRoute(
            settings: settings,
            builder: (_) => PatientSummaryScreen(state: widget.state, patientLocalUuid: patientLocalUuid),
          );
        }
        if (name.startsWith('/visits/') && name != '/visits/start' && name != '/visits/result') {
          final segments = name.split('/');
          final visitLocalUuid = segments.length >= 3 ? segments[2] : '';
          return MaterialPageRoute(
            settings: settings,
            builder: (_) => VisitFormScreen(state: widget.state, visitLocalUuid: visitLocalUuid),
          );
        }
        if (name == '/consultation/new') {
          final patient = settings.arguments;
          return MaterialPageRoute(
            settings: settings,
            builder: (_) => ConsultationFormScreen(
              state: widget.state,
              preselectedPatient: patient is LocalPatient ? patient : null,
            ),
          );
        }
        if (name == '/consultation') {
          final localUuid = settings.arguments;
          return MaterialPageRoute(
            settings: settings,
            builder: (_) => ConsultationFormScreen(
              state: widget.state,
              consultationLocalUuid: localUuid is String ? localUuid : null,
            ),
          );
        }
        if (name == '/consultation/summary') {
          final localUuid = settings.arguments;
          if (localUuid is String) {
            return MaterialPageRoute(
              settings: settings,
              builder: (_) => ConsultationSummaryScreen(state: widget.state, consultationLocalUuid: localUuid),
            );
          }
        }
        if (name == '/consultation/prescription') {
          final args = settings.arguments as Map?;
          return MaterialPageRoute(
            settings: settings,
            builder: (_) => PrescriptionScreen(
              state: widget.state,
              consultationLocalUuid: (args?['consultationLocalUuid'] as String?) ?? '',
              patientLocalUuid: args?['patientLocalUuid'] as String?,
            ),
          );
        }
        if (name == '/consultation/diagnostics') {
          final args = settings.arguments as Map?;
          return MaterialPageRoute(
            settings: settings,
            builder: (_) => DiagnosticRequestScreen(
              state: widget.state,
              consultationLocalUuid: (args?['consultationLocalUuid'] as String?) ?? '',
            ),
          );
        }
        if (name == '/consultation/discharge') {
          final args = settings.arguments as Map?;
          return MaterialPageRoute(
            settings: settings,
            builder: (_) => DischargePlanScreen(
              state: widget.state,
              consultationLocalUuid: (args?['consultationLocalUuid'] as String?) ?? '',
              patientLocalUuid: args?['patientLocalUuid'] as String?,
            ),
          );
        }
        if (name == '/doctor') {
          return MaterialPageRoute(
            settings: settings,
            builder: (_) => DoctorHomeScreen(state: widget.state),
          );
        }
        return null;
      },
      initialRoute: '/',
    );
  }
}