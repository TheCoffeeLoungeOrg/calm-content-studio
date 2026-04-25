import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  console.log("--- PAYHIP WEBHOOK START ---");

  if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

  const data = req.body;
  
  // 1. Find the Email
  const email = data.email || data.customer_email || data.subscriber_email || (data.customer && data.customer.email);
  
  // 2. Find the Product Name (Now checking the 'items' array)
  let productName = data.product_name || data.plan_name || data.item_name;
  
  if (!productName && data.items && data.items.length > 0) {
    productName = data.items[0].product_name; // This catches "Calm Content Hub"
  }

  const type = data.type; 

  console.log("Signal Received:", type);
  console.log("Email Found:", email);
  console.log("Product Found:", productName);

  // Handle Cancellations
  if (type === 'subscription.deleted' && email) {
      await supabase
        .from('user_usage')
        .update({ monthly_limit: 0, membership_plan: 'Cancelled' })
        .eq('email', email.toLowerCase().trim());
      
      return res.status(200).json({ status: "Subscription marked as inactive" });
  }

  // Safety Check
  if (!email || !productName) {
    console.log("Payload Error: Data structure still not matching. Body:", JSON.stringify(data));
    return res.status(200).json({ status: "Ignored - Missing Data" });
  }

  try {
    // Default to Professional since your test product is "Calm Content Hub"
    // You can adjust this logic if you have multiple products
    let plan = "Professional";
    let limit = 999;

    // Optional: If you ever add an 'Essential' product, use this:
    if (productName.toLowerCase().includes("essential")) {
      plan = "Essential";
      limit = 20;
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
