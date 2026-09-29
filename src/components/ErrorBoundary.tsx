/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Component, ErrorInfo, ReactNode } from 'react';
import ParticleOrb from './ParticleOrb';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Erreur non interceptée dans l\'arborescence React :', error, errorInfo);
  }

  handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            position: 'fixed',
            inset: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: '#0A0A0C',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            userSelect: 'none',
          }}
        >
          {/* Orbe figé en état d'erreur (teinte rouge sombre et vibration de précaution) */}
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ParticleOrb state="error" />

            {/* Bouton icône unique pour recharger l'application (Zéro texte permanent) */}
            <div
              style={{
                position: 'absolute',
                bottom: '48px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 40,
              }}
            >
              <button
                type="button"
                onClick={this.handleReload}
                title="Recharger l'application"
                aria-label="Recharger l'application"
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '9999px',
                  backgroundColor: 'rgba(239, 68, 68, 0.14)',
                  border: '1px solid rgba(239, 68, 68, 0.45)',
                  color: '#FCA5A5',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 0 24px rgba(239, 68, 68, 0.25)',
                  transition: 'all 200ms ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.26)';
                  e.currentTarget.style.transform = 'scale(1.06)';
                  e.currentTarget.style.boxShadow = '0 0 32px rgba(239, 68, 68, 0.45)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.14)';
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.boxShadow = '0 0 24px rgba(239, 68, 68, 0.25)';
                }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21.5 2v6h-6" />
                  <path d="M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
