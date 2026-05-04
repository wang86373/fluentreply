exports.handler = async function (event) {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method not allowed" })
      };
    }

    const { text } = JSON.parse(event.body || "{}");

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
You are a highly accurate translation engine.

Task:
- Detect the input language.
- If the input is Chinese, translate it into accurate, natural English.
- If the input is English, translate it into accurate, natural Simplified Chinese.
- Preserve the meaning as closely as possible.
- Do not add new information.
- Do not over-polish unless needed for naturalness.
- Provide 3 alternative translations for the whole sentence/paragraph.

Return ONLY valid JSON. No markdown.

Input:
${text}

JSON format:
{
  "detected_language": "Chinese or English or Other",
  "target_language": "English or Simplified Chinese",
  "main": "best accurate translation",
  "options": [
    {
      "label": "Natural",
      "text": "natural accurate translation",
      "meaning": "meaning explanation in the source language"
    },
    {
      "label": "Direct",
      "text": "more literal translation",
      "meaning": "meaning explanation in the source language"
    },
    {
      "label": "Polished",
      "text": "slightly smoother translation",
      "meaning": "meaning explanation in the source language"
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
