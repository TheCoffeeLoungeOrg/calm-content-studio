import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { content, platforms, tone, email } = req.body;
        // 1. DATABASE CHECK (The "Find Me" Logic)
    const cleanEmail = (email || "").toLowerCase().trim();
    
    // We use .ilike to ignore capital letters
    let { data: user, error: dbError } = await supabase
      .from('user_usage')
      .select('*')
      .ilike('email', cleanEmail) 
      .single();

    // If still not found, we create a basic entry to prevent a crash
    if (!user) {
        const { data: newUser } = await supabase.from('user_usage').insert([{ 
          email: cleanEmail, 
          usage_count: 0, 
          monthly_limit: 20, 
          membership_plan: 'Essential' 
        }]).select().single();
        user = newUser;
    }

        // 1. FASTEST DB FETCH
        const { data: user } = await supabase.from('user_usage').select('membership_plan, usage_count, monthly_limit').ilike('email', cleanEmail).single();
        if (!user) return res.status(404).json({ error: "User not found" });

        // 2. ULTRALIGHT AI CALL
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${process.env.GEMINI_API_KEY}`;
        
        const aiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: `Social Media Expert. Tone: ${tone}. Create content for ${platforms.join(', ')} based on this text: ${content}. Return JSON only.` }] }],
                generationConfig: { 
                    responseMimeType: "application/json", 
                    temperature: 0.1, // Less "creative thinking" = Faster response
                    maxOutputTokens: 600 // Shortest possible length to beat the timer
                }
            })
        });

        const aiData = await aiResponse.json();
        const resultText = aiData.candidates[0].content.parts[0].text;

        // 3. SILENT UPDATE
        if (user.membership_plan !== 'Professional') {
            await supabase.from('user_usage').update({ usage_count: user.usage_count + 1 }).ilike('email', cleanEmail);
        }

        return res.status(200).json({ 
            results: JSON.parse(resultText), 
            remaining: user.membership_plan === 'Professional' ? 999 : (user.monthly_limit - (user.usage_count + 1)),
            plan: user.membership_plan
        });

    } catch (error) {
        return res.status(500).json({ error: "Network lag detected. Try turning off your VPN for a moment." });
    }
}
