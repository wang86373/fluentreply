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
- Keep the translation accurate and natural.
- If targetLanguage is provided, translate into that language.
- If targetLanguage is empty:
  - Chinese input -> English
  - English input -> Simplified Chinese
- Provide exactly 3 whole-text translation options.
- For each option, meaning must be short.
- If translating Chinese to English, meaning must be Simplified Chinese.
- If translating English to Chinese, meaning must be English.
- Keep each option concise and suitable for a dropdown menu.

Return ONLY valid JSON. No markdown.

Input:
${text}

Preferred target language:
${targetLanguage || "auto"}

JSON format:
{
  "detected_language": "Chinese or English or Other",
  "target_language": "English or Simplified Chinese",
  "main": "best accurate translation",
  "options": [
    {
      "label": "Closest",
      "text": "closest accurate translation",
      "meaning": "short meaning in source language"
    },
    {
      "label": "Natural",
      "text": "natural accurate translation",
      "meaning": "short meaning in source language"
    },
    {
      "label": "Alternative",
      "text": "another accurate translation",
      "meaning": "short meaning in source language"
    }
  ]
}
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

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({
          error: data.error?.message || "OpenAI API error"
        })
      };
    }

    const outputText =
      data.output_text ||
      data.output?.[0]?.content?.[0]?.text;

    if (!outputText) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "No output from OpenAI" })
      };
    }

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
