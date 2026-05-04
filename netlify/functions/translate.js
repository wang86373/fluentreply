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
You are a professional translation assistant.

Detect the input language automatically.

Rules:
- If input is Chinese, translate into natural English.
- If input is English, translate into natural Simplified Chinese.
- Split the input into short meaningful sentence segments.
- For each segment, return exactly 3 translation options.
- Each option must include label, text, and meaning.
- If translating into English, meaning must be Simplified Chinese.
- If translating into Chinese, meaning must be natural English.
- Keep each option concise and natural.
- Return ONLY valid JSON. No markdown.

Input:
${text}

JSON format:
{
  "detected_language": "Chinese or English or Other",
  "target_language": "English or Simplified Chinese",
  "full_translation": "complete best translation",
  "segments": [
    {
      "source": "original sentence segment",
      "best": "best translation for this segment",
      "options": [
        {
          "label": "Natural",
          "text": "...",
          "meaning": "..."
        },
        {
          "label": "Polite",
          "text": "...",
          "meaning": "..."
        },
        {
          "label": "Casual",
          "text": "...",
          "meaning": "..."
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
