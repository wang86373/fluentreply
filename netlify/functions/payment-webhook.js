const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

exports.handler = async function (event) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      event.headers["stripe-signature"],
      endpointSecret
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);

    return {
      statusCode: 400,
      body: `Webhook Error: ${err.message}`
    };
  }

  try {
    if (stripeEvent.type === "checkout.session.completed") {
      const session = stripeEvent.data.object;

      const email =
        session.customer_email ||
        session.customer_details?.email;

      if (!email) {
        return {
          statusCode: 400,
          body: "Missing customer email"
        };
      }

      const proUntil = new Date();
      proUntil.setMonth(proUntil.getMonth() + 1);

      const { error: profileError } = await supabase
        .from("profiles")
        .upsert(
          {
            email: email.toLowerCase(),
            is_pro: true,
            plan: "pro",
            pro_until: proUntil.toISOString(),
            usage_count: 0,
            updated_at: new Date().toISOString()
          },
          {
            onConflict: "email"
          }
        );

      if (profileError) {
        console.error("Profile update failed:", profileError);

        return {
          statusCode: 500,
          body: "Profile update failed"
        };
      }

      const { error: paymentError } = await supabase
        .from("payments")
        .insert({
          email: email.toLowerCase(),
          order_id: session.id,
          payment_id: session.payment_intent || session.subscription || session.id,
          amount: session.amount_total ? session.amount_total / 100 : null,
          currency: session.currency,
          status: "paid",
          plan: "pro",
          raw: session,
          created_at: new Date().toISOString()
        });

      if (paymentError) {
        console.error("Payment record failed:", paymentError);
      }
    }

    return {
      statusCode: 200,
      body: "OK"
    };
  } catch (err) {
    console.error("Webhook server error:", err);

    return {
      statusCode: 500,
      body: "Server error: " + err.message
    };
  }
};
