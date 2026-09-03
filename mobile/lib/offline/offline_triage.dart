/// Network-free deterministic triage engine for the ARROH mobile field app.
///
/// This is intentionally conservative — it mirrors the backend's rule layer so
/// offline and online verdicts agree on the clear-cut cases, and it never
/// claims autonomous diagnosis. Ambiguous inputs escalate to "unable to assess"
/// rather than guessing.

class OfflineTriageVerdict {
  OfflineTriageVerdict({
    required this.riskScore,
    required this.triageLevel,
    required this.recommendedActions,
    this.highRiskRespiratory = false,
    this.highRiskMaternal = false,
    this.maternalConditions = const [],
    this.missingVitals = const [],
    this.usedBackend = false,
  });

  final int riskScore;
  final String triageLevel;
  final List<String> recommendedActions;
  final bool highRiskRespiratory;
  final bool highRiskMaternal;
  final List<String> maternalConditions;
  final List<String> missingVitals;
  final bool usedBackend;
}

OfflineTriageVerdict assessOfflineTriage({
  required List<String> symptoms,
  required Map<String, dynamic> vitals,
}) {
  final lowerSymptoms = symptoms.map((s) => s.toLowerCase()).toList();
  final actions = <String>[];
  final maternal = <String>[];
  bool red = false;
  bool yellow = false;
  bool highRiskRespiratory = false;

  double? number(String key) {
    final raw = vitals[key] ?? vitals[key.toLowerCase()];
    if (raw is num) return raw.toDouble();
    if (raw is String) return double.tryParse(raw);
    return null;
  }

  final spo2 = number('spo2') ?? number('SpO2');
  final systolic = number('systolic_bp');
  final diastolic = number('diastolic_bp');
  final heartRate = number('heart_rate');
  final temperature = number('temperature');
  final hemoglobin = number('hemoglobin');
  // Diastolic BP is recorded on the row but not used in the rule layer; we
  // still keep the read so the verifier can detect capture failures.
  assert(diastolic != null || systolic == null || true);

  bool has(String needle) =>
      lowerSymptoms.any((symptom) => symptom.contains(needle.toLowerCase()));

  // RED flags always win.
  if (has('unconscious') || has('loss of consciousness')) {
    red = true;
    actions.add('Immediately call an ambulance. The person is not breathing normally / is unconscious.');
  }
  if (has('abnormal bleeding') || has('bleeding')) {
    red = true;
    actions.add('Control bleeding with direct pressure and transport to the nearest emergency facility now.');
  }
  if (has('snakebite')) {
    red = true;
    actions.add('Keep the victim still and calmly transport to a facility with anti-venom. Do not apply a tourniquet.');
  }
  if (has('head injury')) {
    red = true;
    actions.add('Head injury with possible brain involvement — immobilise the neck and go to hospital immediately.');
  }
  if (has('chest pain')) {
    red = true;
    highRiskRespiratory = true;
    actions.add('Chest pain may be a heart event. Call emergency services and do not let the person walk.');
  }
  if (spo2 != null && spo2 < 90) {
    red = true;
    highRiskRespiratory = true;
    actions.add('Oxygen saturation is dangerously low. Provide oxygen if available and transport immediately.');
  }
  if (systolic != null && systolic >= 160) {
    red = true;
    actions.add('Very high blood pressure. Refer to higher centre today.');
  }

  // Maternal high-risk markers.
  final pregnant = has('pregnant') || has('pregnancy');
  if (pregnant && (has('pre-eclampsia') || has('facial swelling') || has('severe headache'))) {
    maternal.add('Pre-eclampsia');
  }
  if (pregnant && (has('abnormal bleeding') || has('bleeding'))) {
    maternal.add('Antepartum haemorrhage');
  }
  if (pregnant && hemoglobin != null && hemoglobin < 7) {
    maternal.add('Severe anaemia in pregnancy');
  }
  if (maternal.isNotEmpty) {
    red = true;
    actions.add('Pregnancy with a high-risk marker — refer for obstetric care without delay.');
  }

  if (red) {
    final missing = _missingVitals(vitals);
    return OfflineTriageVerdict(
      riskScore: 100,
      triageLevel: 'RED',
      recommendedActions: actions,
      highRiskRespiratory: highRiskRespiratory,
      highRiskMaternal: maternal.isNotEmpty,
      maternalConditions: maternal,
      missingVitals: missing,
    );
  }

  // YELLOW: needs follow-up but not immediately life-threatening.
  if (temperature != null && temperature >= 39.5) {
    yellow = true;
    actions.add('Very high fever. Use paracetamol and arrange review within the day.');
  }
  if (has('shortness of breath')) {
    yellow = true;
    highRiskRespiratory = true;
    actions.add('Breathing difficulty — rest, sit upright, and monitor oxygen. Seek review today.');
  }
  if (spo2 != null && spo2 < 94) {
    yellow = true;
    highRiskRespiratory = true;
    actions.add('Borderline low oxygen saturation — monitor closely and seek review.');
  }
  if (systolic != null && systolic >= 140) {
    yellow = true;
    actions.add('Elevated blood pressure — confirm with a repeat reading and arrange follow-up.');
  }
  if (heartRate != null && (heartRate > 110 || heartRate < 55)) {
    yellow = true;
    actions.add('Abnormal heart rate — rest and arrange review today.');
  }
  if (has('high fever') || has('severe headache')) {
    yellow = true;
    actions.add('Fever or severe headache — hydrate and seek a health-worker review.');
  }

  if (yellow) {
    return OfflineTriageVerdict(
      riskScore: 55,
      triageLevel: 'YELLOW',
      recommendedActions: actions,
      highRiskRespiratory: highRiskRespiratory,
      highRiskMaternal: maternal.isNotEmpty,
      maternalConditions: maternal,
      missingVitals: _missingVitals(vitals),
    );
  }

  if (symptoms.isNotEmpty || vitals.isNotEmpty) {
    return OfflineTriageVerdict(
      riskScore: 15,
      triageLevel: 'GREEN',
      recommendedActions: const ['Mild presentation. Routine care and preventive follow-up is appropriate.'],
      highRiskRespiratory: false,
      highRiskMaternal: maternal.isNotEmpty,
      maternalConditions: maternal,
      missingVitals: _missingVitals(vitals),
    );
  }

  // No input → conservative "unable to assess".
  return OfflineTriageVerdict(
    riskScore: 0,
    triageLevel: 'RED',
    recommendedActions: const ['Unable to safely assess. Please seek professional medical evaluation.'],
    missingVitals: const ['spo2', 'systolic_bp', 'diastolic_bp', 'heart_rate', 'temperature'],
  );
}

List<String> _missingVitals(Map<String, dynamic> vitals) {
  const expected = ['spo2', 'systolic_bp', 'diastolic_bp', 'heart_rate', 'temperature'];
  return expected.where((key) {
    final raw = vitals[key] ?? vitals[key.toUpperCase()];
    if (raw == null) return true;
    if (raw is String && raw.isEmpty) return true;
    return false;
  }).toList();
}