import { settings } from '@devvit/web/server';

const GEMINI_MODEL = 'gemini-flash-latest';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const MIN_REASON_LEN = 30;

const REASON_SYSTEM_PROMPT = `You are drafting a removal-reason message that a Reddit moderator will post in reply to a user whose content was just removed.

Rules:
- Write in second person ("you", "your") addressed to the content author.
- Briefly cite the reason(s) the content was reported. Paraphrase them — do not quote.
- Encourage the user to review the subreddit rules. Do not assume bad intent.
- Use neutral, factual, professional, friendly language. Avoid blame.
- Mention if the account is new (under 30 days) as helpful context, but never as accusation.
- 30 to 80 words.
- Output the message text only. No greeting ("Hi", "Hello"). No signoff or mod-team signature. No markdown. No quotation marks around the message.`;

export type ReasonContext = {
  itemType: 'post' | 'comment';
  title?: string;
  userReportReasons: string[];
  modReportReasons: string[];
  accountAgeDays: number;
  priorRemovals: number;
};

export const generateRemovalReason = async (
  ctx: ReasonContext
): Promise<string | null> => {
  const apiKey = await readKey();
  if (!apiKey) {
    console.warn('[huddle] generateRemovalReason: no Gemini key configured');
    return null;
  }

  const lines: string[] = [
    `Content type: ${ctx.itemType}`,
  ];
  if (ctx.title) lines.push(`Content title: ${ctx.title}`);
  if (ctx.userReportReasons.length > 0) {
    lines.push(
      `User-submitted report reasons: ${ctx.userReportReasons.join(' | ')}`
    );
  }
  if (ctx.modReportReasons.length > 0) {
    lines.push(
      `Moderator-flagged reasons: ${ctx.modReportReasons.join(' | ')}`
    );
  }
  lines.push(`Author account age: ${ctx.accountAgeDays} day(s)`);
  if (ctx.priorRemovals > 0) {
    lines.push(`Author prior removals in this subreddit: ${ctx.priorRemovals}`);
  }

  const userPrompt = lines.join('\n');

  let response: Response;
  try {
    response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: REASON_SYSTEM_PROMPT }] },
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 400,
          temperature: 0.4,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
  } catch (err) {
    console.error(
      '[huddle] generateRemovalReason fetch threw:',
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
    console.warn(`[huddle] generateRemovalReason gemini ${response.status} — ${body}`);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (err) {
    console.error(
      '[huddle] generateRemovalReason malformed JSON:',
      err instanceof Error ? err.message : err
    );
    return null;
  }

  const text = extractText(parsed);
  if (!text || text.length < MIN_REASON_LEN) {
    console.warn(
      `[huddle] generateRemovalReason short/blocked: len=${text?.length ?? 0} preview=${JSON.stringify((text ?? '').slice(0, 60))}`
    );
    return null;
  }
  console.log(`[huddle] generateRemovalReason ok (len=${text.length})`);
  return text;
};

const readKey = async (): Promise<string | undefined> => {
  try {
    const raw = await settings.get('geminiApiKey');
    if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
  } catch (err) {
    console.error('[huddle] generateRemovalReason settings.get failed:', err);
  }
  return undefined;
};

type GeminiPart = { text?: string; thought?: boolean };
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
    .trim()
    .replace(/^["'""]+|["'""]+$/g, ''); // strip stray quotes if model adds them
  return joined.length > 0 ? joined : undefined;
};
