import { redis, settings } from '@devvit/web/server';
import { k } from '../keys';
import { factsAsRawSentence, type UserFacts } from './facts';

const GEMINI_MODEL = 'gemini-flash-latest';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SYSTEM_PROMPT = `You format moderator queue context. You receive a structured fact dict about a user. Output ONE neutral, factual sentence in plain English combining only the facts given. Rules:
- NEVER add opinions, guesses, or words like "suspicious", "concerning", "likely", "appears to".
- NEVER reference content you were not given.
- If a fact is zero or missing, omit it from the sentence rather than saying "no prior actions".
- Maximum 25 words.
- Output the sentence only. No preamble, no markdown.`;

export const getOrGenerateSummary = async (
  itemId: string,
  facts: UserFacts
): Promise<string> => {
  const cached = await redis.get(k.summary(itemId));
  if (cached) return cached;

  const apiKey = await readGeminiKey();
  if (!apiKey) {
    console.warn(
      `[huddle] summary fallback for ${itemId}: no Gemini key configured (set in app settings at developers.reddit.com/apps/huddle-mod)`
    );
    return factsAsRawSentence(facts);
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
          maxOutputTokens: 100,
          temperature: 0.2,
          responseMimeType: 'text/plain',
        },
      }),
    });
  } catch (err) {
    console.error('summary: fetch failed', err);
    return factsAsRawSentence(facts);
  }

  if (!response.ok) {
    console.warn(`summary: gemini returned ${response.status}`);
    return factsAsRawSentence(facts);
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return factsAsRawSentence(facts);
  }

  const text = extractText(parsed);
  if (!text) return factsAsRawSentence(facts);

  try {
    await redis.set(k.summary(itemId), text);
  } catch (err) {
    console.error('summary: cache write failed', err);
  }
  return text;
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

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
};

const extractText = (parsed: unknown): string | undefined => {
  const data = parsed as GeminiResponse;
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === 'string' ? text.trim() : undefined;
};
