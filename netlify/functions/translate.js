const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

exports.handler = async function (event) {
  try {
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: ""
      };
    }

    if (event.httpMethod !== "POST") {
      return jsonError(405, "Method not allowed");
    }

    const body = JSON.parse(event.body || "{}");

    const {
  text = "",
  sourceLanguage = "auto",
  targetLanguage = "English",
  task = "translate",
  glossary = [],
  engineMode = "auto",
  rewriteTone = "auto",
  uiLanguage = "zh",
  sentenceMode = true
} = body;

    if (!text.trim()) {
      return jsonError(400, "Missing text");
    }

    let deeplText = "";
    let deeplUsed = false;
    let deeplError = "";

    const shouldUseDeepL =
      process.env.DEEPL_API_KEY &&
      task === "translate" &&
      engineMode !== "ai" &&
      isDeepLSupported(targetLanguage);

    if (shouldUseDeepL) {
      try {
        deeplText = await translateWithDeepL(
          text,
          sourceLanguage,
          targetLanguage
        );
        deeplUsed = Boolean(deeplText);
      } catch (error) {
        deeplError = error.message || "DeepL failed";
      }
    }

    if (engineMode === "deepl") {
      if (!deeplText) {
        return jsonError(
          500,
          "DeepL failed",
          deeplError || "No DeepL result"
        );
      }

      return json(
        buildDeepLOnlyResult({
          text,
          deeplText,
          sourceLanguage,
          targetLanguage,
          uiLanguage
        })
      );
    }

    const aiResult = await enhanceWithAI({
  originalText: text,
  deeplText,
  sourceLanguage,
  targetLanguage,
  task,
  glossary,
  rewriteTone,
  uiLanguage,
  sentenceMode
});

    aiResult.engine_used = deeplUsed ? "DeepL + AI" : "AI only";
    aiResult.deepl_used = deeplUsed;
    aiResult.deepl_error = deeplError;

    return json(
      normalizeResult(aiResult, {
        originalText: text,
        fallbackText: deeplText,
        uiLanguage
      })
    );

  } catch (error) {
    return jsonError(500, "Server error", error.message);
  }
};

function json(body) {
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify(body)
  };
}

function jsonError(statusCode, error, detail = "") {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify({
      error,
      detail
    })
  };
}

function buildDeepLOnlyResult({
  text,
  deeplText,
  sourceLanguage,
  targetLanguage,
  uiLanguage
}) {
  return {
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
            label: "Closest",
            text: deeplText,
            meaning: meaning(uiLanguage, "closest")
          },
          {
            label: "Natural",
            text: deeplText,
            meaning: meaning(uiLanguage, "natural")
          },
          {
            label: "Alternative",
            text: deeplText,
            meaning: meaning(uiLanguage, "alternative")
          }
        ]
      }
    ]
  };
}

async function translateWithDeepL(text, sourceLanguage, targetLanguage) {
  const target = mapDeepLLang(targetLanguage);

  if (!target) {
    throw new Error("DeepL does not support this target language");
  }

  const params = new URLSearchParams();
  params.append("text", text);
  params.append("target_lang", target);

  const source = mapDeepLLang(sourceLanguage);

  if (sourceLanguage !== "auto" && source) {
    params.append("source_lang", source);
  }

  const endpoint =
    process.env.DEEPL_API_URL ||
    "https://api-free.deepl.com/v2/translate";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${process.env.DEEPL_API_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params
  });

  const data = await response.json();

  if (!response.ok) {
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
  rewriteTone,
  uiLanguage,
  sentenceMode
}) {
  if (!process.env.OPENAI_API_KEY) {
    if (deeplText) {
      return buildDeepLOnlyResult({
        text: originalText,
        deeplText,
        sourceLanguage,
        targetLanguage,
        uiLanguage
      });
    }

    throw new Error("Missing OPENAI_API_KEY");
  }

  const explanationLanguage = getExplanationLanguage(uiLanguage);
  const glossaryText = buildGlossaryText(glossary);
  const taskPrompt = getTaskPrompt(task);
  const toneInstruction = getToneInstruction(rewriteTone);

  const segmentationRule = sentenceMode
    ? `
Sentence mode is ON:
- Split the ORIGINAL input into natural sentence-level segments.
- Each segment must preserve the full-message context.
- Interpret each sentence using surrounding context, not in isolation.
- Maintain consistent emotional tone, relationship context, and conversational intent across all segments.
- Prefer contextually natural translations over literal sentence-by-sentence translation.
- If a short sentence has multiple meanings, infer the most natural meaning from the overall conversation.
- Each segment must have its own best translation and 3 options.
- Do not translate segments as isolated sentences.
`
    : `
Sentence mode is OFF:
- Return exactly ONE segment for the entire message.
- The segment must contain the complete full-message translation.
- The 3 options must be 3 complete full-message expressions.
`;

  const prompt = `
You are FluentReply, a professional multilingual translation assistant.

Task:
${taskPrompt}

Source language:
${sourceLanguage}

Target language:
${targetLanguage || "auto"}

Explanation language:
${explanationLanguage}

Original input:
${originalText}

DeepL base translation:
${deeplText || "No DeepL result provided."}

Glossary:
${glossaryText}

TRANSLATION MEMORY RULES:
- Maintain consistent translations for repeated names, brands, companies, products, and relationships.
- If a term has already appeared earlier in the conversation, prefer the same translation unless context requires otherwise.
- Keep terminology consistent across all segments and options.
- Avoid translating the same entity differently in different sentences.

TONE INSTRUCTION:
${toneInstruction}

ANTI-AI WORDING RULES:
- Avoid robotic AI wording such as: moreover, furthermore, therefore, thus, utilize, facilitate, commence.
- Avoid overly formal filler unless the selected tone requires it.
- Prefer natural native wording over literal machine translation.
- Keep the meaning accurate, but make the sentence sound like a real human wrote it.
- Do not make the translation longer than necessary.

NATIVE COMPRESSION RULES:
- Prefer shorter native expressions when meaning stays the same.
- Avoid unnecessarily long or repetitive wording.
- Use contractions naturally when appropriate.
- Remove robotic filler phrases.
- Sound like a real native speaker in real conversation.

DYNAMIC STYLE ROUTING:
- If the input is a business email, use clear professional language.
- If the input is casual chat or texting, use natural conversational language.
- If the input is romantic or affectionate, preserve warmth and intimacy naturally.
- If the input is news or formal content, prioritize accuracy, neutrality, and clarity.
- If the input contains slang, idioms, or internet language, translate the intended meaning rather than word-for-word.
- If the input is short, prefer the most likely natural meaning from context.
- Do not over-polish casual messages.
- Do not make formal messages too casual.

CONFIDENCE & AMBIGUITY RULES:
- If the source text is ambiguous, infer the most contextually natural meaning.
- If multiple interpretations are plausible, prefer the most likely real-world conversational meaning.
- Use alternatives strategically when ambiguity exists.
- Avoid hallucinating meanings that are unsupported by context.
- Preserve uncertainty when the original text itself is unclear.
- Do not overconfidently force one interpretation if context is insufficient.

EMOTIONAL TONE PRESERVATION:
- Preserve the emotional intensity of the original message.
- If the source is affectionate, keep it warm and intimate.
- If the source is frustrated, preserve the frustration without making it rude unless the original is rude.
- If the source is apologetic, keep the apology natural and sincere.
- If the source is playful, keep it playful and natural.
- Do not flatten emotional messages into neutral textbook translations.
- Do not make emotional messages overly dramatic if the original is mild.

CULTURAL LOCALIZATION RULES:
- Prefer culturally natural expressions over literal translations when appropriate.
- Translate idioms, slang, emotional expressions, and social phrases into their natural equivalent meaning.
- Avoid awkward word-for-word translations that native speakers would not normally say.
- Preserve the social intent of the original message, not just the literal words.
- If a phrase has a culturally common equivalent in the target language, prefer the natural equivalent.

HUMAN FREQUENCY RULES:
- Prefer expressions commonly used by real native speakers.
- Avoid textbook or corporate AI phrasing unless required.
- Prefer conversational high-frequency wording.
- Prefer natural spoken rhythm.
- If multiple translations are accurate, choose the one most commonly used in real life.

ALTERNATIVE DIVERSITY RULES:
- Each option must be meaningfully different.
- Avoid tiny wording swaps that do not add real value.
- Do not repeat the same sentence pattern across options.
- The options should differ in tone, rhythm, structure, or native style.
- Closest should be faithful, Natural should be native, Alternative should provide a clearly different natural expression.

REAL NATIVE SPEECH RULES:
- Sound like real people in real conversations.
- Prefer modern spoken phrasing.
- Preserve natural texting rhythm.
- Avoid overly polished AI sentence construction.
- Use contractions naturally.
- Prefer authentic native cadence over textbook phrasing.

SEMANTIC CONSISTENCY RULES:
- Preserve the original meaning precisely.
- Natural wording must not distort meaning.
- Do not exaggerate emotional intensity.
- Do not soften strong statements unless context requires it.
- Do not remove important nuance or implications.
- Avoid adding meanings that are not supported by the original text.

QUALITY SCORING RULES:
- Prefer translations with the best balance of:
  - accuracy
  - naturalness
  - emotional fidelity
  - localization quality
- Penalize robotic wording.
- Penalize repetitive alternatives.
- Penalize awkward literal phrasing.
- Prefer fluent native readability.

CORE RULES:
- Translate the FULL original input.
- Never drop, skip, shorten, or ignore any sentence.
- If DeepL base translation exists, use it as the main meaning reference.
- The final translation must be in the target language.
- Explanations must be in ${explanationLanguage}.
- Support all language pairs.
- Keep chat messages natural, human, and context-aware.
- Keep pronouns, relationships, tone, gender references, and logic consistent.
- Apply glossary terms strictly.
- Do not invent new subjects, locations, emotions, or relationships.

CHINESE AFFECTIONATE TERMS:
- If Chinese "亲爱的" appears in romantic, affectionate, or close chat context, include "Honey" as Natural or Alternative.
- For "亲爱的", options should consider: Honey, Sweetheart, Babe, Dear.
- For "宝贝", options should consider: Baby, Babe, Sweetheart.
- For "老公", options should consider: Honey, Hubby, Husband depending on context.
- For "老婆", options should consider: Honey, Sweetheart, Wife depending on context.

RELATIONSHIP CONTEXT RULES:
- Infer relationship context from the conversation naturally.
- Preserve consistent relationship tone across all segments.
- Romantic language should remain emotionally intimate.
- Business communication should remain professional.
- Friendly chat should sound casual and human.
- Avoid mixing romantic and formal business tone incorrectly.

${segmentationRule}

CONVERSATIONAL FLOW RULES:
- Ensure all segments sound natural when read together.
- Preserve realistic conversational rhythm.
- Maintain emotional continuity across sentences.
- Avoid making adjacent sentences sound stylistically disconnected.
- Preserve natural dialogue pacing.

INTENT PRESERVATION RULES:
- Preserve the speaker's real communicative intent.
- Translate implied meaning naturally when context makes the intent clear.
- Preserve sarcasm, hesitation, affection, frustration, politeness, or indirect meaning when present.
- Do not translate only the literal surface wording.
- Prioritize communicative meaning over rigid word-for-word structure.

REGISTER AWARENESS RULES:
- Match the social register of the original message.
- Preserve whether the tone is formal, casual, intimate, professional, playful, or respectful.
- Do not make casual speech sound corporate.
- Do not make professional communication sound overly casual.
- Preserve realistic social tone for the target audience.

OPTION RULES:
- Every segment must have exactly 3 options:
  1. Closest
  2. Natural
  3. Alternative
- Each option text must be in the target language.
- Each option meaning must be in ${explanationLanguage}.
- Closest = most faithful to original meaning.
- Natural = most natural conversational expression.
- Alternative = another natural expression with the same meaning.

- Closest must prioritize accuracy and faithfulness.
- Natural must prioritize native everyday expression.
- Alternative must provide a clearly different but still accurate style.
- Do not make all three options sound almost the same.

OUTPUT RULES:
- Return ONLY valid JSON.
- No markdown.
- No comments.
- No extra text.

JSON format:
{
  "detected_language": "detected source language",
  "target_language": "target language",
  "full_translation": "complete translation of the full input",
  "segments": [
    {
      "id": 1,
      "source": "original text or sentence",
      "best": "best translation",
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
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
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

  return JSON.parse(cleaned);
}

function normalizeResult(parsed, { originalText, fallbackText, uiLanguage }) {
  if (!parsed || typeof parsed !== "object") {
    parsed = {};
  }

  if (!parsed.full_translation && Array.isArray(parsed.segments)) {
    parsed.full_translation = parsed.segments
      .map(s => s.best || "")
      .join(" ")
      .trim();
  }

  if (!parsed.full_translation) {
    parsed.full_translation = fallbackText || "";
  }

  if (!Array.isArray(parsed.segments) || parsed.segments.length === 0) {
    parsed.segments = [
      {
        id: 1,
        source: originalText,
        best: parsed.full_translation,
        options: [
          {
            label: "Closest",
            text: parsed.full_translation,
            meaning: meaning(uiLanguage, "closest")
          },
          {
            label: "Natural",
            text: parsed.full_translation,
            meaning: meaning(uiLanguage, "natural")
          },
          {
            label: "Alternative",
            text: parsed.full_translation,
            meaning: meaning(uiLanguage, "alternative")
          }
        ]
      }
    ];
  }

  parsed.segments = parsed.segments.map((seg, index) => {
    let options = Array.isArray(seg.options) ? seg.options : [];

    while (options.length < 3) {
      const type =
        options.length === 0
          ? "closest"
          : options.length === 1
          ? "natural"
          : "alternative";

      options.push({
        label:
          type === "closest"
            ? "Closest"
            : type === "natural"
            ? "Natural"
            : "Alternative",
        text:
          seg.best ||
          parsed.full_translation ||
          fallbackText ||
          "",
        meaning: meaning(uiLanguage, type)
      });
    }

    options = options.slice(0, 3).map((opt, optIndex) => ({
      label:
        opt.label ||
        (optIndex === 0
          ? "Closest"
          : optIndex === 1
          ? "Natural"
          : "Alternative"),
      text:
        opt.text ||
        seg.best ||
        parsed.full_translation ||
        fallbackText ||
        "",
      meaning:
        opt.meaning ||
        meaning(
          uiLanguage,
          optIndex === 0
            ? "closest"
            : optIndex === 1
            ? "natural"
            : "alternative"
        )
    }));

    return {
      id: seg.id || index + 1,
      source: seg.source || originalText,
      best:
        seg.best ||
        options[0].text ||
        parsed.full_translation ||
        fallbackText ||
        "",
      options
    };
  });

  return parsed;
}

function getExplanationLanguage(uiLanguage) {
  if (uiLanguage === "zh") return "Simplified Chinese";
  if (uiLanguage === "ja") return "Japanese";
  return "English";
}

function buildGlossaryText(glossary) {
  if (!Array.isArray(glossary) || glossary.length === 0) {
    return "No glossary provided.";
  }

  return glossary
    .filter(item => item && item.source && item.target)
    .map(item => `${item.source} = ${item.target}`)
    .join("\n");
}

function getTaskPrompt(task) {
  if (task === "headline") {
    return "Rewrite or translate the entire input as a professional news headline. Do not drop key information.";
  }

  if (task === "vocab") {
    return "Extract important vocabulary from the entire input and explain each term briefly.";
  }

  if (task === "news") {
    return "Translate the entire input as professional, neutral news content.";
  }

  return "Translate accurately and naturally.";
}

function getToneInstruction(tone){

  if(tone === "auto"){
    return `
Automatically choose the most appropriate tone based on the input context.
Keep the translation accurate, natural, and socially appropriate.
`;
  }

  if(tone === "professional"){
    return `
Use polished, professional, business-level language.
Avoid slang or overly casual wording.
Keep the translation natural and fluent.
`;
  }

  if(tone === "casual"){
    return `
Use casual, conversational wording.
Sound like a native speaker texting naturally.
Use contractions when appropriate.
`;
  }

  if(tone === "friendly"){
    return `
Use friendly, approachable conversational language.
Sound warm, positive, and natural.
`;
  }

  if(tone === "concise" || tone === "short"){
    return `
Keep the translation concise, clean, and efficient.
Use short native phrasing.
Avoid unnecessary words.
`;
  }

  if(tone === "native"){
    return `
Rewrite like a native speaker would naturally say it.
Avoid robotic AI phrasing.
Use authentic everyday wording.
`;
  }

  if(tone === "warm"){
    return `
Use warm, emotionally gentle wording.
Sound caring and human.
Preserve emotional softness naturally.
`;
  }

  if(tone === "confident"){
    return `
Use confident, clear, assertive wording.
Sound natural, not aggressive.
`;
  }

  if(tone === "flirty"){
    return `
Use playful, subtly flirtatious wording when appropriate.
Keep the tone natural and attractive.
Do not make it inappropriate or excessive.
`;
  }

  if(tone === "luxury"){
    return `
Use elegant, polished, premium-sounding language.
Maintain natural sophistication.
Avoid sounding stiff or artificial.
`;
  }

  if(tone === "genz"){
    return `
Use modern Gen Z conversational style naturally.
Keep it casual, current, and human.
Avoid sounding forced or cringe.
`;
  }

  return `
Use natural, fluent, human-sounding language.
Avoid robotic translation wording.
`;
}

function meaning(lang, type) {
  const zh = {
    closest: "最贴近原文意思的翻译。",
    natural: "更自然、更口语化的表达，但意思不变。",
    alternative: "另一种自然表达方式，意思保持一致。"
  };

  const ja = {
    closest: "原文の意味に最も忠実な翻訳です。",
    natural: "より自然な表現ですが、意味は同じです。",
    alternative: "同じ意味を持つ別の自然な表現です。"
  };

  const en = {
    closest: "The closest translation to the original meaning.",
    natural: "A more natural expression with the same meaning.",
    alternative: "Another natural way to express the same meaning."
  };

  if (lang === "zh") return zh[type];
  if (lang === "ja") return ja[type];
  return en[type];
}

function isDeepLSupported(lang) {
  return Boolean(mapDeepLLang(lang));
}

function mapDeepLLang(lang) {
  const map = {
    English: "EN",
    "Simplified Chinese": "ZH",
    Chinese: "ZH",
    Japanese: "JA",
    Korean: "KO",
    Spanish: "ES",
    French: "FR",
    German: "DE",
    Russian: "RU",
    Portuguese: "PT",
    Italian: "IT",
    Dutch: "NL",
    Polish: "PL",
    Arabic: "AR",
    Turkish: "TR",
    Ukrainian: "UK",
    Thai: null,
    Vietnamese: null,
    Burmese: null,
    auto: null
  };

  return map[lang] || null;
}
