import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

  try {
    const { content, platforms, tone, email, lengthPreference } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    // Get the current date dynamically
    const today = new Date();
    const currentYear = today.getFullYear();
    const dateString = today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    // 1. Database Check
    let { data: user } = await supabase.from('user_usage').select('*').eq('email', email.toLowerCase().trim()).single();
    if (!user) {
      const { data: newUser } = await supabase.from('user_usage').insert([{ email: email.toLowerCase().trim(), usage_count: 0, max_limit: 100 }]).select().single();
      user = newUser;
    }
    if (user.usage_count >= user.max_limit) return res.status(403).json({ error: "Limit reached." });

    // 2. Length Logic
    const lengthInstruction = lengthPreference === 'short' 
      ? "Keep the POST_CONTENT punchy and concise (1-2 paragraphs)." 
      : "Provide a substantial, deep-dive POST_CONTENT (3-4 paragraphs).";

    // 3. AI Call with Dynamic Date
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
    
    const systemInstruction = `Act as a master content strategist. Tone: "${tone}". ${lengthInstruction}
    CRITICAL: Today's date is ${dateString}. Ensure all seasonal and year references (like ${currentYear}) are strictly accurate.
    
    REQUIRED: Generate content for: ${platforms.join(', ')}. 
    
    For each platform, provide:
    - NEWSLETTER_SUBJECT: (Only if the platform is Newsletter) Provide 3 catchy subject lines. Separate them with <br> so they appear as a list.
    - POST_CONTENT: Use <br><br> for paragraph spacing.
    - VISUAL_SUGGESTION: (Not for Newsletter) A brief description of a graphic or image for this post.
    - STRATEGIC_HASHTAGS: (Not for Newsletter) 3-5 tags.
    - CALL_TO_ACTION: A clear closing line that increases engagement.
    - NEVER USE EM DASH
    
    Return as a SINGLE JSON object. No markdown backticks or "json" labels.`;

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
    
    if (data.error && data.error.code === 503) {
        return res.status(200).json({ error: "The Studio is super busy right now, give the button another click!" });
    }

    if (!data.candidates || !data.candidates[0].content.parts[0].text) {
        return res.status(500).json({ error: "The Studio is having a moment. Please try again!" });
    }

    const resultText = data.candidates[0].content.parts[0].text;
    const newCount = user.usage_count + 1;
    await supabase.from('user_usage').update({ usage_count: newCount }).eq('email', email.toLowerCase().trim());
    
    return res.status(200).json({ 
      results: JSON.parse(resultText), 
      remaining: user.max_limit - newCount 
    });

  } catch (error) {
    return res.status(500).json({ error: "The Studio is super busy right now, give the button another click!" });
  }
}
