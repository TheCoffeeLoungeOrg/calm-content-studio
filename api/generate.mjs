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

        // 1. DATABASE CHECK
        let { data: userData, error: dbError } = await supabase
            .from('user_usage')
            .select('*')
            .ilike('email', cleanEmail)
            .single();

        if (dbError || !userData) {
            const { data: newUser } = await supabase.from('user_usage').insert([{
                email: cleanEmail, usage_count: 0, 'Monthly Limit': 20, 'Membership Plan': 'Essential'
            }]).select().single();
            userData = newUser;
        }

// 2. AI CALL (STRICT & FAST)
        const systemInstruction = `You are a Master Content Strategist. Tone: ${tone}. 
        Output ONLY a JSON object. 
        Keys: "POST_CONTENT", "VISUAL_SUGGESTION", "STRATEGIC_HASHTAGS", "CALL_TO_ACTION".
        STRICT: Under 150 words total. No fluff. Use <br><br> for breaks.`;

        const aiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: systemInstruction + `\n\nMaterial: ${content}` }] }],
                generationConfig: { 
                    responseMimeType: "application/json", 
                    temperature: 0.1, // Makes the AI faster and more direct
                    maxOutputTokens: 400 // Limits length to stay under the 10s timer
                }
            })
        });

        const aiData = await aiResponse.json();
        if (!aiData.candidates || !aiData.candidates[0]) throw new Error("AI Timeout");

        let resultText = aiData.candidates[0].content.parts[0].text;
        resultText = resultText.replace(/\n/g, " ").trim();

        // 3. UPDATE USAGE
        const isPro = userData['Membership Plan'] === 'Professional';
        if (!isPro) {
            await supabase.from('user_usage').update({ usage_count: userData.usage_count + 1 }).ilike('email', cleanEmail);
        }

        // 4. FINAL RESPONSE
        return res.status(200).json({ 
            results: JSON.parse(resultText), 
            remaining: isPro ? 999 : (userData['Monthly Limit'] - (userData.usage_count + 1)),
            plan: userData['Membership Plan']
        });

    } catch (error) {
        console.error("Final Error:", error.message);
        return res.status(500).json({ error: "Stabilizing the Studio. Please try 1 platform." });
    }
}
