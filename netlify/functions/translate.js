exports.handler = async function (event) {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method not allowed" })
      };
    }

    const {
      text,
      sourceLanguage,
      targetLanguage,
      task,
      glossary
    } = JSON.parse(event.body || "{}");

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

    const glossaryText = Array.isArray(glossary) && glossary.length
      ? glossary.map(item => `${item.source} = ${item.target}`).join("\n")
      : "No glossary provided.";

    const taskPrompt =
      task === "headline"
        ? "Rewrite or translate the input as a professional news headline. Keep it accurate and concise."
        : task === "vocab"
        ? "Extract important news vocabulary from the input and explain each term briefly."
        : task === "news"
        ? "Translate the input as professional news content. Keep it accurate, neutral, and journalistic."
        : "Translate accurately.";

    const prompt = `
You are a strict professional AI translation and news writing assistant.

Task:
${taskPrompt}

Language rules:
- If sourceLanguage is "auto", detect the input language.
- If sourceLanguage is provided, treat input as that language.
- Translate or rewrite into targetLanguage.
- If targetLanguage is empty:
  - Simplified Chinese -> English
  - English -> Simplified Chinese
  - Other -> English

Supported languages:
Simplified Chinese, English, Japanese, Korean, Spanish, French, German, Russian, Thai, Vietnamese, Burmese, Arabic.

Glossary rules:
- If a glossary is provided, you MUST prioritize these translations.
- Keep proper names, brand names, movie titles, places, and custom terms consistent.
- Do not ignore glossary terms if they appear in the input.

Glossary:
${glossaryText}

Strict rules:
- Do not add false information.
- Do not remove meaning.
- Keep the meaning accurate.
- Return ONLY valid JSON.
- Split input into meaningful sentence segments.
- Each segment must have exactly 3 options.
- "meaning" must explain the option in the source language.

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
  "full_translation": "complete result joined from best segment results",
  "segments": [
    {
      "id": 1,
      "source": "original sentence or clause",
      "best": "best result for this segment",
      "options": [
        {
          "label": "Closest",
          "text": "closest accurate result",
          "meaning": "meaning in source language"
        },
        {
          "label": "Natural",
          "text": "natural result",
          "meaning": "meaning in source language"
        },
        {
          "label": "News Style",
          "text": "professional news-style result",
          "meaning": "meaning in source language"
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
