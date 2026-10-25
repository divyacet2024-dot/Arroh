/// Shared helpers for the doctor consultation screens. Kept tiny so it
/// is easy to keep in sync with the underlying triage semantics.

import 'package:flutter/material.dart';

import '../offline/models.dart';

Color riskColor(String? triageStatus) {
  switch (triageStatus) {
    case 'RED':
      return const Color(0xFFC62828);
    case 'YELLOW':
      return const Color(0xFFB26A00);
    case 'GREEN':
    default:
      return const Color(0xFF1B5E20);
  }
}

String summarizeVitals(Map<String, dynamic>? vitals) {
  if (vitals == null || vitals.isEmpty) return 'No vitals recorded.';
  final parts = <String>[];
  final temp = vitals['temperature_c'];
  if (temp != null) parts.add('Temp ${temp}°C');
  final pulse = vitals['pulse_bpm'];
  if (pulse != null) parts.add('Pulse $pulse');
  final rr = vitals['respiratory_rate'];
  if (rr != null) parts.add('RR $rr');
  final spo2 = vitals['spo2'];
  if (spo2 != null) parts.add('SpO2 $spo2%');
  final bp = vitals['blood_pressure'];
  if (bp != null && '$bp'.isNotEmpty) parts.add('BP $bp');
  final w = vitals['weight_kg'];
  if (w != null) parts.add('Weight ${w}kg');
  if (parts.isEmpty) return 'Vitals recorded.';
  return parts.join(' · ');
}

String safeName(LocalPatient? patient) {
  if (patient == null) return 'Unknown patient';
  return patient.name;
}
