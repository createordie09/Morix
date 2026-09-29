/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { clearLocalMemory, loadLocalMemory } from '../services/localMemory';

export interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  currentVoice: string;
  onVoiceChange: (voice: string) => void;
  currentLanguage: 'auto' | 'fr' | 'en';
  onLanguageChange: (lang: 'auto' | 'fr' | 'en') => void;
  micSensitivity: number;
  onMicSensitivityChange: (val: number) => void;
  devShortcutEnabled: boolean;
  onDevShortcutEnabledChange: (enabled: boolean) => void;
}

const AVAILABLE_VOICES = [
  { id: 'Puck', name: 'Puck', desc: 'Masculin · Vif, direct & complice (recommandé)' },
  { id: 'Charon', name: 'Charon', desc: 'Masculin · Posé, grave & calme' },
  { id: 'Fenrir', name: 'Fenrir', desc: 'Masculin · Énergique & profond' },
  { id: 'Kore', name: 'Kore', desc: 'Féminin · Clair, doux & précis' },
  { id: 'Zephyr', name: 'Zephyr', desc: 'Féminin · Chaleureux, fluide & dynamique' },
  { id: 'Aoede', name: 'Aoede', desc: 'Féminin · Expressif & posé' },
];

export default function SettingsPanel({
  isOpen,
  onClose,
  currentVoice,
  onVoiceChange,
  currentLanguage,
  onLanguageChange,
  micSensitivity,
  onMicSensitivityChange,
  devShortcutEnabled,
  onDevShortcutEnabledChange,
}: SettingsPanelProps) {
  const [memoryCount, setMemoryCount] = useState(0);
  const [totalChars, setTotalChars] = useState(0);
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const [clearedFeedback, setClearedFeedback] = useState(false);

  // Recharger l'état de la mémoire à chaque ouverture
  useEffect(() => {
    if (isOpen) {
      const mem = loadLocalMemory();
      setMemoryCount(mem.resumes.length);
      const chars = mem.resumes.reduce((acc, r) => acc + (r.resume?.length || 0), 0);
      setTotalChars(chars);
      setIsConfirmingClear(false);
      setClearedFeedback(false);
    }
  }, [isOpen]);

  // Écoute de la touche Échap pour refermer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleExecuteClear = () => {
    clearLocalMemory();
    setMemoryCount(0);
    setTotalChars(0);
    setIsConfirmingClear(false);
    setClearedFeedback(true);
    setTimeout(() => setClearedFeedback(false), 2500);
  };

  const getSensitivityLabel = (val: number) => {
    if (val < 30) return 'Ambiance bruyante';
    if (val <= 70) return 'Équilibré (Recommandé)';
    return 'Très sensible (Chuchotement)';
  };

  return (
    <aside
      role="region"
      aria-label="Panneau des paramètres"
      aria-hidden={!isOpen}
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        height: '100vh',
        width: '350px',
        maxWidth: 'calc(100vw - 32px)',
        backgroundColor: 'rgba(10, 10, 12, 0.96)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderRight: '1px solid rgba(255, 255, 255, 0.08)',
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
        transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 300ms cubic-bezier(0.16, 1, 0.3, 1), visibility 300ms',
        visibility: isOpen ? 'visible' : 'hidden',
        boxShadow: isOpen ? '16px 0 48px rgba(0, 0, 0, 0.75)' : 'none',
        borderRadius: 0,
        userSelect: 'none',
        color: '#F4F4F5',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '24px 20px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          borderRadius: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h2
            style={{
              margin: 0,
              fontSize: '0.875rem',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: '#F4F4F5',
              fontFamily: 'inherit',
            }}
          >
            Paramètres Morix
          </h2>
        </div>

        {/* Bouton Fermer */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer les paramètres"
          style={{
            background: 'transparent',
            border: 'none',
            padding: '6px',
            margin: 0,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255, 255, 255, 0.45)',
            transition: 'color 150ms ease, transform 150ms ease',
            borderRadius: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#FFFFFF';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'rgba(255, 255, 255, 0.45)';
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Contenu avec défilement */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '28px',
        }}
      >
        {/* ============================================================== */}
        {/* SECTION 1 : VOIX & DICTION                                     */}
        {/* ============================================================== */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <span
            style={{
              fontSize: '0.6875rem',
              fontWeight: 600,
              letterSpacing: '0.08em',
              color: 'rgba(255, 255, 255, 0.45)',
              textTransform: 'uppercase',
            }}
          >
            1. Voix & Diction
          </span>

          <div
            style={{
              border: '1px solid rgba(255, 255, 255, 0.08)',
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
              borderRadius: 0,
              padding: '14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
            }}
          >
            {/* Choix de la voix */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label
                htmlFor="morix-voice-select"
                style={{
                  fontSize: '0.75rem',
                  color: 'rgba(255, 255, 255, 0.8)',
                  fontWeight: 500,
                }}
              >
                Timbre vocal du modèle Live :
              </label>

              <select
                id="morix-voice-select"
                value={currentVoice}
                onChange={(e) => onVoiceChange(e.target.value)}
                style={{
                  backgroundColor: '#121216',
                  color: '#FFFFFF',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: 0,
                  padding: '8px 10px',
                  fontSize: '0.8125rem',
                  fontFamily: 'inherit',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                {AVAILABLE_VOICES.map((v) => (
                  <option key={v.id} value={v.id} style={{ backgroundColor: '#18181B', color: '#FFFFFF' }}>
                    {v.name} ({v.desc})
                  </option>
                ))}
              </select>
              <span style={{ fontSize: '0.6875rem', color: 'rgba(255, 255, 255, 0.4)' }}>
                Application immédiate sur la session audio en cours.
              </span>
            </div>

            {/* Choix de la langue */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '6px' }}>
              <span
                style={{
                  fontSize: '0.75rem',
                  color: 'rgba(255, 255, 255, 0.8)',
                  fontWeight: 500,
                }}
              >
                Langue de réponse souhaitée :
              </span>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '4px',
                }}
              >
                {(
                  [
                    { id: 'auto', label: 'Auto (Bilingue)' },
                    { id: 'fr', label: 'Français' },
                    { id: 'en', label: 'English' },
                  ] as const
                ).map((lang) => {
                  const isSelected = currentLanguage === lang.id;
                  return (
                    <button
                      key={lang.id}
                      type="button"
                      onClick={() => onLanguageChange(lang.id)}
                      style={{
                        padding: '6px 4px',
                        fontSize: '0.6875rem',
                        fontWeight: isSelected ? 600 : 400,
                        backgroundColor: isSelected ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.04)',
                        border: isSelected
                          ? '1px solid rgba(255, 255, 255, 0.4)'
                          : '1px solid rgba(255, 255, 255, 0.08)',
                        color: isSelected ? '#FFFFFF' : 'rgba(255, 255, 255, 0.6)',
                        cursor: 'pointer',
                        borderRadius: 0,
                        transition: 'all 120ms ease',
                      }}
                    >
                      {lang.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ============================================================== */}
        {/* SECTION 2 : COMPTE                                             */}
        {/* ============================================================== */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <span
            style={{
              fontSize: '0.6875rem',
              fontWeight: 600,
              letterSpacing: '0.08em',
              color: 'rgba(255, 255, 255, 0.45)',
              textTransform: 'uppercase',
            }}
          >
            2. Compte
          </span>

          <div
            style={{
              border: '1px solid rgba(255, 255, 255, 0.08)',
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
              borderRadius: 0,
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  display: 'inline-block',
                  width: '6px',
                  height: '6px',
                  backgroundColor: '#10B981',
                  borderRadius: '50%',
                  boxShadow: '0 0 6px rgba(16, 185, 129, 0.6)',
                }}
              />
              <span
                style={{
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  color: '#FFFFFF',
                }}
              >
                Session locale
              </span>
            </div>

            <p
              style={{
                margin: 0,
                fontSize: '0.75rem',
                color: 'rgba(255, 255, 255, 0.65)',
                lineHeight: 1.5,
              }}
            >
              Aucune synchronisation cloud pour l'instant.
            </p>

            <p
              style={{
                margin: 0,
                fontSize: '0.6875rem',
                color: 'rgba(255, 255, 255, 0.38)',
                lineHeight: 1.4,
              }}
            >
              Vos données, préférences et résumés de conversation sont stockés localement sur votre appareil. L'authentification distante sera proposée lors du Palier D.
            </p>
          </div>
        </div>

        {/* ============================================================== */}
        {/* SECTION 3 : PRÉFÉRENCES & MÉMOIRE                              */}
        {/* ============================================================== */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <span
            style={{
              fontSize: '0.6875rem',
              fontWeight: 600,
              letterSpacing: '0.08em',
              color: 'rgba(255, 255, 255, 0.45)',
              textTransform: 'uppercase',
            }}
          >
            3. Préférences & Mémoire
          </span>

          <div
            style={{
              border: '1px solid rgba(255, 255, 255, 0.08)',
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
              borderRadius: 0,
              padding: '14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '18px',
            }}
          >
            {/* Curseur de sensibilité micro */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <label
                  htmlFor="mic-sensitivity-slider"
                  style={{
                    fontSize: '0.75rem',
                    color: 'rgba(255, 255, 255, 0.85)',
                    fontWeight: 500,
                  }}
                >
                  Sensibilité du microphone :
                </label>
                <span style={{ fontSize: '0.6875rem', color: '#60A5FA', fontWeight: 600 }}>
                  {micSensitivity} %
                </span>
              </div>

              <input
                id="mic-sensitivity-slider"
                type="range"
                min="0"
                max="100"
                step="5"
                value={micSensitivity}
                onChange={(e) => onMicSensitivityChange(Number(e.target.value))}
                style={{
                  width: '100%',
                  accentColor: '#60A5FA',
                  cursor: 'pointer',
                  margin: '4px 0',
                }}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.625rem', color: 'rgba(255, 255, 255, 0.4)' }}>
                <span>Bruit fort</span>
                <span style={{ color: 'rgba(255, 255, 255, 0.65)' }}>{getSensitivityLabel(micSensitivity)}</span>
                <span>Chuchotement</span>
              </div>
            </div>

            {/* Interrupteur Raccourci Dev-mode */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: '8px',
                borderTop: '1px solid rgba(255, 255, 255, 0.06)',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.85)', fontWeight: 500 }}>
                  Raccourci dev (Ctrl+Shift+D)
                </span>
                <span style={{ fontSize: '0.6875rem', color: 'rgba(255, 255, 255, 0.4)' }}>
                  Affiche la barre d'outils cachée
                </span>
              </div>

              <button
                type="button"
                onClick={() => onDevShortcutEnabledChange(!devShortcutEnabled)}
                style={{
                  padding: '4px 10px',
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  backgroundColor: devShortcutEnabled ? 'rgba(34, 197, 94, 0.16)' : 'rgba(255, 255, 255, 0.06)',
                  border: devShortcutEnabled
                    ? '1px solid rgba(34, 197, 94, 0.4)'
                    : '1px solid rgba(255, 255, 255, 0.1)',
                  color: devShortcutEnabled ? '#86EFAC' : 'rgba(255, 255, 255, 0.45)',
                  cursor: 'pointer',
                  borderRadius: 0,
                  transition: 'all 120ms ease',
                }}
              >
                {devShortcutEnabled ? 'Activé' : 'Désactivé'}
              </button>
            </div>

            {/* Gestion de la mémoire locale */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                paddingTop: '8px',
                borderTop: '1px solid rgba(255, 255, 255, 0.06)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.85)', fontWeight: 500 }}>
                  Mémoire des conversations :
                </span>
                <span style={{ fontSize: '0.6875rem', color: 'rgba(255, 255, 255, 0.5)' }}>
                  {memoryCount} session{memoryCount > 1 ? 's' : ''} ({totalChars} car.)
                </span>
              </div>

              {clearedFeedback ? (
                <div
                  style={{
                    backgroundColor: 'rgba(34, 197, 94, 0.12)',
                    border: '1px solid rgba(34, 197, 94, 0.3)',
                    color: '#86EFAC',
                    padding: '8px 10px',
                    fontSize: '0.75rem',
                    textAlign: 'center',
                  }}
                >
                  ✓ Mémoire locale réinitialisée
                </div>
              ) : isConfirmingClear ? (
                <div
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.35)',
                    padding: '10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    borderRadius: 0,
                  }}
                >
                  <span style={{ fontSize: '0.6875rem', color: '#FCA5A5', lineHeight: 1.4 }}>
                    Confirmer la suppression irréversible des résumés de session ?
                  </span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={handleExecuteClear}
                      style={{
                        flex: 1,
                        backgroundColor: '#DC2626',
                        border: 'none',
                        color: '#FFFFFF',
                        fontSize: '0.6875rem',
                        fontWeight: 600,
                        padding: '6px',
                        cursor: 'pointer',
                        borderRadius: 0,
                      }}
                    >
                      Oui, effacer
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsConfirmingClear(false)}
                      style={{
                        flex: 1,
                        backgroundColor: 'rgba(255, 255, 255, 0.08)',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        color: 'rgba(255, 255, 255, 0.8)',
                        fontSize: '0.6875rem',
                        padding: '6px',
                        cursor: 'pointer',
                        borderRadius: 0,
                      }}
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsConfirmingClear(true)}
                  disabled={memoryCount === 0}
                  style={{
                    backgroundColor: memoryCount > 0 ? 'rgba(239, 68, 68, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                    border: memoryCount > 0 ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(255, 255, 255, 0.06)',
                    color: memoryCount > 0 ? '#FCA5A5' : 'rgba(255, 255, 255, 0.3)',
                    fontSize: '0.75rem',
                    padding: '8px 12px',
                    cursor: memoryCount > 0 ? 'pointer' : 'default',
                    borderRadius: 0,
                    textAlign: 'center',
                    transition: 'all 120ms ease',
                  }}
                  onMouseEnter={(e) => {
                    if (memoryCount > 0) {
                      e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.22)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (memoryCount > 0) {
                      e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.12)';
                    }
                  }}
                >
                  Effacer la mémoire locale
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
