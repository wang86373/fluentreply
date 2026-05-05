exports.handler = async function (event) {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Method not allowed" })
      };
    }

    const { email, plan = "pro" } = JSON.parse(event.body || "{}");

    if (!email || !String(email).includes("@")) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing or invalid email" })
      };
    }

    const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;
    const SITE_URL = (process.env.SITE_URL || "").replace(/\/$/, "");

    if (!NOWPAYMENTS_API_KEY) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing NOWPAYMENTS_API_KEY" })
      };
    }

    if (!SITE_URL || !SITE_URL.startsWith("https://")) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Invalid SITE_URL" })
      };
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const selectedPlan = plan === "pro_plus" ? "pro_plus" : "pro";

    const priceAmount = selectedPlan === "pro_plus" ? 29 : 12;
    const planName = selectedPlan === "pro_plus" ? "FluentReply Pro+" : "FluentReply Pro";

    const orderId = `fluentreply_${selectedPlan}_${Date.now()}`;

    const response = await fetch("https://api.nowpayments.io/v1/invoice", {
      method: "POST",
      headers: {
        "x-api-key": NOWPAYMENTS_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        price_amount: priceAmount,
        price_currency: "usd",
        order_id: orderId,
        order_description: `${planName} | ${normalizedEmail}`,
        success_url: `${SITE_URL}/success.html?order_id=${orderId}&plan=${selectedPlan}`,
        cancel_url: SITE_URL,
        ipn_callback_url: `${SITE_URL}/.netlify/functions/payment-webhook`
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: data.message || "Payment creation failed",
          detail: data
        })
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invoice_url: data.invoice_url,
        order_id: orderId,
        plan: selectedPlan,
        amount: priceAmount
      })
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Server error",
        detail: error.message
      })
    };
  }
};
