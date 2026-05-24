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
    console.warn(`[huddle] suggestion[${itemId}] no Gemini key`);
    return null;
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
      `[huddle] suggestion[${itemId}] fetch threw:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }

  if (!response.ok) {
    let body = '';
    try {
      body = (await response.text()).slice(0, 200);
    } catch {
      // ignore
    }
    console.warn(`[huddle] suggestion[${itemId}] gemini ${response.status} — ${body}`);
    return null;
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
    console.warn(`[huddle] suggestion[${itemId}] invalid response shape`);
    return null;
  }

  try {
    await redis.set(cacheKey, JSON.stringify(suggestion), {
      expiration: new Date(Date.now() + 60 * 60 * 1000), // 1 hour TTL
    });
  } catch (err) {
    console.error(
      `[huddle] suggestion[${itemId}] cache write failed:`,
      err instanceof Error ? err.message : err
    );
  }
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
