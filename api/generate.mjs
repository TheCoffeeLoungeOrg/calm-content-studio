import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
    // 1. STICKY HEADERS FOR STABILITY
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { content, platforms, tone, email } = req.body;
        const cleanEmail = (email || "").toLowerCase().trim();

        // 2. DATABASE CHECK - Find or Create User (Combined into one step)
        let { data: userData, error: dbError } = await supabase
            .from('user_usage')
            .select('*')
            .ilike('email', cleanEmail)
            .single();

        if (!userData) {
            const { data: newUser } = await supabase.from('user_usage').insert([{
                email: cleanEmail,
                usage_count: 0,
                'Monthly Limit': 20,
                'Membership Plan': 'Essential'
            }]).select().single();
            userData = newUser;
        }

        if (!userData) throw new Error("User record unavailable");

        // 3. MAP DATABASE FIELDS (Matches your Supabase screenshot)
        const currentPlan = userData['Membership Plan'] || 'Essential';
        const currentUsage = userData.usage_count || 0;
        const monthlyLimit = userData['Monthly Limit'] || 20;

        // 4. AI CALL (Optimized for speed)
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${process.env.GEMINI_API_KEY}`;
        
        const aiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: `Social Media Marketer. Tone: ${tone}. Create content for ${platforms.join(', ')} from this text: ${content}. Return JSON only.` }] }],
                generationConfig: { 
                    responseMimeType: "application/json", 
                    temperature: 0.2, 
                    maxOutputTokens: 800 
                }
            })
        });

        const aiData = await aiResponse.json();
        if (aiData.error) throw new Error("AI Timeout or Error");
        
        const resultText = aiData.candidates[0].content.parts[0].text;

        // 5. UPDATE USAGE IF NOT PROFESSIONAL
        if (currentPlan !== 'Professional') {
            await supabase.from('user_usage')
                .update({ usage_count: currentUsage + 1 })
                .ilike('email', cleanEmail);
        }

        // 6. RETURN FINAL RESULTS
        return res.status(200).json({ 
            results: JSON.parse(resultText), 
            remaining: currentPlan === 'Professional' ? 999 : (monthlyLimit - (currentUsage + 1)),
            plan: currentPlan
        });

    } catch (error) {
        console.error("CRITICAL ERROR:", error.message);
        return res.status(500).json({ error: "The Studio encountered a snag. Please refresh and try again." });
    }
}
