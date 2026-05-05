const crypto = require("crypto");

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: "Method Not Allowed"
      };
    }

    const body = JSON.parse(event.body || "{}");

    console.log("Webhook received:", body);

    // 🔐 验证签名（安全关键）
    const secret = process.env.NOWPAYMENTS_IPN_SECRET;
    const signature = event.headers["x-nowpayments-sig"];

    const hmac = crypto.createHmac("sha512", secret);
    hmac.update(JSON.stringify(body));
    const expectedSignature = hmac.digest("hex");

    if (signature !== expectedSignature) {
      console.log("Invalid signature");
      return {
        statusCode: 401,
        body: "Invalid signature"
      };
    }

    // 🎯 只处理成功支付
    if (body.payment_status === "finished" || body.payment_status === "confirmed") {
      const email = body.order_description?.split("|")[1]?.trim();

      console.log("Payment success for:", email);

      const SUPABASE_URL = process.env.SUPABASE_URL;
      const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

      const proUntil = new Date();
      proUntil.setMonth(proUntil.getMonth() + 1);

      // 💾 更新用户为 Pro
      await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
        method: "POST",
        headers: {
          "apikey": SERVICE_KEY,
          "Authorization": `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "resolution=merge-duplicates"
        },
        body: JSON.stringify({
          email: email,
          is_pro: true,
          plan: "pro",
          pro_until: proUntil.toISOString(),
          updated_at: new Date().toISOString()
        })
      });

      // 💾 记录支付
      await fetch(`${SUPABASE_URL}/rest/v1/payments`, {
        method: "POST",
        headers: {
          "apikey": SERVICE_KEY,
          "Authorization": `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: email,
          order_id: body.order_id,
          payment_id: body.payment_id,
          amount: body.price_amount,
          currency: body.price_currency,
          status: body.payment_status,
          raw: body
        })
      });

      console.log("User upgraded to PRO:", email);
    }

    return {
      statusCode: 200,
      body: "OK"
    };

  } catch (err) {
    console.error("Webhook error:", err);

    return {
      statusCode: 500,
      body: "Server error"
    };
  }
};
