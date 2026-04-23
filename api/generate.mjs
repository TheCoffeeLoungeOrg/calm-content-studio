import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

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
    
    const systemInstruction = `Act as a master content strategist. Tone: "${tone}". 
    REQUIRED: Generate content for: ${platforms.join(', ')}. 
    
    For each platform, follow these strict structural rules:
    - NEWSLETTER_SUBJECT: (ONLY for the Newsletter platform) Provide 3 catchy, high opening subject line options.
    - POST_CONTENT: Provide a substantial, engaging 3-4 paragraph response. Dive into the "why" and "how". Use <br><br> between every paragraph for spacing.
    - STRATEGIC_HASHTAGS: Provide 3-5 relevant hashtags for all platforms except for Newsletter.
    - CALL_TO_ACTION: Provide a clear, encouraging closing line.
    
    Return the response as a SINGLE JSON object where the keys are the platform names. Do not include markdown backticks or the word "json".`;

    const aiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemInstruction + `\n\nInput Source Material: "${content}"` }] }],
        generationConfig: { 
            responseMimeType: "application/json", 
            temperature: 0.7 
        }
      })
    });

    const data = await aiResponse.json();
    
    // 3. Handle Gemini High Demand (Busy Signal)
    if (data.error && data.error.code === 503) {
        return res.status(200).json({ 
            error: "The Studio is super busy right now, give the button another click!",
            isRetryable: true 
        });
    }

    if (!data.candidates || !data.candidates[0].content.parts[0].text) {
        return res.status(500).json({ error: "The Studio is having a moment. Please try again!" });
    }

    const resultText = data.candidates[0].content.parts[0].text;
    
    // 4. Update usage count in Supabase
    const newCount = user.usage_count + 1;
    await supabase.from('user_usage').update({ usage_count: newCount }).eq('email', email.toLowerCase().trim());
    
    // 5. Send back results
    return res.status(200).json({ 
      results: JSON.parse(resultText), 
      remaining: user.max_limit - newCount 
    });

  } catch (error) {
    console.error("Internal Error:", error);
    return res.status(500).json({ error: "The Studio is super busy right now, give the button another click!" });
  }
}
