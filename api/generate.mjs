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
    const cleanEmail = email.toLowerCase().trim();

    let { data: user, error: dbError } = await supabase
      .from('user_usage')
      .select('*')
      // .ilike makes the search case-insensitive (ignores Caps vs No Caps)
      .ilike('email', cleanEmail) 
      .single();

    // If user doesn't exist, we can still create them as 'Essential' 
    // but we use the clean lowercase version to keep your database tidy.
    if (!user) {
      const { data: newUser } = await supabase.from('user_usage').insert([{ 
        email: cleanEmail, 
        usage_count: 0, 
        monthly_limit: 20, 
        membership_plan: 'Essential' 
      }]).select().single();
      user = newUser;
    }

    // 2. TIERED LIMIT CHECK
    // Professional members always pass. Essential members checked against monthly_limit.
    const isProfessional = user.membership_plan === 'Professional';
    if (!isProfessional && user.usage_count >= user.monthly_limit) {
       return res.status(403).json({ error: "Your monthly limit has been reached." });
    }

    const lengthInstruction = lengthPreference === 'short' 
      ? "Keep the POST_CONTENT punchy and concise (1-2 paragraphs)." 
      : "Provide a substantial, deep-dive POST_CONTENT (3-4 paragraphs).";

    // 3. AI CALL
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
    
    const systemInstruction = `Act as a master content strategist. Tone: "${tone}". ${lengthInstruction}
    CRITICAL: Today's date is ${dateString}. Only mention the year or specific date if it is naturally relevant to the content; do not force "2026" into every post.
    
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
    
    if (data.error) {
        return res.status(500).json({ error: "Gemini AI Error: " + data.error.message });
    }

    const resultText = data.candidates[0].content.parts[0].text;

    // 4. SMART CREDIT DEDUCTION
    let currentUsage = user.usage_count;
    
    // Only increment and update DB if they ARE NOT Professional
    if (!isProfessional) {
        currentUsage = user.usage_count + 1;
        await supabase.from('user_usage').update({ usage_count: currentUsage }).eq('email', email.toLowerCase().trim());
    }
    
    // 5. RETURN RESULTS
    // If Pro, we send 999. If Essential, we do the math safely.
    const remainingCount = isProfessional ? 999 : (user.monthly_limit - currentUsage);

    return res.status(200).json({ 
      results: JSON.parse(resultText), 
      remaining: remainingCount,
      plan: user.membership_plan
    });

  } catch (error) {
    console.error("Studio Error:", error);
    return res.status(500).json({ error: "The Studio encountered an error. Please try again." });
  }
}
