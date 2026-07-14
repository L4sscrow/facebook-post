// ==UserScript==
// @name         Facebook Post AI Generator
// @namespace    https://lasscrow.local/facebook-post-ai
// @version      1.0.0
// @description  Génère automatiquement un post Facebook (texte 📸, lien, hashtags) via OpenRouter à partir d'une courte description.
// @author       lasscrow
// @match        https://www.facebook.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// @connect      openrouter.ai
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ------------------------------------------------------------------
  // CONFIGURATION — à adapter
  // ------------------------------------------------------------------

  // La clé API OpenRouter n'est plus écrite ici : elle se saisit dans le popup
  // et est stockée via GM_setValue (stockage propre à Violentmonkey, pas dans le code).

  // Modèle par défaut (modifiable ensuite directement dans le popup, persisté)
  const DEFAULT_MODEL = 'openai/gpt-5.4-mini';

  // Hashtags toujours présents, ajoutés automatiquement à la fin du post
  const FIXED_HASHTAGS = ['#franchecomte', '#lestrepublicain', '#estrepublicain', '#lionelvadam'];

  // ------------------------------------------------------------------
  // Styles
  // ------------------------------------------------------------------

  const STYLE = `
    #fbpg-trigger {
      position: fixed;
      right: 24px;
      bottom: 24px;
      z-index: 2147483647;
      background: linear-gradient(135deg, #1877f2, #0a5dc2);
      color: #fff;
      border: none;
      border-radius: 999px;
      padding: 14px 20px;
      font-size: 15px;
      font-weight: 600;
      font-family: -apple-system, Helvetica, Arial, sans-serif;
      box-shadow: 0 4px 14px rgba(0,0,0,.35);
      cursor: pointer;
    }
    #fbpg-trigger:hover { filter: brightness(1.08); }

    #fbpg-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,.55);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, Helvetica, Arial, sans-serif;
    }
    #fbpg-modal {
      background: #fff;
      color: #1c1e21;
      width: 520px;
      max-width: 92vw;
      max-height: 88vh;
      overflow-y: auto;
      border-radius: 10px;
      padding: 20px 22px 22px;
      box-shadow: 0 10px 40px rgba(0,0,0,.4);
    }
    #fbpg-modal h2 {
      margin: 0 0 14px;
      font-size: 18px;
    }
    #fbpg-modal label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      margin: 12px 0 4px;
      color: #444;
    }
    #fbpg-modal textarea,
    #fbpg-modal input[type="text"],
    #fbpg-modal input[type="url"] {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #ccd0d5;
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 14px;
      font-family: inherit;
      resize: vertical;
    }
    #fbpg-desc { min-height: 70px; }
    #fbpg-result { min-height: 140px; }
    #fbpg-modal .fbpg-row {
      display: flex;
      gap: 10px;
      margin-top: 16px;
    }
    #fbpg-modal button {
      cursor: pointer;
      border: none;
      border-radius: 6px;
      padding: 9px 14px;
      font-size: 14px;
      font-weight: 600;
    }
    .fbpg-btn-primary { background: #1877f2; color: #fff; }
    .fbpg-btn-secondary { background: #e4e6eb; color: #1c1e21; }
    .fbpg-btn-close { background: transparent; color: #65676b; font-size: 20px; padding: 0 4px; }
    #fbpg-header { display: flex; justify-content: space-between; align-items: center; }
    #fbpg-status { font-size: 13px; margin-top: 10px; min-height: 18px; }
    #fbpg-status.error { color: #d93025; }
    #fbpg-status.ok { color: #1a7f37; }
  `;

  function injectStyle() {
    const s = document.createElement('style');
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  // ------------------------------------------------------------------
  // UI
  // ------------------------------------------------------------------

  function buildTrigger() {
    const btn = document.createElement('button');
    btn.id = 'fbpg-trigger';
    btn.type = 'button';
    btn.textContent = '✨ Générer mon post';
    btn.addEventListener('click', openModal);
    document.body.appendChild(btn);
  }

  function openModal() {
    if (document.getElementById('fbpg-overlay')) return;

    const savedModel = GM_getValue('fbpg_model', DEFAULT_MODEL);
    const savedApiKey = GM_getValue('fbpg_api_key', '');

    const overlay = document.createElement('div');
    overlay.id = 'fbpg-overlay';
    overlay.innerHTML = `
      <div id="fbpg-modal">
        <div id="fbpg-header">
          <h2>Générer un post Facebook</h2>
          <button type="button" class="fbpg-btn-close" id="fbpg-close">✕</button>
        </div>

        <label for="fbpg-desc">Décris brièvement le post</label>
        <textarea id="fbpg-desc" placeholder="Ex: Feu d'artifice du 14 juillet à Paris"></textarea>

        <label for="fbpg-link">Lien de l'article</label>
        <input type="url" id="fbpg-link" placeholder="https://...">

        <label for="fbpg-model">Modèle OpenRouter</label>
        <input type="text" id="fbpg-model" value="${escapeHtml(savedModel)}">

        <label for="fbpg-apikey">Clé API OpenRouter (stockée localement dans Violentmonkey)</label>
        <input type="password" id="fbpg-apikey" value="${escapeHtml(savedApiKey)}" placeholder="sk-or-v1-...">

        <div class="fbpg-row">
          <button type="button" class="fbpg-btn-primary" id="fbpg-generate">Générer</button>
        </div>

        <div id="fbpg-status"></div>

        <label for="fbpg-result">Résultat (modifiable avant insertion)</label>
        <textarea id="fbpg-result" placeholder="Le post généré apparaîtra ici..."></textarea>

        <div class="fbpg-row">
          <button type="button" class="fbpg-btn-secondary" id="fbpg-copy">Copier</button>
          <button type="button" class="fbpg-btn-primary" id="fbpg-insert">Insérer dans le post</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
    document.getElementById('fbpg-close').addEventListener('click', closeModal);
    document.getElementById('fbpg-generate').addEventListener('click', onGenerate);
    document.getElementById('fbpg-copy').addEventListener('click', onCopy);
    document.getElementById('fbpg-insert').addEventListener('click', onInsert);
    document.getElementById('fbpg-model').addEventListener('change', (e) => {
      GM_setValue('fbpg_model', e.target.value.trim());
    });
    document.getElementById('fbpg-apikey').addEventListener('change', (e) => {
      GM_setValue('fbpg_api_key', e.target.value.trim());
    });

    document.getElementById('fbpg-desc').focus();
  }

  function closeModal() {
    const overlay = document.getElementById('fbpg-overlay');
    if (overlay) overlay.remove();
  }

  function setStatus(msg, kind) {
    const el = document.getElementById('fbpg-status');
    if (!el) return;
    el.textContent = msg;
    el.className = kind || '';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ------------------------------------------------------------------
  // Génération via OpenRouter
  // ------------------------------------------------------------------

  function onGenerate() {
    const desc = document.getElementById('fbpg-desc').value.trim();
    const link = document.getElementById('fbpg-link').value.trim();
    const model = document.getElementById('fbpg-model').value.trim() || DEFAULT_MODEL;
    const apiKey = document.getElementById('fbpg-apikey').value.trim();

    if (!desc) {
      setStatus('Décris d\'abord le sujet du post.', 'error');
      return;
    }
    if (!apiKey) {
      setStatus('Renseigne ta clé API OpenRouter ci-dessus.', 'error');
      return;
    }

    GM_setValue('fbpg_model', model);
    GM_setValue('fbpg_api_key', apiKey);
    setStatus('Génération en cours...', '');
    document.getElementById('fbpg-generate').disabled = true;

    const systemPrompt = [
      'Tu rédiges des posts Facebook courts et engageants pour un journaliste qui relaie ses',
      'diaporamas photo (Franche-Comté / L\'Est Républicain).',
      'Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, sans balises markdown,',
      'avec exactement ces clés :',
      '- "text": 2 à 4 phrases engageantes qui donnent envie de voir le diaporama photo.',
      '  Le texte doit OBLIGATOIREMENT commencer par l\'emoji 📸 suivi d\'un espace, puis le texte',
      '  (pas de titre séparé, pas de guillemets). Ton chaleureux et local. Sans hashtags et sans lien.',
      '- "hashtags": un tableau de 3 à 6 hashtags pertinents par rapport au sujet, en français,',
      '  au format "#motclé" (sans espace, sans accent si possible). Si la ville et/ou le département',
      '  concernés sont identifiables dans le sujet donné, ajoute-les OBLIGATOIREMENT sous forme de',
      '  hashtags (ex: "#Besancon", "#Doubs"). N\'inclus PAS ces hashtags, déjà ajoutés automatiquement : ' +
      FIXED_HASHTAGS.join(', ') + '.'
    ].join(' ');

    const userPrompt = `Sujet du post : ${desc}`;

    GM_xmlhttpRequest({
      method: 'POST',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'X-Title': 'Facebook Post AI Generator'
      },
      data: JSON.stringify({
        model: model,
        temperature: 0.8,
        provider: {
          order: ['azure', 'openai'],
          allow_fallbacks: true
        },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      }),
      onload: function (res) {
        document.getElementById('fbpg-generate').disabled = false;
        handleGenerateResponse(res, link);
      },
      onerror: function () {
        document.getElementById('fbpg-generate').disabled = false;
        setStatus('Erreur réseau lors de l\'appel à OpenRouter.', 'error');
      },
      ontimeout: function () {
        document.getElementById('fbpg-generate').disabled = false;
        setStatus('La requête a expiré, réessaie.', 'error');
      }
    });
  }

  function handleGenerateResponse(res, link) {
    if (res.status < 200 || res.status >= 300) {
      setStatus(`Erreur OpenRouter (${res.status}). Vérifie ta clé API et le nom du modèle.`, 'error');
      return;
    }

    let payload;
    try {
      payload = JSON.parse(res.responseText);
    } catch (e) {
      setStatus('Réponse OpenRouter illisible.', 'error');
      return;
    }

    const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message
      ? payload.choices[0].message.content
      : null;

    if (!content) {
      setStatus('Réponse vide de la part du modèle.', 'error');
      return;
    }

    const parsed = extractJson(content);
    if (!parsed) {
      // Repli : on affiche le texte brut, l'utilisateur peut corriger à la main.
      document.getElementById('fbpg-result').value = content.trim();
      setStatus('Format inattendu, texte brut affiché — à vérifier.', 'error');
      return;
    }

    const finalText = assemblePost(parsed, link);
    document.getElementById('fbpg-result').value = finalText;
    setStatus('Post généré.', 'ok');
  }

  function extractJson(text) {
    let cleaned = text.trim();
    // Retire d'éventuelles balises ```json ... ```
    cleaned = cleaned.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();

    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) return null;

    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch (e) {
      return null;
    }
  }

  function assemblePost(parsed, link) {
    let text = (parsed.text || '').trim();
    if (!text.startsWith('📸')) text = '📸 ' + text;

    let dynamicTags = Array.isArray(parsed.hashtags) ? parsed.hashtags : [];

    dynamicTags = dynamicTags
      .map((t) => String(t).trim())
      .filter(Boolean)
      .map((t) => (t.startsWith('#') ? t : '#' + t));

    // Dédoublonne au cas où l'IA aurait quand même repris un hashtag fixe.
    const fixedLower = FIXED_HASHTAGS.map((t) => t.toLowerCase());
    dynamicTags = dynamicTags.filter((t) => !fixedLower.includes(t.toLowerCase()));

    const allTags = [...dynamicTags, ...FIXED_HASHTAGS].join(' ');

    const parts = [text];
    if (link) parts.push('🔴 Toutes les images à revoir ici ⏬⏬⏬\n' + link);
    parts.push(allTags);

    return parts.filter(Boolean).join('\n\n');
  }

  // ------------------------------------------------------------------
  // Copier / Insérer
  // ------------------------------------------------------------------

  function onCopy() {
    const text = document.getElementById('fbpg-result').value;
    if (!text) return;
    GM_setClipboard(text);
    setStatus('Copié dans le presse-papiers.', 'ok');
  }

  function onInsert() {
    const text = document.getElementById('fbpg-result').value;
    if (!text) {
      setStatus('Rien à insérer.', 'error');
      return;
    }

    const box = findComposerBox();
    if (!box) {
      GM_setClipboard(text);
      setStatus('Zone de post introuvable — texte copié, colle-le avec Ctrl+V.', 'error');
      return;
    }

    box.focus();
    const inserted = document.execCommand('insertText', false, text);
    if (!inserted) {
      GM_setClipboard(text);
      setStatus('Insertion auto impossible — texte copié, colle-le avec Ctrl+V.', 'error');
      return;
    }

    setStatus('Post inséré.', 'ok');
    closeModal();
  }

  function findComposerBox() {
    // Cherche la boîte de texte du composeur ouvert (dialog de création de post),
    // sinon la première zone de texte éditable visible sur la page.
    const dialogs = document.querySelectorAll('div[role="dialog"]');
    for (const dialog of dialogs) {
      const box = dialog.querySelector('div[role="textbox"][contenteditable="true"]');
      if (box && isVisible(box)) return box;
    }
    const anyBox = document.querySelector('div[role="textbox"][contenteditable="true"]');
    if (anyBox && isVisible(anyBox)) return anyBox;
    return null;
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // ------------------------------------------------------------------
  // Init
  // ------------------------------------------------------------------

  injectStyle();
  buildTrigger();
})();
