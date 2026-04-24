import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // 1. Immediate CORS Handling
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

  try {
    const { content, platforms, tone, email, lengthPreference } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    // 2. DATABASE CHECK (Case-Insensitive)
    const cleanEmail = (email || "").toLowerCase().trim();
    let { data: user } = await supabase
      .from('user_usage')
      .select('*')
      .ilike('email', cleanEmail) 
      .single();

    if (!user) {
      const { data: newUser } = await supabase.from('user_usage').insert([{ 
        email: cleanEmail, 
        usage_count: 0, 
        monthly_limit: 20, 
        membership_plan: 'Essential' 
      }]).select().single();
      user = newUser;
    }

    const isProfessional = user.membership_plan === 'Professional';
    const lengthInstruction = lengthPreference === 'short' ? "1 paragraph" : "2 short paragraphs";

    // 3. FASTER AI CALL
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
    
    const systemInstruction = `Master Marketer personality. Tone: ${tone}. Length: ${lengthInstruction}. 
    Return ONLY a single JSON object. No markdown. 
    Platforms: ${platforms.join(', ')}.
    Newsletter keys: NEWSLETTER_SUBJECT, POST_CONTENT, CALL_TO_ACTION.
    Other keys: POST_CONTENT, VISUAL_SUGGESTION, STRATEGIC_HASHTAGS, CALL_TO_ACTION.`;

    const aiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemInstruction + `\n\nInput: "${content}"` }] }],
        generationConfig: { 
            responseMimeType: "application/json", 
            temperature: 0.5,
            maxOutputTokens: 800 // Forced shorter output to beat the 10s timer
        }
      })
    });

    const aiData = await aiResponse.json();
    if (aiData.error) return res.status(500).json({ error: "AI Busy. Try fewer platforms." });

    let resultText = aiData.candidates[0].content.parts[0].text;
    resultText = resultText.replace(/```json/g, "").replace(/```/g, "").trim();

    // 4. USAGE UPDATE
    let currentUsage = user.usage_count;
    if (!isProfessional) {
        currentUsage++;
        await supabase.from('user_usage').update({ usage_count: currentUsage }).ilike('email', cleanEmail);
    }
    
    return res.status(200).json({ 
      results: JSON.parse(resultText), 
      remaining: isProfessional ? 999 : (user.monthly_limit - currentUsage),
      plan: user.membership_plan
    });

  } catch (error) {
    return res.status(500).json({ error: "Timeout. Please try selecting only 1-2 platforms." });
  }
}
