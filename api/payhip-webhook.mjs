import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // Log the body so we can see it in Vercel if it fails again
  console.log("Webhook Received:", JSON.stringify(req.body));

  if (req.method !== 'POST') return res.status(405).end();

  // Payhip uses different keys for different types of sales
  const email = req.body.email || req.body.customer_email;
  const productName = req.body.product_name || req.body.plan_name || req.body.item_name;
  const type = req.body.type;

  // If we have an email and a product, we proceed
  if (email && productName) {
    let plan = "Essential";
    let limit = 20;

    // Search for "Professional" anywhere in the product title
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

    return res.status(200).json({ status: "Success", plan: plan });
  }

  return res.status(200).json({ status: "No valid data found in request" });
}
