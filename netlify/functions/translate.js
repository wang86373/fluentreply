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

    const prompt = `
Translate the user's text into natural English.

Return ONLY valid JSON.
Do not include markdown.

User text:
${text}

JSON format:
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
        "Authorization": \`Bearer \${process.env.OPENAI_API_KEY}\`
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: prompt,
        temperature: 0.4
      })
    });

    const data = await response.json();

    const outputText =
      data.output_text ||
      data.output?.[0]?.content?.[0]?.text ||
      "";

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
