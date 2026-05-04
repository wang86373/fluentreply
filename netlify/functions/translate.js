exports.handler = async function (event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    const {
      text,
      sourceLanguage = "auto",
      targetLanguage = "English",
      task = "translate",
      glossary = [],
      engineMode = "auto"
    } = JSON.parse(event.body || "{}");

    if (!text || !text.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing text" }) };
    }

    let deeplText = "";
    let deeplUsed = false;
    let deeplError = "";

    if (
      process.env.DEEPL_API_KEY &&
      task === "translate" &&
      engineMode !== "ai"
    ) {
      try {
        deeplText = await translateWithDeepL(text, sourceLanguage, targetLanguage);
        deeplUsed = !!deeplText;
      } catch (e) {
        deeplError = e.message || "DeepL failed";
      }
    }

    if (engineMode === "deepl" && deeplText) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          detected_language: sourceLanguage,
          target_language: targetLanguage,
          full_translation: deeplText,
          engine_used: "DeepL only",
          deepl_used: true,
          deepl_error: "",
          segments: [
            {
              id: 1,
              source: text,
              best: deeplText,
              options: [
                {
                  label: "DeepL",
                  text: deeplText,
                  meaning: "DeepL precise translation."
                }
              ]
            }
          ]
        })
      };
    }

    const aiResult = await enhanceWithAI({
      originalText: text,
      deeplText,
      sourceLanguage,
      targetLanguage,
      task,
      glossary
    });

    aiResult.engine_used = deeplUsed ? "DeepL + AI" : "AI only";
    aiResult.deepl_used = deeplUsed;
    aiResult.deepl_error = deeplError;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(aiResult)
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

async function translateWithDeepL(text, sourceLanguage, targetLanguage) {
  const params = new URLSearchParams();
  params.append("text", text);
  params.append("target_lang", mapDeepLLang(targetLanguage));

  const source = mapDeepLLang(sourceLanguage);
  if (sourceLanguage !== "auto" && source) {
    params.append("source_lang", source);
  }

  const endpoint = process.env.DEEPL_API_KEY.endsWith(":fx")
    ? "https://api-free.deepl.com/v2/translate"
    : "https://api.deepl.com/v2/translate";

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `DeepL-Auth-Key ${process.env.DEEPL_API_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.message || "DeepL failed");
  }

  return data.translations?.[0]?.text || "";
}

async function enhanceWithAI({
  originalText,
  deeplText,
  sourceLanguage,
  targetLanguage,
  task,
  glossary
}) {
  if (!process.env.OPENAI_API_KEY) {
    if (deeplText) {
      return {
        detected_language: sourceLanguage,
        target_language: targetLanguage,
        full_translation: deeplText,
        segments: [
          {
            id: 1,
            source: originalText,
            best: deeplText,
            options: [
              {
                label: "DeepL",
                text: deeplText,
                meaning: "基于 DeepL 的精准翻译。"
              }
            ]
          }
        ]
      };
    }

    throw new Error("Missing OPENAI_API_KEY");
  }

  const glossaryText = Array.isArray(glossary) && glossary.length
    ? glossary.map(item => `${item.source} = ${item.target}`).join("\n")
    : "No glossary provided.";

  const taskPrompt =
    task === "headline"
      ? "Rewrite or translate the input as a professional news headline."
      : task === "vocab"
      ? "Extract important vocabulary and explain each term briefly."
      : task === "news"
      ? "Translate as professional neutral news content."
      : "Translate accurately, using DeepL as the precise base translation when provided.";

  const prompt = `
You are FluentReply, a professional translation assistant.

Task:
${taskPrompt}

Source language:
${sourceLanguage}

Target language:
${targetLanguage || "auto"}

Original input:
${originalText}

DeepL base translation:
${deeplText || "No DeepL result provided."}

Glossary:
${glossaryText}

Very important context rules:
- First understand the full original text as one complete message.
- Translate according to the full context, not sentence by sentence in isolation.
- The full_translation must be the best complete translation of the entire input.
- Then split the original input into natural sentence segments.
- Each segment translation must match the meaning of the full_translation.
- Do not change the meaning of a segment just to make it sound natural.
- Keep pronouns, relationships, tone, and logic consistent across all segments.
- If a sentence depends on previous or next sentences, use that context.
- If DeepL result is provided, use it as the precise base for the full meaning.
- Do not let each small segment create a separate meaning.
- Do not invent new relationships, subjects, locations, or emotions.

Option rules:
- Each segment must have exactly 3 options:
  1. Closest: most faithful to the original meaning
  2. Natural: natural spoken expression, but same meaning
  3. Alternative: another natural way to say the same meaning
- Each option must include a short meaning/explanation in the source language.
- Apply glossary terms strictly.
- Return ONLY valid JSON.

JSON format:
{
  "detected_language": "detected source language",
  "target_language": "target language",
  "full_translation": "complete best translation",
  "segments": [
    {
      "id": 1,
      "source": "original sentence",
      "best": "best translated sentence",
      "options": [
        {
          "label": "Closest",
          "text": "closest translation",
          "meaning": "meaning explanation"
        },
        {
          "label": "Natural",
          "text": "natural translation",
          "meaning": "meaning explanation"
        },
        {
          "label": "Alternative",
          "text": "alternative expression",
          "meaning": "meaning explanation"
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
    throw new Error(data.error?.message || "OpenAI API error");
  }

  const outputText =
    data.output_text ||
    data.output?.[0]?.content?.[0]?.text;

  if (!outputText) {
    throw new Error("No output from OpenAI");
  }

  const cleaned = outputText
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  return JSON.parse(cleaned);
}

function mapDeepLLang(lang) {
  const map = {
    "English": "EN",
    "Simplified Chinese": "ZH",
    "Chinese": "ZH",
    "Japanese": "JA",
    "Korean": "KO",
    "Spanish": "ES",
    "French": "FR",
    "German": "DE",
    "Russian": "RU",
    "Portuguese": "PT",
    "Italian": "IT",
    "Dutch": "NL",
    "Polish": "PL",
    "Arabic": "AR",
    "Turkish": "TR",
    "Ukrainian": "UK"
  };

  return map[lang] || "EN";
}
