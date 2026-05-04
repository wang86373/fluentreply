exports.handler = async function (event) {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method not allowed" })
      };
    }

    const { text, targetLanguage, mode } = JSON.parse(event.body || "{}");

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
- Detect the input language automatically.
- If targetLanguage is provided, translate into that target language.
- If no targetLanguage:
  - Chinese input -> English
  - English input -> Simplified Chinese
  - Other language -> English

Supported target languages:
English, Simplified Chinese, Japanese, Korean, Spanish, French, German, Russian, Thai, Vietnamese, Burmese, Arabic.

Mode:
${mode || "full"}

Rules:
- Translate ONLY.
- Do not add meaning.
- Do not remove meaning.
- Do not explain outside JSON.
- Keep translation accurate, natural, and close to the original.
- Split the input into short meaningful sentence segments.
- Each segment should be a sentence or short clause.
- For each segment, provide exactly 3 translation options.
- The first option should be the closest accurate translation.
- The second option should be natural.
- The third option should be an alternative expression.
- "meaning" must explain the option in the original input language.
- Return ONLY valid JSON. No markdown.

Input:
${text}

Target language:
${targetLanguage || "auto"}

JSON format:
{
  "detected_language": "Detected input language",
  "target_language": "Target output language",
  "full_translation": "complete translation joined from the best segment translations",
  "segments": [
    {
      "id": 1,
      "source": "original sentence or clause",
      "best": "best translation for this segment",
      "options": [
        {
          "label": "Closest",
          "text": "closest accurate translation",
          "meaning": "meaning in the original input language"
        },
        {
          "label": "Natural",
          "text": "natural translation",
          "meaning": "meaning in the original input language"
        },
        {
          "label": "Alternative",
          "text": "alternative translation",
          "meaning": "meaning in the original input language"
        }
      ]
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
        body: JSON.stringify({
          error: "No output from OpenAI"
        })
      };
    }

    const cleaned = outputText
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const parsed = JSON.parse(cleaned);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json"
      },
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
