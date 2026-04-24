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
        Tone: ${tone}. Length: ${lengthInst}. Paragraph breaks: <br><br>.
        Output ONLY a JSON object. NO markdown, NO arrays.
        Keys MUST be exactly from this list: ${platforms.join(', ')}.
        If 'Newsletter' is selected, use keys: NEWSLETTER_SUBJECT, POST_CONTENT, CALL_TO_ACTION.
        For others, use: POST_CONTENT, VISUAL_SUGGESTION, STRATEGIC_HASHTAGS, CALL_TO_ACTION.`;

        const aiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: systemInstruction + `\n\nSource: ${content}` }] }],
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
            plan: userData['Membership Plan']
        });

    } catch (error) {
        console.error("Studio Error:", error);
        return res.status(500).json({ error: "System snag. Please refresh and try 1 platform." });
    }
}
