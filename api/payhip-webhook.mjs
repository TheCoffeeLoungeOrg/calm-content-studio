import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  console.log("--- PAYHIP WEBHOOK START ---");
  if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

  const data = req.body;
  const email = data.email || data.customer_email || data.subscriber_email || (data.customer && data.customer.email);
  
  // The IDs from your checkout URLs
  const ESSENTIAL_ID = "qLWxEKqxzk";
  const PROFESSIONAL_ID = "APzD4y1LzE";
  
  // Payhip sends the ID in the pricing_plan_id field
  const planID = data.pricing_plan_id || ""; 
  
  console.log("Incoming Email:", email);
  console.log("Incoming Plan ID:", planID);

  // 1. Handle Cancellations
  if (data.type === 'subscription.deleted' && email) {
      await supabase.from('user_usage')
        .update({ 'Monthly Limit': 0, 'Membership Plan': 'Cancelled' })
        .eq('email', email.toLowerCase().trim());
      return res.status(200).json({ status: "Cancelled" });
  }

  if (!email) return res.status(200).json({ status: "No email found" });

  try {
    // 2. Logic based on specific IDs
    let plan = "Professional";
    let limit = 999;

    if (planID === ESSENTIAL_ID) {
      plan = "Essential";
      limit = 20;
    } else if (planID === PROFESSIONAL_ID) {
      plan = "Professional";
      limit = 999;
    } else {
      // Fallback: If for some reason the ID is missing, check the name
      const name = (data.plan_name || "").toLowerCase();
      if (name.includes("essential")) {
        plan = "Essential";
        limit = 20;
      }
    }

    console.log(`Final Decision: Mapping ID ${planID} to ${plan} tier.`);

    const { error } = await supabase
      .from('user_usage')
      .upsert({ 
        email: email.toLowerCase().trim(), 
        'Membership Plan': plan, 
        'Monthly Limit': limit,
        usage_count: 0 
      }, { onConflict: 'email' });

    if (error) {
      console.error("Supabase Error:", error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ status: "Success", plan: plan });

  } catch (err) {
    return res.status(500).json({ error: "Internal Error" });
  }
}
