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

    const today = new Date();
    const dateString = today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    // 1. DATABASE CHECK
    const cleanEmail = (email || "").toLowerCase().trim();
    if (!cleanEmail) return res.status(400).json({ error: "Email is required" });

    let { data: user } = await supabase
      .from('user_usage')
      .select('*')
      .ilike('email', cleanEmail) 
      .single();

    if (!user) {
      const { data: newUser, error: insertError } = await supabase.from('user_usage').insert([{ 
        email: cleanEmail, 
        usage_count: 0, 
        monthly_limit: 20, 
        membership_plan: 'Essential' 
      }]).select().single();
      
      if (insertError) throw new Error("Could not create user record");
      user = newUser;
    }

    // 2. TIERED LIMIT CHECK
    const isProfessional = user.membership_plan === 'Professional';
    if (!isProfessional && user.usage_count >= user.monthly_limit) {
       return res.status(403).json({ error: "Your monthly limit has been reached." });
    }

    const lengthInstruction = lengthPreference === 'short' 
      ? "Keep content punchy (1-2 paragraphs)." 
      : "Provide a deep-dive (3-4 paragraphs).";

    // 3. AI CALL - STRENGTHENED INSTRUCTIONS
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
    
    const systemInstruction = `You are a professional content creator. 
    Tone: "${tone}". ${lengthInstruction}
    Today's date is ${dateString}. 

    REQUIRED: Return a SINGLE JSON object only. 
    NO markdown, NO backticks, NO numbering (e.g., do not use 1., 2., 3.).

    Each platform in ${platforms.join(', ')} must have these EXACT keys:
    - NEWSLETTER_SUBJECT (Only if platform is Newsletter)
    - POST_CONTENT (Use <br><br> for paragraph breaks)
    - VISUAL_SUGGESTION
    - STRATEGIC_HASHTAGS (High performing but relative to content)
    - CALL_TO_ACTION (highperforming in creating engagement)
    - NEVER USE EM DASH`;

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

    const aiData = await aiResponse.json();
    if (aiData.error) return res.status(500).json({ error: "AI Error: " + aiData.error.message });

    // CLEANING THE JSON
    let resultText = aiData.candidates[0].content.parts[0].text;
    resultText = resultText.replace(/```json/g, "").replace(/```/g, "").trim();

    // 4. SMART CREDIT DEDUCTION
    let currentUsage = user.usage_count;
    if (!isProfessional) {
        currentUsage = user.usage_count + 1;
        await supabase.from('user_usage').update({ usage_count: currentUsage }).ilike('email', cleanEmail);
    }
    
    // 5. RETURN RESULTS
    const remainingCount = isProfessional ? 999 : (user.monthly_limit - currentUsage);

    return res.status(200).json({ 
      results: JSON.parse(resultText), 
      remaining: remainingCount,
      plan: user.membership_plan
    });

  } catch (error) {
    console.error("Studio Error:", error);
    return res.status(500).json({ error: "The Studio encountered a snag. Try again!" });
  }
}
