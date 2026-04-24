import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from "@google/generative-ai";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { email, content, tone, platforms } = req.body;

  try {
    // 1. Database Check (Atomic increment/limit check)
    const { data: user, error } = await supabase
      .from('user_usage')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user || user.usage_count >= user['Monthly Limit']) {
      return res.status(403).json({ error: 'Credit limit reached or user not found.' });
    }

    // 2. AI Generation
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `Generate social media content for these platforms: ${platforms}. 
                    Topic: ${content}. Tone: ${tone}. 
                    Return JSON only: {"POST_CONTENT": "the generated text with \\n for line breaks"}`;

    const result = await model.generateContent(prompt);
    const aiResponse = JSON.parse(result.response.text());

    // 3. Update Supabase (Increment usage)
    await supabase
      .from('user_usage')
      .update({ usage_count: user.usage_count + 1 })
      .eq('email', email);

    // 4. Fire-and-forget to Google Apps Script (Email Delivery)
    // We don't "await" this long if we want to stay under 10s, 
    // but a fetch here is usually fast enough.
    fetch(process.env.GOOGLE_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        customerEmail: email,
        content: aiResponse.POST_CONTENT
      })
    });

    // 5. Return to Frontend
    return res.status(200).json(aiResponse);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
