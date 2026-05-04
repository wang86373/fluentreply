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
      sourceLanguage = "auto",
      targetLanguage = "English",
      task = "translate",
      glossary = [],
      engineMode = "auto",
      uiLanguage = "en"
    } = JSON.parse(event.body || "{}");

    if (!text || !text.trim()) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing text" })
      };
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
                  meaning: getSimpleMeaning(uiLanguage)
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
      glossary,
      uiLanguage
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

  const target = mapDeepLLang(targetLanguage);
  if (!target) {
    throw new Error("DeepL does not support this target language");
  }

  params.append("target_lang", target);

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
  glossary,
  uiLanguage
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
                meaning: getSimpleMeaning(uiLanguage)
              }
            ]
          }
        ]
      };
    }

    throw new Error("Missing OPENAI_API_KEY");
  }

  const explanationLanguage =
    uiLanguage === "zh" ? "Simplified Chinese" :
    uiLanguage === "ja" ? "Japanese" :
    "English";

  const glossaryText = Array.isArray(glossary) && glossary.length
    ? glossary.map(item => `${item.source} = ${item.target}`).join("\n")
    : "No glossary provided.";

  const taskPrompt =
    task === "headline"
      ? "Rewrite or translate the entire input as a professional news headline. Do not drop any key information."
      : task === "vocab"
      ? "Extract important vocabulary from the entire input and explain each term briefly."
      : task === "news"
      ? "Translate the entire input as professional neutral news content."
      : "Translate the entire input accurately. Use DeepL as the precise base translation when provided.";

  const prompt = `
You are FluentReply, a professional multilingual translation assistant.

Task:
${taskPrompt}

Source language:
${sourceLanguage}

Target language:
${targetLanguage || "auto"}

User interface language:
${uiLanguage}

Explanation language:
${explanationLanguage}

Original input:
${originalText}

DeepL base translation:
${deeplText || "No DeepL result provided."}

Glossary:
${glossaryText}

CRITICAL TRANSLATION RULES:
- You MUST translate the FULL original input.
- Do NOT translate only the first sentence.
- Do NOT drop, skip, shorten, or ignore any sentence.
- full_translation MUST contain the meaning of EVERY sentence in the original input.
- First understand the whole message as one complete conversation.
- Then create a complete full_translation of the whole message.
- Only AFTER full_translation is complete, split it into segments.
- Segments are only for display and sentence selection.
- Segments MUST NOT create new meanings.
- Segments MUST NOT omit any part of the original text.
- Every original sentence or phrase must be represented in the final translation.
- Keep pronouns, relationships, gender references, tone, and logic consistent.
- If a sentence depends on previous or next sentences, translate using that context.
- If DeepL result is provided, use it as the precise meaning base.
- Do not invent subjects, emotions, locations, or relationships.
- Do not make the wording sound fancy if it changes the meaning.
- For chat messages, keep the tone natural, human, and conversational.
- This product supports all language pairs. Do not assume the target is always English.
- The translated text must be in the target language.
- The explanations must be in ${explanationLanguage}.

SEGMENT RULES:
- Split the ORIGINAL input into natural sentence-level segments.
- For each original segment, provide the corresponding translated segment.
- The combined best values of all segments should equal the full_translation in meaning.
- The number of segments should match the natural number of sentences or message parts.
- If the original has 4 sentences, return around 4 segments.
- Never return only one segment unless the original is truly one short sentence.
- Never let the first segment replace the whole translation.

OPTION RULES:
- Each segment must have exactly 3 options:
  1. Closest: most faithful to the original meaning
  2. Natural: natural spoken expression, same meaning
  3. Alternative: another natural way to say the same meaning
- Each option must translate ONLY that segment, but using full-message context.
- Each option text must be in the target language.
- Each option meaning/explanation MUST be written in ${explanationLanguage}.
- If explanationLanguage is Simplified Chinese, explanations must be Chinese.
- If explanationLanguage is Japanese, explanations must be Japanese.
- Never default explanations to English unless explanationLanguage is English.
- Apply glossary terms strictly.

OUTPUT RULES:
- Return ONLY valid JSON.
- No markdown.
- No comments.
- No extra text.

JSON format:
{
  "detected_language": "detected source language",
  "target_language": "target language",
  "full_translation": "complete translation of the entire input, including every sentence",
  "segments": [
    {
      "id": 1,
      "source": "original sentence or message part",
      "best": "translated sentence or message part",
      "options": [
        {
          "label": "Closest",
          "text": "closest translation of this segment",
          "meaning": "meaning explanation in ${explanationLanguage}"
        },
        {
          "label": "Natural",
          "text": "natural translation of this segment",
          "meaning": "meaning explanation in ${explanationLanguage}"
        },
        {
          "label": "Alternative",
          "text": "alternative translation of this segment",
          "meaning": "meaning explanation in ${explanationLanguage}"
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
      input: prompt,
      temperature: 0.2
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

  const parsed = JSON.parse(cleaned);

  if (!parsed.full_translation && Array.isArray(parsed.segments)) {
    parsed.full_translation = parsed.segments.map(s => s.best).join(" ");
  }

  if (!Array.isArray(parsed.segments) || parsed.segments.length === 0) {
    parsed.segments = [
      {
        id: 1,
        source: originalText,
        best: parsed.full_translation || deeplText || "",
        options: [
          {
            label: "Closest",
            text: parsed.full_translation || deeplText || "",
            meaning: getClosestMeaning(uiLanguage)
          },
          {
            label: "Natural",
            text: parsed.full_translation || deeplText || "",
            meaning: getNaturalMeaning(uiLanguage)
          },
          {
            label: "Alternative",
            text: parsed.full_translation || deeplText || "",
            meaning: getAlternativeMeaning(uiLanguage)
          }
        ]
      }
    ];
  }

  parsed.segments = parsed.segments.map((seg, index) => {
    const options = Array.isArray(seg.options) ? seg.options : [];

    while (options.length < 3) {
      options.push({
        label: options.length === 0 ? "Closest" : options.length === 1 ? "Natural" : "Alternative",
        text: seg.best || "",
        meaning:
          options.length === 0 ? getClosestMeaning(uiLanguage) :
          options.length === 1 ? getNaturalMeaning(uiLanguage) :
          getAlternativeMeaning(uiLanguage)
      });
    }

    return {
      id: seg.id || index + 1,
      source: seg.source || "",
      best: seg.best || options[0]?.text || "",
      options: options.slice(0, 3)
    };
  });

  return parsed;
}

function getSimpleMeaning(uiLanguage) {
  if (uiLanguage === "zh") return "基于 DeepL 的精准整段翻译。";
  if (uiLanguage === "ja") return "DeepL に基づく正確な全文翻訳です。";
  return "DeepL precise full translation.";
}

function getClosestMeaning(uiLanguage) {
  if (uiLanguage === "zh") return "最贴近原文意思的翻译。";
  if (uiLanguage === "ja") return "原文の意味に最も忠実な翻訳です。";
  return "The closest translation to the original meaning.";
}

function getNaturalMeaning(uiLanguage) {
  if (uiLanguage === "zh") return "更自然、更口语化的表达，但意思不变。";
  if (uiLanguage === "ja") return "より自然な表現ですが、意味は同じです。";
  return "A more natural expression with the same meaning.";
}

function getAlternativeMeaning(uiLanguage) {
  if (uiLanguage === "zh") return "另一种自然表达方式，意思保持一致。";
  if (uiLanguage === "ja") return "同じ意味を持つ別の自然な表現です。";
  return "Another natural way to express the same meaning.";
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
    "Ukrainian": "UK",
    "Thai": null,
    "Vietnamese": null,
    "Burmese": null
  };

  return map[lang] || null;
}
