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
 * Parse event data from scraped club content using Gemini API.
 *
 * @param {object[]} scrapeResults - Array of { clubId, clubName, content, url }
 * @param {string} apiKey - Gemini API key
 * @returns {Promise<object[]>} - Parsed event objects
 */
export async function parseEventsWithGemini(scrapeResults, apiKey) {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  if (!scrapeResults || scrapeResults.length === 0) {
    console.warn('No scrape results to parse');
    return { events: [], error: null, rawResponse: null };
  }

  const ai = new GoogleGenAI({ apiKey });

  // Build the user prompt with all club content
  const clubSections = scrapeResults.map(result =>
    `--- Club: ${result.clubId} (${result.clubName}) ---\nSource URL: ${result.url}\n\n${result.content}`
  ).join('\n\n');

  const userPrompt = `Extract all upcoming mountaineering events from the following Greek club website content.\nToday's date is ${new Date().toISOString().split('T')[0]}.\n\n${clubSections}`;

  console.log(`[gemini] Sending ${userPrompt.length} chars to Gemini...`);

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: userPrompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.1,
        maxOutputTokens: 8192,
      },
    });

    // Access the response text - try different access patterns
    let text = '';
    if (typeof response.text === 'string') {
      text = response.text;
    } else if (response.candidates && response.candidates[0]) {
      const candidate = response.candidates[0];
      if (candidate.content && candidate.content.parts) {
        text = candidate.content.parts.map(p => p.text || '').join('');
      }
    }

    console.log(`[gemini] Raw response length: ${text.length}`);
    console.log(`[gemini] Raw response preview: ${text.slice(0, 500)}`);

    if (!text) {
      return { events: [], error: 'Empty response from Gemini', rawResponse: JSON.stringify(response).slice(0, 1000) };
    }

    text = text.trim();

    // Try to extract JSON from the response
    let jsonStr = text;

    // Strip markdown fences if Gemini adds them despite instructions
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

    if (!Array.isArray(parsed)) {
      return { events: [], error: 'Gemini returned non-array JSON', rawResponse: text.slice(0, 500) };
    }

    return { events: parsed, error: null, rawResponse: null };
  } catch (err) {
    console.error(`[gemini] Parsing failed: ${err.message}`);
    console.error(`[gemini] Stack: ${err.stack}`);
    return { events: [], error: err.message, rawResponse: null };
  }
}
