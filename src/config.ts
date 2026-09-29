/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Architecture sécurisée : La clé API maître reste confinée au serveur, qui fournit des jetons de session éphémères restreints (/api/live-token) et prend en charge les requêtes de recherche web (/api/search) afin d'éliminer toute exposition de secret dans le navigateur.

export const GEMINI_CONFIG = {
  // Modèle Live pour l'audio/texte natif temps réel
  model: 'gemini-2.5-flash-native-audio-preview-09-2025',

  // Endpoints serveur proxy pour l'authentification et les outils
  endpoints: {
    liveToken: '/api/live-token',
    search: '/api/search',
    summarize: '/api/summarize',
  },
};
