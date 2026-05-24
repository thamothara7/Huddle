import { redis, settings } from '@devvit/web/server';
import { k } from '../keys';
import type { ModSuggestion } from '../../../shared/api';

const GEMINI_MODEL = 'gemini-flash-latest';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const VALID_ACTIONS = new Set(['approve', 'remove', 'spam', 'review']);
const VALID_CONFIDENCE = new Set(['low', 'medium', 'high']);

const SYSTEM_PROMPT = `You are advising a subreddit moderator on a queued report. You receive ONLY a structured fact dict — never the content of the reported item. Recommend ONE of these actions:

- "approve": the facts and reports do not support removal
- "remove": the facts clearly indicate a violation (e.g. multiple removals, mod-reported)
- "spam": clearly a spam account (very new account + multiple prior removals + spam-like reports)
- "review": you decline to recommend — the facts are insufficient and a moderator should decide manually

Confidence:
- "high": multiple strong signals point to the recommended action
- "medium": one or two clear signals
- "low": weak signal — prefer "review" with "low" confidence over a guess

The "why" field must:
- Be ONE sentence, max 20 words
- Cite only fields from the dict (account age, post/comment counts, prior removals, report reasons)
- NEVER use judgment words like "suspicious", "concerning", "likely", "appears to"
- NEVER reference content you were not given

Default to "review" with "low" confidence when uncertain. Err on caution — never recommend remove/spam without clear factual support.`;

export type SuggestionContext = {
  itemType: 'post' | 'comment';
  userReportReasons: string[];
  modReportReasons: string[];
  accountAgeDays: number;
  postsInSubTotal: number;
  commentsInSubTotal: number;
  inSubLast7d: number;
  priorRemovals: number;
};

// Conservative rule-based fallback used whenever the LLM is unavailable
// (no key, rate-limited, network error, safety block). Mirrors the LLM's
// constraints: only cites fact-dict fields, never uses judgment language,
// defaults to 'review' when uncertain.
const computeHeuristicSuggestion = (ctx: SuggestionContext): ModSuggestion => {
  const userReports = ctx.userReportReasons.length;
  const modReports = ctx.modReportReasons.length;
  const totalReports = userReports + modReports;
  const veryNewAccount = ctx.accountAgeDays > 0 && ctx.accountAgeDays < 7;
  const youngAccount = ctx.accountAgeDays > 0 && ctx.accountAgeDays < 30;
  const oldAccount = ctx.accountAgeDays > 365;
  const hasPriorRemovals = ctx.priorRemovals > 0;
  const manyPriorRemovals = ctx.priorRemovals >= 3;

  // Spam: very new account + multiple prior removals + any report
  if (veryNewAccount && manyPriorRemovals && totalReports >= 1) {
    return {
      action: 'spam',
      confidence: 'medium',
      why: `Account ${ctx.accountAgeDays} days old with ${ctx.priorRemovals} prior removals in this sub.`,
    };
  }

  // Remove: mod-reported AND (young account OR prior removals)
  if (modReports > 0 && (youngAccount || hasPriorRemovals)) {
    const ageNote = youngAccount
      ? ` account ${ctx.accountAgeDays} days old`
      : '';
    const removalNote = hasPriorRemovals
      ? `${ageNote ? ',' : ''} ${ctx.priorRemovals} prior removal${ctx.priorRemovals === 1 ? '' : 's'}`
      : '';
    return {
      action: 'remove',
      confidence: hasPriorRemovals && youngAccount ? 'high' : 'medium',
      why: `Mod-reported;${ageNote}${removalNote}.`.trim(),
    };
  }

  // Remove: many prior removals on their own
  if (manyPriorRemovals) {
    return {
      action: 'remove',
      confidence: 'medium',
      why: `${ctx.priorRemovals} prior removals in this subreddit.`,
    };
  }

  // Approve: long-established + clean + minimal report
  if (
    oldAccount &&
    !hasPriorRemovals &&
    modReports === 0 &&
    userReports <= 1
  ) {
    return {
      action: 'approve',
      confidence: 'low',
      why: `Account ${Math.round(ctx.accountAgeDays / 365)} year(s) old with no prior removals in this sub.`,
    };
  }

  return {
    action: 'review',
    confidence: 'low',
    why: 'Insufficient signals — manual review recommended.',
  };
};

const writeSuggestionToCache = async (
  itemId: string,
  suggestion: ModSuggestion,
  ttlSeconds: number
): Promise<void> => {
  try {
    await redis.set(k.suggestion(itemId), JSON.stringify(suggestion), {
      expiration: new Date(Date.now() + ttlSeconds * 1000),
    });
  } catch (err) {
    console.error(
      `[huddle] suggestion[${itemId}] cache write failed:`,
      err instanceof Error ? err.message : err
    );
  }
};

export const getOrGenerateSuggestion = async (
  itemId: string,
  ctx: SuggestionContext
): Promise<ModSuggestion | null> => {
  const cacheKey = k.suggestion(itemId);
  const cached = await redis.get(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as ModSuggestion;
      if (isValidSuggestion(parsed)) return parsed;
    } catch {
      // fall through to regenerate
    }
  }

  const apiKey = await readKey();
  if (!apiKey) {
    console.warn(
      `[huddle] suggestion[${itemId}] no Gemini key — using heuristic fallback`
    );
    const heuristic = computeHeuristicSuggestion(ctx);
    await writeSuggestionToCache(itemId, heuristic, 60 * 60); // 1h
    return heuristic;
  }

  const factDict = {
    itemType: ctx.itemType,
    userReportReasons: ctx.userReportReasons,
    modReportReasons: ctx.modReportReasons,
    accountAgeDays: ctx.accountAgeDays,
    postsInSubTotal: ctx.postsInSubTotal,
    commentsInSubTotal: ctx.commentsInSubTotal,
    inSubLast7d: ctx.inSubLast7d,
    priorRemovals: ctx.priorRemovals,
  };

  let response: Response;
  try {
    response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          {
            role: 'user',
            parts: [{ text: JSON.stringify(factDict) }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 200,
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['approve', 'remove', 'spam', 'review'],
              },
              confidence: {
                type: 'string',
                enum: ['low', 'medium', 'high'],
              },
              why: { type: 'string' },
            },
            required: ['action', 'confidence', 'why'],
          },
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
  } catch (err) {
    console.error(
      `[huddle] suggestion[${itemId}] fetch threw — using heuristic fallback:`,
      err instanceof Error ? err.message : err
    );
    const heuristic = computeHeuristicSuggestion(ctx);
    await writeSuggestionToCache(itemId, heuristic, 60 * 60);
    return heuristic;
  }

  if (!response.ok) {
    let body = '';
    try {
      body = (await response.text()).slice(0, 200);
    } catch {
      // ignore
    }
    console.warn(
      `[huddle] suggestion[${itemId}] gemini ${response.status} — using heuristic fallback. body=${body}`
    );
    const heuristic = computeHeuristicSuggestion(ctx);
    // Shorter TTL on rate-limit fallbacks so we retry the LLM sooner once
    // quota resets. For 429 specifically Gemini's free tier resets per day
    // and per minute — 30 minutes is a reasonable middle ground.
    const ttl = response.status === 429 ? 30 * 60 : 60 * 60;
    await writeSuggestionToCache(itemId, heuristic, ttl);
    return heuristic;
  }

  let raw: string;
  try {
    raw = await response.text();
  } catch {
    return null;
  }
  // The response.json() shape from Gemini wraps the structured JSON in
  // candidates[].content.parts[].text — extract then parse.
  let suggestion: ModSuggestion | null = null;
  try {
    const parsed = JSON.parse(raw) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string; thought?: boolean }> };
      }>;
    };
    const parts = parsed?.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts)) {
      const text = parts
        .filter((p) => p && p.thought !== true)
        .map((p) => (typeof p.text === 'string' ? p.text : ''))
        .join('')
        .trim();
      if (text) {
        const inner = JSON.parse(text) as ModSuggestion;
        if (isValidSuggestion(inner)) suggestion = inner;
      }
    }
  } catch (err) {
    console.error(
      `[huddle] suggestion[${itemId}] parse failed:`,
      err instanceof Error ? err.message : err
    );
  }

  if (!suggestion) {
    console.warn(
      `[huddle] suggestion[${itemId}] invalid response shape — using heuristic fallback`
    );
    const heuristic = computeHeuristicSuggestion(ctx);
    await writeSuggestionToCache(itemId, heuristic, 60 * 60);
    return heuristic;
  }

  // Cache LLM-validated suggestions for 24h — fact dict changes slowly
  // and this minimizes repeated Gemini calls on a busy queue.
  await writeSuggestionToCache(itemId, suggestion, 24 * 60 * 60);
  console.log(
    `[huddle] suggestion[${itemId}] ok: ${suggestion.action} (${suggestion.confidence})`
  );
  return suggestion;
};

const isValidSuggestion = (s: unknown): s is ModSuggestion => {
  if (!s || typeof s !== 'object') return false;
  const obj = s as Record<string, unknown>;
  return (
    typeof obj.action === 'string' &&
    VALID_ACTIONS.has(obj.action) &&
    typeof obj.confidence === 'string' &&
    VALID_CONFIDENCE.has(obj.confidence) &&
    typeof obj.why === 'string' &&
    obj.why.length > 0
  );
};

const readKey = async (): Promise<string | undefined> => {
  try {
    const raw = await settings.get('geminiApiKey');
    if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
  } catch (err) {
    console.error('[huddle] suggestion settings.get failed:', err);
  }
  return undefined;
};
