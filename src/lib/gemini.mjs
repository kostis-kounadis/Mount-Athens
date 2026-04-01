import { GoogleGenAI } from '@google/genai';

/**
 * The system prompt instructs Gemini to extract structured event data
 * from Greek mountaineering club web content.
 */
const SYSTEM_PROMPT = `You are a data extraction assistant for Greek mountaineering event schedules.
Your task is to extract structured event data from Greek-language web content of mountaineering clubs near Athens, Greece.

OUTPUT FORMAT:
Return ONLY a valid JSON array of event objects. No markdown fences, no explanation, no extra text.

Each event object must have these fields:
{
  "id": "<club_id>-<YYYY-MM-DD>-<slug>",
  "date": "YYYY-MM-DD",
  "club_id": "<provided club_id>",
  "club_name": "<provided club_name>",
  "event_title": "<event title in English>",
  "event_type": "hiking|mountaineering|climbing|trekking|skiing|trail-running|other",
  "difficulty": "<Greek abbreviation or null>",
  "difficulty_label": "<English label or null>",
  "duration_hours": <number or null>,
  "elevation_gain_m": <number or null>,
  "meeting_point": "<string or null>",
  "meeting_time": "<HH:MM or null>",
  "description": "<brief English description>",
  "original_url": "<source URL>"
}

GREEK DIFFICULTY ABBREVIATIONS:
- ΒΔ (BD) = Easy hiking
- ΥΔ (YD) = Moderate hiking
- ΩΠ (OP) = Mountaineering
- ΑΝ (AN) = Climbing
- ΟΠ (OP-T) = Trekking

RULES:
1. Dates MUST be in ISO 8601 format (YYYY-MM-DD)
2. Translate event titles and descriptions to English
3. If a field cannot be determined, use null
4. The "id" field should be: club_id + date + a short slug derived from the title (lowercase, hyphens, no special chars)
5. Only include FUTURE events (upcoming, not past)
6. event_type should be inferred from context if not explicitly stated
7. If no events can be extracted, return an empty array []

EXAMPLE INPUT:
Club: eos-acharnon (EOS Acharnon)
Content: "ΕΞΟΡΜΗΣΗ 5 Απριλίου 2026 - Πάρνηθα, Καταφύγιο Μπάφι. Βαθμός δυσκολίας: ΒΔ. Ώρες πορείας: 5. Υψομετρική διαφορά: 600μ."

EXAMPLE OUTPUT:
[{"id":"eos-acharnon-2026-04-05-parnitha-bafi","date":"2026-04-05","club_id":"eos-acharnon","club_name":"EOS Acharnon","event_title":"Parnitha - Bafi Refuge","event_type":"hiking","difficulty":"BD","difficulty_label":"Easy","duration_hours":5,"elevation_gain_m":600,"meeting_point":null,"meeting_time":null,"description":"Spring hike to Bafi refuge on Parnitha mountain","original_url":"https://eosacharnon.gr/events"}]`;

/**
 * Parse event data from a single club's scraped content using Gemini API.
 * This is called once per club to keep each API call small and within limits.
 *
 * @param {object} clubData - { clubId, clubName, content, url }
 * @param {string} apiKey - Gemini API key
 * @returns {Promise<{events: object[], error: string|null}>}
 */
export async function parseOneClubWithGemini(clubData, apiKey) {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  if (!clubData || !clubData.content || clubData.content.length < 30) {
    console.warn(`[gemini] Skipping ${clubData?.clubId} -- too little content (${clubData?.content?.length || 0} chars)`);
    return { events: [], error: 'Too little content to parse' };
  }

  const ai = new GoogleGenAI({ apiKey });

  const userPrompt = `Extract all upcoming mountaineering events from the following Greek club website content.
Today's date is ${new Date().toISOString().split('T')[0]}.

Club: ${clubData.clubId} (${clubData.clubName})
Source URL: ${clubData.url}

Content:
${clubData.content}`;

  console.log(`[gemini] Sending ${userPrompt.length} chars for ${clubData.clubId}...`);

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: userPrompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.1,
        maxOutputTokens: 4096,
      },
    });

    // Access the response text
    let text = '';
    if (typeof response.text === 'string') {
      text = response.text;
    } else if (response.candidates && response.candidates[0]) {
      const candidate = response.candidates[0];
      if (candidate.content && candidate.content.parts) {
        text = candidate.content.parts.map(p => p.text || '').join('');
      }
    }

    console.log(`[gemini] Response for ${clubData.clubId}: ${text.length} chars`);

    if (!text) {
      return { events: [], error: 'Empty response from Gemini' };
    }

    text = text.trim();

    // Strip markdown fences if Gemini adds them despite instructions
    let jsonStr = text;
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

    if (!Array.isArray(parsed)) {
      return { events: [], error: 'Gemini returned non-array JSON' };
    }

    console.log(`[gemini] Parsed ${parsed.length} events for ${clubData.clubId}`);
    return { events: parsed, error: null };
  } catch (err) {
    const message = err.message || String(err);
    console.error(`[gemini] Failed for ${clubData.clubId}: ${message}`);
    return { events: [], error: message };
  }
}
