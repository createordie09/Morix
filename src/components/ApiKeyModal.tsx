/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';

export interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onKeySaved: (maskedKey: string) => void;
  canClose?: boolean;
  currentMaskedKey?: string;
}

export default function ApiKeyModal({
  isOpen,
  onClose,
  onKeySaved,
  canClose = true,
  currentMaskedKey = '',
}: ApiKeyModalProps) {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = apiKey.trim();

    if (!trimmed) {
      setError('Veuillez saisir votre clé API Google Gemini.');
      return;
    }

    if (trimmed.length < 10) {
      setError('La clé API semble trop courte. Vérifiez votre saisie.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      if (typeof window !== 'undefined' && window.morixAPI?.saveApiKey) {
        const res = await window.morixAPI.saveApiKey(trimmed);
        if (res.success) {
          onKeySaved(res.maskedKey || trimmed.slice(0, 6) + '...' + trimmed.slice(-4));
          setApiKey('');
          onClose();
        } else {
          setError(res.message || 'Erreur lors de l\'enregistrement de la clé.');
        }
      } else {
        // Fallback pour test web pur
        onKeySaved(trimmed.slice(0, 6) + '...' + trimmed.slice(-4));
        setApiKey('');
        onClose();
      }
    } catch (err: any) {
      setError(err?.message || 'Erreur de communication avec le processus principal.');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setApiKey(text.trim());
        setError(null);
      }
    } catch {
      // Ignorer si les permissions clipboard sont refusées
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        padding: '20px',
      }}
    >
      <div
        className="window-no-drag"
        style={{
          width: '100%',
          maxWidth: '480px',
          backgroundColor: '#0d0d12',
          border: '1px solid rgba(255, 255, 255, 0.14)',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.8), 0 0 1px 1px rgba(255, 255, 255, 0.05)',
          display: 'flex',
          flexDirection: 'column',
          color: '#FFFFFF',
          borderRadius: 0,
        }}
      >
        {/* En-tête */}
        <div
          style={{
            padding: '20px 24px 16px 24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%)',
                boxShadow: '0 0 8px rgba(59, 130, 246, 0.8)',
              }}
            />
            <h2
              style={{
                margin: 0,
                fontSize: '0.9375rem',
                fontWeight: 600,
                letterSpacing: '0.02em',
                color: '#FFFFFF',
              }}
            >
              Configuration de la Clé API Gemini
            </h2>
          </div>

          {canClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'rgba(255, 255, 255, 0.45)',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'color 120ms ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#FFFFFF';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.45)';
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        {/* Corps */}
        <form onSubmit={handleSave} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: 'rgba(255, 255, 255, 0.72)', lineHeight: 1.55 }}>
            Morix fonctionne directement sur votre machine. Pour alimenter la voix et les outils en direct avec le modèle{' '}
            <strong style={{ color: '#93C5FD' }}>Gemini 2.5 Flash Native Audio</strong>, renseignez votre clé d'API personnelle.
          </p>

          {currentMaskedKey && (
            <div
              style={{
                padding: '8px 12px',
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                fontSize: '0.75rem',
                color: 'rgba(255, 255, 255, 0.65)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>Clé actuelle :</span>
              <code style={{ color: '#86EFAC', fontFamily: 'monospace' }}>{currentMaskedKey}</code>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label htmlFor="gemini-api-key-input" style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.85)', fontWeight: 500 }}>
              Clé d'API Google Gemini :
            </label>

            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                id="gemini-api-key-input"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setError(null);
                }}
                placeholder="AIzaSy..."
                autoComplete="off"
                spellCheck={false}
                style={{
                  width: '100%',
                  padding: '10px 80px 10px 12px',
                  backgroundColor: '#07070a',
                  border: error ? '1px solid #EF4444' : '1px solid rgba(255, 255, 255, 0.16)',
                  color: '#FFFFFF',
                  fontSize: '0.8125rem',
                  fontFamily: 'monospace',
                  borderRadius: 0,
                  outline: 'none',
                  transition: 'border-color 150ms ease',
                }}
                onFocus={(e) => {
                  if (!error) e.currentTarget.style.borderColor = '#3B82F6';
                }}
                onBlur={(e) => {
                  if (!error) e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.16)';
                }}
              />

              <div style={{ position: 'absolute', right: '8px', display: 'flex', gap: '4px' }}>
                <button
                  type="button"
                  onClick={handlePaste}
                  title="Coller depuis le presse-papier"
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: 'rgba(255, 255, 255, 0.6)',
                    padding: '3px 6px',
                    fontSize: '0.6875rem',
                    cursor: 'pointer',
                    borderRadius: 0,
                  }}
                >
                  Coller
                </button>
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  title={showKey ? 'Masquer' : 'Afficher'}
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: 'rgba(255, 255, 255, 0.6)',
                    padding: '3px 6px',
                    fontSize: '0.6875rem',
                    cursor: 'pointer',
                    borderRadius: 0,
                  }}
                >
                  {showKey ? 'Masquer' : 'Voir'}
                </button>
              </div>
            </div>

            {error && (
              <span style={{ fontSize: '0.75rem', color: '#F87171' }}>
                {error}
              </span>
            )}
          </div>

          {/* Lien d'aide */}
          <div
            style={{
              padding: '10px 12px',
              backgroundColor: 'rgba(59, 130, 246, 0.05)',
              border: '1px solid rgba(59, 130, 246, 0.2)',
              fontSize: '0.75rem',
              color: 'rgba(255, 255, 255, 0.75)',
              lineHeight: 1.45,
            }}
          >
            Besoin d'une clé ?{' '}
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#60A5FA', textDecoration: 'underline' }}
            >
              Créer une clé gratuite sur Google AI Studio
            </a>
            . Elle sera stockée localement sur votre ordinateur.
          </div>

          {/* Boutons d'action */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
            {canClose && (
              <button
                type="button"
                onClick={onClose}
                disabled={isSaving}
                style={{
                  padding: '8px 16px',
                  backgroundColor: 'transparent',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: 'rgba(255, 255, 255, 0.7)',
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                  borderRadius: 0,
                }}
              >
                Annuler
              </button>
            )}

            <button
              type="submit"
              disabled={isSaving}
              data-testid="save-api-key-button"
              style={{
                padding: '8px 20px',
                backgroundColor: '#2563EB',
                border: '1px solid #3B82F6',
                color: '#FFFFFF',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: isSaving ? 'wait' : 'pointer',
                borderRadius: 0,
                boxShadow: '0 0 12px rgba(37, 99, 235, 0.4)',
                transition: 'all 120ms ease',
              }}
            >
              {isSaving ? 'Enregistrement...' : 'Enregistrer et activer Morix'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
