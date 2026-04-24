import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from "@google/generative-ai";

// Initialize Supabase with the exact key from your Vercel screenshot
const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
  // Set CORS headers for Payhip
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { email, content, tone, platforms, lengthPreference } = req.body;

  try {
    // 1. Fetch User Data
    const { data: user, error } = await supabase
      .from('user_usage')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      console.error("Supabase Lookup Error:", error);
      return res.status(403).json({ error: 'Membership email not found in our records.' });
    }
    
    // Note: JS uses bracket notation for column names with spaces
    const limit = parseInt(user['Monthly Limit'] || 0);
    const usage = parseInt(user['usage_count'] || 0);

    if (usage >= limit) {
      return res.status(403).json({ error: 'Monthly credit limit reached.' });
    }

    // 2. AI Generation
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `Act as a professional content strategist. 
    Topic: ${content}
    Tone: ${tone}
    Target Platforms: ${platforms.join(', ')}
    Length: ${lengthPreference}
    
    Return a JSON object where each key is the Platform name and each value is an object containing "Caption" and "Hook". Use \\n for line breaks.`;

    const result = await model.generateContent(prompt);
    const aiData = JSON.parse(result.response.text());

    // 3. Update Usage (Atomic Increment)
    const newCount = usage + 1;
    await supabase
      .from('user_usage')
      .update({ usage_count: newCount, last_used: new Date().toISOString() })
      .eq('email', email);

    // 4. Send Response to Payhip Frontend
    return res.status(200).json({
      results: aiData, // This sends the object directly to your loop
      remaining: limit - newCount,
      plan: user['Membership Plan'] || 'Essential'
    });

  } catch (err) {
    console.error("Server Error:", err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
