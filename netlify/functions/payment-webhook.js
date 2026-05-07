const crypto = require("crypto");

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: "Method Not Allowed"
      };
    }

    const secret = process.env.NOWPAYMENTS_IPN_SECRET;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!secret || !SUPABASE_URL || !SERVICE_KEY) {
      return {
        statusCode: 500,
        body: "Missing server configuration"
      };
    }

    const signature =
      event.headers["x-nowpayments-sig"] ||
      event.headers["X-Nowpayments-Sig"];

    if (!signature) {
      return {
        statusCode: 401,
        body: "Missing signature"
      };
    }

    const expectedSignature = crypto
      .createHmac("sha512", secret)
      .update(event.body || "")
      .digest("hex");

    if (
  !crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  )
) {
      return {
        statusCode: 401,
        body: "Invalid signature"
      };
    }

    const body = JSON.parse(event.body || "{}");

    const validPaidStatuses = ["finished", "confirmed"];

    if (!validPaidStatuses.includes(body.payment_status)) {
      return {
        statusCode: 200,
        body: "Ignored"
      };
    }

    const rawDescription = body.order_description || "";
    const email = rawDescription.split("|")[1]?.trim()?.toLowerCase();

    if (!email || !email.includes("@")) {
      return {
        statusCode: 400,
        body: "Missing email"
      };
    }

    const orderId = String(body.order_id || "");
    const plan = orderId.includes("pro_plus") ? "pro_plus" : "pro";

    const proUntil = new Date();

    if (plan === "pro_plus") {
      proUntil.setMonth(proUntil.getMonth() + 1);
    } else {
      proUntil.setMonth(proUntil.getMonth() + 1);
    }

    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?on_conflict=email`,
      {
        method: "POST",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates"
        },
        body: JSON.stringify({
          email,
          is_pro: true,
          plan,
          pro_until: proUntil.toISOString(),
          updated_at: new Date().toISOString()
        })
      }
    );

    if (!profileRes.ok) {
      const detail = await profileRes.text();
      return {
        statusCode: 500,
        body: "Profile update failed: " + detail
      };
    }
const paymentId = String(
  body.payment_id || body.invoice_id || body.order_id
);

const existingPaymentRes = await fetch(
  `${SUPABASE_URL}/rest/v1/payments?payment_id=eq.${encodeURIComponent(paymentId)}`,
  {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`
    }
  }
);

const existingPayments = await existingPaymentRes.json();

if(existingPayments?.length){
  return {
    statusCode: 200,
    body: "Already processed"
  };
}
    const paymentPayload = {
      email,
      order_id: body.order_id,
      payment_id: paymentId,
      amount: body.price_amount,
      currency: body.price_currency,
      status: body.payment_status,
      plan,
      raw: body,
      created_at: new Date().toISOString()
    };

    const paymentRes = await fetch(`${SUPABASE_URL}/rest/v1/payments`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(paymentPayload)
    });

    if (!paymentRes.ok) {
      const detail = await paymentRes.text();
      console.log("Payment record failed:", detail);
    }

    return {
      statusCode: 200,
      body: "OK"
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: "Server error: " + err.message
    };
  }
};
