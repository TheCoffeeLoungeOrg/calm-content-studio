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

        // Safety Catch: If user doesn't exist, create them immediately
        if (dbError || !userData) {
            const { data: newUser, error: createError } = await supabase
                .from('user_usage')
                .insert([{
                    email: cleanEmail,
                    usage_count: 0,
                    'Monthly Limit': 20,
                    'Membership Plan': 'Essential'
                }])
                .select()
                .single();
            
            if (createError) throw new Error("Database creation failed");
            userData = newUser;
        }

        // Now it's safe to read these because we know userData exists
        const currentPlan = userData['Membership Plan']; 
        const isPro = currentPlan === 'Professional';
        const lengthInst = lengthPreference === 'short' ? "1-2 paragraphs" : "3-4 paragraphs";

        // 2. AI CALL (STRICT JSON FORMAT)
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${process.env.GEMINI_API_KEY}`;
        
const systemInstruction = `You are a Master Content Strategist. 
        Tone: ${tone}. Output ONLY JSON. 
        Platforms: ${platforms.join(', ')}. 
        STRICT: Keep each post under 100 words. No fluff. Use <br><br> for breaks.`;

// 2. AI CALL (STRICT JSON)
        const systemInstruction = `You are a Master Content Strategist. 
        Tone: ${tone}. Output ONLY a raw JSON object. 
        No markdown, no backticks, no comments.
        Keys: ${platforms.join(', ')}.
        Each value must be a string. 
        Use <br><br> for breaks.`;

        const aiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: systemInstruction + `\n\nMaterial: ${content}` }] }],
                generationConfig: { 
                    responseMimeType: "application/json", 
                    temperature: 0.1
                }
            })
        });

        const aiData = await aiResponse.json();
        
        if (!aiData.candidates || !aiData.candidates[0]) {
            throw new Error("AI Timeout. Try 1 platform.");
        }

        // CLEANING THE TEXT (Removes any accidental markdown or stray characters)
        let resultText = aiData.candidates[0].content.parts[0].text;
        resultText = resultText.replace(/```json/g, "").replace(/```/g, "").trim();

        // 3. UPDATE USAGE & RESPOND
        if (!isPro) {
            await supabase.from('user_usage').update({ usage_count: userData.usage_count + 1 }).ilike('email', cleanEmail);
        }

        return res.status(200).json({ 
            results: JSON.parse(resultText), 
            remaining: isPro ? 999 : (userData['Monthly Limit'] - (userData.usage_count + 1)),
            plan: currentPlan
        });

    } catch (error) {
        console.error("Studio Error:", error);
        return res.status(500).json({ error: "System snag. Please refresh and try 1 platform." });
    }
}
