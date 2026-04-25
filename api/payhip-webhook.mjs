import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  console.log("--- PAYHIP WEBHOOK START ---");

  if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

  // Payhip sends data in different formats. This catches them all.
  const data = req.body;
  
  // Payhip often uses these specific keys
  const email = data.email || data.customer_email || data.subscriber_email;
  const productName = data.product_name || data.plan_name || data.item_name;
  const type = data.type; // e.g., 'paid', 'subscription.deleted'

  console.log("Signal Received:", type);
  console.log("Email Found:", email);
  console.log("Product Found:", productName);

  // If it's a cancellation, we handle that differently
  if (type === 'subscription.deleted' && email) {
      console.log(`Processing Cancellation for ${email}`);
      await supabase
        .from('user_usage')
        .update({ monthly_limit: 0, membership_plan: 'Cancelled' })
        .eq('email', email.toLowerCase().trim());
      
      return res.status(200).json({ status: "Subscription marked as inactive" });
  }

  // If it's a sale, we need the email and product name
  if (!email || !productName) {
    console.log("Payload Error: Could not find email or product name in:", JSON.stringify(data));
    return res.status(200).json({ status: "Ignored - Missing Data" });
  }

  try {
    let plan = "Essential";
    let limit = 20;

    if (productName.toLowerCase().includes("professional")) {
      plan = "Professional";
      limit = 999;
    }

    const { error } = await supabase
      .from('user_usage')
      .upsert({ 
        email: email.toLowerCase().trim(), 
        membership_plan: plan, 
        monthly_limit: limit,
        usage_count: 0 
      }, { onConflict: 'email' });

    if (error) {
      console.error("Supabase Error:", error);
      return res.status(500).json({ error: error.message });
    }

    console.log(`--- SUCCESS: ${email} added to ${plan} ---`);
    return res.status(200).json({ status: "Success" });

  } catch (err) {
    console.error("Critical Failure:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
