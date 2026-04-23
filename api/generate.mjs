import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { content, platforms, tone, email } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    // 1. Check/Update Usage in Supabase
    let { data: user } = await supabase.from('user_usage').select('*').eq('email', email.toLowerCase().trim()).single();
    if (!user) {
      const { data: newUser } = await supabase.from('user_usage').insert([{ email: email.toLowerCase().trim(), usage_count: 0, max_limit: 100 }]).select().single();
      user = newUser;
    }
    if (user.usage_count >= user.max_limit) return res.status(403).json({ error: "Limit reached." });

    // 2. Call Gemini 3 Flash
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
    const systemInstruction = `Act as a strategist. Tone: "${tone}". REQUIRED: Generate content for: ${platforms.join(', ')}. JSON Format: Keys are platform names.`;

    const aiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemInstruction + `\n\nInput: "${content}"` }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.3 }
      })
    });

    const data = await aiResponse.json();
    const resultText = data.candidates[0].content.parts[0].text;
    
    const newCount = user.usage_count + 1;
    await supabase.from('user_usage').update({ usage_count: newCount }).eq('email', email.toLowerCase().trim());
    
    return res.status(200).json({ results: JSON.parse(resultText), remaining: user.max_limit - newCount });

  } catch (error) {
    return res.status(500).json({ error: "Studio busy. Try again." });
  }
}
