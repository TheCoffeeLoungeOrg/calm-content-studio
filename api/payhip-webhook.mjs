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
  let productName = data.product_name || data.plan_name || data.item_name;
  
  if (!productName && data.items && data.items.length > 0) {
    productName = data.items[0].product_name;
  }

  const type = data.type; 

  if (type === 'subscription.deleted' && email) {
      // NOTE: Using 'Membership Plan' and 'Monthly Limit' to match your generator script
      await supabase
        .from('user_usage')
        .update({ 'Monthly Limit': 0, 'Membership Plan': 'Cancelled' })
        .eq('email', email.toLowerCase().trim());
      
      return res.status(200).json({ status: "Subscription marked as inactive" });
  }

  if (!email || !productName) {
    return res.status(200).json({ status: "Ignored - Missing Data" });
  }

  try {
    let plan = "Professional";
    let limit = 999;

    if (productName.toLowerCase().includes("essential")) {
      plan = "Essential";
      limit = 20;
    }

    // --- THE FIX AREA ---
    // Make sure these keys match your Supabase column names EXACTLY.
    // Based on your generator script, they should be:
    // 'Membership Plan' and 'Monthly Limit'
    const { error } = await supabase
      .from('user_usage')
      .upsert({ 
        email: email.toLowerCase().trim(), 
        'Membership Plan': plan, 
        'Monthly Limit': limit,
        usage_count: 0 
      }, { onConflict: 'email' });

    if (error) {
      console.error("Supabase Error details:", error);
      return res.status(500).json({ error: error.message });
    }

    console.log(`--- SUCCESS: ${email} added to ${plan} ---`);
    return res.status(200).json({ status: "Success" });

  } catch (err) {
    console.error("Critical Failure:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
