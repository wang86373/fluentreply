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
Translate this text into natural English.

Return ONLY valid JSON.
Do not include markdown.
Do not include explanations.

Text:
${text}

Format:
{
  "main": "best natural English translation",
  "options": [
    { "label": "Natural", "text": "..." },
    { "label": "Polite", "text": "..." },
    { "label": "Casual", "text": "..." },
    { "label": "Professional", "text": "..." },
    { "label": "Short", "text": "..." },
    { "label": "Alternative", "text": "..." }
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

    const outputText = data.output_text;

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
