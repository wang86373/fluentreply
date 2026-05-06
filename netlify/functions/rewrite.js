exports.handler = async function(event){

  try{
    const body = JSON.parse(event.body || "{}");

    const {
  text,
  target,
  isPro,
  rewriteTone = "natural"
} = body;

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
- sound human
- avoid AI wording
- avoid repetition
- preserve meaning
- generate diverse native alternatives

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

    const response = await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Authorization":`Bearer ${process.env.OPENAI_API_KEY}`
      },
      body:JSON.stringify({
        model:"gpt-4o-mini",
        input: prompt + "\n\n" + text,
        temperature:0.7
      })
    });

    const data = await response.json();

    let output =
      data.output_text ||
      data.output?.[0]?.content?.[0]?.text;

    output = output
  .replace(/```json/gi,"")
  .replace(/```/g,"")
  .trim();

let parsed;

try{
  parsed = JSON.parse(output);
}catch(e){
  parsed = {
    alternatives:[
      {
        label:"Natural",
        text:output,
        meaning:"AI rewrite"
      }
    ]
  };
}

    let alternatives = parsed.alternatives || [];

    // 🔥 Pro无限
    if(!isPro){
      alternatives = alternatives.slice(0,3);
    }

    return {
      statusCode:200,
      body:JSON.stringify({ alternatives })
    };

  }catch(err){
    return {
      statusCode:500,
      body:JSON.stringify({ error: err.message })
    };
  }
};
