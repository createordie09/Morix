/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  // Shared Gemini client instance on the server with User-Agent header
  const getGeminiClient = () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not defined in server environment');
    }
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  };

  /**
   * Endpoint 1: Création de jeton éphémère de session pour Gemini Live
   * Fournit au navigateur un token temporaire restreint (authTokens)
   * afin que la clé API maître ne quitte JAMAIS le serveur.
   */
  app.post('/api/live-token', async (req, res) => {
    try {
      const ai = getGeminiClient();
      const model = req.body.model || 'gemini-2.5-flash-native-audio-preview-09-2025';
      const token = await ai.authTokens.create({
        config: {
          liveConnectConstraints: {
            model,
          },
        },
      });
      res.json({ token: token.name });
    } catch (err: any) {
      console.error('[Server /api/live-token Error]:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to create live token' });
    }
  });

  /**
   * Endpoint 2: Proxy serveur pour la recherche web (outil rechercher_web)
   * Effectue un appel generateContent avec l'outil natif googleSearch
   * en utilisant la clé API stockée de façon sécurisée côté serveur.
   */
  app.post('/api/search', async (req, res) => {
    try {
      const { requete } = req.body;
      if (!requete) {
        return res.status(400).json({ error: 'Requete is required' });
      }

      console.log(`[Server /api/search] Exécution recherche pour: "${requete}"`);
      const ai = getGeminiClient();
      let searchResp: any;

      try {
        searchResp = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: `Effectue une recherche web précise et synthétise les faits récents et vérifiés pour répondre à la requête suivante : ${requete}`,
          config: {
            tools: [{ googleSearch: {} }],
          },
        });
      } catch (modelErr: any) {
        const is404 =
          modelErr?.message?.includes('not available') ||
          modelErr?.message?.includes('NOT_FOUND') ||
          modelErr?.status === 404;
        if (is404) {
          searchResp = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: `Effectue une recherche web précise et synthétise les faits récents et vérifiés pour répondre à la requête suivante : ${requete}`,
            config: {
              tools: [{ googleSearch: {} }],
            },
          });
        } else {
          throw modelErr;
        }
      }

      const texte = searchResp?.text || '';
      const candidate = searchResp?.candidates?.[0];
      const chunks = candidate?.groundingMetadata?.groundingChunks;
      const sources =
        chunks
          ?.map((chunk: any) => ({
            titre: chunk.web?.title || 'Source web',
            url: chunk.web?.uri || '',
          }))
          .filter((s: any) => Boolean(s.url)) || [];

      res.json({
        status: 'success',
        requete,
        resultat: texte,
        sources,
      });
    } catch (err: any) {
      console.error('[Server /api/search Error]:', err?.message || err);
      res.status(500).json({
        status: 'erreur',
        message: err?.message || 'Erreur lors de la recherche web',
      });
    }
  });

  /**
   * Endpoint 3: Génération de résumé court de session et extraction de préférences
   * Utilise Gemini côté serveur pour résumer en 2-3 phrases les points clés à mémoriser.
   */
  app.post('/api/summarize', async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        return res.status(400).json({ error: 'Text content is required' });
      }

      console.log(`[Server /api/summarize] Génération de résumé pour ${text.length} caractères...`);
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

      let resp: any;
      try {
        resp = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
          },
        });
      } catch (modelErr: any) {
        resp = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
        });
      }

      const raw = resp?.text?.trim() || '{}';
      let parsed: any = {};
      try {
        const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
        parsed = JSON.parse(cleaned);
      } catch {
        parsed = { resume: raw.slice(0, 300), nomUtilisateur: null, langue: 'fr' };
      }

      res.json({
        status: 'success',
        resume: parsed.resume || '',
        nomUtilisateur: parsed.nomUtilisateur || null,
        langue: parsed.langue === 'en' ? 'en' : 'fr',
      });
    } catch (err: any) {
      console.warn('[Server /api/summarize Error]:', err?.message || err);
      res.status(500).json({
        status: 'error',
        message: err?.message || 'Erreur lors de la génération du résumé',
      });
    }
  });

  // Montage de Vite en mode middleware pour le dev, ou fichiers statiques en prod
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] morix-ui backend running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
