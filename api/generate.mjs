import { createClient } from '@supabase/supabase-js';

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { content, platforms, tone, email } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // 1. Check/Update Usage in Supabase
    let { data: user, error: fetchError } = await supabase
      .from('user_usage')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .single();

    // If user doesn't exist, create them
    if (!user) {
      const { data: newUser, error: insertError } = await supabase
        .from('user_usage')
        .insert([{ 
          email: email.toLowerCase().trim(), 
          usage_count: 0, 
          max_limit: 100 
        }])
        .select()
        .single();
      
      if (insertError) throw insertError;
      user = newUser;
    }

    // Check limits
    if (user.usage_count >= user.max_limit) {
      return res.status(403).json({ error: "Limit reached." });
    }

    // 2. Call Gemini 3 Flash
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
    
    const systemInstruction = `Act as a master content strategist. Your tone is: "${tone}". 
    REQUIRED: You must generate repurposed content for these specific platforms: ${platforms.join(', ')}. 
    
    For each platform, provide:
    - POST_CONTENT: The main body text.
    - STRATEGIC_HASHTAGS: Relevant tags.
    - CALL_TO_ACTION: An engaging closing line.
    
    CRITICAL: Return the response as a SINGLE JSON object where the keys are the platform names. Do not include any markdown formatting like \`\`\`json.`;

    const aiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ 
          parts: [{ text: systemInstruction + `\n\nInput Source Content: "${content}"` }] 
        }],
        generationConfig: { 
          responseMimeType: "application/json", 
          temperature: 0.7 
        }
      })
    });

    const data = await aiResponse.json();
    
    if (!data.candidates || !data.candidates[0].content.parts[0].text) {
      console.error("Gemini Error:", data);
      return res.status(500).json({ error: "AI failed to generate content." });
    }

    const resultText = data.candidates[0].content.parts[0].text;
    
    // 3. Update usage count in Supabase
    const newCount = user.usage_count + 1;
    const { error: updateError } = await supabase
      .from('user_usage')
      .update({ usage_count: newCount })
      .eq('email', email.toLowerCase().trim());

    if (updateError) console.error("Supabase Update Error:", updateError);

    // 4. Return results and remaining credits
    return res.status(200).json({ 
      results: JSON.parse(resultText), 
      remaining: user.max_limit - newCount 
    });

  } catch (error) {
    console.error("Internal Server Error:", error);
    return res.status(500).json({ 
      error: "Studio error.", 
      message: error.message 
    });
  }
}
