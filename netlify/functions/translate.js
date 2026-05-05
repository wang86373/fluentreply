exports.handler = async (event) => {
  try {
    const { text, mode } = JSON.parse(event.body);

    const DEEPL_API_KEY = process.env.DEEPL_API_KEY;
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

    // =========================
    // 🔹 Step 1: DeepL 基础翻译
    // =========================
    let deeplResult = "";

    if (mode !== "ai_only") {
      const deeplRes = await fetch("https://api-free.deepl.com/v2/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `DeepL-Auth-Key ${DEEPL_API_KEY}`,
        },
        body: new URLSearchParams({
          text,
          target_lang: "EN",
        }),
      });

      const deeplData = await deeplRes.json();
      deeplResult = deeplData.translations?.[0]?.text || "";
    }

    // =========================
    // 🔹 Step 2: AI 优化（核心升级）
    // =========================
    let finalText = deeplResult;

    if (mode !== "deepl_only") {
      const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `
You are a professional bilingual translator.

STRICT RULES:
1. NEVER translate sentence by sentence.
2. MUST understand full context before translating.
3. Output must be natural, fluent, human-like English.

SPECIAL RULES FOR CHINESE TERMS:

亲爱的:
- In romantic or close context → MUST include:
  Honey / Sweetheart / Babe / Dear
- "Honey" MUST appear in one of the options

宝贝:
- Baby / Babe / Sweetheart

老婆:
- Honey / Wife (context dependent)

老公:
- Honey / Husband

STYLE:
Return EXACT format:

MAIN:
<Best translation>

ALTERNATIVES:
1. ...
2. ...
3. ...
              `,
            },
            {
              role: "user",
              content: text,
            },
          ],
        }),
      });

      const aiData = await aiRes.json();
      const aiText =
        aiData.choices?.[0]?.message?.content || deeplResult;

      finalText = aiText;
    }

    // =========================
    // 🔹 Step 3: 兜底补充 Honey（关键修复）
    // =========================
    if (text.includes("亲爱的") && !finalText.toLowerCase().includes("honey")) {
      finalText += "\n\nAlternative:\nHoney";
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        result: finalText,
        source: mode === "deepl_only" ? "DeepL" : "AI",
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: err.message,
      }),
    };
  }
};
