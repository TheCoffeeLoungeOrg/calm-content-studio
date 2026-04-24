import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  // 1. STICKY HEADERS (Forces CORS to behave)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { content, platforms, tone, email } = req.body;
    
    // 2. DATABASE - We search for JUST the ID and Plan to keep it fast
    const cleanEmail = (email || "").toLowerCase().trim();
    const { data: user, error: dbError } = await supabase
      .from('user_usage')
      .select('membership_plan, usage_count, monthly_limit')
      .ilike('email', cleanEmail)
      .single();

    if (dbError || !user) throw new Error("Database lag");

    // 3. AI - We move to a more stable prompt structure
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${process.env.GEMINI_API_KEY}`;
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Marketer. Tone: ${tone}. Platforms: ${platforms.join(',')}. Source: ${content}` }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
      })
    });

    const aiData = await response.json();
    const result = aiData.candidates[0].content.parts[0].text;

    // 4. USAGE - Increment in a separate "fire and forget" way
    if (user.membership_plan !== 'Professional') {
      await supabase.from('user_usage').update({ usage_count: user.usage_count + 1 }).ilike('email', cleanEmail);
    }

    return res.status(200).json({ 
      results: JSON.parse(result), 
      remaining: user.membership_plan === 'Professional' ? 999 : (user.monthly_limit - (user.usage_count + 1)),
      plan: user.membership_plan
    });

  } catch (err) {
    console.error("CRASH:", err.message);
    return res.status(500).json({ error: "System lag. Please try 1 platform with a shorter text snippet." });
  }
}
