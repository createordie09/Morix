/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import ApiKeyModal from './components/ApiKeyModal';
import DashboardWindow from './components/DashboardWindow';
import DashboardStandaloneView from './components/DashboardStandaloneView';
import ParticleOrb from './components/ParticleOrb';
import SettingsPanel from './components/SettingsPanel';
import StatusPill, { StatusPillState } from './components/StatusPill';
import VisualCanvas, { VisualCanvasData } from './components/VisualCanvas';
import { createGeminiLiveAudio, LiveAudioController } from './services/geminiLiveAudio';
import {
  addSessionSummary,
  clearLocalMemory,
  loadLocalMemory,
  updateUserPreferences,
} from './services/localMemory';
import {
  DashboardItem,
  DashboardWindowData,
  TaskItem,
  WindowType,
} from './types/dashboard';
import { OrbState } from './types/orb';

export default function App() {
  // Détection du mode Fenêtre Dashboard Native Electron
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const isDashboardView = urlParams?.get('window') === 'dashboard';
  const dashboardId = urlParams?.get('id') || '';

  if (isDashboardView) {
    return <DashboardStandaloneView windowId={dashboardId} />;
  }

  const [orbState, setOrbState] = useState<OrbState>('idle');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isActivated, setIsActivated] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [micVolume, setMicVolume] = useState(0);
  const [showMicModal, setShowMicModal] = useState(false);
  const [simulatedState, setSimulatedState] = useState<StatusPillState | null>(null);

  // Pleine Autonomie Visuelle et Synchronisation Parole / Écran
  const [visualCanvasData, setVisualCanvasData] = useState<VisualCanvasData | null>(null);
  const [outputAudioIntensity, setOutputAudioIntensity] = useState<number>(0);

  // Outils de test développeur masqués par défaut (accessible via raccourci secret Ctrl+Shift+D / Cmd+Shift+D)
  const [showDevTools, setShowDevTools] = useState(false);

  // Préférences configurables via le panneau de paramètres
  const [currentVoice, setCurrentVoice] = useState<string>(
    () => loadLocalMemory().preferences.voix || 'Puck'
  );
  const [currentLanguage, setCurrentLanguage] = useState<'auto' | 'fr' | 'en'>(
    () => loadLocalMemory().preferences.languePreference || 'auto'
  );
  const [micSensitivity, setMicSensitivity] = useState<number>(
    () => loadLocalMemory().preferences.micSensitivity ?? 50
  );
  const [devShortcutEnabled, setDevShortcutEnabled] = useState<boolean>(
    () => loadLocalMemory().preferences.devShortcutEnabled ?? true
  );
  const [alwaysOnTop, setAlwaysOnTop] = useState<boolean>(
    () => loadLocalMemory().preferences.alwaysOnTop ?? false
  );
  const [transparentBackground, setTransparentBackground] = useState<boolean>(
    () => loadLocalMemory().preferences.transparentBackground ?? false
  );
  const [autoStart, setAutoStart] = useState<boolean>(
    () => loadLocalMemory().preferences.autoStart ?? false
  );
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [apiKeyStatus, setApiKeyStatus] = useState<{
    hasKey: boolean;
    isFromEnv: boolean;
    maskedKey: string;
  }>({ hasKey: true, isFromEnv: false, maskedKey: '' });

  const handleAlwaysOnTopChange = (enabled: boolean) => {
    setAlwaysOnTop(enabled);
    updateUserPreferences({ alwaysOnTop: enabled });
    if (typeof window !== 'undefined' && window.morixAPI?.setAlwaysOnTop) {
      window.morixAPI.setAlwaysOnTop(enabled);
    }
  };

  const handleTransparentBackgroundChange = (enabled: boolean) => {
    setTransparentBackground(enabled);
    updateUserPreferences({ transparentBackground: enabled });
  };

  const handleAutoStartChange = async (enabled: boolean) => {
    setAutoStart(enabled);
    updateUserPreferences({ autoStart: enabled });
    if (typeof window !== 'undefined' && window.morixAPI?.setAutostart) {
      try {
        const res = await window.morixAPI.setAutostart(enabled);
        setAutoStart(res);
      } catch (err) {
        console.warn('[Morix App] Erreur setAutostart :', err);
      }
    }
  };

  // Synchroniser l'état initial Toujours au premier plan, Lancement au démarrage et Clé API
  useEffect(() => {
    const initialAlwaysOnTop = loadLocalMemory().preferences.alwaysOnTop;
    if (initialAlwaysOnTop && typeof window !== 'undefined' && window.morixAPI?.setAlwaysOnTop) {
      window.morixAPI.setAlwaysOnTop(initialAlwaysOnTop);
    }

    if (typeof window !== 'undefined' && window.morixAPI?.getAutostart) {
      window.morixAPI.getAutostart().then((enabled) => {
        setAutoStart(enabled);
        updateUserPreferences({ autoStart: enabled });
      }).catch((err) => {
        console.warn('[Morix App] Erreur lecture getAutostart :', err);
      });
    }

    if (typeof window !== 'undefined' && window.morixAPI?.getApiKeyStatus) {
      window.morixAPI.getApiKeyStatus().then((status) => {
        setApiKeyStatus(status);
        if (!status.hasKey) {
          // Affichage automatique de l'écran de configuration initial si aucune clé n'existe
          setIsApiKeyModalOpen(true);
        }
      }).catch((err) => {
        console.warn('[Morix App] Erreur vérification clé API :', err);
      });
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        if (!devShortcutEnabled) return;
        e.preventDefault();
        setShowDevTools((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [devShortcutEnabled]);

  const handleVoiceChange = async (voice: string) => {
    setCurrentVoice(voice);
    if (liveAudioRef.current) {
      await liveAudioRef.current.setVoice(voice);
    } else {
      updateUserPreferences({ voix: voice });
    }
  };

  const handleLanguageChange = async (lang: 'auto' | 'fr' | 'en') => {
    setCurrentLanguage(lang);
    if (liveAudioRef.current) {
      await liveAudioRef.current.setLanguage(lang);
    } else {
      updateUserPreferences({ languePreference: lang });
    }
  };

  const handleMicSensitivityChange = (val: number) => {
    setMicSensitivity(val);
    if (liveAudioRef.current) {
      liveAudioRef.current.setMicSensitivity(val);
    } else {
      updateUserPreferences({ micSensitivity: val });
    }
  };

  const handleDevShortcutEnabledChange = (enabled: boolean) => {
    setDevShortcutEnabled(enabled);
    updateUserPreferences({ devShortcutEnabled: enabled });
    if (!enabled) {
      setShowDevTools(false);
    }
  };

  // Persistance mémoire avant fermeture d'onglet ou rafraîchissement
  useEffect(() => {
    const handleBeforeUnload = () => {
      liveAudioRef.current?.persistCurrentSessionMemory();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Compute unified pill state and orb state
  const effectivePillState: StatusPillState =
    simulatedState ||
    (orbState === 'error'
      ? 'error'
      : micDenied
      ? 'blocked'
      : isMuted
      ? 'muted'
      : !isActivated
      ? 'idle'
      : (orbState as StatusPillState));

  const effectiveOrbState: OrbState =
    (simulatedState as OrbState) ||
    (orbState === 'error'
      ? 'error'
      : micDenied
      ? 'blocked'
      : isMuted
      ? 'muted'
      : orbState);

  // Fenêtres dynamiques pilotées par Morix
  const [dashboardWindows, setDashboardWindows] = useState<DashboardWindowData[]>([]);

  const liveAudioRef = useRef<LiveAudioController | null>(null);

  // Registre des promesses de confirmation en attente de clic utilisateur (clé: windowId)
  const pendingConfirmationsRef = useRef<
    Map<string, (result: Record<string, unknown>) => void>
  >(new Map());

  /**
   * Ouvre une fenêtre modulaire pilotée par Morix (outil "ouvrir_fenetre")
   */
  const handleOpenModularWindow = async (params: {
    type?: WindowType;
    titre?: string;
    contenu?: string[];
    question?: string;
    description?: string;
  }): Promise<Record<string, unknown>> => {
    const windowType: WindowType = params.type || 'info';
    const finalTitle =
      params.titre?.trim() ||
      (windowType === 'confirmation'
        ? 'Confirmation requise'
        : windowType === 'liste_taches'
        ? 'Tâches à traiter'
        : 'Rapport d’activité');

    const baseWidth = windowType === 'confirmation' ? 360 : 340;
    const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const screenHeight = typeof window !== 'undefined' ? window.innerHeight : 800;

    const windowId = `window-${windowType}-${Date.now()}`;

    let items: DashboardItem[] | undefined;
    let tasks: TaskItem[] | undefined;

    if (windowType === 'liste_taches') {
      const rawList =
        Array.isArray(params.contenu) && params.contenu.length > 0
          ? params.contenu
          : ['Action prioritaire', 'Tâche secondaire'];

      tasks = rawList.map((entry, idx) => ({
        id: `task-${Date.now()}-${idx}`,
        text: typeof entry === 'string' ? entry : String(entry),
        done: false,
      }));
    } else if (windowType === 'info') {
      const rawList =
        Array.isArray(params.contenu) && params.contenu.length > 0
          ? params.contenu
          : [finalTitle];

      items = rawList.map((entry, idx) => ({
        id: `item-${Date.now()}-${idx}`,
        title: typeof entry === 'string' ? entry : String(entry),
        subtitle: params.description || 'Information transmise par Morix',
        badge: `#${idx + 1}`,
      }));
    }

    const newWindow: DashboardWindowData = {
      id: windowId,
      type: windowType,
      title: finalTitle,
      position: { x: 0, y: 0 },
      width: baseWidth,
      items,
      tasks,
      confirmation:
        windowType === 'confirmation'
          ? {
              question: params.question || params.titre || 'Confirmez-vous cette action ?',
              description: params.description,
              resolved: false,
            }
          : undefined,
    };

    // Ouvrir une vraie fenêtre Electron native séparée
    if (typeof window !== 'undefined' && window.morixAPI?.openDashboardWindow) {
      await window.morixAPI.openDashboardWindow(newWindow);
    }

    if (windowType === 'confirmation') {
      return new Promise<Record<string, unknown>>((resolve) => {
        pendingConfirmationsRef.current.set(windowId, resolve);

        setTimeout(() => {
          if (pendingConfirmationsRef.current.has(windowId)) {
            pendingConfirmationsRef.current.delete(windowId);
            resolve({
              statut: 'expire',
              reponse: 'aucune',
              message: 'L\'utilisateur n\'a pas répondu à la demande de confirmation.',
            });
          }
        }, 120000);
      });
    }

    return {
      status: 'success',
      type: windowType,
      titreAffiche: finalTitle,
      nombreElements: tasks ? tasks.length : items ? items.length : 0,
      message: `La fenêtre native [${windowType.toUpperCase()}] "${finalTitle}" a été ouverte sur le bureau.`,
    };
  };

  const handleConfirmChoice = (windowId: string, choice: 'oui' | 'non') => {
    setDashboardWindows((prev) =>
      prev.map((win) => {
        if (win.id === windowId && win.confirmation) {
          return {
            ...win,
            confirmation: {
              ...win.confirmation,
              resolved: true,
              choice,
            },
          };
        }
        return win;
      })
    );

    const resolver = pendingConfirmationsRef.current.get(windowId);
    if (resolver) {
      pendingConfirmationsRef.current.delete(windowId);
      resolver({
        status: 'success',
        reponseUtilisateur: choice,
        message: `L'utilisateur a répondu : "${choice.toUpperCase()}".`,
      });
    }
  };

  const handleCloseWindow = (id: string) => {
    const resolver = pendingConfirmationsRef.current.get(id);
    if (resolver) {
      pendingConfirmationsRef.current.delete(id);
      resolver({
        status: 'annule',
        reponseUtilisateur: 'annule',
        message: 'L\'utilisateur a fermé la fenêtre sans confirmer.',
      });
    }

    setDashboardWindows((prev) => prev.filter((w) => w.id !== id));
  };

  // Écouteurs IPC pour les fenêtres dashboard natives (confirmation et fermeture)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.morixAPI) return;

    const unsubConfirmed = window.morixAPI.onDashboardConfirmed?.((data) => {
      handleConfirmChoice(data.id, data.choice);
    });

    const unsubClosed = window.morixAPI.onDashboardClosed?.((data) => {
      handleCloseWindow(data.id);
    });

    return () => {
      unsubConfirmed?.();
      unsubClosed?.();
    };
  }, []);

  // Activation de Morix déclenchée par un clic utilisateur
  const handleActivateMorix = async () => {
    if (isActivating) return;
    setIsActivating(true);
    setMicDenied(false);

    try {
      if (!liveAudioRef.current) {
        liveAudioRef.current = createGeminiLiveAudio({
          onStateChange: (newState) => {
            setOrbState(newState);
            if (newState !== 'speaking') {
              setOutputAudioIntensity(0);
            }
          },
          onVolumeChange: (vol) => {
            setMicVolume(vol);
          },
          onOutputAudioIntensity: (intensity) => {
            setOutputAudioIntensity(intensity);
          },
          onError: (err) => {
            console.warn('[Morix App] Information flux Live :', err?.message || err);
          },
          onToolCall: async (call) => {
            if (call.name === 'afficher_ecran') {
              const data: VisualCanvasData = {
                type: call.args?.type || 'texte',
                titre: call.args?.titre,
                contenu: call.args?.contenu,
                items: Array.isArray(call.args?.items) ? call.args.items : undefined,
                langue: call.args?.langue,
                duree: call.args?.duree,
                position: call.args?.position,
              };
              setVisualCanvasData(data);
              return {
                status: 'success',
                type: data.type,
                titre: data.titre,
                message: `L'écran [${data.type.toUpperCase()}] "${data.titre || ''}" a été affiché avec succès à l'écran.`,
              };
            }
            if (call.name === 'effacer_ecran') {
              setVisualCanvasData(null);
              return {
                status: 'success',
                message: "L'écran visuel a été effacé avec succès.",
              };
            }
            if (call.name === 'ouvrir_fenetre') {
              return handleOpenModularWindow({
                type: call.args?.type,
                titre: call.args?.titre,
                contenu: call.args?.contenu,
                question: call.args?.question,
                description: call.args?.description,
              });
            }
            if (call.name === 'mettre_a_jour_statut') {
              const statut = String(call.args?.statut || '').trim();
              return {
                status: 'success',
                statut,
                message: `Statut de Morix mis à jour avec succès : "${statut}".`,
              };
            }
            return { status: 'unhandled_tool' };
          },
        });
      }

      const { micGranted } = await liveAudioRef.current.start();
      setIsActivated(true);
      if (!micGranted) {
        setMicDenied(true);
        setShowMicModal(true);
      } else {
        setMicDenied(false);
        setShowMicModal(false);
      }
    } catch (err: any) {
      console.warn('[Morix App] Session en attente d\'activation audio :', err?.message || err);
      setOrbState('idle');
      setMicDenied(true);
      setShowMicModal(true);
    } finally {
      setIsActivating(false);
    }
  };

  const handleRetryMic = async () => {
    if (!liveAudioRef.current) {
      handleActivateMorix();
      return;
    }
    setIsActivating(true);
    try {
      const granted = await liveAudioRef.current.retryMicrophone();
      if (granted) {
        setMicDenied(false);
        setShowMicModal(false);
      } else {
        setMicDenied(true);
        setShowMicModal(true);
      }
    } catch (err: any) {
      console.warn('[Morix App] Nouvelle tentative micro :', err?.message || err);
      setMicDenied(true);
      setShowMicModal(true);
    } finally {
      setIsActivating(false);
    }
  };

  const handleToggleMute = () => {
    if (liveAudioRef.current) {
      const muted = liveAudioRef.current.toggleMute();
      setIsMuted(muted);
    }
  };

  const handlePillClick = () => {
    if (!apiKeyStatus.hasKey) {
      setIsApiKeyModalOpen(true);
      return;
    }
    if (micDenied || effectivePillState === 'blocked') {
      setShowMicModal(true);
    } else if (!isActivated) {
      handleActivateMorix();
    } else {
      handleToggleMute();
    }
  };

  const handlePillClickRef = useRef(handlePillClick);
  handlePillClickRef.current = handlePillClick;

  // Abonnement au basculement micro déclenché par raccourci global (Ctrl+Shift+Space)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.morixAPI?.onToggleMic) return;
    const unsub = window.morixAPI.onToggleMic(() => {
      console.log('[Morix App] Raccourci global micro déclenché.');
      handlePillClickRef.current();
    });
    return () => unsub();
  }, []);

  // Écouteur d'événement pour tests visuels automatisés
  useEffect(() => {
    const handleTestVisual = (e: any) => {
      if (e.detail?.type === 'afficher_ecran') {
        setVisualCanvasData(e.detail.data);
      } else if (e.detail?.type === 'effacer_ecran') {
        setVisualCanvasData(null);
      }
    };
    window.addEventListener('morix:test-visual', handleTestVisual);
    return () => window.removeEventListener('morix:test-visual', handleTestVisual);
  }, []);

  const handleOpenStandalone = () => {
    if (typeof window !== 'undefined') {
      window.open(window.location.href, '_blank', 'noopener,noreferrer');
    }
  };

  // Nettoyage complet à la fermeture
  useEffect(() => {
    return () => {
      liveAudioRef.current?.stop();
    };
  }, []);

  return (
    <div
      className="app-root"
      style={{
        backgroundColor: transparentBackground ? 'transparent' : '#000000',
      }}
    >
      {/* Zone de glisser-déplacer invisible en haut de la fenêtre (Frameless Electron Drag Region) */}
      <div
        className="window-drag-region"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: '36px',
          zIndex: 35,
        }}
      />

      {/* Central 3D Particle Orb (Piloted strictly by real-time audio stream) */}
      <div id="orb-container">
        <ParticleOrb
          state={effectiveOrbState}
          transparentBackground={transparentBackground}
          audioIntensity={outputAudioIntensity}
        />
      </div>

      {/* Visual Canvas pour l'autonomie visuelle en direct de Morix */}
      <VisualCanvas
        data={visualCanvasData}
        onClose={() => setVisualCanvasData(null)}
        isOrbSpeaking={effectiveOrbState === 'speaking'}
      />

      {/* Les fenêtres Dashboard sont maintenant de vraies fenêtres Electron natives gérées par le main process */}

      {/* Discreet Gear Icon Button (Bottom-Left) */}
      <button
        type="button"
        className="window-no-drag"
        onClick={() => setIsSettingsOpen((prev) => !prev)}
        onFocus={(e) => {
          e.currentTarget.style.color = '#FFFFFF';
          e.currentTarget.style.outline = '2px solid rgba(255, 255, 255, 0.75)';
          e.currentTarget.style.outlineOffset = '3px';
        }}
        onBlur={(e) => {
          if (!isSettingsOpen) {
            e.currentTarget.style.color = 'rgba(255, 255, 255, 0.45)';
          }
          e.currentTarget.style.outline = 'none';
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsSettingsOpen((prev) => !prev);
          }
        }}
        aria-label={isSettingsOpen ? 'Fermer les paramètres' : 'Ouvrir les paramètres'}
        aria-expanded={isSettingsOpen}
        style={{
          position: 'fixed',
          bottom: '24px',
          left: '24px',
          zIndex: 40,
          width: '36px',
          height: '36px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          borderRadius: 0,
          color: isSettingsOpen ? '#FFFFFF' : 'rgba(255, 255, 255, 0.45)',
          transition: 'color 200ms ease, transform 200ms ease, outline 150ms ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = '#FFFFFF';
        }}
        onMouseLeave={(e) => {
          if (!isSettingsOpen) {
            e.currentTarget.style.color = 'rgba(255, 255, 255, 0.45)';
          }
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>

      {/* Transparent Click-Dismiss Layer for Settings */}
      {isSettingsOpen && (
        <div
          onClick={() => setIsSettingsOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 55,
            background: 'transparent',
          }}
        />
      )}

      {/* Settings Side Panel */}
      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        currentVoice={currentVoice}
        onVoiceChange={handleVoiceChange}
        currentLanguage={currentLanguage}
        onLanguageChange={handleLanguageChange}
        micSensitivity={micSensitivity}
        onMicSensitivityChange={handleMicSensitivityChange}
        devShortcutEnabled={devShortcutEnabled}
        onDevShortcutEnabledChange={handleDevShortcutEnabledChange}
        alwaysOnTop={alwaysOnTop}
        onAlwaysOnTopChange={handleAlwaysOnTopChange}
        transparentBackground={transparentBackground}
        onTransparentBackgroundChange={handleTransparentBackgroundChange}
        autoStart={autoStart}
        onAutoStartChange={handleAutoStartChange}
        maskedApiKey={apiKeyStatus.maskedKey}
        onOpenApiKeyModal={() => setIsApiKeyModalOpen(true)}
      />

      {/* Écran modal de configuration de la Clé API Gemini */}
      <ApiKeyModal
        isOpen={isApiKeyModalOpen}
        onClose={() => setIsApiKeyModalOpen(false)}
        onKeySaved={(newMaskedKey) => {
          setApiKeyStatus((prev) => ({ ...prev, hasKey: true, maskedKey: newMaskedKey }));
        }}
        canClose={apiKeyStatus.hasKey}
        currentMaskedKey={apiKeyStatus.maskedKey}
      />

      {/* Microphone Control Bar (Centre Bas - Pastille de Statut Glassmorphic Unique) */}
      <div
        className="window-no-drag"
        style={{
          position: 'fixed',
          bottom: '36px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <StatusPill
          state={effectivePillState}
          isActivated={isActivated}
          isActivating={isActivating}
          micVolume={micVolume}
          onClick={handlePillClick}
        />
      </div>

      {/* Fenêtre explicite de déblocage du micro */}
      {showMicModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Autoriser le microphone"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 90,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.78)',
            backdropFilter: 'blur(10px)',
            padding: '20px',
          }}
        >
          <div
            style={{
              width: '460px',
              maxWidth: '100%',
              backgroundColor: '#0E0E12',
              border: '1px solid rgba(245, 158, 11, 0.4)',
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.8), 0 0 30px rgba(245, 158, 11, 0.1)',
              borderRadius: 0,
              padding: '24px 26px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.25rem' }}>🎙</span>
                <span
                  style={{
                    fontSize: '0.9375rem',
                    fontWeight: 700,
                    letterSpacing: '0.01em',
                    color: '#F4F4F5',
                  }}
                >
                  Autoriser le microphone
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowMicModal(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'rgba(255, 255, 255, 0.4)',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  padding: '4px',
                }}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                fontSize: '0.8125rem',
                color: '#D4D4D8',
                lineHeight: 1.55,
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <p style={{ margin: 0, color: 'rgba(255, 255, 255, 0.85)' }}>
                Votre navigateur a bloqué l'accès au microphone pour cette page. Pour pouvoir dialoguer vocalement avec Morix, veuillez activer l'autorisation :
              </p>

              <div
                style={{
                  padding: '12px 14px',
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div>
                  <strong>1.</strong> Cliquez sur l'icône de cadenas ou de paramètres du site située à gauche de la barre d'adresse de votre navigateur.
                </div>
                <div>
                  <strong>2.</strong> Activez l'autorisation pour le <strong>Microphone</strong> (ou sélectionnez « Autoriser »).
                </div>
                <div>
                  <strong>3.</strong> Cliquez sur <strong>Réessayer</strong> ci-dessous, ou ouvrez l'application dans un onglet dédié.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
              <button
                type="button"
                onClick={handleRetryMic}
                disabled={isActivating}
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  backgroundColor: '#38BDF8',
                  border: 'none',
                  borderRadius: 0,
                  color: '#09090B',
                  fontWeight: 600,
                  fontSize: '0.8125rem',
                  cursor: isActivating ? 'wait' : 'pointer',
                  transition: 'background-color 150ms ease',
                }}
              >
                {isActivating ? 'Vérification...' : 'Réessayer l’accès au microphone'}
              </button>

              <button
                type="button"
                onClick={handleOpenStandalone}
                style={{
                  width: '100%',
                  padding: '9px 16px',
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: 0,
                  color: '#E4E4E7',
                  fontWeight: 500,
                  fontSize: '0.8125rem',
                  cursor: 'pointer',
                  transition: 'background-color 150ms ease',
                }}
              >
                Ouvrir dans un nouvel onglet plein écran ↗
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Contrôles de test des outils (Mode Dev, masqués par défaut, affichés avec Ctrl+Shift+D / Cmd+Shift+D) */}
      {showDevTools && (
        <div
          role="toolbar"
          aria-label="Contrôles de test des outils (Mode Dev)"
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '5px 8px',
            borderRadius: '9999px',
            backgroundColor: 'rgba(20, 20, 25, 0.72)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.45)',
          }}
        >
          {/* Test 1 : Liste de tâches (type liste_taches) */}
          <button
            type="button"
            onClick={() => {
              liveAudioRef.current?.sendTextMessage(
                'Morix, affiche-moi une liste de tâches avec : Appeler le client et Envoyer le devis.'
              );
            }}
            title="Test outil : Liste de tâches (type liste_taches)"
            aria-label="Test outil : Liste de tâches"
            style={{
              width: '28px',
              height: '28px',
              padding: 0,
              borderRadius: '9999px',
              cursor: 'pointer',
              border: '1px solid rgba(52, 211, 153, 0.35)',
              backgroundColor: 'rgba(52, 211, 153, 0.12)',
              color: '#A7F3D0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 150ms ease, transform 150ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(52, 211, 153, 0.25)';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(52, 211, 153, 0.12)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 11 12 14 22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          </button>

          {/* Test 2 : Question avec Oui / Non (type confirmation) */}
          <button
            type="button"
            onClick={() => {
              liveAudioRef.current?.sendTextMessage(
                'Morix, demande-moi une confirmation pour savoir si je veux continuer.'
              );
            }}
            title="Test outil : Confirmation Oui / Non (type confirmation)"
            aria-label="Test outil : Confirmation Oui / Non"
            style={{
              width: '28px',
              height: '28px',
              padding: 0,
              borderRadius: '9999px',
              cursor: 'pointer',
              border: '1px solid rgba(251, 191, 36, 0.35)',
              backgroundColor: 'rgba(251, 191, 36, 0.12)',
              color: '#FDE68A',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 150ms ease, transform 150ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(251, 191, 36, 0.25)';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(251, 191, 36, 0.12)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </button>

          {/* Test 3 : Lien externe sécurisé (outil ouvrir_lien_externe) */}
          <button
            type="button"
            onClick={() => {
              liveAudioRef.current?.sendTextMessage(
                'Morix, ouvre-moi une recherche sur les tendances du e-commerce en 2026 sur Google.'
              );
            }}
            title="Test outil : Ouverture de lien web sécurisé (ouvrir_lien_externe)"
            aria-label="Test outil : Lien Web"
            style={{
              width: '28px',
              height: '28px',
              padding: 0,
              borderRadius: '9999px',
              cursor: 'pointer',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              backgroundColor: 'rgba(56, 189, 248, 0.12)',
              color: '#BAE6FD',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 150ms ease, transform 150ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(56, 189, 248, 0.25)';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(56, 189, 248, 0.12)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </button>

          {/* Test 4 : Récapitulatif simple (type info) */}
          <button
            type="button"
            onClick={() => {
              liveAudioRef.current?.sendTextMessage(
                'Morix, montre-moi un récapitulatif de mes priorités du jour.'
              );
            }}
            title="Test outil : Rapport / Synthèse d'informations (type info)"
            aria-label="Test outil : Informations"
            style={{
              width: '28px',
              height: '28px',
              padding: 0,
              borderRadius: '9999px',
              cursor: 'pointer',
              border: '1px solid rgba(167, 139, 250, 0.35)',
              backgroundColor: 'rgba(167, 139, 250, 0.12)',
              color: '#DDD6FE',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 150ms ease, transform 150ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(167, 139, 250, 0.25)';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(167, 139, 250, 0.12)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </button>

          {/* Test 5 : Recherche Web en temps réel (outil rechercher_web) */}
          <button
            type="button"
            onClick={() => {
              liveAudioRef.current?.sendTextMessage(
                'Morix, fais une recherche web : quelles sont les dernières actualités technologiques de la semaine ?'
              );
            }}
            title="Test outil : Recherche web en direct (rechercher_web)"
            aria-label="Test outil : Recherche Web"
            style={{
              width: '28px',
              height: '28px',
              padding: 0,
              borderRadius: '9999px',
              cursor: 'pointer',
              border: '1px solid rgba(244, 114, 182, 0.35)',
              backgroundColor: 'rgba(244, 114, 182, 0.12)',
              color: '#FBCFE8',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 150ms ease, transform 150ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(244, 114, 182, 0.25)';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(244, 114, 182, 0.12)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          </button>

          {/* Séparateur discret */}
          <div
            style={{
              width: '1px',
              height: '16px',
              backgroundColor: 'rgba(255, 255, 255, 0.15)',
              margin: '0 2px',
            }}
          />

          {/* Simulateur 8 états pour la pastille & l'orbe (Zéro texte, tooltips uniquement) */}
          {(
            [
              { state: 'idle', color: '#64748B', label: 'Simuler état : idle (veille)' },
              { state: 'listening', color: '#00C3FF', label: 'Simuler état : listening (écoute)' },
              { state: 'thinking', color: '#C026D3', label: 'Simuler état : thinking (réflexion)' },
              { state: 'speaking', color: '#EC4899', label: 'Simuler état : speaking (parle)' },
              { state: 'searching', color: '#F59E0B', label: 'Simuler état : searching (recherche web)' },
              { state: 'planning', color: '#EF4444', label: 'Simuler état : planning (décision bicolore)' },
              { state: 'muted', color: '#71717A', label: 'Simuler état : muted (micro coupé)' },
              { state: 'blocked', color: '#DC2626', label: 'Simuler état : blocked (micro bloqué)' },
              { state: 'error', color: '#B91C1C', label: 'Simuler état : error (erreur réseau/quota)' },
            ] as const
          ).map((item) => {
            const isSelected = simulatedState === item.state;
            return (
              <button
                key={item.state}
                type="button"
                onClick={() =>
                  setSimulatedState((prev) => (prev === item.state ? null : item.state))
                }
                title={item.label}
                aria-label={item.label}
                style={{
                  width: '24px',
                  height: '24px',
                  padding: 0,
                  borderRadius: '9999px',
                  cursor: 'pointer',
                  border: isSelected
                    ? `2px solid #FFFFFF`
                    : `1px solid ${item.color}55`,
                  backgroundColor: isSelected ? `${item.color}66` : `${item.color}22`,
                  boxShadow: isSelected ? `0 0 10px ${item.color}` : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 150ms ease',
                }}
              >
                <span
                  style={{
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    backgroundColor: item.color,
                    boxShadow: `0 0 6px ${item.color}`,
                  }}
                />
              </button>
            );
          })}

          {/* Bouton reset simulateur (si un état est forcé) */}
          {simulatedState !== null && (
            <button
              type="button"
              onClick={() => setSimulatedState(null)}
              title="Réinitialiser en mode direct (suivi temps réel)"
              aria-label="Réinitialiser en mode direct"
              style={{
                width: '24px',
                height: '24px',
                padding: 0,
                borderRadius: '9999px',
                cursor: 'pointer',
                border: '1px solid rgba(255, 255, 255, 0.4)',
                backgroundColor: 'rgba(255, 255, 255, 0.15)',
                color: '#FFFFFF',
                fontSize: '11px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ✕
            </button>
          )}

          {/* Séparateur discret pour tests mémoire */}
          <div
            style={{
              width: '1px',
              height: '16px',
              backgroundColor: 'rgba(255, 255, 255, 0.15)',
              margin: '0 2px',
            }}
          />

          {/* Test Mémoire : Simuler enregistrement d'un souvenir */}
          <button
            type="button"
            onClick={() => {
              addSessionSummary(
                "L'utilisateur s'appelle Alexandre et prépare activement le lancement de sa plateforme SaaS dans deux semaines."
              );
              updateUserPreferences({ nomUtilisateur: 'Alexandre', langue: 'fr' });
            }}
            title="Test Mémoire : injecter un souvenir de session d'Alexandre (nom + projet SaaS)"
            aria-label="Injecter souvenir de test"
            style={{
              background: 'rgba(168, 85, 247, 0.15)',
              border: '1px solid rgba(168, 85, 247, 0.35)',
              color: '#D8B4FE',
              width: '26px',
              height: '26px',
              padding: 0,
              borderRadius: '9999px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 150ms ease',
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2a5 5 0 0 1 5 5v1a4 4 0 0 1 4 4v4a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5v-4a4 4 0 0 1 4-4V7a5 5 0 0 1 5-5z" />
              <line x1="9" y1="12" x2="15" y2="12" />
            </svg>
          </button>

          {/* Test Mémoire : Vider la mémoire locale */}
          <button
            type="button"
            onClick={() => {
              clearLocalMemory();
            }}
            title="Vider la mémoire locale (supprime tous les résumés et préférences)"
            aria-label="Vider la mémoire locale"
            style={{
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              color: '#FCA5A5',
              width: '26px',
              height: '26px',
              padding: 0,
              borderRadius: '9999px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 150ms ease',
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>

          {/* Test Sécurité : Déclencher erreur Live / Circuit Breaker */}
          <button
            type="button"
            onClick={() => {
              liveAudioRef.current?.triggerErrorState('Simulation erreur quota HTTP 429', true);
            }}
            title="Tester état d'erreur et circuit breaker (quota 429 / réseau)"
            aria-label="Tester erreur et circuit breaker"
            style={{
              background: 'rgba(220, 38, 38, 0.22)',
              border: '1px solid rgba(220, 38, 38, 0.55)',
              color: '#F87171',
              width: '26px',
              height: '26px',
              padding: 0,
              borderRadius: '9999px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 150ms ease',
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </button>

          {/* Séparateur pour tests autonomie visuelle */}
          <div
            style={{
              width: '1px',
              height: '16px',
              backgroundColor: 'rgba(255, 255, 255, 0.15)',
              margin: '0 2px',
            }}
          />

          {/* Test Visuel : Afficher écran de code */}
          <button
            type="button"
            onClick={() => {
              setVisualCanvasData({
                type: 'code',
                titre: 'Exemple de Code Synchronisé',
                contenu: 'async function synchroniserVisuel() {\n  console.log("Morix affiche en direct !");\n  return true;\n}',
                langue: 'typescript',
                position: 'droite',
              });
            }}
            title="Test Visuel : afficher écran de code à droite"
            aria-label="Tester écran code"
            style={{
              background: 'rgba(99, 102, 241, 0.22)',
              border: '1px solid rgba(99, 102, 241, 0.55)',
              color: '#A5B4FC',
              width: '26px',
              height: '26px',
              padding: 0,
              borderRadius: '9999px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '11px',
              fontWeight: 600,
            }}
          >
            &lt;/&gt;
          </button>

          {/* Test Visuel : Afficher étapes */}
          <button
            type="button"
            onClick={() => {
              setVisualCanvasData({
                type: 'etapes',
                titre: 'Étapes du Projet',
                items: [
                  '1. Initialisation de la session Gemini Live',
                  '2. Détection de la voix et analyse acoustique',
                  '3. Affichage visuel synchronisé en direct',
                ],
                position: 'centre',
              });
            }}
            title="Test Visuel : afficher étapes au centre"
            aria-label="Tester écran étapes"
            style={{
              background: 'rgba(16, 185, 129, 0.22)',
              border: '1px solid rgba(16, 185, 129, 0.55)',
              color: '#6EE7B7',
              width: '26px',
              height: '26px',
              padding: 0,
              borderRadius: '9999px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '11px',
              fontWeight: 600,
            }}
          >
            123
          </button>

          {/* Test Visuel : Effacer l'écran */}
          <button
            type="button"
            onClick={() => {
              setVisualCanvasData(null);
            }}
            title="Test Visuel : effacer écran"
            aria-label="Effacer écran test"
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              color: '#FFFFFF',
              width: '26px',
              height: '26px',
              padding: 0,
              borderRadius: '9999px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
            }}
          >
            ∅
          </button>
        </div>
      )}
    </div>
  );
}
