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
      engineMode = "deepl",
      uiLanguage = "en"
    } = JSON.parse(event.body || "{}");

    if (!text || !text.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing text" }) };
    }

    let deeplText = "";
    let deeplUsed = false;
    let deeplError = "";

    if (process.env.DEEPL_API_KEY && task === "translate" && engineMode !== "ai") {
      try {
        deeplText = await translateWithDeepL(text, sourceLanguage, targetLanguage);
        deeplUsed = !!deeplText;
      } catch (e) {
        deeplError = e.message || "DeepL failed";
      }
    }

    if (engineMode === "deepl" && deeplText) {
      return json({
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
              { label: "DeepL", text: deeplText, meaning: meaning(uiLanguage, "deepl") }
            ]
          }
        ]
      });
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

    return json(aiResult);

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error", detail: error.message })
    };
  }
};

function json(body) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

async function translateWithDeepL(text, sourceLanguage, targetLanguage) {
  const target = mapDeepLLang(targetLanguage);
  if (!target) throw new Error("DeepL does not support this target language");

  const params = new URLSearchParams();
  params.append("text", text);
  params.append("target_lang", target);

  const source = mapDeepLLang(sourceLanguage);
  if (sourceLanguage !== "auto" && source) params.append("source_lang", source);

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

  if (!res.ok) throw new Error(data.message || "DeepL failed");

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
              { label: "DeepL", text: deeplText, meaning: meaning(uiLanguage, "deepl") }
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
      ? "Rewrite or translate the entire input as a professional news headline. Do not drop key information."
      : task === "vocab"
      ? "Extract important vocabulary from the entire input and explain each term briefly."
      : task === "news"
      ? "Translate the entire input as professional neutral news content."
      : "Translate the entire input accurately. If DeepL base translation is provided, use it as the precise meaning base.";

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

CRITICAL RULES:
- Translate the FULL original input.
- Do not drop, skip, shorten, or ignore any sentence.
- full_translation must include every sentence and meaning from the original input.
- First understand the whole message as one complete conversation.
- Then create full_translation.
- Only after that, split the original input into natural sentence-level segments.
- Segments are only for display and selection.
- Segment translations must match full_translation in meaning.
- Do not create new meanings in segments.
- Keep pronouns, relationships, gender references, tone, and logic consistent.
- The translated text must be in the target language.
- The explanations must be in ${explanationLanguage}.
- Support all language pairs; do not assume target is English.
- For chat messages, keep the tone natural and human.

OPTION RULES:
- Each segment must have exactly 3 options:
  1. Closest
  2. Natural
  3. Alternative
- Each option text must be in the target language.
- Each option meaning/explanation must be in ${explanationLanguage}.
- Apply glossary terms strictly.

OUTPUT RULES:
- Return ONLY valid JSON.
- No markdown.
- No extra text.

JSON format:
{
  "detected_language": "detected source language",
  "target_language": "target language",
  "full_translation": "complete translation of entire input",
  "segments": [
    {
      "id": 1,
      "source": "original sentence or phrase",
      "best": "translated sentence or phrase",
      "options": [
        {"label":"Closest","text":"...","meaning":"..."},
        {"label":"Natural","text":"...","meaning":"..."},
        {"label":"Alternative","text":"...","meaning":"..."}
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

  if (!response.ok) throw new Error(data.error?.message || "OpenAI API error");

  const outputText =
    data.output_text ||
    data.output?.[0]?.content?.[0]?.text;

  if (!outputText) throw new Error("No output from OpenAI");

  const cleaned = outputText.replace(/```json/g, "").replace(/```/g, "").trim();
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
          { label: "Closest", text: parsed.full_translation || deeplText || "", meaning: meaning(uiLanguage, "closest") },
          { label: "Natural", text: parsed.full_translation || deeplText || "", meaning: meaning(uiLanguage, "natural") },
          { label: "Alternative", text: parsed.full_translation || deeplText || "", meaning: meaning(uiLanguage, "alternative") }
        ]
      }
    ];
  }

  parsed.segments = parsed.segments.map((seg, index) => {
    let options = Array.isArray(seg.options) ? seg.options : [];

    while (options.length < 3) {
      const type = options.length === 0 ? "closest" : options.length === 1 ? "natural" : "alternative";
      options.push({
        label: type === "closest" ? "Closest" : type === "natural" ? "Natural" : "Alternative",
        text: seg.best || "",
        meaning: meaning(uiLanguage, type)
      });
    }

    return {
      id: seg.id || index + 1,
      source: seg.source || "",
      best: seg.best || options[0].text || "",
      options: options.slice(0, 3)
    };
  });

  return parsed;
}

function meaning(lang, type) {
  const zh = {
    deepl: "基于 DeepL 的快速精准整段翻译。",
    closest: "最贴近原文意思的翻译。",
    natural: "更自然、更口语化的表达，但意思不变。",
    alternative: "另一种自然表达方式，意思保持一致。"
  };
  const ja = {
    deepl: "DeepL に基づく高速で正確な全文翻訳です。",
    closest: "原文の意味に最も忠実な翻訳です。",
    natural: "より自然な表現ですが、意味は同じです。",
    alternative: "同じ意味を持つ別の自然な表現です。"
  };
  const en = {
    deepl: "Fast precise full translation based on DeepL.",
    closest: "The closest translation to the original meaning.",
    natural: "A more natural expression with the same meaning.",
    alternative: "Another natural way to express the same meaning."
  };
  if (lang === "zh") return zh[type];
  if (lang === "ja") return ja[type];
  return en[type];
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
