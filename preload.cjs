/**
 * Pont IPC sécurisé entre le processus de rendu (React) et le processus principal (Electron).
 * Exposé via contextBridge.exposeInMainWorld sous window.morixAPI.
 *
 * Règles de sécurité :
 * - contextIsolation: true  → les fonctions ci-dessous sont les SEULS ponts vers le main process.
 * - nodeIntegration: false  → le renderer n'a aucun accès à Node.js ou à la clé API.
 * - Aucune clé API, aucun secret n'est transmis au renderer.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('morixAPI', {
  // ── Commandes Session Live ────────────────────────────────────────────────
  /** Démarre la session Gemini Live côté main process. */
  startSession: (config) => ipcRenderer.invoke('live:start', config),

  /** Arrête la session Gemini Live. */
  stopSession: () => ipcRenderer.invoke('live:stop'),

  /** Envoie un chunk audio PCM16 base64 capté par le micro côté renderer. */
  sendAudioChunk: (base64Data) => ipcRenderer.send('live:audio-chunk', base64Data),

  /** Envoie un message texte à la session Live. */
  sendTextMessage: (text) => ipcRenderer.send('live:text-message', text),

  /** Change la voix (relance la session avec la nouvelle voix). */
  setVoice: (voiceName) => ipcRenderer.invoke('live:set-voice', voiceName),

  /** Change la langue de réponse de Morix. */
  setLanguage: (lang) => ipcRenderer.invoke('live:set-language', lang),

  /** Renvoie le résultat d'un tool call exécuté dans le renderer vers le main process. */
  sendToolResponse: (arg1, arg2, arg3) => ipcRenderer.send('live:tool-response', arg1, arg2, arg3),

  /** Demande la persistance mémoire de la session courante. */
  persistMemory: () => ipcRenderer.invoke('live:persist-memory'),

  /** Recherche web avec googleSearch grounding dans le main process. */
  rechercherWeb: (requete) => ipcRenderer.invoke('morix:search', requete),

  /** Résumé IA de la session pour la mémoire locale dans le main process. */
  resumerSession: (texte) => ipcRenderer.invoke('morix:summarize', texte),

  // ── Contrôles Fenêtre Principale ──────────────────────────────────────────
  /** Active ou désactive le mode Toujours au premier plan. */
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('window:set-always-on-top', flag),

  /** Retourne si la fenêtre est actuellement au premier plan. */
  isAlwaysOnTop: () => ipcRenderer.invoke('window:is-always-on-top'),

  // ── Fenêtres Dashboard Natives Electron ───────────────────────────────────
  /** Demande l'ouverture d'une nouvelle fenêtre dashboard native au main process. */
  openDashboardWindow: (data) => ipcRenderer.invoke('dashboard:open', data),

  /** Ferme une fenêtre dashboard native par son ID. */
  closeDashboardWindow: (id) => ipcRenderer.invoke('dashboard:close', id),

  /** Récupère les données d'une fenêtre dashboard depuis le main process. */
  getDashboardData: (id) => ipcRenderer.invoke('dashboard:get-data', id),

  /** Envoie le choix de confirmation ('oui' ou 'non') fait dans une fenêtre séparée. */
  confirmDashboardChoice: (id, choice) => ipcRenderer.invoke('dashboard:confirm-choice', { id, choice }),

  // ── Intégration Système & Raccourcis ──────────────────────────────────────
  /** Active ou désactive le lancement automatique au démarrage de l'OS. */
  setAutostart: (enabled) => ipcRenderer.invoke('app:set-autostart', enabled),

  /** Récupère l'état actuel du lancement automatique au démarrage. */
  getAutostart: () => ipcRenderer.invoke('app:get-autostart'),

  /** Écoute le raccourci global ou l'action système pour basculer/activer le micro. */
  onToggleMic: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('live:toggle-mic', handler);
    return () => ipcRenderer.removeListener('live:toggle-mic', handler);
  },

  // ── Gestion Clé API Utilisateur ──────────────────────────────────────────
  /** Récupère le statut de configuration de la clé API Gemini. */
  getApiKeyStatus: () => ipcRenderer.invoke('config:get-api-key-status'),

  /** Sauvegarde localement la clé API Gemini de l'utilisateur. */
  saveApiKey: (apiKey) => ipcRenderer.invoke('config:save-api-key', apiKey),

  /** Supprime la clé API enregistrée. */
  clearApiKey: () => ipcRenderer.invoke('config:clear-api-key'),

  // ── Desktop Vision & Pilotage Système Autonome ───────────────────────────
  /** Capture l'écran principal en base64 pour analyse visuelle multimodale. */
  captureScreen: () => ipcRenderer.invoke('screen:capture-active'),

  /** Ouvre une application installée ou une URL dans le navigateur. */
  openApplication: (nomOuUrl) => ipcRenderer.invoke('system:open-app', nomOuUrl),

  /** Ouvre un dossier dans l'explorateur de fichiers. */
  openFolder: (chemin) => ipcRenderer.invoke('system:open-folder', chemin),

  /** Exécute une commande shell/powershell système. */
  executeCommand: (commande) => ipcRenderer.invoke('system:execute-command', commande),

  /** Bascule le mode de la fenêtre ('standard' | 'mini' | 'sidebar'). */
  setWindowMode: (mode) => ipcRenderer.invoke('window:set-mode', mode),

  /** Programme un rappel autonome. */
  scheduleReminder: (delaiSecondes, message) => ipcRenderer.invoke('morix:schedule-reminder', { delaiSecondes, message }),

  /** Analyse l'écran actif par vision multimodale avec Gemini. */
  analyzeScreen: (question) => ipcRenderer.invoke('morix:analyze-screen', question),

  /** Écoute le changement de mode fenêtre ('standard', 'mini', 'sidebar'). */
  onWindowModeChanged: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('window:mode-changed', handler);
    return () => ipcRenderer.removeListener('window:mode-changed', handler);
  },

  /** Écoute les alertes ou événements proactifs déclenchés par Morix. */
  onProactiveAlert: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('morix:proactive-alert', handler);
    return () => ipcRenderer.removeListener('morix:proactive-alert', handler);
  },

  // ── Callbacks / Événements reçus du main process ──────────────────────────
  /** Réception des chunks audio de réponse (base64 PCM24k) à jouer. */
  onAudioResponse: (callback) => {
    const handler = (_event, base64Audio) => callback(base64Audio);
    ipcRenderer.on('live:audio-response', handler);
    return () => ipcRenderer.removeListener('live:audio-response', handler);
  },

  /** Changements d'état de l'orbe (idle/listening/thinking/speaking/searching/planning/error/disconnected). */
  onStateChange: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('live:state-change', handler);
    return () => ipcRenderer.removeListener('live:state-change', handler);
  },

  /** Transcription texte reçue (modèle ou utilisateur). */
  onTranscript: (callback) => {
    const handler = (_event, text, isModel) => callback(text, isModel);
    ipcRenderer.on('live:transcript', handler);
    return () => ipcRenderer.removeListener('live:transcript', handler);
  },

  /** Détection d'interruption vocale (barge-in utilisateur). */
  onInterrupted: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('live:interrupted', handler);
    return () => ipcRenderer.removeListener('live:interrupted', handler);
  },

  /** Fin d'un tour de parole du modèle. */
  onTurnComplete: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('live:turn-complete', handler);
    return () => ipcRenderer.removeListener('live:turn-complete', handler);
  },

  /** Déclenchement d'un function call par Gemini Live → exécuté dans le renderer. */
  onToolCall: (callback) => {
    const handler = (_event, toolCallObj, callId, name, args) => {
      if (typeof toolCallObj === 'object' && toolCallObj !== null) {
        callback(toolCallObj, toolCallObj.callId || toolCallObj.id, toolCallObj.name, toolCallObj.args);
      } else {
        callback({ id: toolCallObj, callId: toolCallObj, name: callId, args: name }, toolCallObj, callId, name);
      }
    };
    ipcRenderer.on('live:tool-call', handler);
    return () => ipcRenderer.removeListener('live:tool-call', handler);
  },

  /** Erreur survenue dans le processus principal ou sur la session Live. */
  onError: (callback) => {
    const handler = (_event, errMsg) => callback(errMsg);
    ipcRenderer.on('live:error', handler);
    return () => ipcRenderer.removeListener('live:error', handler);
  },

  /** Historique des tours de conversation transmis pour persistance locale. */
  onConversationTurns: (callback) => {
    const handler = (_event, turns) => callback(turns);
    ipcRenderer.on('live:conversation-turns', handler);
    return () => ipcRenderer.removeListener('live:conversation-turns', handler);
  },

  /** Réception d'un choix de confirmation depuis une fenêtre dashboard native. */
  onDashboardConfirmed: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('dashboard:confirmed', handler);
    return () => ipcRenderer.removeListener('dashboard:confirmed', handler);
  },

  /** Notification de fermeture d'une fenêtre dashboard native. */
  onDashboardClosed: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('dashboard:closed', handler);
    return () => ipcRenderer.removeListener('dashboard:closed', handler);
  },
});
