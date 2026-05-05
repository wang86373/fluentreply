exports.handler = async function (event) {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Method not allowed" })
      };
    }

    const { email } = JSON.parse(event.body || "{}");

    if (!email) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing email" })
      };
    }

    const orderId = `fluentreply_${Date.now()}`;

    const response = await fetch("https://api.nowpayments.io/v1/invoice", {
      method: "POST",
      headers: {
        "x-api-key": process.env.NOWPAYMENTS_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        price_amount: 10,
        price_currency: "usd",
        order_id: orderId,
        order_description: `FluentReply Pro | ${email}`,
        success_url: `${process.env.SITE_URL}/success.html?order_id=${orderId}`,
        cancel_url: process.env.SITE_URL,
        ipn_callback_url: `${process.env.SITE_URL}/.netlify/functions/payment-webhook`
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: data.message || "NOWPayments invoice creation failed",
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
        raw: data
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
