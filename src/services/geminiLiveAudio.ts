/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { GEMINI_CONFIG } from '../config';
import {
  getFullMorixSystemInstruction,
  MORIX_TOOLS,
  MORIX_VOICE_CONFIG,
} from '../morixPersonality';
import {
  loadLocalMemory,
  summarizeAndPersistConversation,
  updateUserPreferences,
} from './localMemory';
import { OrbState } from '../types/orb';

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
  let activeSession: any = null;

  // Web Audio Contexts & Nodes
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

  // Reconnection backoff
  let reconnectTimer: number | null = null;
  let reconnectAttempts = 0;

  // Mémoire de session & historique des échanges pour le résumé persistant
  let conversationTurns: string[] = [];
  let currentModelTurnText = '';
  let periodicSummaryTimer: number | null = null;

  // Paramètres personnalisables (voix et sensibilité micro)
  const initialPrefs = loadLocalMemory().preferences;
  let currentVoice = initialPrefs.voix || MORIX_VOICE_CONFIG.voiceName;
  let micSensitivityThreshold = 0.025 - ((initialPrefs.micSensitivity ?? 50) / 100) * 0.023;

  // Circuit breaker & gestion des erreurs (quota, réseau, runtime)
  let recentErrorTimestamps: number[] = [];
  let isCircuitBreakerTripped = false;
  let circuitBreakerCooldownTimer: number | null = null;
  let errorRevertTimer: number | null = null;

  // Limitation de sécurité sur la recherche web (5 recherches / minute max)
  let recentSearchTimestamps: number[] = [];

  const updateState = (newState: OrbState) => {
    if (currentState !== newState) {
      currentState = newState;
      options.onStateChange(newState);
    }
  };

  /**
   * Déclenche l'état visuel d'erreur temporaire ("error"),
   * et active le Circuit Breaker si 3 erreurs surviennent en < 60s ou si quota 429.
   */
  const triggerErrorState = (reason: string, isQuota: boolean = false) => {
    console.warn(`[Gemini Live Audio] Déclenchement de l'état d'erreur : "${reason}"`);
    updateState('error');

    if (errorRevertTimer) {
      clearTimeout(errorRevertTimer);
    }

    // Revenir doucement à l'état idle après 3.5 secondes
    errorRevertTimer = window.setTimeout(() => {
      if (currentState === 'error') {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          // Reste en erreur si le navigateur est physiquement hors-ligne
          return;
        }
        updateState('idle');
      }
    }, 3500);

    const now = Date.now();
    recentErrorTimestamps = recentErrorTimestamps.filter((t) => now - t < 60000);
    recentErrorTimestamps.push(now);

    // Déclenchement du circuit breaker si 3 erreurs consécutives en moins d'une minute ou erreur quota 429
    if (isQuota || recentErrorTimestamps.length >= 3) {
      if (!isCircuitBreakerTripped) {
        isCircuitBreakerTripped = true;
        console.warn(
          `[Gemini Live Audio] CIRCUIT BREAKER ENCLENCHÉ : ${recentErrorTimestamps.length} erreurs en <60s (ou quota). Reconnexions automatiques suspendues pendant 30 secondes.`
        );

        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }

        if (circuitBreakerCooldownTimer) {
          clearTimeout(circuitBreakerCooldownTimer);
        }

        circuitBreakerCooldownTimer = window.setTimeout(() => {
          console.log('[Gemini Live Audio] CIRCUIT BREAKER : Fin de la période de garde (30s). Prêt pour reprise.');
          isCircuitBreakerTripped = false;
          recentErrorTimestamps = [];
          reconnectAttempts = 0;
          if (isRunning && typeof navigator !== 'undefined' && navigator.onLine) {
            connectSession();
          }
        }, 30000);
      }
    }
  };

  // Écouteurs globaux de l'état réseau (online / offline)
  const handleOnline = () => {
    console.log('[Gemini Live Audio] Réseau rétabli (navigator.onLine = true)');
    if (currentState === 'error') {
      updateState('idle');
    }
    if (isRunning && !activeSession && !isCircuitBreakerTripped) {
      connectSession();
    }
  };

  const handleOffline = () => {
    console.warn('[Gemini Live Audio] Coupure réseau détectée (navigator.onLine = false)');
    triggerErrorState('Coupure réseau Internet détectée', false);
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
  }

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
  };

  const connectSession = async (): Promise<void> => {
    let sessionToken = '';

    // 1. Récupération d'un jeton éphémère (authTokens) généré côté serveur
    try {
      const tokenResp = await fetch(GEMINI_CONFIG.endpoints.liveToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: GEMINI_CONFIG.model }),
      });

      if (tokenResp.ok) {
        const tokenData = await tokenResp.json();
        if (tokenData?.token) {
          sessionToken = tokenData.token;
        }
      } else {
        console.warn(`[Gemini Live Audio] Réponse serveur jeton HTTP ${tokenResp.status}`);
      }
    } catch (tokenErr) {
      console.warn('[Gemini Live Audio] Erreur de communication avec le serveur pour le jeton éphémère :', tokenErr);
    }

    if (!sessionToken) {
      console.warn('[Gemini Live Audio] Échec de récupération du jeton de session Live.');
      updateState('disconnected');
      return;
    }

    const ai = new GoogleGenAI({
      apiKey: sessionToken,
      httpOptions: {
        apiVersion: 'v1alpha',
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    try {
      const session = await ai.live.connect({
        model: GEMINI_CONFIG.model,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: getFullMorixSystemInstruction(),
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: currentVoice,
              },
            },
          },
          tools: MORIX_TOOLS,
        },
        callbacks: {
          onopen: () => {
            reconnectAttempts = 0;
            if (!isSpeaking && !wasVoiceActive) {
              updateState('idle');
            }

            // Minuteur de résumé périodique d'activité
            if (!periodicSummaryTimer) {
              periodicSummaryTimer = window.setInterval(() => {
                if (conversationTurns.length >= 3) {
                  const turnsToSave = [...conversationTurns];
                  summarizeAndPersistConversation(turnsToSave).catch((e) =>
                    console.warn('[Gemini Live Audio] Erreur résumé périodique :', e)
                  );
                }
              }, 4 * 60 * 1000);
            }
          },

          onmessage: async (message: LiveServerMessage) => {
            // Détection et exécution des Function Calls (Tool Use)
            if (message.toolCall?.functionCalls && message.toolCall.functionCalls.length > 0) {
              const hasSearch = message.toolCall.functionCalls.some(
                (c) => c.name === 'rechercher_web'
              );
              if (hasSearch) {
                updateState('searching');
              } else {
                updateState('planning');
              }
              for (const call of message.toolCall.functionCalls) {
                const callName = call.name || '';
                const callId = call.id || '';
                let toolResult: Record<string, unknown> = {};

                try {
                  if (callName === 'obtenir_heure_actuelle') {
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
                  } else if (callName === 'rechercher_web') {
                    // Contrôle de sécurité : Limite de 5 recherches maximum par minute
                    const now = Date.now();
                    recentSearchTimestamps = recentSearchTimestamps.filter((t) => now - t < 60000);

                    if (recentSearchTimestamps.length >= 5) {
                      console.warn('[Gemini Live Tool] Sécurité : Limite de 5 recherches web par minute atteinte.');
                      toolResult = {
                        status: 'erreur',
                        message:
                          'Limite de sécurité atteinte : maximum 5 recherches web autorisées par minute pour éviter les requêtes en rafale. Informe l\'utilisateur que tu as atteint cette limite temporaire et réponds avec les informations déjà disponibles.',
                      };
                    } else {
                      recentSearchTimestamps.push(now);
                      const requete = String(call.args?.requete || '').trim();
                      if (!requete) {
                        toolResult = {
                          status: 'erreur',
                          message: 'Requête de recherche vide.',
                        };
                      } else {
                        try {
                          const searchResp = await fetch(GEMINI_CONFIG.endpoints.search, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ requete }),
                          });

                          if (!searchResp.ok) {
                            const errData = await searchResp.json().catch(() => null);
                            throw new Error(errData?.message || `Erreur serveur HTTP ${searchResp.status}`);
                          }

                          const searchData = await searchResp.json();
                          toolResult = {
                            status: 'success',
                            requete,
                            resultat: searchData.resultat || '',
                            sources: searchData.sources || [],
                          };
                        } catch (searchErr: any) {
                          console.warn(
                            '[Gemini Live Tool] Échec de la recherche web via serveur proxy :',
                            searchErr?.message || searchErr
                          );
                          toolResult = {
                            status: 'erreur',
                            requete,
                            message: `La recherche web n'a pas pu aboutir pour le moment (${searchErr?.message || 'service indisponible'}). Informe l'utilisateur que tu n'as pas pu vérifier l'information sur le web en direct.`,
                          };
                        }
                      }
                    }
                  } else if (callName === 'mettre_a_jour_statut') {
                    const statut = String(call.args?.statut || '').trim();
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
                    try {
                      // Timeout de sécurité de 25s pour ne jamais laisser une promesse en suspens
                      const toolPromise = Promise.resolve(
                        options.onToolCall({
                          name: callName,
                          args: call.args || {},
                        })
                      );
                      const timeoutPromise = new Promise<Record<string, unknown>>((_, reject) =>
                        setTimeout(() => reject(new Error('Délai d\'attente dépassé (timeout 25s)')), 25000)
                      );
                      toolResult = await Promise.race([toolPromise, timeoutPromise]);
                    } catch (toolCallErr: any) {
                      console.warn(`[Gemini Live Tool] Erreur execution de l'outil "${callName}" :`, toolCallErr);
                      toolResult = {
                        status: 'erreur',
                        message: `L'opération "${callName}" a échoué : ${toolCallErr?.message || 'Erreur interne'}.`,
                      };
                    }
                  } else {
                    toolResult = { status: 'acknowledged' };
                  }

                  session.sendToolResponse({
                    functionResponses: [
                      {
                        id: callId,
                        name: callName,
                        response: { output: toolResult },
                      },
                    ],
                  });
                } catch (toolError: any) {
                  console.warn(`[Gemini Live Tool] Échec de l'outil "${callName}" :`, toolError?.message || toolError);
                  try {
                    session.sendToolResponse({
                      functionResponses: [
                        {
                          id: callId,
                          name: callName,
                          response: {
                            output: {
                              status: 'erreur',
                              message: toolError?.message || 'Erreur lors de l\'exécution de l\'outil',
                            },
                          },
                        },
                      ],
                    });
                  } catch (respErr) {
                    console.warn('[Gemini Live Tool] Erreur d\'envoi de la réponse d\'erreur :', respErr);
                  }
                }
              }
            }

            // Détection d'interruption (barge-in)
            if (message.serverContent?.interrupted) {
              stopAllPlayback();
              if (wasVoiceActive) {
                updateState('listening');
              } else {
                updateState('idle');
              }
              return;
            }

            // Audio model turn parts
            const parts = message.serverContent?.modelTurn?.parts;
            if (parts) {
              for (const part of parts) {
                if (part.text) {
                  options.onTranscript?.(part.text, true);
                  currentModelTurnText += part.text;
                }
                if (part.inlineData?.data) {
                  if (thinkingTimer) {
                    clearTimeout(thinkingTimer);
                    thinkingTimer = null;
                  }
                  playPcm24kChunk(part.inlineData.data);
                }
              }
            }

            if (message.serverContent?.turnComplete) {
              // Fin de génération du tour : archivage dans le buffer de mémoire de session
              if (currentModelTurnText.trim()) {
                conversationTurns.push(`Morix : ${currentModelTurnText.trim()}`);
                currentModelTurnText = '';
              }
            }
          },

          onerror: (err: any) => {
            const errMsg = String(err?.message || err || '');
            console.warn('[Gemini Live] Notification session Live :', errMsg);
            options.onError?.(err);

            const isQuota =
              errMsg.includes('429') ||
              errMsg.toLowerCase().includes('quota') ||
              errMsg.toLowerCase().includes('rate limit');

            triggerErrorState(isQuota ? 'Quota API dépassé (HTTP 429)' : `Erreur Live : ${errMsg}`, isQuota);
          },

          onclose: () => {
            if (isRunning) {
              if (typeof navigator !== 'undefined' && !navigator.onLine) {
                triggerErrorState('Connexion Internet perdue');
                return;
              }

              if (isCircuitBreakerTripped) {
                console.log('[Gemini Live] Reconnexion automatique suspendue par le circuit breaker.');
                return;
              }

              // Après 3 tentatives infructueuses, déclencher l'état d'erreur et le circuit breaker
              if (reconnectAttempts >= 3) {
                triggerErrorState('Échec persistant de la connexion Live après 3 tentatives');
                return;
              }

              updateState('disconnected');
              const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 10000);
              reconnectAttempts++;
              console.log(`[Gemini Live] Tentative de reconnexion ${reconnectAttempts}/3 dans ${Math.round(delay)}ms...`);
              reconnectTimer = window.setTimeout(() => {
                if (isRunning && !isCircuitBreakerTripped && (typeof navigator === 'undefined' || navigator.onLine)) {
                  connectSession();
                }
              }, delay);
            }
          },
        },
      });

      activeSession = session;
    } catch (err: any) {
      console.warn('[Gemini Live] Connexion session Live différée :', err?.message || err);
      const errMsg = String(err?.message || err || '');
      const isQuota =
        errMsg.includes('429') ||
        errMsg.toLowerCase().includes('quota') ||
        errMsg.toLowerCase().includes('rate limit');
      triggerErrorState(isQuota ? 'Quota API dépassé (HTTP 429)' : `Erreur de connexion Live : ${errMsg}`, isQuota);
    }
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
      } catch (advancedConstraintErr) {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      const tracks = mediaStream.getAudioTracks();
      if (!tracks || tracks.length === 0) {
        console.warn('[Gemini Live Audio] Aucune piste audio détectée sur le flux MediaStream.');
        return false;
      }

      // 2. AudioContext pour la capture micro
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      inputAudioCtx = new AudioContextClass();
      if (inputAudioCtx.state === 'suspended') {
        await inputAudioCtx.resume();
      }

      // 3. AudioContext pour la restitution
      await ensureOutputAudioContext();

      // 4. Source MediaStream
      sourceNode = inputAudioCtx.createMediaStreamSource(mediaStream);

      // 5. ScriptProcessorNode pour le streaming PCM (bufferSize 2048 ~128ms)
      const bufferSize = 2048;
      scriptProcessor = inputAudioCtx.createScriptProcessor(bufferSize, 1, 1);

      // 6. GainNode à 0 pour éviter l'effet larsen/écho tout en maintenant le flux actif dans l'AudioContext
      muteGainNode = inputAudioCtx.createGain();
      muteGainNode.gain.value = 0;

      scriptProcessor.onaudioprocess = (e: AudioProcessingEvent) => {
        if (!isRunning) return;

        const inputChannel = e.inputBuffer.getChannelData(0);

        // Calcul RMS pour le niveau de voix et le retour visuel
        let sum = 0;
        for (let i = 0; i < inputChannel.length; i++) {
          sum += inputChannel[i] * inputChannel[i];
        }
        const rms = Math.sqrt(sum / inputChannel.length);

        // Notifier le volume actuel pour l'indicateur visuel (0 à 1)
        const currentVol = isMutedState ? 0 : Math.min(1, rms * 20);
        options.onVolumeChange?.(currentVol);

        // Si le micro est muté par l'utilisateur, ne pas émettre
        if (isMutedState) {
          return;
        }

        // Détection de voix avec seuil sensible paramétrable
        const isVoice = rms > micSensitivityThreshold;
        const now = performance.now();

        if (isVoice) {
          wasVoiceActive = true;
          silenceStartTime = 0;

          if (thinkingTimer) {
            clearTimeout(thinkingTimer);
            thinkingTimer = null;
          }

          // Si l'utilisateur prend la parole pendant que Gemini parle, couper l'audio sortant (barge-in)
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

        // CORRECTION MAJEURE : Utiliser la propriété "media" pour que le SDK @google/genai
        // génère le tableau "mediaChunks" requis par le serveur WebSocket Gemini Live.
        if (activeSession) {
          try {
            activeSession.sendRealtimeInput({
              media: {
                data: base64Audio,
                mimeType: 'audio/pcm;rate=16000',
              },
            });
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
      console.warn(
        '[Gemini Live Audio] Accès microphone refusé ou non disponible :',
        err?.message || err
      );
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

      // Établir la session Gemini Live d'abord pour être prêt à recevoir le flux
      try {
        await connectSession();
      } catch (err) {
        console.warn('[Gemini Live] Échec initialisation session :', err);
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
      const granted = await startMicrophoneCapture();
      if (granted && !activeSession) {
        await connectSession();
      }
      return granted;
    },

    sendTextMessage: (text: string) => {
      const trimmed = text.trim();
      if (trimmed) {
        conversationTurns.push(`Utilisateur : ${trimmed}`);
      }
      if (activeSession) {
        updateState('thinking');
        try {
          activeSession.sendClientContent({
            turns: [{ role: 'user', parts: [{ text }] }],
            turnComplete: true,
          });
        } catch (err) {
          console.warn('[Gemini Live] Erreur lors de sendClientContent :', err);
        }
      }
    },

    stop: () => {
      isRunning = false;
      isMutedState = false;

      if (thinkingTimer) {
        clearTimeout(thinkingTimer);
        thinkingTimer = null;
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (periodicSummaryTimer) {
        clearInterval(periodicSummaryTimer);
        periodicSummaryTimer = null;
      }
      if (circuitBreakerCooldownTimer) {
        clearTimeout(circuitBreakerCooldownTimer);
        circuitBreakerCooldownTimer = null;
      }
      if (errorRevertTimer) {
        clearTimeout(errorRevertTimer);
        errorRevertTimer = null;
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

      if (activeSession) {
        try {
          activeSession.close();
        } catch {
          // Ignorer
        }
        activeSession = null;
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
    },

    setVoice: async (voiceName: string) => {
      currentVoice = voiceName;
      updateUserPreferences({ voix: voiceName });
      if (isRunning && activeSession) {
        try {
          activeSession.close();
        } catch {
          // Ignorer
        }
        activeSession = null;
        await connectSession();
      }
    },

    setMicSensitivity: (val: number) => {
      const clamped = Math.max(0, Math.min(100, val));
      micSensitivityThreshold = 0.025 - (clamped / 100) * 0.023;
      updateUserPreferences({ micSensitivity: clamped });
    },

    setLanguage: async (lang: 'auto' | 'fr' | 'en') => {
      updateUserPreferences({ languePreference: lang });
      if (isRunning && activeSession) {
        try {
          activeSession.close();
        } catch {
          // Ignorer
        }
        activeSession = null;
        await connectSession();
      }
    },

    triggerErrorState: (reason: string, isQuota?: boolean) => {
      triggerErrorState(reason, isQuota);
    },
  };
}
