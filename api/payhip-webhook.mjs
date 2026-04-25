import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // These logs will help us find the data Payhip is sending
  console.log("--- WEBHOOK START ---");
  console.log("Method:", req.method);
  console.log("Body Content:", JSON.stringify(req.body));

  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Method not allowed" });
  }

 // Payhip sends different fields based on the event type
  // A wider net to catch the email and product name
  const email = req.body.email || req.body.customer_email || req.body.subscriber_email;
  const productName = req.body.product_name || req.body.plan_name || req.body.item_name || req.body.subscription_name;

  if (!email || !productName) {
    console.log("MISSING DATA: Email or Product Name not found in body");
    return res.status(200).json({ status: "Incomplete data ignored" });
  }

  if (!email || !productName) {
    console.log("MISSING DATA: Email or Product Name not found in body");
    return res.status(200).json({ status: "Incomplete data ignored" });
  }

  try {
    let plan = "Essential";
    let limit = 20;

    // Check for "Professional" in the name
    if (productName.toLowerCase().includes("professional")) {
      plan = "Professional";
      limit = 999;
    }

    console.log(`Processing ${plan} for ${email}`);

    const { error } = await supabase
  .from('user_usage') // <--- Make sure this matches your table name exactly
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
    console.log(`✅ DATABASE UPDATED: ${email} is now ${plan}`);

    console.log("--- WEBHOOK SUCCESS ---");
    return res.status(200).json({ status: "Success", plan: plan });

  } catch (err) {
    console.error("Critical Webhook Failure:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
