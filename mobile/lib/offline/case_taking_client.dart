/// AI-assisted case-taking client.
///
/// The mobile app talks to the backend's `/case-taking` endpoints so the
/// same multilingual extraction, follow-up question engine, and safety
/// verification are used by both the ASHA worker on the field and the
/// doctor on the web.
///
/// If the backend is unreachable, the client falls back to the offline
/// ``OfflineCaseTakingService`` so the patient can still start a
/// conversation. Whatever the user enters is enqueued for sync so the
/// doctor receives the structured case once connectivity returns.

library;

import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'offline_triage.dart';

class ExtractedSymptom {
  ExtractedSymptom({
    required this.symptom,
    this.bodyLocation,
    this.onset,
    this.duration,
    this.severity,
    this.confidence = 0.0,
    this.source = 'USER_TEXT',
    this.confirmedByUser = false,
  });

  final String symptom;
  final String? bodyLocation;
  final String? onset;
  final String? duration;
  final String? severity;
  final double confidence;
  final String source;
  final bool confirmedByUser;

  factory ExtractedSymptom.fromJson(Map<String, dynamic> json) => ExtractedSymptom(
        symptom: (json['symptom'] as String?) ?? '',
        bodyLocation: json['body_location'] as String?,
        onset: json['onset'] as String?,
        duration: json['duration'] as String?,
        severity: json['severity'] as String?,
        confidence: (json['confidence'] as num?)?.toDouble() ?? 0.0,
        source: (json['source'] as String?) ?? 'USER_TEXT',
        confirmedByUser: json['confirmed_by_user'] as bool? ?? false,
      );

  Map<String, dynamic> toJson() => {
        'symptom': symptom,
        'body_location': bodyLocation,
        'onset': onset,
        'duration': duration,
        'severity': severity,
        'confidence': confidence,
        'source': source,
        'confirmed_by_user': confirmedByUser,
      };

  ExtractedSymptom copyWith({bool? confirmedByUser}) => ExtractedSymptom(
        symptom: symptom,
        bodyLocation: bodyLocation,
        onset: onset,
        duration: duration,
        severity: severity,
        confidence: confidence,
        source: source,
        confirmedByUser: confirmedByUser ?? this.confirmedByUser,
      );
}

class StructuredCase {
  StructuredCase({
    this.symptoms = const [],
    this.duration,
    this.severity,
    this.location,
    this.associatedSymptoms = const [],
    this.pregnancyStatus,
    this.injury,
    this.medications = const [],
    this.allergies = const [],
    this.relevantVitals = const {},
    this.language = 'unknown',
    this.rawTranscript = '',
    this.overallConfidence = 0.0,
    this.notes = const [],
  });

  final List<ExtractedSymptom> symptoms;
  final String? duration;
  final String? severity;
  final String? location;
  final List<String> associatedSymptoms;
  final String? pregnancyStatus;
  final String? injury;
  final List<String> medications;
  final List<String> allergies;
  final Map<String, double> relevantVitals;
  final String language;
  final String rawTranscript;
  final double overallConfidence;
  final List<String> notes;

  factory StructuredCase.fromJson(Map<String, dynamic> json) => StructuredCase(
        symptoms: ((json['symptoms'] as List?) ?? const [])
            .map((item) => ExtractedSymptom.fromJson(item as Map<String, dynamic>))
            .toList(),
        duration: json['duration'] as String?,
        severity: json['severity'] as String?,
        location: json['location'] as String?,
        associatedSymptoms: ((json['associated_symptoms'] as List?) ?? const []).cast<String>(),
        pregnancyStatus: json['pregnancy_status'] as String?,
        injury: json['injury'] as String?,
        medications: ((json['medications'] as List?) ?? const []).cast<String>(),
        allergies: ((json['allergies'] as List?) ?? const []).cast<String>(),
        relevantVitals: ((json['relevant_vitals'] as Map?) ?? const {})
            .map((key, value) => MapEntry(key.toString(), (value as num).toDouble())),
        language: (json['language'] as String?) ?? 'unknown',
        rawTranscript: (json['raw_transcript'] as String?) ?? '',
        overallConfidence: (json['overall_confidence'] as num?)?.toDouble() ?? 0.0,
        notes: ((json['notes'] as List?) ?? const []).cast<String>(),
      );

  Map<String, dynamic> toJson() => {
        'symptoms': symptoms.map((s) => s.toJson()).toList(),
        'duration': duration,
        'severity': severity,
        'location': location,
        'associated_symptoms': associatedSymptoms,
        'pregnancy_status': pregnancyStatus,
        'injury': injury,
        'medications': medications,
        'allergies': allergies,
        'relevant_vitals': relevantVitals,
        'language': language,
        'raw_transcript': rawTranscript,
        'overall_confidence': overallConfidence,
        'notes': notes,
      };
}

class FollowUpQuestion {
  FollowUpQuestion({
    required this.questionId,
    required this.prompt,
    this.translations = const {},
    this.expectedKind = 'yes_no',
    this.priority = 100,
    this.safetyReason = '',
  });

  final String questionId;
  final String prompt;
  final Map<String, String> translations;
  final String expectedKind;
  final int priority;
  final String safetyReason;

  factory FollowUpQuestion.fromJson(Map<String, dynamic> json) => FollowUpQuestion(
        questionId: json['question_id'] as String,
        prompt: json['prompt'] as String? ?? '',
        translations: ((json['prompt_translations'] as Map?) ?? const {}).cast<String, String>(),
        expectedKind: json['expected_kind'] as String? ?? 'yes_no',
        priority: (json['priority'] as num?)?.toInt() ?? 100,
        safetyReason: json['safety_reason'] as String? ?? '',
      );

  String localized(String language) => translations[language] ?? prompt;
}

class CaseSession {
  CaseSession({
    required this.caseId,
    required this.patientLocalUuid,
    required this.language,
    required this.startedAt,
    required this.aiProposedCase,
    required this.patientCase,
    this.triageResult = const {},
    this.safetyFlags = const [],
    this.followUpQuestions = const [],
    this.answers = const [],
    this.emergencyIntentDetected = false,
    this.ragResult,
    this.timelineEvents = const [],
    this.completed = false,
    this.completedAt,
  });

  final String caseId;
  final String? patientLocalUuid;
  final String language;
  final String startedAt;
  final StructuredCase aiProposedCase;
  final StructuredCase patientCase;
  final Map<String, dynamic> triageResult;
  final List<String> safetyFlags;
  final List<FollowUpQuestion> followUpQuestions;
  final List<Map<String, dynamic>> answers;
  final bool emergencyIntentDetected;
  final Map<String, dynamic>? ragResult;
  final List<Map<String, dynamic>> timelineEvents;
  final bool completed;
  final String? completedAt;

  factory CaseSession.fromJson(Map<String, dynamic> json) => CaseSession(
        caseId: json['case_id'] as String,
        patientLocalUuid: json['patient_local_uuid'] as String?,
        language: (json['language'] as String?) ?? 'unknown',
        startedAt: json['started_at'] as String? ?? '',
        aiProposedCase: StructuredCase.fromJson(json['ai_proposed_case'] as Map<String, dynamic>),
        patientCase: StructuredCase.fromJson(json['patient_case'] as Map<String, dynamic>),
        triageResult: (json['triage_result'] as Map?)?.cast<String, dynamic>() ?? const {},
        safetyFlags: ((json['safety_flags'] as List?) ?? const []).cast<String>(),
        followUpQuestions: ((json['follow_up_questions'] as List?) ?? const [])
            .map((q) => FollowUpQuestion.fromJson(q as Map<String, dynamic>))
            .toList(),
        answers: ((json['answers'] as List?) ?? const []).cast<Map<String, dynamic>>(),
        emergencyIntentDetected: json['emergency_intent_detected'] as bool? ?? false,
        ragResult: (json['rag_result'] as Map?)?.cast<String, dynamic>(),
        timelineEvents: ((json['timeline_events'] as List?) ?? const [])
            .map((e) => (e as Map).cast<String, dynamic>())
            .toList(),
        completed: json['completed'] as bool? ?? false,
        completedAt: json['completed_at'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'case_id': caseId,
        'patient_local_uuid': patientLocalUuid,
        'language': language,
        'started_at': startedAt,
        'ai_proposed_case': aiProposedCase.toJson(),
        'patient_case': patientCase.toJson(),
        'triage_result': triageResult,
        'safety_flags': safetyFlags,
        'follow_up_questions': followUpQuestions
            .map((q) => {
                  'question_id': q.questionId,
                  'prompt': q.prompt,
                  'prompt_translations': q.translations,
                  'expected_kind': q.expectedKind,
                  'priority': q.priority,
                  'safety_reason': q.safetyReason,
                })
            .toList(),
        'answers': answers,
        'emergency_intent_detected': emergencyIntentDetected,
        'rag_result': ragResult,
        'timeline_events': timelineEvents,
        'completed': completed,
        'completed_at': completedAt,
      };
}

class CaseTakingClient {
  CaseTakingClient({required this.backendBaseUrl, required this.httpClient});

  final String backendBaseUrl;
  final http.Client httpClient;

  Future<({CaseSession session, Map<String, dynamic>? rag})> startCase({
    required String transcript,
    required String language,
    String? patientLocalUuid,
  }) async {
    final uri = Uri.parse('$backendBaseUrl/api/v1/case-taking/start');
    final response = await httpClient.post(
      uri,
      headers: const {'Content-Type': 'application/json'},
      body: jsonEncode({
        'transcript': transcript,
        'language': language,
        'patient_local_uuid': patientLocalUuid,
      }),
    );
    if (response.statusCode >= 400) {
      throw CaseTakingException('Failed to start case-taking session (${response.statusCode})');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    return (
      session: CaseSession.fromJson(body['session'] as Map<String, dynamic>),
      rag: (body['rag'] as Map?)?.cast<String, dynamic>(),
    );
  }

  Future<CaseSession> answerQuestion({
    required CaseSession session,
    required String questionId,
    required String answer,
  }) async {
    final uri = Uri.parse('$backendBaseUrl/api/v1/case-taking/answer');
    final response = await httpClient.post(
      uri,
      headers: const {'Content-Type': 'application/json'},
      body: jsonEncode({
        'session': session.toJson(),
        'question_id': questionId,
        'answer': answer,
      }),
    );
    if (response.statusCode >= 400) {
      throw CaseTakingException('Failed to record answer (${response.statusCode})');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    return CaseSession.fromJson(body['session'] as Map<String, dynamic>);
  }

  Future<({CaseSession session, Map<String, dynamic> triage})> confirmCase(CaseSession session) async {
    final uri = Uri.parse('$backendBaseUrl/api/v1/case-taking/confirm');
    final response = await httpClient.post(
      uri,
      headers: const {'Content-Type': 'application/json'},
      body: jsonEncode({'session': session.toJson()}),
    );
    if (response.statusCode >= 400) {
      throw CaseTakingException('Failed to confirm case-taking session (${response.statusCode})');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    return (
      session: CaseSession.fromJson(body['case_session'] as Map<String, dynamic>),
      triage: (body['triage_result'] as Map?)?.cast<String, dynamic>() ?? const {},
    );
  }
}

class CaseTakingException implements Exception {
  CaseTakingException(this.message);
  final String message;
  @override
  String toString() => 'CaseTakingException: $message';
}

/// Offline fallback that mirrors the mock AI provider on the backend so the
/// mobile app stays usable when the network is down. The verdict always
/// defers to the deterministic :func:`assessOfflineTriage` engine.
class OfflineCaseTakingService {
  CaseSession startCase({required String transcript, required String language, String? patientLocalUuid}) {
    final lower = transcript.toLowerCase();
    final symptoms = <ExtractedSymptom>[];
    final emergency = _isEmergency(lower, language);
    if (_matches(lower, language, ['chest pain', 'ಎದೆ ನೋವು', 'seene mein dard', 'மார்பு வலி'])) {
      symptoms.add(ExtractedSymptom(symptom: 'chest pain', severity: 'moderate', confidence: 0.7));
    }
    if (_matches(lower, language, ['shortness of breath', 'ಉಸಿರಾಡಲು ಕಷ್ಟ', 'saans', 'மூச்சு'])) {
      symptoms.add(ExtractedSymptom(symptom: 'shortness of breath', severity: 'moderate', confidence: 0.7));
    }
    if (_matches(lower, language, ['severe headache', 'ತೀವ್ರ ತಲೆನೋವು', 'sir dard', 'தலைவலி'])) {
      symptoms.add(ExtractedSymptom(symptom: 'severe headache', severity: 'severe', confidence: 0.7));
    }
    if (_matches(lower, language, ['blurred vision', 'ಮಸುಕು', 'dikhai', 'பார்வை'])) {
      symptoms.add(ExtractedSymptom(symptom: 'blurred vision', severity: 'moderate', confidence: 0.7));
    }
    if (_matches(lower, language, ['facial swelling', 'ಮುಖ ಊತ', 'chehra', 'முக வீக்கம்'])) {
      symptoms.add(ExtractedSymptom(symptom: 'facial swelling', severity: 'moderate', confidence: 0.7));
    }

    final pregnancy = _matches(lower, language, ['pregnant', 'ಗರ್ಭಿಣಿ', 'garbhvati', 'கர்ப்பிணி']);

    final patientCase = StructuredCase(
      symptoms: symptoms,
      language: language,
      rawTranscript: transcript,
      pregnancyStatus: pregnancy ? 'PREGNANT' : null,
    );
    final triage = _runSafetyEngine(patientCase, emergency);
    final questions = _generateFollowups(symptoms, language, pregnancy);

    return CaseSession(
      caseId: 'local-${DateTime.now().millisecondsSinceEpoch}',
      patientLocalUuid: patientLocalUuid,
      language: language,
      startedAt: DateTime.now().toUtc().toIso8601String(),
      aiProposedCase: patientCase,
      patientCase: patientCase,
      triageResult: triage,
      followUpQuestions: questions,
      emergencyIntentDetected: emergency,
      timelineEvents: [
        {'event_type': 'CASE_RECORDED', 'occurred_at': DateTime.now().toUtc().toIso8601String()},
      ],
    );
  }

  CaseSession answerQuestion(CaseSession session, String questionId, String answer) {
    final updatedQuestions = session.followUpQuestions.where((q) => q.questionId != questionId).toList();
    final updatedAnswers = [
      ...session.answers,
      {'question_id': questionId, 'answer': answer, 'answered_at': DateTime.now().toUtc().toIso8601String()},
    ];
    final patientCase = session.patientCase;
    final normalized = answer.toLowerCase().trim();
    if (questionId == 'q_breathing_difficulty' && (normalized == 'yes' || normalized == 'ಹೌದು')) {
      if (!patientCase.symptoms.any((s) => s.symptom == 'shortness of breath')) {
        final symptoms = [...patientCase.symptoms, ExtractedSymptom(symptom: 'shortness of breath', severity: 'moderate', confidence: 0.9, confirmedByUser: true)];
        final newCase = StructuredCase(
          symptoms: symptoms,
          duration: patientCase.duration,
          severity: patientCase.severity,
          location: patientCase.location,
          associatedSymptoms: patientCase.associatedSymptoms,
          pregnancyStatus: patientCase.pregnancyStatus,
          injury: patientCase.injury,
          medications: patientCase.medications,
          allergies: patientCase.allergies,
          relevantVitals: patientCase.relevantVitals,
          language: patientCase.language,
          rawTranscript: patientCase.rawTranscript,
          overallConfidence: patientCase.overallConfidence,
          notes: patientCase.notes,
        );
        final triage = _runSafetyEngine(newCase, session.emergencyIntentDetected);
        return CaseSession(
          caseId: session.caseId,
          patientLocalUuid: session.patientLocalUuid,
          language: session.language,
          startedAt: session.startedAt,
          aiProposedCase: session.aiProposedCase,
          patientCase: newCase,
          triageResult: triage,
          safetyFlags: session.safetyFlags,
          followUpQuestions: updatedQuestions,
          answers: updatedAnswers,
          emergencyIntentDetected: session.emergencyIntentDetected,
          ragResult: session.ragResult,
          timelineEvents: session.timelineEvents,
          completed: session.completed,
          completedAt: session.completedAt,
        );
      }
    }
    return CaseSession(
      caseId: session.caseId,
      patientLocalUuid: session.patientLocalUuid,
      language: session.language,
      startedAt: session.startedAt,
      aiProposedCase: session.aiProposedCase,
      patientCase: patientCase,
      triageResult: session.triageResult,
      safetyFlags: session.safetyFlags,
      followUpQuestions: updatedQuestions,
      answers: updatedAnswers,
      emergencyIntentDetected: session.emergencyIntentDetected,
      ragResult: session.ragResult,
      timelineEvents: session.timelineEvents,
      completed: session.completed,
      completedAt: session.completedAt,
    );
  }

  bool _isEmergency(String lower, String language) {
    const en = ['cannot breathe', 'can\'t breathe', 'unconscious', 'accident', 'snakebite', 'severe bleeding', 'chest pain'];
    const kn = ['ಉಸಿರಾಡಲಾಗುತ್ತಿಲ್ಲ', 'ಪ್ರಜ್ಞೆ ಹೋಗಿದೆ', 'ಅಪಘಾತ', 'ಹಾವು ಕಚ್ಚಿದೆ'];
    const hi = ['saans nahi aa rahi', 'behosh', 'hadsa', 'saamp kaat', 'seene mein dard'];
    const ta = ['மூச்சு வரவில்லை', 'mookku varavillai', 'விபத்து', 'பாம்பு கடி', 'மார்பு வலி'];
    final list = switch (language) {
      'kn' => kn,
      'hi' => hi,
      'ta' => ta,
      _ => en,
    };
    return list.any((phrase) => lower.contains(phrase));
  }

  bool _matches(String lower, String language, List<String> phrases) =>
      phrases.any((phrase) => lower.contains(phrase.toLowerCase()));

  Map<String, dynamic> _runSafetyEngine(StructuredCase caseData, bool emergency) {
    final symptoms = caseData.symptoms.map((s) => s.symptom).toList();
    final vitals = caseData.relevantVitals;
    final verdict = assessOfflineTriage(symptoms: symptoms, vitals: vitals);
    if (emergency && verdict.triageLevel != 'RED') {
      return {
        'triage_level': 'RED',
        'risk_score': 100,
        'recommended_actions': [
          'Patient reported an emergency intent. Activate emergency protocol.',
          ...verdict.recommendedActions,
        ],
        'high_risk_respiratory': verdict.highRiskRespiratory,
        'high_risk_maternal': verdict.highRiskMaternal,
        'maternal_conditions': verdict.maternalConditions,
        'missing_vitals': verdict.missingVitals,
      };
    }
    return {
      'triage_level': verdict.triageLevel,
      'risk_score': verdict.riskScore,
      'recommended_actions': verdict.recommendedActions,
      'high_risk_respiratory': verdict.highRiskRespiratory,
      'high_risk_maternal': verdict.highRiskMaternal,
      'maternal_conditions': verdict.maternalConditions,
      'missing_vitals': verdict.missingVitals,
    };
  }

  List<FollowUpQuestion> _generateFollowups(List<ExtractedSymptom> symptoms, String language, bool pregnant) {
    final qs = <FollowUpQuestion>[];
    final hasChest = symptoms.any((s) => s.symptom == 'chest pain');
    final hasBreath = symptoms.any((s) => s.symptom == 'shortness of breath');
    final hasPreEclampsia = symptoms.any((s) => s.symptom == 'severe headache') ||
        symptoms.any((s) => s.symptom == 'blurred vision') ||
        symptoms.any((s) => s.symptom == 'facial swelling');

    if (hasChest) {
      qs.add(FollowUpQuestion(
        questionId: 'q_chest_pain_onset',
        prompt: 'When did the chest pain start?',
        priority: 10,
        safetyReason: 'Acute coronary syndrome',
      ));
    }
    if (hasChest || hasBreath) {
      qs.add(FollowUpQuestion(
        questionId: 'q_breathing_difficulty',
        prompt: 'Are you having difficulty breathing right now?',
        priority: 5,
        safetyReason: 'Respiratory compromise',
      ));
    }
    if (hasPreEclampsia) {
      qs.add(FollowUpQuestion(
        questionId: 'q_pregnancy_confirm',
        prompt: 'Are you pregnant, or could you be pregnant?',
        priority: 6,
        safetyReason: 'Pre-eclampsia danger signs',
      ));
    }
    if (pregnant) {
      qs.add(FollowUpQuestion(
        questionId: 'q_pregnancy_weeks',
        prompt: 'How many weeks pregnant are you?',
        priority: 8,
        safetyReason: 'Gestational age',
      ));
    }
    qs.sort((a, b) => a.priority.compareTo(b.priority));
    return qs.take(3).toList();
  }
}
