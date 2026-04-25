import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  console.log("--- PAYHIP WEBHOOK START ---");

  if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

  const data = req.body;
  
  // 1. Find the Email (Checking all possible Payhip fields)
  const email = data.email || data.customer_email || data.subscriber_email || (data.customer && data.customer.email);
  
  // 2. Find the Product or Plan Name
  let productName = data.plan_name || data.product_name || data.item_name;
  
  if (!productName && data.items && data.items.length > 0) {
    productName = data.items[0].product_name;
  }

  const type = data.type; 

  console.log("Signal Received:", type);
  console.log("Email Found:", email);
  console.log("Product Found:", productName);

  // 3. Handle Subscription Cancellations
  if (type === 'subscription.deleted' && email) {
      console.log(`Processing Cancellation for ${email}`);
      await supabase
        .from('user_usage')
        .update({ 
          'Monthly Limit': 0, 
          'Membership Plan': 'Cancelled' 
        })
        .eq('email', email.toLowerCase().trim());
      
      return res.status(200).json({ status: "Subscription marked as inactive" });
  }

  // 4. Safety Check for New Sales
  if (!email || !productName) {
    console.log("Payload Error: Missing email or product name. Body:", JSON.stringify(data));
    return res.status(200).json({ status: "Ignored - Missing Data" });
  }

  try {
    // 5. Smart Plan Mapping
    // We check for "Essential" first, otherwise default to Professional
    let plan = "Professional";
    let limit = 999;

    if (productName.toLowerCase().includes("essential")) {
      plan = "Essential";
      limit = 20;
    }

    console.log(`Final Mapping: ${plan} (${limit} credits)`);

    // 6. Upsert to Supabase (Update if exists, Insert if new)
    const { error } = await supabase
      .from('user_usage')
      .upsert({ 
        email: email.toLowerCase().trim(), 
        'Membership Plan': plan, 
        'Monthly Limit': limit,
        usage_count: 0 
      }, { onConflict: 'email' });

    if (error) {
      console.error("Supabase Error Details:", error);
      return res.status(500).json({ error: error.message });
    }

    console.log(`--- SUCCESS: ${email} added to ${plan} ---`);
    return res.status(200).json({ status: "Success" });

  } catch (err) {
    console.error("Critical Webhook Failure:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
