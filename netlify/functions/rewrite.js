exports.handler = async function(event){

  try{
    const body = JSON.parse(event.body || "{}");

    const { text, target, isPro } = body;

    const prompt = `
Rewrite this sentence in ${target}.

Return JSON:
{
 "alternatives":[
   {"label":"Closest","text":"...","meaning":"..."},
   {"label":"Natural","text":"...","meaning":"..."},
   {"label":"Fluent","text":"...","meaning":"..."}
 ]
}
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
