exports.handler = async function (event) {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method not allowed" })
      };
    }

    const { text, targetLanguage } = JSON.parse(event.body || "{}");

    if (!text || !text.trim()) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing text" })
      };
    }

    if (!process.env.OPENAI_API_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Missing OPENAI_API_KEY" })
      };
    }

    const prompt = `
You are a strict professional translation engine.

Rules:
- Translate ONLY.
- Do NOT explain outside JSON.
- Do NOT add meaning.
- Do NOT remove meaning.
- Keep translation accurate and natural.

Direction:
- If targetLanguage exists → use it
- Otherwise:
  - Chinese → English
  - English → Simplified Chinese

CRITICAL:
- Always return EXACT SAME meaning in BOTH languages
- NO generic text like "简短翻译"
- meaning MUST be full sentence meaning

Output EXACTLY 3 options.

JSON ONLY:

{
  "detected_language": "...",
  "target_language": "...",
  "main": "...",
  "options": [
    {
      "label": "Closest",
      "text": "...",
      "meaning": "完整对应翻译（另一种语言）"
    },
    {
      "label": "Natural",
      "text": "...",
      "meaning": "完整对应翻译（另一种语言）"
    },
    {
      "label": "Alternative",
      "text": "...",
      "meaning": "完整对应翻译（另一种语言）"
    }
  ]
}

Input:
${text}

Target:
${targetLanguage || "auto"}
`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: prompt
      })
    });

    const data = await response.json();

    const outputText =
      data.output_text ||
      data.output?.[0]?.content?.[0]?.text;

    const cleaned = outputText
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const parsed = JSON.parse(cleaned);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed)
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Server error",
        detail: error.message
      })
    };
  }
};
