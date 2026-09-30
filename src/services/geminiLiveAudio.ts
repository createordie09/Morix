/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getFullMorixSystemInstruction,
  MORIX_VOICE_CONFIG,
} from '../morixPersonality';
import {
  loadLocalMemory,
  summarizeAndPersistConversation,
  updateUserPreferences,
} from './localMemory';
import { OrbState } from '../types/orb';

// ── Déclaration globale du pont IPC Morix exposé par preload.cjs ─────────────
declare global {
  interface Window {
    morixAPI?: {
      startSession: (config?: {
        voice?: string;
        language?: string;
        systemInstruction?: string;
      }) => Promise<{ started: boolean }>;
      stopSession: () => Promise<{ stopped: boolean }>;
      sendAudioChunk: (base64Data: string) => void;
      sendTextMessage: (text: string) => void;
      setVoice: (voiceName: string) => Promise<{ voice: string }>;
      setLanguage: (lang: string) => Promise<{ language: string }>;
      sendToolResponse: (
        callIdOrObj: any,
        name?: string,
        result?: Record<string, unknown>
      ) => void;
      persistMemory: () => Promise<{ persisted: boolean }>;
      onAudioResponse: (callback: (base64Audio: string) => void) => () => void;
      onStateChange: (callback: (state: OrbState) => void) => () => void;
      onTranscript: (
        callback: (text: string, isModel: boolean) => void
      ) => () => void;
      onInterrupted: (callback: () => void) => () => void;
      onTurnComplete: (callback: () => void) => () => void;
      onToolCall: (
        callback: (
          call: { id: string; name: string; args: any },
          callId: string,
          name: string,
          args: any
        ) => void
      ) => () => void;
      rechercherWeb: (requete: string) => Promise<{
        status: string;
        requete?: string;
        resultat?: string;
        sources?: Array<{ titre: string; url: string }>;
        message?: string;
      }>;
      resumerSession: (texte: string) => Promise<{
        status: string;
        resume?: string;
        nomUtilisateur?: string | null;
        langue?: 'fr' | 'en';
        message?: string;
      }>;
      setAlwaysOnTop?: (flag: boolean) => Promise<boolean>;
      isAlwaysOnTop?: () => Promise<boolean>;
      openDashboardWindow?: (data: any) => Promise<{ id: string; opened: boolean }>;
      closeDashboardWindow?: (id: string) => Promise<{ closed: boolean }>;
      getDashboardData?: (id: string) => Promise<any>;
      confirmDashboardChoice?: (id: string, choice: 'oui' | 'non') => Promise<{ confirmed: boolean }>;
      onDashboardConfirmed?: (callback: (data: { id: string; choice: 'oui' | 'non' }) => void) => () => void;
      onDashboardClosed?: (callback: (data: { id: string }) => void) => () => void;
      setAutostart?: (enabled: boolean) => Promise<boolean>;
      getAutostart?: () => Promise<boolean>;
      onToggleMic?: (callback: () => void) => () => void;
      getApiKeyStatus?: () => Promise<{ hasKey: boolean; isFromEnv: boolean; maskedKey: string }>;
      saveApiKey?: (apiKey: string) => Promise<{ success: boolean; maskedKey?: string; message?: string }>;
      clearApiKey?: () => Promise<{ success: boolean }>;
      onError: (callback: (errMsg: string) => void) => () => void;
      onConversationTurns: (
        callback: (turns: string[]) => void
      ) => () => void;
    };
  }
}

export interface LiveAudioController {
  start: () => Promise<{ micGranted: boolean }>;
  stop: () => void;
  toggleMute: () => boolean;
  isMuted: () => boolean;
  retryMicrophone: () => Promise<boolean>;
  sendTextMessage: (text: string) => void;
  getState: () => OrbState;
  persistCurrentSessionMemory: () => Promise<void>;
  setVoice: (voiceName: string) => Promise<void>;
  setMicSensitivity: (sensitivity: number) => void;
  setLanguage: (lang: 'auto' | 'fr' | 'en') => Promise<void>;
  triggerErrorState: (reason: string, isQuota?: boolean) => void;
}

export interface LiveAudioOptions {
  onStateChange: (state: OrbState) => void;
  onVolumeChange?: (volume: number) => void;
  onError?: (error: any) => void;
  onTranscript?: (text: string, isModel: boolean) => void;
  onToolCall?: (call: {
    name: string;
    args: any;
  }) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

export function createGeminiLiveAudio(options: LiveAudioOptions): LiveAudioController {
  let currentState: OrbState = 'idle';
  let isRunning = false;
  let isMutedState = false;

  // Web Audio Contexts & Nodes pour capture micro et rendu audio
  let inputAudioCtx: AudioContext | null = null;
  let outputAudioCtx: AudioContext | null = null;
  let mediaStream: MediaStream | null = null;
  let scriptProcessor: ScriptProcessorNode | null = null;
  let sourceNode: MediaStreamAudioSourceNode | null = null;
  let muteGainNode: GainNode | null = null;

  // Playback queue & scheduling
  let nextPlayTime = 0;
  let activeSources: AudioBufferSourceNode[] = [];
  let isSpeaking = false;

  // VAD & thinking state timers
  let silenceStartTime = 0;
  let wasVoiceActive = false;
  let thinkingTimer: number | null = null;

  // Mémoire de session & historique des échanges pour le résumé persistant
  let conversationTurns: string[] = [];
  let currentModelTurnText = '';
  let periodicSummaryTimer: number | null = null;

  // Paramètres personnalisables (voix et sensibilité micro)
  const initialPrefs = loadLocalMemory().preferences;
  let currentVoice = initialPrefs.voix || MORIX_VOICE_CONFIG.voiceName;
  let micSensitivityThreshold = 0.025 - ((initialPrefs.micSensitivity ?? 50) / 100) * 0.023;

  // Limitation de sécurité sur la recherche web (5 recherches / minute max)
  let recentSearchTimestamps: number[] = [];

  // Cleanup des listeners IPC
  const ipcUnsubscribers: (() => void)[] = [];

  const updateState = (newState: OrbState) => {
    if (currentState !== newState) {
      currentState = newState;
      options.onStateChange(newState);
    }
  };

  const triggerErrorState = (reason: string, isQuota: boolean = false) => {
    console.warn(`[Gemini Live Audio] État d'erreur : "${reason}"`);
    updateState('error');

    window.setTimeout(() => {
      if (currentState === 'error') {
        updateState('idle');
      }
    }, 3500);
  };

  function floatTo16BitPCM(
    inputData: Float32Array,
    fromRate: number,
    toRate: number = 16000
  ): ArrayBuffer {
    if (fromRate === toRate) {
      const buffer = new ArrayBuffer(inputData.length * 2);
      const view = new DataView(buffer);
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      }
      return buffer;
    }

    // Linear interpolation resampling to 16kHz
    const ratio = fromRate / toRate;
    const newLength = Math.round(inputData.length / ratio);
    const buffer = new ArrayBuffer(newLength * 2);
    const view = new DataView(buffer);

    for (let i = 0; i < newLength; i++) {
      const originalPos = i * ratio;
      const index = Math.floor(originalPos);
      const frac = originalPos - index;
      const nextIndex = Math.min(index + 1, inputData.length - 1);
      const sample = inputData[index] * (1 - frac) + inputData[nextIndex] * frac;
      const s = Math.max(-1, Math.min(1, sample));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
  }

  function arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  const stopAllPlayback = () => {
    activeSources.forEach((src) => {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Ignorer
      }
    });
    activeSources = [];
    isSpeaking = false;
    if (outputAudioCtx) {
      nextPlayTime = outputAudioCtx.currentTime;
    }
  };

  const ensureOutputAudioContext = async () => {
    if (!outputAudioCtx || outputAudioCtx.state === 'closed') {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      outputAudioCtx = new AudioContextClass({ sampleRate: 24000 });
    }
    if (outputAudioCtx.state === 'suspended') {
      await outputAudioCtx.resume();
    }
    nextPlayTime = outputAudioCtx.currentTime;
  };

  const playPcm24kChunk = (base64Audio: string) => {
    if (!outputAudioCtx || !isRunning) return;

    try {
      // Decode base64 to binary
      const binary = window.atob(base64Audio);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      const int16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768.0;
      }

      if (float32.length === 0) return;

      // Create 24kHz single channel buffer
      const audioBuffer = outputAudioCtx.createBuffer(1, float32.length, 24000);
      audioBuffer.copyToChannel(float32, 0);

      const source = outputAudioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(outputAudioCtx.destination);

      const now = outputAudioCtx.currentTime;
      const startTime = Math.max(now, nextPlayTime);
      source.start(startTime);
      nextPlayTime = startTime + audioBuffer.duration;

      isSpeaking = true;
      updateState('speaking');

      activeSources.push(source);

      source.onended = () => {
        activeSources = activeSources.filter((s) => s !== source);
        if (activeSources.length === 0) {
          isSpeaking = false;
          if (isRunning && currentState === 'speaking') {
            updateState('idle');
          }
        }
      };
    } catch (decodeErr) {
      console.warn('[Gemini Live Audio] Erreur décodage PCM24k :', decodeErr);
    }
  };

  /**
   * Configuration des écouteurs IPC morixAPI venant du processus principal
   */
  const setupIpcListeners = () => {
    if (!window.morixAPI) {
      console.warn('[Gemini Live Audio] window.morixAPI non disponible dans ce contexte.');
      return;
    }

    // Réception des chunks audio générés par le modèle
    const unAudio = window.morixAPI.onAudioResponse((base64Audio) => {
      if (thinkingTimer) {
        clearTimeout(thinkingTimer);
        thinkingTimer = null;
      }
      playPcm24kChunk(base64Audio);
    });
    ipcUnsubscribers.push(unAudio);

    // Synchronisation d'état venant du main process
    const unState = window.morixAPI.onStateChange((state) => {
      updateState(state);
    });
    ipcUnsubscribers.push(unState);

    // Transcription de texte
    const unTranscript = window.morixAPI.onTranscript((text, isModel) => {
      options.onTranscript?.(text, isModel);
      if (isModel) {
        currentModelTurnText += text;
      }
    });
    ipcUnsubscribers.push(unTranscript);

    // Interruption / barge-in
    const unInterrupted = window.morixAPI.onInterrupted(() => {
      stopAllPlayback();
      if (wasVoiceActive) {
        updateState('listening');
      } else {
        updateState('idle');
      }
    });
    ipcUnsubscribers.push(unInterrupted);

    // Fin de tour de parole du modèle
    const unTurn = window.morixAPI.onTurnComplete(() => {
      if (currentModelTurnText.trim()) {
        conversationTurns.push(`Morix : ${currentModelTurnText.trim()}`);
        currentModelTurnText = '';
      }
    });
    ipcUnsubscribers.push(unTurn);

    // Réception des Function Calls (outils)
    const unTool = window.morixAPI.onToolCall(async (toolCall, callId, callName, callArgs) => {
      const name = callName || toolCall?.name || '';
      const id = callId || toolCall?.id || (toolCall as any)?.callId || '';
      const args = callArgs || toolCall?.args || {};

      console.log(`[Gemini Live Tool IPC] Réception tool call : "${name}" (id: ${id})`);

      let toolResult: Record<string, unknown> = {};

      try {
        if (name === 'obtenir_heure_actuelle') {
          try {
            const now = new Date();
            const heure = now.toLocaleTimeString('fr-FR', {
              hour: '2-digit',
              minute: '2-digit',
            });
            const date = now.toLocaleDateString('fr-FR', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            });
            toolResult = {
              heure,
              date,
              fuseau: Intl.DateTimeFormat().resolvedOptions().timeZone,
              texte: `Il est actuellement ${heure} (${date}).`,
            };
          } catch (clockErr: any) {
            toolResult = {
              status: 'erreur',
              message: `Erreur lecture horloge : ${clockErr?.message || 'indisponible'}`,
            };
          }
        } else if (name === 'rechercher_web') {
          const now = Date.now();
          recentSearchTimestamps = recentSearchTimestamps.filter((t) => now - t < 60000);

          if (recentSearchTimestamps.length >= 5) {
            toolResult = {
              status: 'erreur',
              message:
                'Limite de sécurité atteinte : maximum 5 recherches web autorisées par minute. Réponds avec les données déjà connues.',
            };
          } else {
            recentSearchTimestamps.push(now);
            const requete = String(args?.requete || '').trim();
            if (!requete) {
              toolResult = {
                status: 'erreur',
                message: 'Requête de recherche vide.',
              };
            } else {
              try {
                if (window.morixAPI?.rechercherWeb) {
                  const searchData = await window.morixAPI.rechercherWeb(requete);
                  toolResult = {
                    status: searchData.status || 'success',
                    requete,
                    resultat: searchData.resultat || searchData.message || '',
                    sources: searchData.sources || [],
                  };
                } else {
                  throw new Error('IPC rechercherWeb non disponible');
                }
              } catch (searchErr: any) {
                toolResult = {
                  status: 'erreur',
                  requete,
                  message: `La recherche web n'a pas pu aboutir (${searchErr?.message || 'indisponible'}).`,
                };
              }
            }
          }
        } else if (name === 'mettre_a_jour_statut') {
          const statut = String(args?.statut || '').trim();
          if (options.onToolCall) {
            try {
              toolResult = await options.onToolCall({
                name: 'mettre_a_jour_statut',
                args: { statut },
              });
            } catch (statusErr: any) {
              toolResult = {
                status: 'erreur',
                message: `Erreur mise à jour statut : ${statusErr?.message || 'indisponible'}`,
              };
            }
          } else {
            toolResult = {
              status: 'success',
              statut,
              message: `Statut mis à jour : "${statut}".`,
            };
          }
        } else if (options.onToolCall) {
          // Outil externe (ex: ouvrir_fenetre) manipulé par l'UI React
          try {
            const toolPromise = Promise.resolve(
              options.onToolCall({
                name,
                args: args || {},
              })
            );
            const timeoutPromise = new Promise<Record<string, unknown>>((_, reject) =>
              setTimeout(() => reject(new Error('Délai d\'attente dépassé (timeout 120s)')), 120000)
            );
            toolResult = await Promise.race([toolPromise, timeoutPromise]);
          } catch (toolCallErr: any) {
            toolResult = {
              status: 'erreur',
              message: `L'opération "${name}" a échoué : ${toolCallErr?.message || 'Erreur interne'}.`,
            };
          }
        } else {
          toolResult = { status: 'acknowledged' };
        }

        // Renvoyer le résultat au main process via IPC
        window.morixAPI?.sendToolResponse(id, name, toolResult);
      } catch (toolError: any) {
        console.warn(`[Gemini Live Tool IPC] Échec outil "${name}" :`, toolError?.message || toolError);
        window.morixAPI?.sendToolResponse(id, name, {
          status: 'erreur',
          message: toolError?.message || 'Erreur lors de l\'exécution de l\'outil',
        });
      }
    });
    ipcUnsubscribers.push(unTool);

    // Notifications d'erreur
    const unErr = window.morixAPI.onError((errMsg) => {
      options.onError?.(new Error(errMsg));
      triggerErrorState(errMsg);
    });
    ipcUnsubscribers.push(unErr);

    // Synchronisation périodique des résumés transmise par le main process
    const unTurns = window.morixAPI.onConversationTurns((turns) => {
      if (turns && turns.length > 0) {
        summarizeAndPersistConversation(turns).catch((e) =>
          console.warn('[Gemini Live Audio] Erreur résumé automatique :', e)
        );
      }
    });
    ipcUnsubscribers.push(unTurns);
  };

  const startMicrophoneCapture = async (): Promise<boolean> => {
    if (!navigator?.mediaDevices?.getUserMedia) {
      console.warn('[Gemini Live Audio] getUserMedia indisponible dans cet environnement.');
      return false;
    }

    try {
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      const tracks = mediaStream.getAudioTracks();
      if (!tracks || tracks.length === 0) {
        return false;
      }

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      inputAudioCtx = new AudioContextClass();
      if (inputAudioCtx.state === 'suspended') {
        await inputAudioCtx.resume();
      }

      await ensureOutputAudioContext();

      sourceNode = inputAudioCtx.createMediaStreamSource(mediaStream);

      const bufferSize = 2048;
      scriptProcessor = inputAudioCtx.createScriptProcessor(bufferSize, 1, 1);

      muteGainNode = inputAudioCtx.createGain();
      muteGainNode.gain.value = 0;

      scriptProcessor.onaudioprocess = (e: AudioProcessingEvent) => {
        if (!isRunning) return;

        const inputChannel = e.inputBuffer.getChannelData(0);

        let sum = 0;
        for (let i = 0; i < inputChannel.length; i++) {
          sum += inputChannel[i] * inputChannel[i];
        }
        const rms = Math.sqrt(sum / inputChannel.length);

        const currentVol = isMutedState ? 0 : Math.min(1, rms * 20);
        options.onVolumeChange?.(currentVol);

        if (isMutedState) {
          return;
        }

        const isVoice = rms > micSensitivityThreshold;
        const now = performance.now();

        if (isVoice) {
          wasVoiceActive = true;
          silenceStartTime = 0;

          if (thinkingTimer) {
            clearTimeout(thinkingTimer);
            thinkingTimer = null;
          }

          if (isSpeaking) {
            stopAllPlayback();
          }

          updateState('listening');
        } else if (wasVoiceActive) {
          if (silenceStartTime === 0) {
            silenceStartTime = now;
          } else if (now - silenceStartTime > 380) {
            wasVoiceActive = false;
            silenceStartTime = 0;

            if (!isSpeaking) {
              updateState('thinking');

              if (thinkingTimer) clearTimeout(thinkingTimer);
              thinkingTimer = window.setTimeout(() => {
                if (currentState === 'thinking' && !isSpeaking) {
                  updateState('idle');
                }
              }, 6000);
            }
          }
        }

        // Conversion vers PCM 16-bit 16kHz
        const pcm16 = floatTo16BitPCM(inputChannel, inputAudioCtx!.sampleRate, 16000);
        const base64Audio = arrayBufferToBase64(pcm16);

        // Relai du flux audio capté au processus principal via le pont IPC
        if (window.morixAPI) {
          try {
            window.morixAPI.sendAudioChunk(base64Audio);
          } catch {
            // Ignorer les erreurs transitoires
          }
        }
      };

      sourceNode.connect(scriptProcessor);
      scriptProcessor.connect(muteGainNode);
      muteGainNode.connect(inputAudioCtx.destination);

      return true;
    } catch (err: any) {
      console.warn('[Gemini Live Audio] Accès microphone non disponible :', err?.message || err);
      if (inputAudioCtx && inputAudioCtx.state !== 'closed') {
        try {
          inputAudioCtx.close();
        } catch {
          // Ignorer
        }
        inputAudioCtx = null;
      }
      return false;
    }
  };

  return {
    start: async (): Promise<{ micGranted: boolean }> => {
      isRunning = true;
      isMutedState = false;
      await ensureOutputAudioContext();

      // Enregistrer les écouteurs IPC
      setupIpcListeners();

      // Démarrer la session Gemini Live côté processus principal Electron
      if (window.morixAPI) {
        try {
          await window.morixAPI.startSession({
            voice: currentVoice,
            systemInstruction: getFullMorixSystemInstruction(),
          });
        } catch (err) {
          console.warn('[Gemini Live] Échec initialisation session IPC :', err);
        }
      }

      // Initialiser la capture microphone
      let micGranted = false;
      try {
        micGranted = await startMicrophoneCapture();
      } catch {
        micGranted = false;
      }

      updateState('idle');
      return { micGranted };
    },

    toggleMute: (): boolean => {
      isMutedState = !isMutedState;
      if (isMutedState && currentState === 'listening') {
        updateState('idle');
      }
      return isMutedState;
    },

    isMuted: (): boolean => isMutedState,

    retryMicrophone: async (): Promise<boolean> => {
      await ensureOutputAudioContext();
      return await startMicrophoneCapture();
    },

    sendTextMessage: (text: string) => {
      const trimmed = text.trim();
      if (trimmed) {
        conversationTurns.push(`Utilisateur : ${trimmed}`);
      }
      updateState('thinking');
      if (window.morixAPI) {
        window.morixAPI.sendTextMessage(text);
      }
    },

    stop: () => {
      isRunning = false;
      isMutedState = false;

      if (thinkingTimer) {
        clearTimeout(thinkingTimer);
        thinkingTimer = null;
      }
      if (periodicSummaryTimer) {
        clearInterval(periodicSummaryTimer);
        periodicSummaryTimer = null;
      }

      // Persistance automatique du résumé de session
      if (currentModelTurnText.trim()) {
        conversationTurns.push(`Morix : ${currentModelTurnText.trim()}`);
        currentModelTurnText = '';
      }
      if (conversationTurns.length > 0) {
        const turnsToSave = [...conversationTurns];
        conversationTurns = [];
        summarizeAndPersistConversation(turnsToSave).catch((err) =>
          console.warn('[Gemini Live Audio] Erreur résumé fin de session :', err)
        );
      }

      stopAllPlayback();

      if (scriptProcessor && sourceNode) {
        try {
          sourceNode.disconnect();
          scriptProcessor.disconnect();
        } catch {
          // Ignorer
        }
      }

      if (muteGainNode) {
        try {
          muteGainNode.disconnect();
        } catch {
          // Ignorer
        }
        muteGainNode = null;
      }

      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
        mediaStream = null;
      }

      if (inputAudioCtx && inputAudioCtx.state !== 'closed') {
        inputAudioCtx.close();
        inputAudioCtx = null;
      }

      if (outputAudioCtx && outputAudioCtx.state !== 'closed') {
        outputAudioCtx.close();
        outputAudioCtx = null;
      }

      // Désabonnement des listeners IPC
      while (ipcUnsubscribers.length > 0) {
        const unsub = ipcUnsubscribers.pop();
        if (unsub) {
          try {
            unsub();
          } catch {
            // Ignorer
          }
        }
      }

      // Arrêt de la session côté main process
      if (window.morixAPI) {
        window.morixAPI.stopSession().catch(() => {});
      }

      updateState('idle');
    },

    getState: () => currentState,

    persistCurrentSessionMemory: async () => {
      if (currentModelTurnText.trim()) {
        conversationTurns.push(`Morix : ${currentModelTurnText.trim()}`);
        currentModelTurnText = '';
      }
      if (conversationTurns.length > 0) {
        const turnsToSave = [...conversationTurns];
        conversationTurns = [];
        await summarizeAndPersistConversation(turnsToSave);
      }
      if (window.morixAPI) {
        await window.morixAPI.persistMemory().catch(() => {});
      }
    },

    setVoice: async (voiceName: string) => {
      currentVoice = voiceName;
      updateUserPreferences({ voix: voiceName });
      if (window.morixAPI) {
        await window.morixAPI.setVoice(voiceName);
      }
    },

    setMicSensitivity: (val: number) => {
      const clamped = Math.max(0, Math.min(100, val));
      micSensitivityThreshold = 0.025 - (clamped / 100) * 0.023;
      updateUserPreferences({ micSensitivity: clamped });
    },

    setLanguage: async (lang: 'auto' | 'fr' | 'en') => {
      updateUserPreferences({ languePreference: lang });
      if (window.morixAPI) {
        await window.morixAPI.setLanguage(lang);
      }
    },

    triggerErrorState: (reason: string, isQuota?: boolean) => {
      triggerErrorState(reason, isQuota);
    },
  };
}
