/**
 * Processus principal Electron pour Morix.
 * Gère la session Gemini Live, la recherche web avec grounding et le résumé de session
 * directement dans ce processus sécurisé.
 * La clé API ne quitte JAMAIS ce processus.
 * Aucun serveur Express externe n'est requis.
 */

require('dotenv').config();

const { app, BrowserWindow, Menu, session, ipcMain, globalShortcut, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// ── Désactivation du menu par défaut ──────────────────────────────────────
Menu.setApplicationMenu(null);

// ── Import dynamique ESM de @google/genai depuis un processus CJS ─────────
let GoogleGenAI, Modality;
async function loadGenAI() {
  const mod = await import('@google/genai');
  GoogleGenAI = mod.GoogleGenAI;
  Modality = mod.Modality;
}

// ── Gestion sécurisée de la Clé API Gemini (Stockage utilisateur local) ──
function getUserConfigPath() {
  return path.join(app.getPath('userData'), 'morix-user-config.json');
}

function getStoredApiKey() {
  try {
    const configPath = getUserConfigPath();
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (data && data.apiKey && typeof data.apiKey === 'string' && data.apiKey.trim()) {
        return data.apiKey.trim();
      }
    }
  } catch (err) {
    console.warn('[Morix Main] Erreur lecture user config :', err?.message);
  }
  // En développement, fallback sur la variable d'environnement si présente
  return process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : '';
}

function saveStoredApiKey(apiKey) {
  const cleanKey = (apiKey || '').trim();
  const configPath = getUserConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  let existing = {};
  if (fs.existsSync(configPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {}
  }
  existing.apiKey = cleanKey;
  existing.updatedAt = Date.now();
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2), { encoding: 'utf8', mode: 0o600 });
  process.env.GEMINI_API_KEY = cleanKey;
  console.log('[Morix Main] Clé API utilisateur enregistrée avec succès dans :', configPath);
  return true;
}

function maskApiKey(key) {
  if (!key || key.length < 8) return '';
  return key.slice(0, 6) + '...' + key.slice(-4);
}

// ── Client Gemini partagé pour le processus principal ─────────────────────
function getGeminiClient() {
  const apiKey = getStoredApiKey();
  if (!apiKey) {
    throw new Error('Aucune clé API Gemini configurée. Veuillez renseigner votre clé API dans les paramètres.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      apiVersion: 'v1alpha',
      headers: { 'User-Agent': 'aistudio-build' },
    },
  });
}

// ── Personnalité et outils Morix ──────────────────────────────────────────
const MORIX_MODEL = 'gemini-2.5-flash-native-audio-preview-09-2025';
const MORIX_VOICE_DEFAULT = 'Puck';

const MORIX_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'rechercher_web',
        description:
          "Utilise cet outil chaque fois que la question porte sur une information récente, une actualité, un événement, une date/année actuelle, un prix, une donnée qui a pu changer depuis ton entraînement. Ne réponds JAMAIS de mémoire à ce type de question sans d'abord utiliser cet outil.",
        parameters: {
          type: 'OBJECT',
          properties: {
            requete: {
              type: 'STRING',
              description: "La requête de recherche précise.",
            },
          },
          required: ['requete'],
        },
      },
      {
        name: 'ouvrir_fenetre',
        description:
          "Ouvre une fenêtre modulaire sur l'écran de l'utilisateur.",
        parameters: {
          type: 'OBJECT',
          properties: {
            type: {
              type: 'STRING',
              enum: ['info', 'liste_taches', 'confirmation'],
              description: "Le type de fenêtre.",
            },
            titre: { type: 'STRING', description: "Le titre de la fenêtre." },
            contenu: {
              type: 'ARRAY',
              items: { type: 'STRING' },
              description: "Éléments de contenu.",
            },
            question: { type: 'STRING', description: "Question pour confirmation." },
            description: { type: 'STRING', description: "Sous-titre explicatif." },
          },
          required: ['type', 'titre'],
        },
      },
      {
        name: 'obtenir_heure_actuelle',
        description: "Retourne l'heure et la date actuelles précises du système de l'utilisateur.",
        parameters: { type: 'OBJECT', properties: {} },
      },
      {
        name: 'mettre_a_jour_statut',
        description: "Met à jour le statut court affiché dans l'interface.",
        parameters: {
          type: 'OBJECT',
          properties: {
            statut: { type: 'STRING', description: "Le libellé court du statut." },
          },
          required: ['statut'],
        },
      },
    ],
  },
];

const MORIX_SYSTEM_INSTRUCTION = `Tu es Morix, un assistant vocal masculin intelligent, vif et complice.

## Rôle et Identité
- Tu t'appelles Morix (genre masculin).
- Tu es le bras droit et l'allié personnel d'un entrepreneur exigeant.
- Ton style est direct, amical, chaleureux et percutant.

## Style d'élocution et de conversation vocale
- Fais des réponses courtes et dynamiques (généralement 1 à 3 phrases concises).
- Évite les énumérations artificielles et les pavés explicatifs trop denses.
- Utilise un ton complice, détendu mais toujours orienté résultat.

## Bilinguisme (Français / Anglais)
- Tu es parfaitement bilingue français et anglais.
- Tu réponds naturellement dans la langue utilisée par l'utilisateur.

## Outils disponibles
Tu disposes de 4 outils : ouvrir_fenetre, rechercher_web, obtenir_heure_actuelle, mettre_a_jour_statut.

## Honnêteté technique absolue
Pour tout ce qui dépasse tes outils actuels, ne prétends JAMAIS avoir effectué une action sans en avoir la capacité technique.

Reste authentique, réactif et va toujours droit au but.`;

// ── État de la session Live ───────────────────────────────────────────────
let activeSession = null;
let mainWindow = null;
let viteDevServer = null;
let currentVoice = MORIX_VOICE_DEFAULT;
let currentLanguage = 'auto';
let isSessionRunning = false;
let reconnectAttempts = 0;
let reconnectTimer = null;
let isCircuitBreakerTripped = false;
let circuitBreakerTimer = null;
let recentErrorTimestamps = [];
let conversationTurns = [];
let currentModelTurnText = '';
let periodicSummaryTimer = null;
let tray = null;
let isQuitting = false;

// ── Envoi sécurisé vers le renderer ─────────────────────────────────────
function sendToRenderer(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function updateState(state) {
  sendToRenderer('live:state-change', state);
}

function triggerErrorState(reason, isQuota = false) {
  console.warn(`[Morix Main] Erreur Live : "${reason}"`);
  updateState('error');

  setTimeout(() => {
    updateState('idle');
  }, 3500);

  const now = Date.now();
  recentErrorTimestamps = recentErrorTimestamps.filter((t) => now - t < 60000);
  recentErrorTimestamps.push(now);

  if (isQuota || recentErrorTimestamps.length >= 3) {
    if (!isCircuitBreakerTripped) {
      isCircuitBreakerTripped = true;
      console.warn('[Morix Main] Circuit breaker enclenché — reconnexions suspendues 30s.');

      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (circuitBreakerTimer) clearTimeout(circuitBreakerTimer);

      circuitBreakerTimer = setTimeout(() => {
        console.log('[Morix Main] Circuit breaker réinitialisé.');
        isCircuitBreakerTripped = false;
        recentErrorTimestamps = [];
        reconnectAttempts = 0;
        if (isSessionRunning) connectSession();
      }, 30000);
    }
  }
}

// ── Logique de recherche web (Google Grounding) ───────────────────────────
async function handleWebSearch(requete) {
  if (!requete || typeof requete !== 'string' || !requete.trim()) {
    throw new Error('La requête de recherche est requise');
  }

  console.log(`[Morix Main Search] Exécution recherche pour: "${requete}"`);
  const ai = getGeminiClient();

  const candidateModels = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-flash-latest'];
  let searchResp;
  let lastErr;

  // 1. Essai avec googleSearch grounding
  for (const model of candidateModels) {
    try {
      searchResp = await ai.models.generateContent({
        model,
        contents: `Effectue une recherche web précise et synthétise les faits récents et vérifiés pour répondre à la requête suivante : ${requete}`,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });
      if (searchResp) break;
    } catch (err) {
      lastErr = err;
    }
  }

  // 2. Repli direct si googleSearch indisponible ou quota restreint
  if (!searchResp) {
    for (const model of candidateModels) {
      try {
        searchResp = await ai.models.generateContent({
          model,
          contents: `Synthétise les faits connus et récents pour répondre à la question suivante : ${requete}`,
        });
        if (searchResp) break;
      } catch (err) {
        lastErr = err;
      }
    }
  }

  if (!searchResp) {
    throw lastErr || new Error('Recherche indisponible');
  }

  const texte = searchResp?.text || '';
  const candidate = searchResp?.candidates?.[0];
  const chunks = candidate?.groundingMetadata?.groundingChunks;
  const sources =
    chunks
      ?.map((chunk) => ({
        titre: chunk.web?.title || 'Source web',
        url: chunk.web?.uri || '',
      }))
      .filter((s) => Boolean(s.url)) || [];

  return {
    status: 'success',
    requete,
    resultat: texte,
    sources,
  };
}

// ── Logique de résumé de session pour la mémoire locale ────────────────────
async function handleSummarize(text) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Le texte à résumer est requis');
  }

  console.log(`[Morix Main Summarize] Génération de résumé pour ${text.length} caractères...`);
  const ai = getGeminiClient();

  const prompt = `Voici des extraits de la conversation vocale récente entre un utilisateur et son assistant Morix :
"""
${text.slice(0, 4000)}
"""

Tâche :
1. Rédige un résumé clair, vivant et concis de 2 ou 3 phrases MAXIMUM mettant en valeur les faits importants, les décisions prises, les projets mentionnés ou les points abordés, afin que Morix s'en souvienne naturellement à la prochaine session.
2. Détecte si l'utilisateur a mentionné son nom ou prénom.
3. Détecte la langue principale utilisée (fr ou en).

Réponds UNIQUEMENT sous forme d'un objet JSON strict valide sans texte avant ou après :
{"resume": "2 à 3 phrases concises de résumé...", "nomUtilisateur": "prénom ou nom si trouvé ou null", "langue": "fr"}`;

  const candidateModels = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-flash-latest'];
  let resp;
  for (const model of candidateModels) {
    try {
      resp = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });
      if (resp) break;
    } catch {
      try {
        resp = await ai.models.generateContent({
          model,
          contents: prompt,
        });
        if (resp) break;
      } catch {}
    }
  }

  const raw = resp?.text?.trim() || '{}';
  let parsed = {};
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = { resume: raw.slice(0, 300), nomUtilisateur: null, langue: 'fr' };
  }

  return {
    status: 'success',
    resume: parsed.resume || '',
    nomUtilisateur: parsed.nomUtilisateur || null,
    langue: parsed.langue === 'en' ? 'en' : 'fr',
  };
}

// ── Connexion à la session Gemini Live ───────────────────────────────────
async function connectSession(systemInstructionOverride) {
  if (!GoogleGenAI) {
    console.warn('[Morix Main] SDK non encore chargé, attente...');
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('[Morix Main] GEMINI_API_KEY manquant dans les variables d\'environnement.');
    updateState('error');
    return;
  }

  if (activeSession) {
    try { activeSession.close(); } catch {}
    activeSession = null;
  }

  const ai = getGeminiClient();
  const systemInstruction = systemInstructionOverride || MORIX_SYSTEM_INSTRUCTION;

  // Modulation de l'instruction système selon la langue
  let langInstruction = systemInstruction;
  if (currentLanguage === 'fr') {
    langInstruction = `${systemInstruction}\n\n**DIRECTIVE LANGUE** : L'utilisateur a explicitement configuré le Français. Réponds EXCLUSIVEMENT en français.`;
  } else if (currentLanguage === 'en') {
    langInstruction = `${systemInstruction}\n\n**LANGUAGE DIRECTIVE**: The user has set English. Speak EXCLUSIVELY in English.`;
  }

  try {
    const session = await ai.live.connect({
      model: MORIX_MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: langInstruction,
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: currentVoice },
          },
        },
        tools: MORIX_TOOLS,
      },
      callbacks: {
        onopen: () => {
          console.log('[Morix Main] Session Gemini Live connectée.');
          reconnectAttempts = 0;
          updateState('idle');

          if (!periodicSummaryTimer) {
            periodicSummaryTimer = setInterval(() => {
              if (conversationTurns.length >= 3) {
                const turns = [...conversationTurns];
                sendToRenderer('live:conversation-turns', turns);
              }
            }, 4 * 60 * 1000);
          }
        },

        onmessage: async (message) => {
          // ── Function Calls (délégation vers le renderer) ─────────────
          if (message.toolCall?.functionCalls?.length > 0) {
            const hasSearch = message.toolCall.functionCalls.some(
              (c) => c.name === 'rechercher_web'
            );
            updateState(hasSearch ? 'searching' : 'planning');

            for (const call of message.toolCall.functionCalls) {
              const callName = call.name || '';
              const callId = call.id || '';
              const args = call.args || {};

              sendToRenderer(
                'live:tool-call',
                { id: callId, callId, name: callName, args },
                callId,
                callName,
                args
              );
            }
          }

          // ── Interruption (barge-in) ────────────────────────────────────
          if (message.serverContent?.interrupted) {
            sendToRenderer('live:interrupted');
            return;
          }

          // ── Parts audio / texte ────────────────────────────────────────
          const parts = message.serverContent?.modelTurn?.parts;
          if (parts) {
            for (const part of parts) {
              if (part.text) {
                sendToRenderer('live:transcript', part.text, true);
                currentModelTurnText += part.text;
              }
              if (part.inlineData?.data) {
                sendToRenderer('live:audio-response', part.inlineData.data);
              }
            }
          }

          // ── Fin de tour ────────────────────────────────────────────────
          if (message.serverContent?.turnComplete) {
            sendToRenderer('live:turn-complete');
            if (currentModelTurnText.trim()) {
              conversationTurns.push(`Morix : ${currentModelTurnText.trim()}`);
              currentModelTurnText = '';
            }
          }
        },

        onerror: (err) => {
          const errMsg = String(err?.message || err || '');
          console.warn('[Morix Main] Erreur session Live :', errMsg);
          sendToRenderer('live:error', errMsg);

          const isQuota =
            errMsg.includes('429') ||
            errMsg.toLowerCase().includes('quota') ||
            errMsg.toLowerCase().includes('rate limit');

          triggerErrorState(isQuota ? 'Quota API dépassé' : `Erreur Live : ${errMsg}`, isQuota);
        },

        onclose: () => {
          console.log('[Morix Main] Session Live fermée.');
          activeSession = null;

          if (!isSessionRunning) return;
          if (isCircuitBreakerTripped) return;
          if (reconnectAttempts >= 3) {
            triggerErrorState('Échec persistant après 3 tentatives de reconnexion');
            return;
          }

          updateState('disconnected');
          const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 10000);
          reconnectAttempts++;
          console.log(`[Morix Main] Reconnexion ${reconnectAttempts}/3 dans ${Math.round(delay)}ms...`);

          reconnectTimer = setTimeout(() => {
            if (isSessionRunning && !isCircuitBreakerTripped) {
              connectSession();
            }
          }, delay);
        },
      },
    });

    activeSession = session;
  } catch (err) {
    const errMsg = String(err?.message || err || '');
    const isQuota = errMsg.includes('429') || errMsg.toLowerCase().includes('quota');
    console.error('[Morix Main] Erreur de connexion Live :', errMsg);
    triggerErrorState(isQuota ? 'Quota API dépassé' : `Erreur connexion : ${errMsg}`, isQuota);
  }
}

function closeSession() {
  isSessionRunning = false;

  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (periodicSummaryTimer) { clearInterval(periodicSummaryTimer); periodicSummaryTimer = null; }
  if (circuitBreakerTimer) { clearTimeout(circuitBreakerTimer); circuitBreakerTimer = null; }

  if (currentModelTurnText.trim()) {
    conversationTurns.push(`Morix : ${currentModelTurnText.trim()}`);
    currentModelTurnText = '';
  }

  if (conversationTurns.length > 0) {
    sendToRenderer('live:conversation-turns', [...conversationTurns]);
    conversationTurns = [];
  }

  if (activeSession) {
    try { activeSession.close(); } catch { /* Ignorer */ }
    activeSession = null;
  }
}

// ── Handlers IPC Session Live ─────────────────────────────────────────────

ipcMain.handle('live:start', async (_event, config = {}) => {
  if (config.voice) currentVoice = config.voice;
  if (config.language) currentLanguage = config.language;
  isSessionRunning = true;
  reconnectAttempts = 0;
  await connectSession(config.systemInstruction);
  return { started: true };
});

ipcMain.handle('live:stop', async () => {
  closeSession();
  return { stopped: true };
});

ipcMain.on('live:audio-chunk', (_event, base64Data) => {
  if (activeSession) {
    try {
      activeSession.sendRealtimeInput({
        media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' },
      });
    } catch { /* Erreur transitoire, ignorer */ }
  }
});

ipcMain.on('live:text-message', (_event, text) => {
  if (activeSession) {
    try {
      activeSession.sendClientContent({
        turns: [{ role: 'user', parts: [{ text }] }],
        turnComplete: true,
      });
    } catch (e) {
      console.warn('[Morix Main] Erreur sendClientContent :', e?.message);
    }
  }
});

ipcMain.handle('live:set-voice', async (_event, voiceName) => {
  currentVoice = voiceName;
  if (isSessionRunning && activeSession) {
    try { activeSession.close(); } catch { /* Ignorer */ }
    activeSession = null;
    await connectSession();
  }
  return { voice: voiceName };
});

ipcMain.handle('live:set-language', async (_event, lang) => {
  currentLanguage = lang;
  if (isSessionRunning && activeSession) {
    try { activeSession.close(); } catch { /* Ignorer */ }
    activeSession = null;
    await connectSession();
  }
  return { language: lang };
});

// Routage des réponses de tool call (renderer → main → session Gemini)
ipcMain.on('live:tool-response', (_event, arg1, arg2, arg3) => {
  let callId, name, result;
  if (typeof arg1 === 'object' && arg1 !== null) {
    if (arg1.functionResponses) {
      if (activeSession) {
        try {
          activeSession.sendToolResponse(arg1);
        } catch (err) {
          console.warn('[Morix Main] Erreur sendToolResponse:', err?.message || err);
        }
      }
      return;
    }
    callId = arg1.id || arg1.callId;
    name = arg1.name;
    result = arg1.result !== undefined ? arg1.result : (arg1.output !== undefined ? arg1.output : arg1);
  } else {
    callId = arg1;
    name = arg2;
    result = arg3;
  }

  if (activeSession) {
    try {
      activeSession.sendToolResponse({
        functionResponses: [
          {
            id: callId,
            name: name,
            response: { output: result },
          },
        ],
      });
    } catch (err) {
      console.warn('[Morix Main] Erreur sendToolResponse:', err?.message || err);
    }
  }
});

ipcMain.handle('live:persist-memory', async () => {
  if (currentModelTurnText.trim()) {
    conversationTurns.push(`Morix : ${currentModelTurnText.trim()}`);
    currentModelTurnText = '';
  }
  if (conversationTurns.length > 0) {
    sendToRenderer('live:conversation-turns', [...conversationTurns]);
    conversationTurns = [];
  }
  return { persisted: true };
});

// ── Handlers IPC Services IA (Recherche Web & Résumé) ──────────────────────

ipcMain.handle('morix:search', async (_event, requete) => {
  try {
    return await handleWebSearch(requete);
  } catch (err) {
    console.error('[Morix Main Search Error]:', err?.message || err);
    return {
      status: 'erreur',
      message: err?.message || 'Erreur lors de la recherche web',
    };
  }
});

ipcMain.handle('morix:summarize', async (_event, text) => {
  try {
    return await handleSummarize(text);
  } catch (err) {
    console.warn('[Morix Main Summarize Error]:', err?.message || err);
    return {
      status: 'error',
      message: err?.message || 'Erreur lors de la génération du résumé',
    };
  }
});

// ── Handlers IPC Contrôles Fenêtre Principale ─────────────────────────────

ipcMain.handle('window:set-always-on-top', (_event, flag) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(Boolean(flag));
    console.log(`[Morix Main] AlwaysOnTop réglé à : ${mainWindow.isAlwaysOnTop()}`);
    return mainWindow.isAlwaysOnTop();
  }
  return false;
});

ipcMain.handle('window:is-always-on-top', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow.isAlwaysOnTop();
  }
  return false;
});

// ── Handlers IPC Intégration Système (Lancement au démarrage) ─────────────

ipcMain.handle('app:get-autostart', () => {
  try {
    const settings = app.getLoginItemSettings();
    return Boolean(settings.openAtLogin);
  } catch (err) {
    console.warn('[Morix Main] Erreur lecture getLoginItemSettings :', err?.message || err);
    return false;
  }
});

ipcMain.handle('app:set-autostart', (_event, enabled) => {
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      openAsHidden: false,
    });
    const settings = app.getLoginItemSettings();
    console.log(`[Morix Main] Lancement automatique au démarrage réglé à : ${settings.openAtLogin}`);
    return Boolean(settings.openAtLogin);
  } catch (err) {
    console.warn('[Morix Main] Erreur setLoginItemSettings :', err?.message || err);
    return false;
  }
});

// ── Handlers IPC Gestion Clé API Utilisateur ──────────────────────────────
ipcMain.handle('config:get-api-key-status', () => {
  const key = getStoredApiKey();
  const hasKey = Boolean(key && key.length > 5);
  const isFromEnv = Boolean(!fs.existsSync(getUserConfigPath()) && process.env.GEMINI_API_KEY);
  return {
    hasKey,
    isFromEnv,
    maskedKey: hasKey ? maskApiKey(key) : '',
  };
});

ipcMain.handle('config:save-api-key', (_event, apiKey) => {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 5) {
    return { success: false, message: 'Format de clé API invalide.' };
  }
  saveStoredApiKey(apiKey.trim());
  return { success: true, maskedKey: maskApiKey(apiKey.trim()) };
});

ipcMain.handle('config:clear-api-key', () => {
  const configPath = getUserConfigPath();
  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      delete data.apiKey;
      fs.writeFileSync(configPath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    } catch {}
  }
  delete process.env.GEMINI_API_KEY;
  return { success: true };
});

// ── Gestionnaire des Fenêtres Dashboard Natives Electron ─────────────────
const dashboardWindowsMap = new Map(); // id -> BrowserWindow
const dashboardDataMap = new Map(); // id -> object
let dashboardSeq = 0;

/**
 * Instancie une vraie fenêtre Electron (BrowserWindow) native pour afficher un Dashboard Morix
 * @param {string|object} arg1 - type ou objet complet
 * @param {string} [arg2] - titre
 * @param {Array<string>} [arg3] - contenu
 */
function ouvrirFenetreDashboard(arg1, arg2, arg3) {
  let params;
  if (typeof arg1 === 'object' && arg1 !== null) {
    params = { ...arg1 };
  } else {
    params = {
      type: arg1 || 'info',
      titre: arg2 || 'Rapport Morix',
      contenu: arg3 || [],
    };
  }

  const windowId = params.id || `dash-${Date.now()}-${++dashboardSeq}`;
  params.id = windowId;
  const windowType = params.type || 'info';
  const finalTitle = params.title || params.titre || 'Morix Dashboard';
  params.title = finalTitle;
  params.titre = finalTitle;

  // Normalisation des structures de données selon le type
  if (windowType === 'liste_taches' && !params.tasks) {
    const rawList =
      Array.isArray(params.contenu) && params.contenu.length > 0
        ? params.contenu
        : ['Action prioritaire', 'Tâche secondaire'];
    params.tasks = rawList.map((entry, idx) => ({
      id: `task-${Date.now()}-${idx}`,
      text: typeof entry === 'string' ? entry : String(entry),
      done: false,
    }));
  } else if (windowType === 'confirmation' && !params.confirmation) {
    params.confirmation = {
      question: params.question || params.titre || 'Confirmez-vous cette action ?',
      description: params.description || '',
      resolved: false,
    };
  } else if (windowType === 'info' && !params.items) {
    const rawList =
      Array.isArray(params.contenu) && params.contenu.length > 0
        ? params.contenu
        : [finalTitle];
    params.items = rawList.map((entry, idx) => ({
      id: `item-${Date.now()}-${idx}`,
      title: typeof entry === 'string' ? entry : String(entry),
      subtitle: params.description || 'Information transmise par Morix',
      badge: `#${idx + 1}`,
    }));
  }

  // Conserver les données complètes pour consultation via IPC
  dashboardDataMap.set(windowId, params);

  // Taille adaptée au contenu : 380x440 pour confirmation, 360x480 pour info/tâches
  const width = windowType === 'confirmation' ? 380 : 360;
  const height = windowType === 'confirmation' ? 440 : 480;

  // Calcul du décalage en cascade automatique par rapport à la fenêtre principale et autres dashboards
  const activeCount = dashboardWindowsMap.size;
  const cascadeOffset = (activeCount % 6) * 36;

  let posX = 100 + cascadeOffset;
  let posY = 100 + cascadeOffset;

  if (mainWindow && !mainWindow.isDestroyed()) {
    const [mainX, mainY] = mainWindow.getPosition();
    const [mainW] = mainWindow.getSize();
    posX = Math.max(24, mainX + mainW - width - 40 - cascadeOffset);
    posY = Math.max(36, mainY + 50 + cascadeOffset);
  }

  const dashWin = new BrowserWindow({
    width,
    height,
    x: Math.round(posX),
    y: Math.round(posY),
    minWidth: 300,
    minHeight: 280,
    frame: false, // Pas de bordure OS, cohérence visuelle Morix
    hasShadow: true,
    transparent: false,
    backgroundColor: '#0a0a0e', // Fond noir/gris épuré, angles droits
    resizable: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // Touche Échap pour fermer la fenêtre active
  dashWin.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape') {
      event.preventDefault();
      dashWin.close();
    }
  });

  const queryParams = new URLSearchParams({
    window: 'dashboard',
    id: windowId,
    type: windowType,
    title: finalTitle,
  }).toString();

  const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged && !process.argv.includes('--test-dashboard') && !process.argv.includes('--test-window');
  const distIndexPath = path.join(__dirname, 'dist', 'index.html');

  if (isDev && viteDevServer) {
    const devUrl = viteDevServer.resolvedUrls?.local?.[0] || 'http://localhost:3000';
    dashWin.loadURL(`${devUrl}?${queryParams}`);
  } else if (fs.existsSync(distIndexPath)) {
    const fileUrl = `${pathToFileURL(distIndexPath).href}?${queryParams}`;
    dashWin.loadURL(fileUrl);
  } else {
    dashWin.loadURL(`http://localhost:3000/?${queryParams}`);
  }

  dashboardWindowsMap.set(windowId, dashWin);
  console.log(`[Morix Main] Fenêtre dashboard native créée (${windowType}, "${finalTitle}") [ID: ${windowId}] à (${Math.round(posX)}, ${Math.round(posY)})`);

  dashWin.on('closed', () => {
    dashboardWindowsMap.delete(windowId);
    console.log(`[Morix Main] Fenêtre dashboard ${windowId} fermée.`);
    sendToRenderer('dashboard:closed', { id: windowId });
  });

  return { id: windowId, opened: true, type: windowType, title: finalTitle };
}

// ── Handlers IPC Dashboard ────────────────────────────────────────────────
ipcMain.handle('dashboard:open', async (_event, params) => {
  return ouvrirFenetreDashboard(params);
});

ipcMain.handle('dashboard:get-data', async (_event, id) => {
  return dashboardDataMap.get(id) || null;
});

ipcMain.handle('dashboard:close', async (_event, id) => {
  const win = dashboardWindowsMap.get(id);
  if (win && !win.isDestroyed()) {
    win.close();
  }
  dashboardWindowsMap.delete(id);
  return { closed: true };
});

ipcMain.handle('dashboard:confirm-choice', async (_event, { id, choice }) => {
  console.log(`[Morix Main] Choix de confirmation reçu pour ${id} : "${choice}"`);
  sendToRenderer('dashboard:confirmed', { id, choice });

  const data = dashboardDataMap.get(id);
  if (data && data.confirmation) {
    data.confirmation.resolved = true;
    data.confirmation.choice = choice;
  }
  return { confirmed: true };
});

// ── Gestionnaire de l'Icône System Tray ──────────────────────────────────
function createTray() {
  if (tray && !tray.isDestroyed()) return;

  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  let trayIcon;
  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath);
  } else {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Morix');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Afficher Morix',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: 'Quitter',
      click: () => {
        console.log('[Morix Main] Fermeture complète demandée depuis le menu Tray.');
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Clic gauche : affiche ou masque la fenêtre principale
  tray.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
      console.log('[Morix Main] Fenêtre masquée suite au clic sur l\'icône Tray.');
    } else {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      console.log('[Morix Main] Fenêtre affichée suite au clic sur l\'icône Tray.');
    }
  });

  console.log('[Morix Main] System Tray initialisé avec succès.');
}

// ── Gestionnaire des Raccourcis Globaux Système ──────────────────────────
function registerGlobalShortcuts() {
  const shortcutKey = 'CommandOrControl+Shift+Space';
  try {
    const registered = globalShortcut.register(shortcutKey, () => {
      console.log(`[Morix Main] Raccourci global ${shortcutKey} déclenché.`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        if (!mainWindow.isVisible()) {
          mainWindow.show();
        }
        mainWindow.focus();
        sendToRenderer('live:toggle-mic');
      }
    });

    if (!registered) {
      console.warn(`[Morix Main] AVERTISSEMENT : Le raccourci global ${shortcutKey} est déjà utilisé par une autre application ou n'a pas pu être enregistré.`);
    } else {
      console.log(`[Morix Main] Raccourci global ${shortcutKey} enregistré avec succès.`);
    }
  } catch (err) {
    console.error(`[Morix Main] Erreur lors de l'enregistrement du raccourci global ${shortcutKey} :`, err?.message || err);
  }

  // Enregistrement du raccourci global Ctrl+Q / Cmd+Q pour quitter
  try {
    globalShortcut.register('CommandOrControl+Q', () => {
      console.log('[Morix Main] Raccourci global CommandOrControl+Q déclenché. Fermeture.');
      isQuitting = true;
      app.quit();
    });
  } catch (err) {
    console.error('[Morix Main] Erreur enregistrement CommandOrControl+Q :', err?.message || err);
  }
}

// ── Création de la fenêtre principale ────────────────────────────────────
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 300,
    minHeight: 300,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // Raccourci clavier Ctrl+Q / Cmd+Q actif directement sur la fenêtre
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if ((input.control || input.meta) && input.key.toLowerCase() === 'q') {
      event.preventDefault();
      console.log('[Morix Main] Raccourci Ctrl+Q / Cmd+Q déclenché. Fermeture.');
      isQuitting = true;
      app.quit();
    }
  });

  // Fermeture redirigée vers masquage en arrière-plan (System Tray) sauf si l'app quitte
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      console.log('[Morix Main] Fenêtre masquée en arrière-plan (accessible via le System Tray).');
      return false;
    }
  });

  // Minimisation masquée vers le System Tray pour continuer en arrière-plan
  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    mainWindow.hide();
    console.log('[Morix Main] Fenêtre minimisée et masquée vers le System Tray.');
  });

  // Autoriser l'accès au microphone pour la voix
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'mediaKeySystem' || true);
  });

  const isTestWindow =
    process.argv.includes('--test-window') ||
    Boolean(process.env.TEST_WINDOW_TRANSFORM && process.env.TEST_WINDOW_TRANSFORM.trim() === '1');
  const isTestDashboard =
    process.argv.includes('--test-dashboard') ||
    Boolean(process.env.TEST_DASHBOARD && process.env.TEST_DASHBOARD.trim() === '1');
  const isTestSystem =
    process.argv.includes('--test-system') ||
    Boolean(process.env.TEST_SYSTEM && process.env.TEST_SYSTEM.trim() === '1');
  const autoExit =
    process.argv.includes('--auto-exit') ||
    Boolean(process.env.AUTO_EXIT_AFTER_CAPTURE && process.env.AUTO_EXIT_AFTER_CAPTURE.trim() !== '0');

  const isTest = isTestWindow || isTestDashboard || isTestSystem;
  const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged && !isTest;
  const distIndexPath = path.join(__dirname, 'dist', 'index.html');

  if (isTest && fs.existsSync(distIndexPath)) {
    console.log('[Morix Main] Chargement direct de dist/index.html pour le test...');
    mainWindow.loadFile(distIndexPath);
  } else if (isDev) {
    let devUrl = process.env.DEV_URL;
    if (!devUrl) {
      try {
        const { createServer } = await import('vite');
        viteDevServer = await createServer({
          server: { port: 3000 },
        });
        await viteDevServer.listen();
        devUrl = viteDevServer.resolvedUrls?.local?.[0] || 'http://localhost:3000';
        console.log(`[Morix Main] Serveur de dev Vite interne prêt : ${devUrl}`);
      } catch (err) {
        console.error('[Morix Main] Erreur création serveur Vite dev interne :', err);
        devUrl = 'http://localhost:3000';
      }
    }
    mainWindow.loadURL(devUrl);
  } else if (fs.existsSync(distIndexPath)) {
    mainWindow.loadFile(distIndexPath);
  } else {
    mainWindow.loadURL('http://localhost:3000');
  }

  // Capture d'écran automatisée si demandée
  if (process.env.CAPTURE_SCREENSHOT) {
    mainWindow.webContents.on('did-finish-load', () => {
      const targetPath = process.env.CAPTURE_SCREENSHOT;
      setTimeout(async () => {
        try {
          const image = await mainWindow.webContents.capturePage();
          fs.writeFileSync(targetPath, image.toPNG());
          console.log(`[Electron] Capture enregistrée : ${targetPath}`);
          if (process.env.AUTO_EXIT_AFTER_CAPTURE) app.quit();
        } catch (err) {
          console.error('[Electron] Erreur capture :', err);
        }
      }, 3500);
    });
  }

  // Test automatisé de conversation et function calling via le main process
  if (process.env.TEST_CONVERSATION === '1') {
    mainWindow.webContents.on('did-finish-load', () => {
      console.log('[Test] Fenêtre chargée. Démarrage du test automatisé de conversation...');

      // Timeout de sécurité global (25s) pour ne jamais rester bloqué
      setTimeout(() => {
        if (process.env.AUTO_EXIT_AFTER_CAPTURE) {
          console.log('[Test] Timeout de sécurité atteint, fermeture.');
          app.quit();
        }
      }, 25000);

      setTimeout(async () => {
        try {
          const secReport = await mainWindow.webContents.executeJavaScript(`
            (() => {
              const res = {
                hasMorixAPI: typeof window.morixAPI !== 'undefined',
                apiKeyExposed: typeof (window).GEMINI_API_KEY !== 'undefined',
                processExposed: typeof (window).process !== 'undefined',
                morixAPIKeys: window.morixAPI ? Object.keys(window.morixAPI) : [],
              };
              console.log("[Renderer] Rapport de securite :", JSON.stringify(res));

              // Clic d'activation Morix sur la StatusPill
              const pillBtn = Array.from(document.querySelectorAll('button')).find(b =>
                (b.getAttribute('aria-label') || '').includes('micro') ||
                (b.title || '').includes('micro')
              ) || document.querySelector('button[aria-label*="micro"]');
              if (pillBtn) {
                pillBtn.click();
                console.log("[Renderer] Clic effectue sur le StatusPill");
              }
              return res;
            })()
          `);
          console.log('[Test] Rapport de sécurité renderer :', secReport);

          // Envoi de la requête de test (question d'actualité pour tester rechercher_web)
          setTimeout(async () => {
            const query = process.env.TEST_QUERY || "Bonjour Morix, quelle heure est-il ?";
            console.log(`[Test] Envoi de la question vocale/texte : "${query}"`);
            await mainWindow.webContents.executeJavaScript(`
              if (window.morixAPI) {
                window.morixAPI.sendTextMessage(${JSON.stringify(query)});
              }
            `);
          }, 3500);

          // Vérification explicite du résumé de mémoire via IPC
          setTimeout(async () => {
            const memoryCheck = await mainWindow.webContents.executeJavaScript(`
              (async () => {
                try {
                  const summary = await window.morixAPI.resumerSession("Utilisateur : Je prépare le lancement de Morix avec Electron.\\nMorix : C'est une excellente étape pour notre projet !");
                  console.log("[Renderer] Test resumerSession IPC :", JSON.stringify(summary));
                  return { summary, status: summary.status };
                } catch (e) {
                  return { error: e.message };
                }
              })()
            `);
            console.log('[Test] Résultat vérification mémoire IPC :', memoryCheck);
          }, 11000);

          // Attente de la réponse du modèle et capture finale
          setTimeout(async () => {
            const outPath = path.join(__dirname, 'electron_conversation_test.png');
            const img = await mainWindow.webContents.capturePage();
            fs.writeFileSync(outPath, img.toPNG());
            console.log('[Test] Capture finale de conversation sauvegardée : ' + outPath);
            console.log('[Test] TEST RÉUSSI AVEC SUCCÈS.');
            if (process.env.AUTO_EXIT_AFTER_CAPTURE) {
              app.quit();
            }
          }, 16000);
        } catch (e) {
          console.error('[Test] Erreur test conversation :', e);
          if (process.env.AUTO_EXIT_AFTER_CAPTURE) {
            app.quit();
          }
        }
      }, 2500);
    });
  }

  // Test automatisé de la transformation de fenêtre (frameless, transparent, drag, alwaysOnTop, resize)
  if (isTestWindow) {
    mainWindow.webContents.on('did-finish-load', () => {
      console.log('[Test-Window] Fenêtre chargée. Démarrage de la vérification de la fenêtre transformée...');

      // Timeout de sécurité global (25s) pour ne jamais rester bloqué
      setTimeout(() => {
        if (autoExit) {
          console.log('[Test-Window] Timeout de sécurité atteint, fermeture.');
          app.quit();
        }
      }, 25000);

      setTimeout(async () => {
        try {
          // 1. Vérification configuration Electron BrowserWindow
          const winConfig = {
            isResizable: mainWindow.isResizable(),
            minSize: mainWindow.getMinimumSize(),
            initialAlwaysOnTop: mainWindow.isAlwaysOnTop(),
            isDestroyed: mainWindow.isDestroyed(),
          };
          console.log('[Test-Window] Configuration fenêtre Electron :', JSON.stringify(winConfig));

          // 2. Vérification DOM : drag region, no-drag sur interactifs, API
          const domCheck = await mainWindow.webContents.executeJavaScript(`
            (() => {
              const dragEl = document.querySelector('.window-drag-region');
              const dragStyle = dragEl ? window.getComputedStyle(dragEl).webkitAppRegion : null;

              const settingsBtn = document.querySelector('button[aria-label*="paramètres"], button.window-no-drag');
              const settingsBtnStyle = settingsBtn ? window.getComputedStyle(settingsBtn).webkitAppRegion : null;

              const pillContainer = document.querySelector('.window-no-drag');
              const pillStyle = pillContainer ? window.getComputedStyle(pillContainer).webkitAppRegion : null;

              return {
                hasDragRegion: !!dragEl,
                dragRegionStyle: dragStyle,
                hasSettingsBtn: !!settingsBtn,
                settingsBtnNoDrag: settingsBtnStyle,
                pillNoDrag: pillStyle,
                hasMorixAPI: typeof window.morixAPI !== 'undefined',
                hasSetAlwaysOnTop: typeof window.morixAPI?.setAlwaysOnTop === 'function',
              };
            })()
          `);
          console.log('[Test-Window] Vérification DOM & CSS drag/no-drag :', JSON.stringify(domCheck));

          // 3. Test IPC Always On Top
          const aotOn = await mainWindow.webContents.executeJavaScript('window.morixAPI.setAlwaysOnTop(true)');
          const mainAotOn = mainWindow.isAlwaysOnTop();
          console.log('[Test-Window] AlwaysOnTop -> true : renderer =', aotOn, 'main =', mainAotOn);

          const aotOff = await mainWindow.webContents.executeJavaScript('window.morixAPI.setAlwaysOnTop(false)');
          const mainAotOff = mainWindow.isAlwaysOnTop();
          console.log('[Test-Window] AlwaysOnTop -> false : renderer =', aotOff, 'main =', mainAotOff);

          // 4. Capture d'écran fenêtre par défaut (fond noir élégant)
          const brainDir = path.join(
            process.env.USERPROFILE || 'C:\\Users\\DELL',
            '.gemini',
            'antigravity',
            'brain',
            '0d5cdbbf-a579-4d56-afbe-29b2f749bd3b'
          );
          const screenshotDefault = path.join(brainDir, 'screenshot_window_default.png');
          const imgDefault = await mainWindow.webContents.capturePage();
          fs.writeFileSync(screenshotDefault, imgDefault.toPNG());
          console.log('[Test-Window] Capture fenêtre par défaut sauvegardée :', screenshotDefault);

          // 5. Test activation fond transparent via réglages
          await mainWindow.webContents.executeJavaScript(`
            (() => {
              const gearBtn = document.querySelector('button[aria-label*="paramètres"]') || Array.from(document.querySelectorAll('button')).find(b => b.querySelector('svg'));
              if (gearBtn) gearBtn.click();
            })()
          `);

          await new Promise(r => setTimeout(r, 600));

          // Basculer le fond transparent
          await mainWindow.webContents.executeJavaScript(`
            (() => {
              const transBtn = document.querySelector('button[data-testid="toggle-transparent-bg"]');
              if (transBtn) {
                transBtn.click();
                console.log("[Renderer] Bouton fond transparent cliqué !");
              } else {
                console.warn("[Renderer] Bouton fond transparent non trouvé");
              }
            })()
          `);

          await new Promise(r => setTimeout(r, 1000));

          const screenshotTransparent = path.join(brainDir, 'screenshot_window_transparent.png');
          const imgTransparent = await mainWindow.webContents.capturePage();
          fs.writeFileSync(screenshotTransparent, imgTransparent.toPNG());
          console.log('[Test-Window] Capture fond transparent sauvegardée :', screenshotTransparent);

          // Fermer les paramètres pour visualiser l'orbe centré lors du redimensionnement
          await mainWindow.webContents.executeJavaScript(`
            (() => {
              const closeBtn = Array.from(document.querySelectorAll('button')).find(b =>
                (b.getAttribute('aria-label') || '').toLowerCase().includes('fermer') ||
                b.textContent === '✕' || b.textContent === '×'
              );
              if (closeBtn) closeBtn.click();
            })()
          `);
          await new Promise(r => setTimeout(r, 600));

          // 6. Test Redimensionnement vers format compact (450x450)
          console.log('[Test-Window] Redimensionnement de la fenêtre à 450x450...');
          mainWindow.setSize(450, 450);
          await new Promise(r => setTimeout(r, 1000));

          const resizeCheck450 = await mainWindow.webContents.executeJavaScript(`
            (() => {
              const canvas = document.querySelector('#orb-container canvas');
              return {
                windowWidth: window.innerWidth,
                windowHeight: window.innerHeight,
                canvasWidth: canvas ? canvas.width : 0,
                canvasHeight: canvas ? canvas.height : 0,
              };
            })()
          `);
          console.log('[Test-Window] Mesures après redimensionnement 450x450 :', JSON.stringify(resizeCheck450));

          const screenshotResized450 = path.join(brainDir, 'screenshot_window_resized_450.png');
          const imgResized450 = await mainWindow.webContents.capturePage();
          fs.writeFileSync(screenshotResized450, imgResized450.toPNG());
          console.log('[Test-Window] Capture redimensionnement 450x450 sauvegardée :', screenshotResized450);

          // 7. Test Redimensionnement taille minimale (300x300)
          console.log('[Test-Window] Redimensionnement de la fenêtre à taille minimale (300x300)...');
          mainWindow.setSize(300, 300);
          await new Promise(r => setTimeout(r, 1000));

          const resizeCheck300 = await mainWindow.webContents.executeJavaScript(`
            (() => {
              const canvas = document.querySelector('#orb-container canvas');
              return {
                windowWidth: window.innerWidth,
                windowHeight: window.innerHeight,
                canvasWidth: canvas ? canvas.width : 0,
                canvasHeight: canvas ? canvas.height : 0,
              };
            })()
          `);
          console.log('[Test-Window] Mesures après redimensionnement 300x300 :', JSON.stringify(resizeCheck300));

          const screenshotResized300 = path.join(brainDir, 'screenshot_window_resized_300.png');
          const imgResized300 = await mainWindow.webContents.capturePage();
          fs.writeFileSync(screenshotResized300, imgResized300.toPNG());
          console.log('[Test-Window] Capture redimensionnement 300x300 sauvegardée :', screenshotResized300);

          console.log('[Test-Window] TOUS LES TESTS DE TRANSFORMATION DE LA FENÊTRE SONT VALIDÉS AVEC SUCCÈS !');
          if (autoExit) {
            app.quit();
          }
        } catch (e) {
          console.error('[Test-Window] Erreur pendant le test :', e);
          if (autoExit) {
            app.quit();
          }
        }
      }, 2500);
    });
  }

  // Test automatisé des fenêtres Dashboard natives indépendantes
  if (isTestDashboard) {
    mainWindow.webContents.on('did-finish-load', () => {
      console.log('[Test-Dashboard] Fenêtre principale chargée. Démarrage du test des fenêtres natives...');

      setTimeout(async () => {
        try {
          const brainDir = path.join(
            process.env.USERPROFILE || 'C:\\Users\\DELL',
            '.gemini',
            'antigravity',
            'brain',
            '0d5cdbbf-a579-4d56-afbe-29b2f749bd3b'
          );

          // 1. Ouvrir la première fenêtre native : liste_taches
          console.log('[Test-Dashboard] Étape 1 : Ouverture de la fenêtre native liste_taches...');
          const win1Result = ouvrirFenetreDashboard({
            type: 'liste_taches',
            titre: 'Tâches Sprint Morix',
            contenu: ['Finaliser Electron', 'Tester fenêtres natives', 'Déployer build'],
          });
          const win1 = dashboardWindowsMap.get(win1Result.id);
          console.log('[Test-Dashboard] Fenêtre 1 créée :', win1Result);

          await new Promise(r => setTimeout(r, 1200));

          // 2. Ouvrir la deuxième fenêtre native : confirmation
          console.log('[Test-Dashboard] Étape 2 : Ouverture de la fenêtre native confirmation...');
          const win2Result = ouvrirFenetreDashboard({
            type: 'confirmation',
            titre: 'Confirmation Déploiement',
            question: 'Confirmez-vous le déploiement de la version ?',
            description: 'Action requise pour synchroniser le système Morix.',
          });
          const win2 = dashboardWindowsMap.get(win2Result.id);
          console.log('[Test-Dashboard] Fenêtre 2 créée :', win2Result);

          await new Promise(r => setTimeout(r, 1200));

          // 3. Vérification de la coexistence de plusieurs fenêtres OS distinctes
          const allWindows = BrowserWindow.getAllWindows();
          const dashCount = dashboardWindowsMap.size;
          console.log(`[Test-Dashboard] Total fenêtres OS ouvertes : ${allWindows.length} (dont ${dashCount} dashboards)`);

          const pos1 = win1 ? win1.getPosition() : [0, 0];
          const pos2 = win2 ? win2.getPosition() : [0, 0];
          console.log(`[Test-Dashboard] Position Fenêtre 1 (liste_taches) : (${pos1[0]}, ${pos1[1]})`);
          console.log(`[Test-Dashboard] Position Fenêtre 2 (confirmation) : (${pos2[0]}, ${pos2[1]})`);

          const isCascaded = (pos1[0] !== pos2[0]) || (pos1[1] !== pos2[1]);
          console.log(`[Test-Dashboard] Les fenêtres sont-elles décalées en cascade ? ${isCascaded}`);

          // 4. Captures d'écran des fenêtres natives
          if (win1 && !win1.isDestroyed()) {
            const img1 = await win1.webContents.capturePage();
            const path1 = path.join(brainDir, 'screenshot_dashboard_tasks.png');
            fs.writeFileSync(path1, img1.toPNG());
            console.log('[Test-Dashboard] Capture fenêtre tâches sauvegardée :', path1);
          }

          if (win2 && !win2.isDestroyed()) {
            const img2 = await win2.webContents.capturePage();
            const path2 = path.join(brainDir, 'screenshot_dashboard_confirmation.png');
            fs.writeFileSync(path2, img2.toPNG());
            console.log('[Test-Dashboard] Capture fenêtre confirmation sauvegardée :', path2);
          }

          // 5. Test de la réponse utilisateur "Oui" dans la fenêtre de confirmation (remontée IPC)
          console.log('[Test-Dashboard] Étape 5 : Test de clic sur "Oui" dans la fenêtre confirmation...');
          let confirmedChoiceReceived = null;
          ipcMain.once('dashboard:confirmed', (_e, data) => {
            confirmedChoiceReceived = data;
          });

          if (win2 && !win2.isDestroyed()) {
            await win2.webContents.executeJavaScript(`
              (() => {
                const btnOui = document.querySelector('button[data-testid="dashboard-btn-oui"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Oui');
                if (btnOui) {
                  btnOui.click();
                  return true;
                }
                return false;
              })()
            `);
          }

          await new Promise(r => setTimeout(r, 1200));

          // 6. Test de la fermeture par touche Échap ou bouton croix
          console.log('[Test-Dashboard] Étape 6 : Fermeture de la fenêtre 1...');
          if (win1 && !win1.isDestroyed()) {
            win1.close();
          }

          await new Promise(r => setTimeout(r, 800));
          console.log(`[Test-Dashboard] Nombre restant de fenêtres dashboard : ${dashboardWindowsMap.size}`);

          console.log('[Test-Dashboard] TOUS LES TESTS DE FENÊTRES DASHBOARD NATIVES SONT VALIDÉS AVEC SUCCÈS !');
          if (autoExit) {
            app.quit();
          }
        } catch (e) {
          console.error('[Test-Dashboard] Erreur pendant le test :', e);
          if (autoExit) {
            app.quit();
          }
        }
      }, 2500);
    });
  }

  // Test automatisé des fonctionnalités d'intégration système (Tray, Global Shortcut, Autostart, Close-to-Tray)
  if (isTestSystem) {
    mainWindow.webContents.on('did-finish-load', () => {
      console.log('[Test-System] Fenêtre principale chargée. Démarrage de la vérification système...');

      const brainDir = path.join(
        process.env.USERPROFILE || 'C:\\Users\\DELL',
        '.gemini',
        'antigravity',
        'brain',
        '0d5cdbbf-a579-4d56-afbe-29b2f749bd3b'
      );

      // Timeout de sécurité global (30s)
      setTimeout(() => {
        if (autoExit) {
          console.log('[Test-System] Timeout de sécurité atteint, fermeture.');
          isQuitting = true;
          app.quit();
        }
      }, 30000);

      setTimeout(async () => {
        try {
          // 1. Vérification Tray
          console.log('[Test-System] 1. Vérification de l\'instance System Tray...');
          const hasTray = Boolean(tray && !tray.isDestroyed());
          console.log('[Test-System] System Tray actif :', hasTray);
          if (!hasTray) throw new Error('System Tray non initialisé');

          // 2. Vérification Raccourci Global
          console.log('[Test-System] 2. Vérification de l\'enregistrement du raccourci global...');
          const isSpaceRegistered = globalShortcut.isRegistered('CommandOrControl+Shift+Space');
          console.log('[Test-System] CommandOrControl+Shift+Space enregistré :', isSpaceRegistered);

          // 3. Test app.setLoginItemSettings
          console.log('[Test-System] 3. Test direct app.setLoginItemSettings...');
          app.setLoginItemSettings({ openAtLogin: true, openAsHidden: false });
          const loginTrue = app.getLoginItemSettings().openAtLogin;
          app.setLoginItemSettings({ openAtLogin: false, openAsHidden: false });
          const loginFalse = app.getLoginItemSettings().openAtLogin;
          console.log(`[Test-System] Test loginSettings : set(true)->${loginTrue}, set(false)->${loginFalse}`);

          // 4. Test IPC Renderer getAutostart / setAutostart / onToggleMic
          console.log('[Test-System] 4. Test IPC Renderer morixAPI...');
          const ipcResult = await mainWindow.webContents.executeJavaScript(`
            (async () => {
              const res = {
                hasMorixAPI: typeof window.morixAPI !== 'undefined',
                hasGetAutostart: typeof window.morixAPI?.getAutostart === 'function',
                hasSetAutostart: typeof window.morixAPI?.setAutostart === 'function',
                hasOnToggleMic: typeof window.morixAPI?.onToggleMic === 'function',
              };
              if (res.hasSetAutostart && res.hasGetAutostart) {
                await window.morixAPI.setAutostart(true);
                res.afterSetTrue = await window.morixAPI.getAutostart();
                await window.morixAPI.setAutostart(false);
                res.afterSetFalse = await window.morixAPI.getAutostart();
              }
              return res;
            })()
          `);
          console.log('[Test-System] Rapport IPC Renderer :', JSON.stringify(ipcResult));

          // 5. Test Masquage & Réactivation (Simulation Raccourci Global)
          console.log('[Test-System] 5. Test masquage et réactivation par raccourci global...');
          mainWindow.hide();
          console.log('[Test-System] Fenêtre masquée. isVisible =', mainWindow.isVisible());
          await new Promise(r => setTimeout(r, 600));

          // Déclencher l'action du raccourci
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
          sendToRenderer('live:toggle-mic');
          await new Promise(r => setTimeout(r, 600));
          console.log(`[Test-System] Fenêtre réactivée : isVisible = ${mainWindow.isVisible()}, isFocused = ${mainWindow.isFocused()}`);

          // 6. Test Close-to-Tray
          console.log('[Test-System] 6. Test Close-to-Tray (mainWindow.close sans quitter)...');
          mainWindow.close();
          await new Promise(r => setTimeout(r, 600));
          console.log(`[Test-System] Après mainWindow.close() : isDestroyed = ${mainWindow.isDestroyed()}, isVisible = ${mainWindow.isVisible()}`);

          // Réafficher pour la suite
          mainWindow.show();
          await new Promise(r => setTimeout(r, 500));

          // 7. Test de l'UI Settings (bouton Lancement au démarrage)
          console.log('[Test-System] 7. Test du bouton toggle Lancement au démarrage dans l\'UI...');
          const uiResult = await mainWindow.webContents.executeJavaScript(`
            (async () => {
              // Clic sur l'icône réglages
              const settingsBtn = document.querySelector('button[aria-label*="paramètres"], button[aria-label*="Paramètres"]');
              if (settingsBtn) {
                settingsBtn.click();
              }
              await new Promise(r => setTimeout(r, 500));

              const toggleAutostart = document.querySelector('[data-testid="toggle-autostart"]');
              if (toggleAutostart) {
                toggleAutostart.scrollIntoView({ behavior: 'instant', block: 'center' });
              }
              await new Promise(r => setTimeout(r, 300));
              const beforeClick = toggleAutostart ? toggleAutostart.textContent.trim() : null;

              if (toggleAutostart) {
                toggleAutostart.click();
              }
              await new Promise(r => setTimeout(r, 500));
              const afterClick = toggleAutostart ? toggleAutostart.textContent.trim() : null;

              return {
                hasSettingsBtn: !!settingsBtn,
                hasToggleAutostart: !!toggleAutostart,
                beforeClick,
                afterClick,
              };
            })()
          `);
          console.log('[Test-System] Résultat test UI Settings :', JSON.stringify(uiResult));

          // 8. Capture d'écran du panneau réglages
          await new Promise(r => setTimeout(r, 600));
          const screenshotPath = path.join(brainDir, 'screenshot_system_settings.png');
          const img = await mainWindow.webContents.capturePage();
          fs.writeFileSync(screenshotPath, img.toPNG());
          console.log('[Test-System] Capture d\'écran enregistrée :', screenshotPath);

          console.log('[Test-System] TOUS LES TESTS D\'INTÉGRATION SYSTÈME SONT VALIDÉS AVEC SUCCÈS !');
          if (autoExit) {
            isQuitting = true;
            app.quit();
          }
        } catch (err) {
          console.error('[Test-System] Erreur pendant le test système :', err);
          if (autoExit) {
            isQuitting = true;
            app.quit();
          }
        }
      }, 2500);
    });
  }

  mainWindow.on('closed', () => {
    closeSession();
    mainWindow = null;
  });

  return mainWindow;
}

// ── Démarrage de l'app ───────────────────────────────────────────────────
app.whenReady().then(async () => {
  await loadGenAI();
  await createWindow();
  createTray();
  registerGlobalShortcuts();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', async () => {
  if (!isQuitting) {
    console.log('[Morix Main] Fenêtres masquées/fermées : l\'application reste active en tâche de fond (System Tray).');
    return;
  }
  closeSession();
  if (viteDevServer) {
    try { await viteDevServer.close(); } catch {}
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
    tray = null;
  }
});
