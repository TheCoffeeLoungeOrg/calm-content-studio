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
        let { data: userData } = await supabase.from('user_usage').select('*').ilike('email', cleanEmail).single();
        if (!userData) {
            const { data: newUser } = await supabase.from('user_usage').insert([{
                email: cleanEmail, usage_count: 0, 'Monthly Limit': 20, 'Membership Plan': 'Essential'
            }]).select().single();
            userData = newUser;
        }

        // 2. AI CALL (FORCED STABILITY)
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${process.env.GEMINI_API_KEY}`;
        
        const systemInstruction = `You are a Master Content Strategist. Tone: ${tone}. 
        Output ONLY a JSON object. No markdown. No backticks. 
        STRICT: Use single quotes (') for all speech. NEVER use double quotes (") inside a value. 
        Keys: ${platforms.join(', ')}. Use <br><br> for breaks.`;

        const aiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: systemInstruction + `\n\nMaterial: ${content}` }] }],
                generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
            })
        });

        const aiData = await aiResponse.json();
        let resultText = aiData.candidates[0].content.parts[0].text;

        // SANITIZE: This prevents the "Unterminated String" error by removing rogue newlines
        resultText = resultText.replace(/\n/g, " ").trim();

        // 3. UPDATE USAGE & RESPOND
        if (userData['Membership Plan'] !== 'Professional') {
            await supabase.from('user_usage').update({ usage_count: userData.usage_count + 1 }).ilike('email', cleanEmail);
        }

        return res.status(200).json({ 
            results: JSON.parse(resultText), 
            remaining: userData['Membership Plan'] === 'Professional' ? 999 : (userData['Monthly Limit'] - (userData.usage_count + 1)),
            plan: userData['Membership Plan']
        });

    } catch (error) {
        return res.status(500).json({ error: "The Studio is cooling down. Please try 1 platform in 30 seconds." });
    }
}
