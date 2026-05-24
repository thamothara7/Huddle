import { redis, settings } from '@devvit/web/server';
import { k } from '../keys';
import { factsAsRawSentence, type UserFacts } from './facts';
import type { SummarySource } from '../../../shared/api';

const GEMINI_MODEL = 'gemini-flash-latest';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const MIN_SUMMARY_LEN = 10;

const SYSTEM_PROMPT = `You format moderator queue context. You receive a structured fact dict about a user. Output ONE neutral, factual sentence in plain English combining only the facts given. Rules:
- NEVER add opinions, guesses, or words like "suspicious", "concerning", "likely", "appears to".
- NEVER reference content you were not given.
- If a fact is zero or missing, omit it from the sentence rather than saying "no prior actions".
- Maximum 25 words.
- Output the sentence only. No preamble, no markdown, no asterisks.`;

export type SummaryResult = {
  text: string;
  source: SummarySource;
};

export const getOrGenerateSummary = async (
  itemId: string,
  facts: UserFacts
): Promise<SummaryResult> => {
  const cached = await redis.get(k.summary(itemId));
  if (cached && cached.length >= MIN_SUMMARY_LEN) {
    return { text: cached, source: 'cache' };
  }
  if (cached && cached.length < MIN_SUMMARY_LEN) {
    console.warn(
      `[huddle] summary[${itemId}] busting suspicious cache (len=${cached.length}, preview=${JSON.stringify(cached.slice(0, 40))})`
    );
    try {
      await redis.del(k.summary(itemId));
    } catch {
      // ignore
    }
  }

  const apiKey = await readGeminiKey();
  if (!apiKey) {
    console.warn(
      `[huddle] summary[${itemId}] fallback: no Gemini key configured`
    );
    return { text: factsAsRawSentence(facts), source: 'fallback' };
  }

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
            parts: [{ text: JSON.stringify(facts) }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 200,
          temperature: 0.2,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
  } catch (err) {
    console.error(
      `[huddle] summary[${itemId}] fallback: fetch threw —`,
      err instanceof Error ? err.message : err
    );
    return { text: factsAsRawSentence(facts), source: 'fallback' };
  }

  if (!response.ok) {
    let body = '';
    try {
      body = (await response.text()).slice(0, 200);
    } catch {
      // ignore
    }
    console.warn(
      `[huddle] summary[${itemId}] fallback: gemini ${response.status} — ${body}`
    );
    return { text: factsAsRawSentence(facts), source: 'fallback' };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (err) {
    console.error(
      `[huddle] summary[${itemId}] fallback: malformed JSON —`,
      err instanceof Error ? err.message : err
    );
    return { text: factsAsRawSentence(facts), source: 'fallback' };
  }

  const text = extractText(parsed);
  if (!text || text.length < MIN_SUMMARY_LEN) {
    console.warn(
      `[huddle] summary[${itemId}] fallback: short/blocked response (len=${text?.length ?? 0}, preview=${JSON.stringify((text ?? '').slice(0, 40))})`
    );
    return { text: factsAsRawSentence(facts), source: 'fallback' };
  }

  try {
    await redis.set(k.summary(itemId), text);
  } catch (err) {
    console.error(
      `[huddle] summary[${itemId}] cache write failed —`,
      err instanceof Error ? err.message : err
    );
  }
  console.log(`[huddle] summary[${itemId}] llm ok (len=${text.length})`);
  return { text, source: 'llm' };
};

const readGeminiKey = async (): Promise<string | undefined> => {
  try {
    const raw = await settings.get('geminiApiKey');
    if (typeof raw === 'string' && raw.length > 0) return raw;
  } catch (err) {
    console.error('summary: settings.get failed', err);
  }
  return undefined;
};

type GeminiPart = {
  text?: string;
  thought?: boolean;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
  }>;
};

const extractText = (parsed: unknown): string | undefined => {
  const data = parsed as GeminiResponse;
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return undefined;
  const joined = parts
    .filter((p) => p && p.thought !== true)
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .join('')
    .trim();
  return joined.length > 0 ? joined : undefined;
};
