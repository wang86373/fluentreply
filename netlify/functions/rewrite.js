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
  natural: "Sound natural and balanced like DeepL Pro.",
  casual: "Use relaxed casual native wording.",
  professional: "Use professional business wording.",
  friendly: "Sound warm and friendly.",
  concise: "Keep the rewrite concise and clean.",
  native: "Sound completely native and human."
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

    output = output.replace(/```json|```/g,"").trim();

    let parsed = JSON.parse(output);

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
