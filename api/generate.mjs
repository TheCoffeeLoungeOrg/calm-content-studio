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

        // 2. AI CALL (STRICT KEY MAPPING)
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${process.env.GEMINI_API_KEY}`;
        
        // We explicitly define the keys so the HTML can find them
        const systemInstruction = `You are a Master Content Strategist. 
        Tone: ${tone}. Output ONLY a JSON object.
        You MUST use this EXACT structure:
        {
          "POST_CONTENT": "Your main content here...",
          "VISUAL_SUGGESTION": "Image idea here...",
          "STRATEGIC_HASHTAGS": "#tags here...",
          "CALL_TO_ACTION": "Link or prompt here..."
        }
        STRICT: Do not add any other keys. Use <br><br> for breaks.`;

        const aiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: systemInstruction + `\n\nMaterial: ${content}` }] }],
                generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
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
