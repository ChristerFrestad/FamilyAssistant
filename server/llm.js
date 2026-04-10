// LLM-integrasjon med tool-calling, RAG, og kontekstvindu-begrensning
// Støtter: Ollama (standard), llama.cpp server (raskere på RPI5)
// Anbefalt modell: qwen2.5:3b (Q4_K_M) for 8GB RAM

const http = require('http');

// === Konfigurasjon ===
const LLM_BACKEND = process.env.LLM_BACKEND || 'ollama'; // 'ollama' eller 'llamacpp'
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const LLAMACPP_HOST = process.env.LLAMACPP_HOST || 'http://localhost:8080';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b';
const MAX_CONTEXT_TOKENS = parseInt(process.env.MAX_CONTEXT_TOKENS || '3072');
const MAX_HISTORY_MESSAGES = 8;

function log(msg) {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  console.log(`[LLM ${ts}] ${msg}`);
}

// === Tool-definitioner for function-calling ===

const AVAILABLE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'add_to_shopping_list',
      description: 'Legg til en vare på handlelisten',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Varenavn (f.eks. Bakepapir, Saft)' },
          category: { type: 'string', enum: ['Kjøtt & fisk', 'Meieri', 'Frukt & grønt', 'Brød & bakst', 'Tørrvarer & annet', 'Drikkevarer', 'Husholdning', 'Barn', 'Personlig pleie'] },
          quantity: { type: 'number', description: 'Antall (valgfritt)' },
        },
        required: ['name', 'category'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_calendar_event',
      description: 'Opprett en ny kalenderhendelse',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Tittel på hendelsen' },
          date: { type: 'string', description: 'Dato i YYYY-MM-DD format' },
          startTime: { type: 'string', description: 'Starttid HH:MM (valgfritt)' },
          endTime: { type: 'string', description: 'Sluttid HH:MM (valgfritt)' },
          location: { type: 'string', description: 'Sted (valgfritt)' },
        },
        required: ['title', 'date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_routine',
      description: 'Oppdater en husholdsrutine eller preferanse i kunnskapsbasen',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['mat', 'rutine', 'preferanse', 'kalender', 'barn', 'annet'] },
          description: { type: 'string', description: 'Hva som ble lært eller endret' },
          action: { type: 'string', enum: ['add', 'update', 'remove'] },
        },
        required: ['category', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'suggest_meal',
      description: 'Foreslå en middag basert på kriterier',
      parameters: {
        type: 'object',
        properties: {
          criteria: { type: 'string', description: 'Hva brukeren ønsker (rask, med kylling, asiatisk, etc.)' },
          day: { type: 'string', description: 'Hvilken dag (mandag, fredag, etc.)' },
        },
        required: ['criteria'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_knowledge_base',
      description: 'Søk i kunnskapsbasen etter tidligere samtaler, rutiner, eller preferanser',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Søkeord eller tema' },
        },
        required: ['query'],
      },
    },
  },
];

// === Tool-name-only liste for modeller uten native tool support ===
const TOOL_DESCRIPTIONS = AVAILABLE_TOOLS.map(t => {
  const f = t.function;
  const params = Object.entries(f.parameters.properties)
    .map(([k, v]) => `  ${k}: ${v.type} — ${v.description}`)
    .join('\n');
  return `${f.name}: ${f.description}\n  Parametere:\n${params}`;
}).join('\n\n');

// === HTTP-kall til LLM-backend ===

function httpRequest(url, payload, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout,
    };

    const req = http.request(reqOpts, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Parse error: ${e.message}`)); }
      });
    });

    req.on('error', (e) => reject(new Error(`Connection failed: ${e.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('LLM timeout')); });
    req.write(payload);
    req.end();
  });
}

// === Generisk LLM-kall med tool-calling support ===

async function llmChat(messages, options = {}) {
  if (LLM_BACKEND === 'llamacpp') {
    return llamaCppChat(messages, options);
  }
  return ollamaChat(messages, options);
}

async function ollamaChat(messages, options = {}) {
  const payload = {
    model: options.model || OLLAMA_MODEL,
    messages,
    stream: false,
    options: {
      temperature: options.temperature || 0.7,
      num_predict: options.maxTokens || 512,
      num_ctx: MAX_CONTEXT_TOKENS,
    },
  };

  // Tool-calling (Ollama native — støttes av Qwen2.5+)
  if (options.tools) {
    payload.tools = options.tools;
  }

  const json = await httpRequest(OLLAMA_HOST + '/api/chat', JSON.stringify(payload), options.timeout || 60000);

  // Sjekk for tool calls i svaret
  if (json.message?.tool_calls && json.message.tool_calls.length > 0) {
    return {
      type: 'tool_calls',
      toolCalls: json.message.tool_calls.map(tc => ({
        name: tc.function.name,
        arguments: tc.function.arguments,
      })),
      content: json.message.content || '',
    };
  }

  return {
    type: 'text',
    content: json.message?.content || '',
  };
}

async function llamaCppChat(messages, options = {}) {
  // llama.cpp /v1/chat/completions format (OpenAI-kompatibelt)
  const payload = {
    messages,
    temperature: options.temperature || 0.7,
    max_tokens: options.maxTokens || 512,
    n_ctx: MAX_CONTEXT_TOKENS,
  };

  if (options.tools) {
    payload.tools = options.tools;
    payload.tool_choice = 'auto';
  }

  const json = await httpRequest(LLAMACPP_HOST + '/v1/chat/completions', JSON.stringify(payload), options.timeout || 60000);
  const choice = json.choices?.[0];

  if (choice?.message?.tool_calls && choice.message.tool_calls.length > 0) {
    return {
      type: 'tool_calls',
      toolCalls: choice.message.tool_calls.map(tc => ({
        name: tc.function.name,
        arguments: typeof tc.function.arguments === 'string'
          ? JSON.parse(tc.function.arguments)
          : tc.function.arguments,
      })),
      content: choice.message.content || '',
    };
  }

  return {
    type: 'text',
    content: choice?.message?.content || '',
  };
}

// === Sjekk tilgjengelighet ===

async function isLLMAvailable() {
  try {
    if (LLM_BACKEND === 'llamacpp') {
      const json = await httpRequest(LLAMACPP_HOST + '/health', '{}', 3000).catch(() => null);
      if (json) return { available: true, backend: 'llama.cpp', models: ['loaded'] };
      return { available: false, backend: 'llama.cpp', models: [] };
    }

    return new Promise((resolve) => {
      const url = new URL(OLLAMA_HOST);
      const req = http.get({
        hostname: url.hostname,
        port: url.port || 11434,
        path: '/api/tags',
        timeout: 3000,
      }, (res) => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const models = (json.models || []).map(m => m.name);
            resolve({ available: true, backend: 'ollama', model: OLLAMA_MODEL, models });
          } catch { resolve({ available: false, backend: 'ollama', models: [] }); }
        });
      });
      req.on('error', () => resolve({ available: false, backend: 'ollama', models: [] }));
      req.on('timeout', () => { req.destroy(); resolve({ available: false, backend: 'ollama', models: [] }); });
    });
  } catch {
    return { available: false, backend: LLM_BACKEND, models: [] };
  }
}

// === Token-estimering (enkel — 1 token ≈ 4 chars for norsk) ===

function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

function trimHistoryToFit(systemPrompt, history, userMessage, maxTokens) {
  const systemTokens = estimateTokens(systemPrompt);
  const userTokens = estimateTokens(userMessage);
  const overhead = 100; // Safety margin
  let available = maxTokens - systemTokens - userTokens - overhead;

  const trimmed = [];
  // Start from most recent, add backwards until budget runs out
  for (let i = history.length - 1; i >= 0; i--) {
    const cost = estimateTokens(history[i].content);
    if (available - cost < 0) break;
    available -= cost;
    trimmed.unshift(history[i]);
  }
  return trimmed;
}

// === RAG: Hent relevant kontekst fra KB ===

// Fase 4.4: sanitiser KB-data før den legges i system-prompt for å hindre
// prompt injection. Lazy-load for å unngå circular dep.
let _sanitize = null;
function getSanitizer() {
  if (_sanitize) return _sanitize;
  try { _sanitize = require('./http/security').sanitizeForPrompt; }
  catch { _sanitize = (s) => (s || '').slice(0, 500); }
  return _sanitize;
}

function buildRAGContext(db, userMessage) {
  if (!db || !db.kbSearch) return '';

  // Hent relevante tidligere samtaler
  const relevant = db.kbSearch(userMessage, 5);
  if (relevant.length === 0) return '';

  const sanitize = getSanitizer();
  let ragText = '\n\nTidligere relevant samtaler:\n';
  for (const entry of relevant.slice(0, 3)) {
    const msg = sanitize(entry.user_message || entry.userMessage || '', 100);
    const resp = sanitize(entry.ai_response || entry.aiResponse || '', 150);
    ragText += `- Bruker: "${msg}" → Svar: "${resp}"\n`;
  }
  return ragText;
}

// === SYSTEM PROMPTS ===

const FAMILY_CONTEXT = `Du er Familieassistenten — en intelligent husholdsassistent for familien Frestad.
Familie: Christer, Martine (hjemme i permisjon), baby Mazie
Adresse: Heia 9, Kristiansand
Butikk: Kiwi Vågsbygd (primær), Coop Extra Vågsbygd (sekundær)
Melk: KUN Røros-meieriet
Utstyr: airfryer, gassgrill, pizzastein, riskoker, Kenwood, bambusdamper, wok

Du har tilgang til disse verktøyene:
${TOOL_DESCRIPTIONS}

Når brukeren ber om noe som kan løses med et verktøy, BRUK verktøyet.
Eksempler:
- "Legg til bakepapir" → kall add_to_shopping_list
- "Vi har legetime torsdag kl 10" → kall add_calendar_event
- "Mazie sover bedre med svøping nå" → kall update_routine
- "Hva hadde vi forrige uke?" → kall search_knowledge_base

Svar alltid på norsk. Vær konkret og hjelpsom. Hold svarene korte og praktiske.`;

// === Hovedfunksjoner ===

// 1. Chat med tool-calling og RAG
async function chat(userMessage, conversationHistory = [], dbContext = {}, db = null) {
  // Bygg RAG-kontekst fra kunnskapsbasen
  const ragContext = buildRAGContext(db, userMessage);

  const systemPrompt = `${FAMILY_CONTEXT}

Dagens kontekst:
${dbContext.todayMeal ? `- Dagens middag: ${dbContext.todayMeal}` : '- Ingen middag planlagt i dag'}
${dbContext.todayChores ? `- Husarbeid: ${dbContext.todayChores}` : ''}
${ragContext}`;

  // Trim historikk til å passe i kontekstvinduet
  const trimmedHistory = trimHistoryToFit(
    systemPrompt,
    conversationHistory.slice(-MAX_HISTORY_MESSAGES),
    userMessage,
    MAX_CONTEXT_TOKENS
  );

  const messages = [
    { role: 'system', content: systemPrompt },
    ...trimmedHistory,
    { role: 'user', content: userMessage },
  ];

  try {
    const result = await llmChat(messages, {
      temperature: 0.7,
      maxTokens: 512,
      tools: AVAILABLE_TOOLS,
    });

    // Hvis LLM returnerte tool-calls, returner dem for utførelse
    if (result.type === 'tool_calls') {
      return {
        type: 'tool_calls',
        toolCalls: result.toolCalls,
        textResponse: result.content || 'Utfører...',
      };
    }

    // Ren tekst-respons — prøv å ekstrahere eventuelle tool-calls fra teksten
    // (fallback for modeller som ikke støtter native tool-calling)
    const extracted = extractToolCallsFromText(result.content);
    if (extracted.toolCalls.length > 0) {
      return {
        type: 'tool_calls',
        toolCalls: extracted.toolCalls,
        textResponse: extracted.cleanedText || result.content,
      };
    }

    return {
      type: 'text',
      content: result.content,
    };
  } catch (err) {
    return {
      type: 'text',
      content: `Beklager, jeg klarer ikke å svare akkurat nå. Feil: ${err.message}`,
    };
  }
}

// Ekstraher tool-calls fra tekst (for modeller uten native support)
function extractToolCallsFromText(text) {
  const toolCalls = [];
  let cleanedText = text;

  // Finn JSON-blokker som matcher tool-format
  const jsonPattern = /```json\s*(\{[\s\S]*?\})\s*```/g;
  let match;
  while ((match = jsonPattern.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.tool && parsed.arguments) {
        toolCalls.push({ name: parsed.tool, arguments: parsed.arguments });
        cleanedText = cleanedText.replace(match[0], '');
      }
    } catch { /* ikke gyldig tool-call JSON */ }
  }

  // Prøv også direkte function-call-mønster
  const fnPattern = /\b(add_to_shopping_list|add_calendar_event|update_routine|suggest_meal|search_knowledge_base)\s*\(([^)]*)\)/g;
  while ((match = fnPattern.exec(text)) !== null) {
    try {
      const args = JSON.parse(match[2] || '{}');
      toolCalls.push({ name: match[1], arguments: args });
      cleanedText = cleanedText.replace(match[0], '');
    } catch { /* kan ikke parse args */ }
  }

  return { toolCalls, cleanedText: cleanedText.trim() };
}

// 2. Smart ukemenyforslag med RAG
async function generateMealSuggestions(context) {
  const { currentMeals, recentHistory, inventory, preferences, season } = context;

  const systemPrompt = `${FAMILY_CONTEXT}

Regler for ukemeny:
- Mandag–torsdag: raske retter under 30 min
- Fredag: comfort food (30-60 min)
- Lørdag–søndag: helgeretter, kan ta lengre tid
- Aldri posemat eller posetmos
- Varier mellom ulike proteiner (kylling, laks, svin, storfe, vegetar)
- Martine liker: curry, scampi, asiatisk mat
- Christer liker: grillmat, biff, kebab`;

  const userPrompt = `Lag forslag til ukemeny (mandag–søndag) for neste uke.

Denne ukens middager (unngå gjentakelse): ${currentMeals.join(', ')}
Siste 2 ukers middager: ${recentHistory.join(', ')}
Vi har hjemme: ${inventory.join(', ')}
Sesong: ${season}

Svar i dette JSON-formatet:
{
  "meals": [
    {"day": "Mandag", "name": "Rettens navn", "prepTime": "20 min", "category": "rask", "reason": "Hvorfor denne", "ingredients": [{"name": "X", "qty": 400, "unit": "g"}]}
  ],
  "handledag": "Anbefalt handledag",
  "tips": "Tips for uken"
}`;

  try {
    const result = await llmChat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], { temperature: 0.8, maxTokens: 2048 });

    const jsonMatch = (result.content || '').match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return { raw: result.content, error: 'Kunne ikke parse JSON' };
  } catch (err) {
    log(`Feil i generateMealSuggestions: ${err.message}`);
    return { error: err.message };
  }
}

// 3. Oppskriftforslag
async function suggestRecipeFromText(mealName) {
  const systemPrompt = `Du er en norsk kokk for familien Frestad. Gi oppskrifter med eksakte mengder for 2 porsjoner.
Bruk ingredienser fra Kiwi/Coop i Norge. Svar på norsk i JSON-format.`;

  const userPrompt = `Gi oppskrift for "${mealName}" for 2 porsjoner.
Svar i JSON: { "name": "...", "category": "rask|comfort|helg", "prepTime": "25 min", "ingredients": [{"name": "X", "qty": 400, "unit": "g"}], "instructions": ["Steg 1..."], "equipment": ["stekepanne"] }`;

  try {
    const result = await llmChat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], { temperature: 0.5, maxTokens: 1024 });

    const jsonMatch = (result.content || '').match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return { raw: result.content, error: 'Kunne ikke parse JSON' };
  } catch (err) {
    return { error: err.message };
  }
}

// 4. Søndagspush med LLM
async function llmSundayPush(context) {
  const result = await generateMealSuggestions(context);
  if (result.error) {
    log(`LLM søndagspush feilet: ${result.error} — faller tilbake til tilfeldig`);
    return null;
  }
  return result;
}

// 5. Intent-extraksjon (for KB self-improvement)
async function extractIntent(userMessage) {
  try {
    const result = await llmChat([
      { role: 'system', content: 'Analyser brukerens melding og ekstraher intent og entiteter. Svar i JSON: { "intent": "shopping|calendar|routine|meal|question|chat", "entities": {...}, "action": "add|update|remove|query|none" }' },
      { role: 'user', content: userMessage },
    ], { temperature: 0.2, maxTokens: 256 });

    const jsonMatch = (result.content || '').match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return { intent: 'chat', entities: {}, action: 'none' };
  } catch {
    return { intent: 'chat', entities: {}, action: 'none' };
  }
}

module.exports = {
  llmChat,
  isLLMAvailable: isLLMAvailable,
  isOllamaAvailable: isLLMAvailable, // Bakoverkompatibel alias
  generateMealSuggestions,
  suggestRecipeFromText,
  chat,
  llmSundayPush,
  extractIntent,
  AVAILABLE_TOOLS,
  OLLAMA_HOST,
  OLLAMA_MODEL,
  LLM_BACKEND,
};
