exports.handler = async function (event) {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method not allowed" })
      };
    }

    const { text, sourceLanguage, targetLanguage } = JSON.parse(event.body || "{}");

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

Task:
- Translate the input text accurately.
- If sourceLanguage is "auto", detect the input language.
- If sourceLanguage is provided, treat the input as that language.
- Translate into targetLanguage.
- If targetLanguage is empty:
  - Chinese -> English
  - English -> Simplified Chinese
  - Other -> English

Supported languages:
Simplified Chinese, English, Japanese, Korean, Spanish, French, German, Russian, Thai, Vietnamese, Burmese, Arabic.

Strict rules:
- Translate ONLY.
- Do not explain outside JSON.
- Do not add meaning.
- Do not remove meaning.
- Keep the translation accurate and natural.
- Provide exactly 3 whole-text translation options.
- "meaning" must be the meaning of the option in the source language.
- Return ONLY valid JSON. No markdown.

Input:
${text}

Source language:
${sourceLanguage || "auto"}

Target language:
${targetLanguage || "auto"}

JSON format:
{
  "detected_language": "detected or selected source language",
  "target_language": "target language",
  "main": "best translation",
  "options": [
    {
      "label": "Closest",
      "text": "closest accurate translation",
      "meaning": "meaning in source language"
    },
    {
      "label": "Natural",
      "text": "natural translation",
      "meaning": "meaning in source language"
    },
    {
      "label": "Alternative",
      "text": "alternative accurate translation",
      "meaning": "meaning in source language"
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
