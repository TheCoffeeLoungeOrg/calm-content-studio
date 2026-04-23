import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Payhip sends data in the body
  const { email, product_name, type } = req.body;

  // We only care about new paid members
  if (type === 'membership.created' || type === 'sale.finished') {
    
    // Determine plan details based on product name
    let plan = "Essential";
    let limit = 20;

    if (product_name.includes("Professional")) {
      plan = "Professional";
      limit = 999;
    }

    // Upsert into Supabase (Update if exists, Insert if new)
    const { error } = await supabase
      .from('user_usage')
      .upsert({ 
        email: email.toLowerCase().trim(), 
        membership_plan: plan, 
        monthly_limit: limit,
        usage_count: 0 // Reset usage for new/renewing members
      }, { onConflict: 'email' });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ status: "Member added successfully" });
  }

  return res.status(200).json({ status: "Ignored event type" });
}
