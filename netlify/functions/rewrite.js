const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
exports.handler = async function(event){

  if(event.httpMethod === "OPTIONS"){
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: ""
  };
}

if(event.httpMethod !== "POST"){
  return {
    statusCode: 405,
    headers: corsHeaders,
    body: JSON.stringify({ error: "Method not allowed" })
  };
}
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  try{
    const body = JSON.parse(event.body || "{}");

    const {
  text,
  target,
  isPro,
  email,
  rewriteTone = "natural"
} = body;

    if(!text || String(text).length > 3000){
  return {
    statusCode: 400,
    headers: corsHeaders,
    body: JSON.stringify({
      error: "Text too long"
    })
  };
}
    let profile = null;

if(email){

  const profileRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email.toLowerCase())}&select=*`,
    {
      headers:{
        apikey:SERVICE_KEY,
        Authorization:`Bearer ${SERVICE_KEY}`
      }
    }
  );

  const profiles = await profileRes.json();

  profile = profiles?.[0] || null;
}

    const FREE_LIMIT = 300;

if(
  !isPro &&
  profile &&
  Number(profile.usage_count || 0) >= FREE_LIMIT
){
  return {
    statusCode: 403,
    headers: corsHeaders,
    body: JSON.stringify({
      error: "Free limit reached"
    })
  };
}
    
    const toneMap = {
  auto: "Automatically choose the most natural style based on context.",
  natural: "Sound natural, fluent, and human.",
  casual: "Use relaxed casual native wording, like real texting.",
  professional: "Use polished professional business wording.",
  friendly: "Sound warm, friendly, and approachable.",
  concise: "Keep the rewrite concise and clean.",
  native: "Sound completely native and human, not AI-written.",
  warm: "Use warm, emotionally gentle wording. Sound caring and human.",
  confident: "Use confident, clear, assertive wording. Sound natural, not aggressive.",
  short: "Use short, efficient native phrasing.",
  flirty: "Use playful, subtly flirtatious wording when appropriate. Keep it natural.",
  luxury: "Use elegant, polished, premium-sounding language.",
  genz: "Use modern Gen Z conversational style naturally. Avoid sounding forced or cringe."
};

const prompt = `
Rewrite this sentence in ${target}.

STYLE:
${toneMap[rewriteTone] || toneMap.natural}

RULES:
- Preserve the original meaning exactly.
- Sound human, native, and context-aware.
- Avoid robotic AI wording.
- Avoid awkward literal phrasing.
- Avoid repetition or tiny wording swaps.
- Generate meaningfully different native alternatives.
- Prefer high-frequency expressions real native speakers actually use.
- Keep emotional tone, relationship context, and social register consistent.
- Do not exaggerate, soften, or invent meaning.

Return JSON only:

{
  "alternatives":[
    {"label":"Closest","text":"...","meaning":"..."},
    {"label":"Natural","text":"...","meaning":"..."},
    {"label":"Casual","text":"...","meaning":"..."},
    {"label":"Professional","text":"...","meaning":"..."},
    {"label":"Friendly","text":"...","meaning":"..."},
    {"label":"Concise","text":"...","meaning":"..."},
    {"label":"Fluent","text":"...","meaning":"..."}
  ]
}

Sentence:
${text}
`;
    
const controller = new AbortController();

const timeout = setTimeout(() => controller.abort(), 45000);
    
    let response;

try{

response = await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      signal: controller.signal,
      headers:{
        "Content-Type":"application/json",
        "Authorization":`Bearer ${process.env.OPENAI_API_KEY}`
      },
      body:JSON.stringify({
  model:"gpt-4o-mini",
  input: prompt,
  temperature:0.7,
  text:{
    format:{
      type:"json_object"
    }
  }
})
    });

} finally {

clearTimeout(timeout);

}

if(!response.ok){

  const errText = await response.text();

  throw new Error(
    `OpenAI API Error: ${response.status} ${errText}`
  );

}
    
    const data = await response.json();

    let output =
      data.output_text ||
      data.output?.[0]?.content?.[0]?.text;

    output = output
  .replace(/```json/gi,"")
  .replace(/```/g,"")
  .trim();

let parsed;
try {
    parsed = JSON.parse(output);
} catch(e) {
    console.error("JSON parse failed for AI output:", output, e);
    parsed = {
        alternatives: [
            {
                label: "Natural",
                text: output || text, // fallback 保证即使 output 为空也有原文
                meaning: "AI rewrite (parse failed)"
            }
        ]
    };
}
    
// ✅ fallback：当 AI 返回 alternatives 为空时，使用原文本
if (!parsed.alternatives || parsed.alternatives.length === 0) {
    parsed.alternatives = [
        {
            label: "Natural",
            text: text, // 原文本 fallback
            meaning: "Original sentence preserved because AI returned empty"
        }
    ];
}

let alternatives = parsed.alternatives || [];

alternatives = (alternatives || []).map((item, index) => ({
    label:
        item.label ||
        [
            "Closest", "Natural", "Casual", "Professional", "Friendly",
            "Concise", "Fluent", "Short", "Warm", "Confident",
            "Luxury", "GenZ"
        ][index] ||
        `Option ${index + 1}`,
    text: String(item.text || "").trim(),
    meaning: item.meaning || "Alternative rewrite"
})).filter(item => item.text);

    const seen = new Set();

alternatives = alternatives.filter(item => {
  const key = item.text
    .toLowerCase()
    .replace(/[.!?]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if(seen.has(key)){
    return false;
  }

  seen.add(key);
  return true;
});

    if(!alternatives.length){
  alternatives = [
    {
      label: "Natural",
      text: text,
      meaning: "Original sentence preserved because no valid rewrite was returned."
    }
  ];
}
    
    // 🔥 Pro无限
    if(!isPro){
      alternatives = alternatives.slice(0,3);
    }

    if(
  !isPro &&
  profile &&
  email
){

  await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email.toLowerCase())}`,
    {
      method:"PATCH",
      headers:{
        "Content-Type":"application/json",
        apikey:SERVICE_KEY,
        Authorization:`Bearer ${SERVICE_KEY}`,
        Prefer:"return=minimal"
      },
      body:JSON.stringify({
        usage_count:
          Number(profile.usage_count || 0) + 1
      })
    }
  );

}

    if(email){
      
  await fetch(`${SUPABASE_URL}/rest/v1/translation_history`, {
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      apikey:SERVICE_KEY,
      Authorization:`Bearer ${SERVICE_KEY}`,
      Prefer:"return=minimal"
    },
    body:JSON.stringify({
      email: email.toLowerCase(),
      source_text: text,
      translated_text: alternatives?.[0]?.text || "",
      target_lang: target,
      rewrite_tone: rewriteTone,
      created_at: new Date().toISOString() // 🔹 新增字段
    })
  });
}


    return {
  statusCode: 200,
  headers: corsHeaders,
  body: JSON.stringify({ alternatives })
};
    
}catch(err){
  return {
    statusCode: 500,
    headers: corsHeaders,
    body: JSON.stringify({ error: err.message })
  };
}
};
