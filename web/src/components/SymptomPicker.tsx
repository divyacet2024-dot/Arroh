/**
 * SymptomPicker — multi-modal symptom selection for rural patients.
 *
 * Three input modes:
 *   1. Tap chips  — large, clearly labelled emoji + text buttons
 *   2. Voice      — mic button (via useArrohVoice already in parent)
 *   3. Text input — fallback for patients who can type
 *
 * Output: structured SymptomEntry[] passed to the parent agent.
 *
 * Design:
 *   - Minimum 56px touch targets
 *   - High-contrast teal/white chips
 *   - Emoji + local language label on each chip
 *   - Selected chips highlighted
 *   - Max 20 selected symptoms (clinical safety: don't overwhelm)
 *   - Accessible: each chip has aria-pressed
 */

import { useState, type FormEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { cn } from '../lib/cn';

export interface SelectedSymptom {
  symptom: string;
  source: 'voice' | 'tap' | 'text';
}

interface SymptomPickerProps {
  language: string;
  selected: SelectedSymptom[];
  onAdd: (symptom: SelectedSymptom) => void;
  onRemove: (symptom: string) => void;
  onDone: () => void;
  disabled?: boolean;
}

// ── Symptom catalogue ─────────────────────────────────────────────────────────

interface SymptomDef {
  id: string;
  emoji: string;
  labels: Record<string, string>;
}

const SYMPTOMS: SymptomDef[] = [
  { id: 'fever',       emoji: '🤒', labels: { 'kn-IN': 'ಜ್ವರ',          'hi-IN': 'बुखार',        'te-IN': 'జ్వరం',       'ta-IN': 'காய்ச்சல்',  'en-IN': 'Fever'              } },
  { id: 'headache',    emoji: '🤕', labels: { 'kn-IN': 'ತಲೆನೋವು',       'hi-IN': 'सिरदर्द',      'te-IN': 'తలనొప్పి',    'ta-IN': 'தலைவலி',     'en-IN': 'Headache'           } },
  { id: 'cough',       emoji: '😮‍💨', labels: { 'kn-IN': 'ಕೆಮ್ಮು',         'hi-IN': 'खांसी',        'te-IN': 'దగ్గు',        'ta-IN': 'இருமல்',     'en-IN': 'Cough'              } },
  { id: 'cold',        emoji: '🤧', labels: { 'kn-IN': 'ಶೀತ',            'hi-IN': 'जुकाम',        'te-IN': 'జలుబు',       'ta-IN': 'சளி',        'en-IN': 'Cold'               } },
  { id: 'vomiting',    emoji: '🤢', labels: { 'kn-IN': 'ವಾಂತಿ',          'hi-IN': 'उल्टी',        'te-IN': 'వాంతి',       'ta-IN': 'வாந்தி',     'en-IN': 'Vomiting'           } },
  { id: 'stomach pain',emoji: '😣', labels: { 'kn-IN': 'ಹೊಟ್ಟೆ ನೋವು',    'hi-IN': 'पेट दर्द',     'te-IN': 'పొట్ట నొప్పి','ta-IN': 'வயிற்று வலி','en-IN': 'Stomach pain'       } },
  { id: 'body pain',   emoji: '💪', labels: { 'kn-IN': 'ಮೈ ನೋವು',        'hi-IN': 'शरीर दर्द',    'te-IN': 'శరీర నొప్పి', 'ta-IN': 'உடல் வலி',   'en-IN': 'Body pain'          } },
  { id: 'weakness',    emoji: '😴', labels: { 'kn-IN': 'ದೌರ್ಬಲ್ಯ',       'hi-IN': 'कमज़ोरी',      'te-IN': 'బలహీనత',     'ta-IN': 'பலவீனம்',    'en-IN': 'Weakness'           } },
  { id: 'diarrhea',    emoji: '🚽', labels: { 'kn-IN': 'ಭೇದಿ',           'hi-IN': 'दस्त',          'te-IN': 'విరేచనాలు',   'ta-IN': 'வயிற்றுப்போக்கு', 'en-IN': 'Diarrhea'     } },
  { id: 'chest pain',  emoji: '🫀', labels: { 'kn-IN': 'ಎದೆ ನೋವು',      'hi-IN': 'छाती दर्द',    'te-IN': 'ఛాతీ నొప్పి','ta-IN': 'நெஞ்சு வலி', 'en-IN': 'Chest pain'         } },
  { id: 'shortness of breath', emoji: '🫁', labels: { 'kn-IN': 'ಉಸಿರಾಟ ತೊಂದರೆ', 'hi-IN': 'सांस लेने में तकलीफ', 'te-IN': 'శ్వాస ఇబ్బంది', 'ta-IN': 'மூச்சுத்திணறல்', 'en-IN': 'Breathing difficulty' } },
  { id: 'skin rash',   emoji: '🔴', labels: { 'kn-IN': 'ಚರ್ಮ ದದ್ದು',     'hi-IN': 'त्वचा पर दाने','te-IN': 'చర్మ దద్దు',  'ta-IN': 'தோல் தடிப்பு','en-IN': 'Skin rash'         } },
  { id: 'joint pain',  emoji: '🦵', labels: { 'kn-IN': 'ಮೊಣಕಾಲು ನೋವು',  'hi-IN': 'जोड़ों का दर्द','te-IN': 'కీళ్ళ నొప్పి','ta-IN': 'மூட்டு வலி', 'en-IN': 'Joint pain'         } },
  { id: 'dizziness',   emoji: '😵', labels: { 'kn-IN': 'ತಲೆ ತಿರುಗುವಿಕೆ', 'hi-IN': 'चक्कर',        'te-IN': 'తల తిరగడం',  'ta-IN': 'தலை சுற்றல்','en-IN': 'Dizziness'          } },
  { id: 'eye problem', emoji: '👁️', labels: { 'kn-IN': 'ಕಣ್ಣು ತೊಂದರೆ',  'hi-IN': 'आँख की समस्या','te-IN': 'కంటి సమస్య', 'ta-IN': 'கண் பிரச்சனை', 'en-IN': 'Eye problem'      } },
];

function getLabel(symptom: SymptomDef, lang: string): string {
  return symptom.labels[lang] ?? symptom.labels['en-IN'] ?? symptom.id;
}

function doneLabel(lang: string): string {
  if (lang.startsWith('kn')) return 'ಮುಂದುವರಿಸಿ';
  if (lang.startsWith('hi')) return 'आगे बढ़ें';
  if (lang.startsWith('te')) return 'కొనసాగించు';
  if (lang.startsWith('ta')) return 'தொடர்க';
  return 'Continue';
}

function addMoreLabel(lang: string): string {
  if (lang.startsWith('kn')) return 'ಬೇರೆ ತೊಂದರೆ ಸೇರಿಸಿ';
  if (lang.startsWith('hi')) return 'अन्य तकलीफ जोड़ें';
  if (lang.startsWith('te')) return 'ఇంకే ఇబ్బంది జోడించు';
  if (lang.startsWith('ta')) return 'வேறு பிரச்சனை சேர்க்க';
  return 'Add another symptom';
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SymptomPicker({
  language,
  selected,
  onAdd,
  onRemove,
  onDone,
  disabled = false,
}: SymptomPickerProps) {
  const [customText, setCustomText] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  const selectedIds = new Set(selected.map((s) => s.symptom));

  const handleTap = (symptom: SymptomDef) => {
    const label = getLabel(symptom, language);
    if (selectedIds.has(label)) {
      onRemove(label);
    } else if (selected.length < 20) {
      onAdd({ symptom: label, source: 'tap' });
    }
  };

  const handleCustomSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = customText.trim();
    if (trimmed && !selectedIds.has(trimmed) && selected.length < 20) {
      onAdd({ symptom: trimmed, source: 'text' });
      setCustomText('');
      setShowCustomInput(false);
    }
  };

  return (
    <div className="symptom-picker">
      {/* Selected symptoms — shown as removable tags */}
      {selected.length > 0 && (
        <div className="symptom-selected-row" aria-label="Selected symptoms">
          {selected.map((s) => (
            <span key={s.symptom} className="symptom-tag">
              {s.symptom}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onRemove(s.symptom)}
                  aria-label={`Remove ${s.symptom}`}
                  className="symptom-tag-remove"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Chip grid */}
      <div className="symptom-grid" role="group" aria-label="Choose symptoms">
        {SYMPTOMS.map((sym) => {
          const label = getLabel(sym, language);
          const isSelected = selectedIds.has(label);
          return (
            <button
              key={sym.id}
              type="button"
              onClick={() => handleTap(sym)}
              disabled={disabled || (!isSelected && selected.length >= 20)}
              aria-pressed={isSelected}
              aria-label={label}
              className={cn(
                'symptom-chip',
                isSelected && 'symptom-chip--selected',
              )}
            >
              <span className="symptom-chip-emoji">{sym.emoji}</span>
              <span className="symptom-chip-label">{label}</span>
            </button>
          );
        })}
      </div>

      {/* Custom text input */}
      {showCustomInput ? (
        <form onSubmit={handleCustomSubmit} className="symptom-custom-form">
          <input
            type="text"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            placeholder={language.startsWith('kn') ? 'ಬೇರೆ ತೊಂದರೆ ಹಾಕಿ…' : 'Type a symptom…'}
            className="symptom-custom-input"
            autoFocus
          />
          <button type="submit" className="symptom-custom-add" aria-label="Add">
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        </form>
      ) : (
        !disabled && (
          <button
            type="button"
            onClick={() => setShowCustomInput(true)}
            className="symptom-add-custom-btn"
          >
            <Plus className="h-4 w-4 mr-1" aria-hidden="true" />
            {addMoreLabel(language)}
          </button>
        )
      )}

      {/* Done / Continue button — only shown when ≥1 symptom selected */}
      {selected.length > 0 && (
        <button
          type="button"
          onClick={onDone}
          disabled={disabled}
          className="symptom-done-btn"
        >
          {doneLabel(language)} →
        </button>
      )}
    </div>
  );
}
