/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface UserPreferences {
  langue?: 'fr' | 'en';
  languePreference?: 'auto' | 'fr' | 'en';
  nomUtilisateur?: string;
  voix?: string;
  micSensitivity?: number; // 0 à 100, défaut 50
  devShortcutEnabled?: boolean; // défaut true
  alwaysOnTop?: boolean; // défaut false
  transparentBackground?: boolean; // défaut false
  autoStart?: boolean; // défaut false
}

export interface SessionSummary {
  id: string;
  timestamp: number;
  resume: string;
}

export interface LocalMemoryData {
  preferences: UserPreferences;
  resumes: SessionSummary[];
}

const STORAGE_KEY = 'morix_local_memory_v1';
const MAX_SUMMARIES = 5;
const MAX_TOTAL_CHARS = 2000;

// Mémoire volatile de secours si localStorage est indisponible ou bloqué
let inMemoryFallback: LocalMemoryData = {
  preferences: {},
  resumes: [],
};

let isStorageAvailable: boolean | null = null;

function checkStorageAvailability(): boolean {
  if (isStorageAvailable !== null) return isStorageAvailable;
  if (typeof window === 'undefined' || !window.localStorage) {
    isStorageAvailable = false;
    return false;
  }
  try {
    const testKey = '__morix_storage_probe__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    isStorageAvailable = true;
  } catch (e) {
    console.warn('[Morix Memory] localStorage indisponible (mode privé ou quota restreint), bascule en mémoire temporaire.', e);
    isStorageAvailable = false;
  }
  return isStorageAvailable;
}

/**
 * Charge les données de mémoire locale depuis localStorage.
 * Ne lance jamais d'exception et dégrade gracieusement en mémoire vive.
 */
export function loadLocalMemory(): LocalMemoryData {
  if (!checkStorageAvailability()) {
    return inMemoryFallback;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { preferences: {}, resumes: [] };
    }
    const parsed = JSON.parse(raw) as Partial<LocalMemoryData>;
    return {
      preferences: parsed.preferences || {},
      resumes: Array.isArray(parsed.resumes) ? parsed.resumes : [],
    };
  } catch (err) {
    console.warn('[Morix Memory] Erreur lors du chargement de localStorage :', err);
    return inMemoryFallback;
  }
}

/**
 * Sauvegarde les données dans localStorage avec contrôle strict de taille.
 */
export function saveLocalMemory(data: LocalMemoryData): void {
  // Tronquer à MAX_SUMMARIES éléments
  let trimmedResumes = data.resumes.slice(-MAX_SUMMARIES);

  // Vérifier la limite de caractères cumulés
  const calculateTotalLength = (list: SessionSummary[]) =>
    list.reduce((acc, curr) => acc + (curr.resume?.length || 0), 0);

  while (trimmedResumes.length > 1 && calculateTotalLength(trimmedResumes) > MAX_TOTAL_CHARS) {
    trimmedResumes.shift(); // Éliminer les résumés les plus anciens jusqu'à respecter la limite
  }

  const payload: LocalMemoryData = {
    preferences: data.preferences || {},
    resumes: trimmedResumes,
  };

  inMemoryFallback = payload;

  if (!checkStorageAvailability()) {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('[Morix Memory] Erreur lors de l\'écriture dans localStorage (quota plein ou restriction) :', err);
  }
}

/**
 * Ajoute un nouveau résumé de session dans la mémoire locale.
 */
export function addSessionSummary(resumeText: string): void {
  const cleanText = resumeText.trim();
  if (!cleanText) return;

  const current = loadLocalMemory();
  const newSummary: SessionSummary = {
    id: `summary-${Date.now()}`,
    timestamp: Date.now(),
    resume: cleanText,
  };

  current.resumes.push(newSummary);
  saveLocalMemory(current);
}

/**
 * Met à jour les préférences de l'utilisateur (nom, langue, voix).
 */
export function updateUserPreferences(prefs: Partial<UserPreferences>): void {
  const current = loadLocalMemory();
  current.preferences = {
    ...current.preferences,
    ...prefs,
  };
  saveLocalMemory(current);
}

/**
 * Réinitialise complètement la mémoire locale (résumés et préférences).
 */
export function clearLocalMemory(): void {
  inMemoryFallback = {
    preferences: {},
    resumes: [],
  };

  if (checkStorageAvailability()) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      console.warn('[Morix Memory] Erreur lors de la suppression de localStorage :', err);
    }
  }
}

/**
 * Génère le bloc textuel de contexte à injecter dans systemInstruction pour Morix.
 */
export function getMemoryContextForInstruction(): string {
  const memory = loadLocalMemory();
  const hasResumes = memory.resumes.length > 0;
  const hasPrefs = Boolean(
    memory.preferences.nomUtilisateur ||
    memory.preferences.langue ||
    memory.preferences.languePreference
  );

  if (!hasResumes && !hasPrefs) {
    return '';
  }

  const sections: string[] = ['## Contexte des échanges précédents (Mémoire persistante)'];

  if (memory.preferences.nomUtilisateur) {
    sections.push(`- Nom de l'utilisateur : ${memory.preferences.nomUtilisateur}`);
  }

  if (memory.preferences.languePreference === 'fr') {
    sections.push("- Directive de langue : L'utilisateur a explicitement configuré la langue sur le FRANÇAIS. Exprime-toi exclusivement en français.");
  } else if (memory.preferences.languePreference === 'en') {
    sections.push("- Language directive: The user has explicitly set their preferred language to ENGLISH. Speak exclusively in English.");
  } else if (memory.preferences.langue) {
    const langLabel = memory.preferences.langue === 'en' ? 'Anglais' : 'Français';
    sections.push(`- Langue habituelle détectée : ${langLabel}`);
  }

  if (hasResumes) {
    sections.push('- Synthèse des dernières sessions :');
    memory.resumes.forEach((s, idx) => {
      sections.push(`  ${idx + 1}. ${s.resume}`);
    });
  }

  sections.push(
    'Consigne de mémoire : Tiens compte naturellement de ces éléments passés dans tes réponses et ton attitude sans exiger que l\'utilisateur répète ce qu\'il t\'a déjà confié.'
  );

  return sections.join('\n');
}

/**
 * Analyse une liste d'échanges récents via le processus principal (morixAPI.resumerSession),
 * génère un résumé en 2-3 phrases et persiste les données en local.
 */
export async function summarizeAndPersistConversation(
  dialogueHistory: string[]
): Promise<SessionSummary | null> {
  if (!dialogueHistory || dialogueHistory.length === 0) {
    return null;
  }

  const rawText = dialogueHistory.filter(Boolean).join('\n');
  if (rawText.trim().length < 20) {
    return null; // Pas assez de matière pour un résumé pertinent
  }

  try {
    if (typeof window !== 'undefined' && window.morixAPI?.resumerSession) {
      const data = await window.morixAPI.resumerSession(rawText);
      if (data && data.status === 'success' && data.resume) {
        addSessionSummary(data.resume);

        if (data.nomUtilisateur || data.langue) {
          updateUserPreferences({
            ...(data.nomUtilisateur ? { nomUtilisateur: data.nomUtilisateur } : {}),
            ...(data.langue ? { langue: data.langue } : {}),
          });
        }

        return {
          id: `summary-${Date.now()}`,
          timestamp: Date.now(),
          resume: data.resume,
        };
      }
    }
    throw new Error('IPC resumerSession non disponible ou réponse invalide');
  } catch (err: any) {
    console.warn('[Morix Memory] Échec de la génération IA du résumé, création d\'une synthèse locale de secours :', err?.message || err);
    // Synthèse de secours locale pour ne rien perdre
    const fallbackText = rawText
      .split('\n')
      .slice(-4)
      .join(' | ')
      .slice(0, 200);

    const fallbackSummary = `Échanges récents : ${fallbackText}`;
    addSessionSummary(fallbackSummary);
    return {
      id: `summary-${Date.now()}`,
      timestamp: Date.now(),
      resume: fallbackSummary,
    };
  }

  return null;
}
