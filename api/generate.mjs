import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from "@google/generative-ai";

// 1. Initialize Clients
const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
  // CORS Headers (Crucial for Payhip)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { email, content, tone, platforms, lengthPreference } = req.body;

  try {
    // 2. Database Credit Check
    const { data: user, error } = await supabase
      .from('user_usage')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      return res.status(403).json({ error: 'Membership email not found.' });
    }
    
    const limit = parseInt(user['Monthly Limit']);
    const usage = parseInt(user.usage_count);

    if (usage >= limit) {
      return res.status(403).json({ error: 'Monthly credit limit reached.' });
    }

   // 3. Gemini 3 Generation (Updated Prompt for extra features)
    const model = genAI.getGenerativeModel({ 
      model: "gemini-3-flash-preview", 
      generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `Act as a professional content creator. Convert this text: "${content}" 
    into content for: ${platforms.join(', ')}. 
    Tone: ${tone}. Length: ${lengthPreference}.
    
    STRICT JSON OUTPUT FORMAT:
    {
      "results": {
        "Platform_Name": {
          "Hook": "Catchy first line",
          "Caption": "Main body text content",
          "CTA": "High-engaging Call to Action",
          "Hashtags": "Trending, relevant hashtags (OMIT for Newsletter)",
          "Image_Suggestion": "Descriptive prompt for a visual (OMIT for Newsletter)",
          "Subject_Line": "Compelling subject wording (ONLY for Newsletter)"
        }
      }
    }

    Note: Use \\n for line breaks. Ensure the Newsletter version feels personal and deep.`;

    const result = await model.generateContent(prompt);
    const aiData = JSON.parse(result.response.text());

    // 4. Update Database (Increment)
    const newCount = usage + 1;
    await supabase.from('user_usage')
      .update({ usage_count: newCount, last_used: new Date().toISOString() })
      .eq('email', email);

    // 5. Send Success Response
    return res.status(200).json({
      results: aiData.results,
      remaining: limit - newCount,
      plan: user['Membership Plan'] || 'Essential'
    });

  } catch (err) {
    console.error("Vercel Execution Error:", err);
    return res.status(500).json({ error: 'Studio error. Check console for model availability.' });
  }
}
