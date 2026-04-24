import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from "@google/generative-ai";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { email, content, tone, platforms, lengthPreference } = req.body;

  try {
    // 1. Database Check
    const { data: user, error } = await supabase
      .from('user_usage')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) return res.status(403).json({ error: 'Membership email not found.' });
    
    const limit = parseInt(user['Monthly Limit']);
    const usage = parseInt(user.usage_count);

    if (usage >= limit) {
      return res.status(403).json({ error: 'Monthly credit limit reached.' });
    }

    // 2. AI Generation - Optimized for your Frontend's Object.entries logic
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `Act as a social media expert. Convert this text: "${content}" 
    into content for: ${platforms.join(', ')}. 
    Tone: ${tone}. Length: ${lengthPreference}.
    
    STRICT JSON OUTPUT FORMAT:
    {
      "results": {
        "Platform_Name": {
          "Caption": "text here",
          "Hook": "text here"
        }
      }
    }`;

    const result = await model.generateContent(prompt);
    const aiData = JSON.parse(result.response.text());

    // 3. Update Usage
    const newCount = usage + 1;
    await supabase.from('user_usage').update({ usage_count: newCount }).eq('email', email);

    // 4. Return to Frontend (Matches your script's expectations)
    return res.status(200).json({
      results: aiData.results,
      remaining: limit - newCount,
      plan: user['Membership Plan'] || 'Essential'
    });

  } catch (err) {
    console.error("Vercel Error:", err);
    return res.status(500).json({ error: 'Generation failed. Please try again.' });
  }
}
