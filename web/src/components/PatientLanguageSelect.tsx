import { LANGUAGE_CODES, LANGUAGE_LABELS, useI18n } from '../i18n';

export function PatientLanguageSelect() {
  const { language, setLanguage, t } = useI18n();

  return (
    <label className="patient-language-control">
      <span className="sr-only">{t('welcome.language')}</span>
      <select
        className="patient-language-select"
        value={language}
        onChange={(event) => {
          const nextLanguage = LANGUAGE_CODES.find((code) => code === event.currentTarget.value);
          if (nextLanguage) setLanguage(nextLanguage);
        }}
      >
        {LANGUAGE_CODES.map((code) => (
          <option key={code} value={code}>
            {LANGUAGE_LABELS[code]}
          </option>
        ))}
      </select>
    </label>
  );
}
