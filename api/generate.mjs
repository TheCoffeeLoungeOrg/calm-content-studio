import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { content, platforms, tone, email, lengthPreference } = req.body;
        const cleanEmail = (email || "").toLowerCase().trim();

        // 1. DATABASE CHECK (Recognizes Professional Plan)
        let { data: userData } = await supabase.from('user_usage').select('*').ilike('email', cleanEmail).single();
        
        if (!userData) {
            const { data: newUser } = await supabase.from('user_usage').insert([{
                email: cleanEmail, usage_count: 0, 'Monthly Limit': 20, 'Membership Plan': 'Essential'
            }]).select().single();
            userData = newUser;
        }

        const currentPlan = userData['Membership Plan'] || 'Essential';
        const isPro = currentPlan === 'Professional';
        const lengthInst = lengthPreference === 'short' ? "1 paragraph max" : "2 short paragraphs";
// This reduces the "workload" so the AI can finish all platforms in under 10 seconds.
        
        // 2. QUALITY AI CALL (Restored Instructions)
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${process.env.GEMINI_API_KEY}`;
        
       const systemInstruction = `You are a Expert Digital Marketing Strategist. 
Output ONLY a JSON object. NO ARRAYS. 
Keys must be exactly: "Facebook Page", "Facebook Group", "Instagram", "Pinterest", "LinkedIn", "TikTok", "Newsletter".
DO NOT wrap the response in an array []. Return only the object {}.
4. Newsletter: Use keys NEWSLETTER_SUBJECT, POST_CONTENT, CALL_TO_ACTION.
5. Others: Use keys POST_CONTENT, VISUAL_SUGGESTION, STRATEGIC_HASHTAGS, CALL_TO_ACTION.
6. Use <br><br> for paragraph breaks.Never use em dash.  Attempt to sound as human as you can`;
        
        const aiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: systemInstruction + `\n\nSource Material: ${content}` }] }],
                generationConfig: { responseMimeType: "application/json", temperature: 0.7 }
            })
        });

        const aiData = await aiResponse.json();
        const resultText = aiData.candidates[0].content.parts[0].text;

        // 3. UPDATE USAGE
        if (!isPro) {
            await supabase.from('user_usage').update({ usage_count: userData.usage_count + 1 }).ilike('email', cleanEmail);
        }

        return res.status(200).json({ 
            results: JSON.parse(resultText), 
            remaining: isPro ? 999 : (userData['Monthly Limit'] - (userData.usage_count + 1)),
            plan: currentPlan
        });

    } catch (error) {
        return res.status(500).json({ error: "The Studio is stabilizing. Please try again in a moment." });
    }
}
