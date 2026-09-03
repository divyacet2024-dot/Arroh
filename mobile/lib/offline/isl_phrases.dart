/// Indian Sign Language (ISL) quick-phrase cards.
///
/// Phase 17 priority 1: emergency ISL / text / audio quick phrases for ASHA
/// field workers who encounter deaf / hard-of-hearing patients and need a
/// reliable, *non-interpretive* communication bridge. These are written
/// phrases — never "interpreted" from camera input — so they remain safe
/// without a verified sign-recognition model. Each phrase is available in
/// multiple local languages so the ASHA worker can flip the spoken language
/// to match the patient's primary language.

class IslPhrase {
  const IslPhrase({
    required this.id,
    required this.icon,
    required this.english,
    required this.translations,
    required this.category,
  });

  final String id;
  final String icon;
  final String english;
  final Map<String, String> translations;
  final String category;
}

const Map<String, String> kSupportedLanguageNames = {
  'en': 'English',
  'kn': 'Kannada',
  'hi': 'Hindi',
  'ta': 'Tamil',
  'te': 'Telugu',
};

const List<IslPhrase> kEmergencyIslPhrases = [
  IslPhrase(
    id: 'emergency',
    icon: '🆘',
    english: 'This is a medical emergency.',
    translations: {
      'en': 'This is a medical emergency.',
      'kn': 'ಇದು ವೈದ್ಯಕೀಯ ತುกร\u200cತು.',
      'hi': 'यह एक चिकित्सा आपातकाल है।',
      'ta': 'இது ஒரு மருத்துவ அவசரநிலை.',
      'te': 'ఇది ఒక వైద్య అత్యవసర పరిస్థితి.',
    },
    category: 'emergency',
  ),
  IslPhrase(
    id: 'chest_pain',
    icon: '💔',
    english: 'Are you having chest pain?',
    translations: {
      'en': 'Are you having chest pain?',
      'kn': 'ನಿಮಗೆ ಎದೆ ನೋವು ಇದೆಯೇ?',
      'hi': 'क्या आपको सीने में दर्द है?',
      'ta': 'உங்களுக்கு மார்பு வலி உள்ளதா?',
      'te': 'మీకు ఛాతీ నొప్పి ఉందా?',
    },
    category: 'symptom',
  ),
  IslPhrase(
    id: 'cannot_breathe',
    icon: '😮‍💨',
    english: 'Are you having trouble breathing?',
    translations: {
      'en': 'Are you having trouble breathing?',
      'kn': 'ನಿಮಗೆ ಉಸಿರಾಡಲು ತೊಂದರೆ ಆಗುತ್ತಿದೆಯೇ?',
      'hi': 'क्या आपको साँस लेने में तकलीफ़ है?',
      'ta': 'உங்களுக்கு மூச்சு விடுவதில் சிரமம் உள்ளதா?',
      'te': 'మీకు శ్వాస తీసుకోవడంలో ఇబ్బంది ఉందా?',
    },
    category: 'symptom',
  ),
  IslPhrase(
    id: 'severe_bleeding',
    icon: '🩸',
    english: 'Are you bleeding heavily?',
    translations: {
      'en': 'Are you bleeding heavily?',
      'kn': 'ನಿಮಗೆ ಹೆಚ್ಚಾಗಿ ರಕ್ತಸ್ರಾವ ಆಗುತ್ತಿದೆಯೇ?',
      'hi': 'क्या आपको तेज़ खून बह रहा है?',
      'ta': 'உங்களுக்கு அதிக இரத்தப்போக்கு உள்ளதா?',
      'te': 'మీకు ఎక్కువ రక్తస్రావం జరుగుతోందా?',
    },
    category: 'symptom',
  ),
  IslPhrase(
    id: 'pregnant',
    icon: '🤰',
    english: 'Are you pregnant? How many weeks?',
    translations: {
      'en': 'Are you pregnant? How many weeks?',
      'kn': 'ನೀವು ಗರ್ಭಿಣಿಯಾಗಿದ್ದೀರಾ? ಎಷ್ಟು ವಾರ?',
      'hi': 'क्या आप गर्भवती हैं? कितने हफ़्ते?',
      'ta': 'நீங்கள் கர்ப்பமாக இருக்கிறீர்களா? எத்தனை வாரங்கள்?',
      'te': 'మీరు గర్భవతిగా ఉన్నారా? ఎన్ని వతనాలు?',
    },
    category: 'history',
  ),
  IslPhrase(
    id: 'serious_injury',
    icon: '🤕',
    english: 'Did you have a serious injury or fall?',
    translations: {
      'en': 'Did you have a serious injury or fall?',
      'kn': 'ನಿಮಗೆ ಗಂಭೀರ ಗಾಯ ಅಥವಾ ಬೀಳುವಿಕೆ ಆಗಿದೆಯೇ?',
      'hi': 'क्या आपको कोई गंभीर चोट या गिरना हुआ है?',
      'ta': 'உங்களுக்கு கடுமையான காயம் அல்லது விழுதல் ஏற்பட்டதா?',
      'te': 'మీకు తీవ్రమైన గాయం లేదా పడిపోవడం జరిగిందా?',
    },
    category: 'history',
  ),
  IslPhrase(
    id: 'pain_location',
    icon: '👉',
    english: 'Please point to where it hurts.',
    translations: {
      'en': 'Please point to where it hurts.',
      'kn': 'ದಯವಿಟ್ಟು ಎಲ್ಲಿ ನೋವು ಅನ್ನು ತೋರಿಸಿ.',
      'hi': 'कृपया दिखाएँ कि दर्द कहाँ है।',
      'ta': 'வலி எங்கு என்பதை சுட்டிக்காட்டுங்கள்.',
      'te': 'దయచేసి నొప్పి ఎక్కడ ఉందో చూపించండి.',
    },
    category: 'instruction',
  ),
  IslPhrase(
    id: 'since_when',
    icon: '⏱️',
    english: 'Since when has this been happening?',
    translations: {
      'en': 'Since when has this been happening?',
      'kn': 'ಇದು ಯಾವಾಗಿನಿಂದ ಆಗುತ್ತಿದೆ?',
      'hi': 'यह कब से हो रहा है?',
      'ta': 'இது எப்போது முதல் நடக்கிறது?',
      'te': 'ఇది ఎప్పటి నుండి జరుగుతోంది?',
    },
    category: 'history',
  ),
  IslPhrase(
    id: 'oxygen',
    icon: '🫁',
    english: 'I am giving you oxygen.',
    translations: {
      'en': 'I am giving you oxygen.',
      'kn': 'ನಾನು ನಿಮಗೆ ಆಮ್ಲಜನಕ ಕೊಡುತ್ತಿದ್ದೇನೆ.',
      'hi': 'मैं आपको ऑक्सीजन दे रहा/रही हूँ।',
      'ta': 'நான் உங்களுக்கு ஆக்சிஜன் கொடுக்கிறேன்.',
      'te': 'నేను మీకు ఆక్సిజన్ ఇస్తున్నాను.',
    },
    category: 'care',
  ),
  IslPhrase(
    id: 'transport',
    icon: '🚑',
    english: 'We are taking you to the hospital now.',
    translations: {
      'en': 'We are taking you to the hospital now.',
      'kn': 'ನಾವು ನಿಮ್ಮನ್ನು ಈಗ ಆಸ್ಪತ್ರೆಗೆ ಕರೆದೊಯ್ಯುತ್ತಿದ್ದೇವೆ.',
      'hi': 'हम आपको अभी अस्पताल ले जा रहे हैं।',
      'ta': 'நாங்கள் உங்களை இப்போது மருத்துவமனைக்கு அழைத்துச் செல்கிறோம்.',
      'te': 'మేము మిమ్మల్ని ఇప్పుడు ఆసుపత్రికి తీసుకువెళ్తున్నాము.',
    },
    category: 'care',
  ),
  IslPhrase(
    id: 'safe',
    icon: '🤝',
    english: 'You are safe. Stay with me.',
    translations: {
      'en': 'You are safe. Stay with me.',
      'kn': 'ನೀವು ಸುರಕ್ಷಿತರಾಗಿದ್ದೀರಿ. ನನ್ನ ಜೊತೆ ಇರಿ.',
      'hi': 'आप सुरक्षित हैं। मेरे साथ रहें।',
      'ta': 'நீங்கள் பாதுகாப்பாக இருக்கிறீர்கள். என்னுடன் இருங்கள்.',
      'te': 'మీరు సురక్షితంగా ఉన్నారు. నా వెంట ఉండండి.',
    },
    category: 'care',
  ),
  IslPhrase(
    id: 'allergy',
    icon: '⚠️',
    english: 'Do you have any allergies to medicine?',
    translations: {
      'en': 'Do you have any allergies to medicine?',
      'kn': 'ನಿಮಗೆ ಯಾವುದೇ ಔಷಧಿ ಅಲರ್ಜಿ ಇದೆಯೇ?',
      'hi': 'क्या आपको किसी दवाई से एलर्जी है?',
      'ta': 'உங்களுக்கு ஏதேனும் மருந்துக்கு ஒவ்வாமை உள்ளதா?',
      'te': 'మీకు ఏదైనా మందులకు అలెర్జీ ఉందా?',
    },
    category: 'history',
  ),
];

/// Safety reminder used at the bottom of every ISL card.
const String kIslSafetyNote =
    'These phrases support communication. They never replace a verified sign-language interpreter.';