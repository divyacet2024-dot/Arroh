/// Tri-state connectivity monitor.
///
/// Distinguishes **Internet down** from **Internet up but backend down** so the
/// UI never claims success for a request that never reached the server.

import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';

enum BackendReachability { unknown, reachable, unreachable }

class ConnectivityState {
  const ConnectivityState({required this.online, required this.backend});

  final bool online;
  final BackendReachability backend;

  ConnectivityState copyWith({bool? online, BackendReachability? backend}) =>
      ConnectivityState(online: online ?? this.online, backend: backend ?? this.backend);
}

class ConnectivityMonitor {
  ConnectivityMonitor({this.probe = _defaultProbe});

  /// Cheap function that returns true when the backend responds on `/health`.
  final Future<bool> Function() probe;

  static Future<bool> _defaultProbe() async => false;

  final Connectivity _connectivity = Connectivity();
  final StreamController<ConnectivityState> _controller =
      StreamController<ConnectivityState>.broadcast();
  bool _online = true;
  BackendReachability _backend = BackendReachability.unknown;
  Timer? _probeTimer;

  Stream<ConnectivityState> get changes => _controller.stream;
  ConnectivityState get current => ConnectivityState(online: _online, backend: _backend);

  Future<void> start() async {
    final initial = await _connectivity.checkConnectivity();
    _online = _isOnline(initial);
    _controller.add(current);
    _connectivity.onConnectivityChanged.listen((result) {
      _online = _isOnline(result);
      _controller.add(current);
      if (_online) {
        unawaited(_probeBackend());
      } else {
        _backend = BackendReachability.unknown;
        _controller.add(current);
      }
    });
    _probeTimer = Timer.periodic(const Duration(seconds: 30), (_) => _probeBackend());
    unawaited(_probeBackend());
  }

  Future<void> dispose() async {
    _probeTimer?.cancel();
    await _controller.close();
  }

  Future<void> refreshBackend() async {
    await _probeBackend();
  }

  Future<void> _probeBackend() async {
    final result = await probe();
    _backend = result ? BackendReachability.reachable : BackendReachability.unreachable;
    if (!_controller.isClosed) _controller.add(current);
  }

  bool _isOnline(dynamic result) {
    if (result is List<ConnectivityResult>) {
      return result.any((r) => r != ConnectivityResult.none);
    }
    if (result is ConnectivityResult) {
      return result != ConnectivityResult.none;
    }
    return true;
  }
}

/// Convenience wrapper that discards the future without lint warnings.
void unawaited(Future<void> future) {
  // intentionally ignored — fire-and-forget pattern.
}