const crypto = require("crypto");

function sortObject(obj) {
  return Object.keys(obj).sort().reduce((result, key) => {
    result[key] =
      obj[key] && typeof obj[key] === "object" && !Array.isArray(obj[key])
        ? sortObject(obj[key])
        : obj[key];
    return result;
  }, {});
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

async function supabaseRequest(path, options = {}) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
      ...(options.headers || {})
    }
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    const secret = process.env.NOWPAYMENTS_IPN_SECRET;
    if (!secret) {
      return json(500, { error: "Missing NOWPAYMENTS_IPN_SECRET" });
    }

    const receivedSig =
      event.headers["x-nowpayments-sig"] ||
      event.headers["X-Nowpayments-Sig"] ||
      event.headers["X-NOWPAYMENTS-SIG"];

    if (!receivedSig) {
      return json(401, { error: "Missing NOWPayments signature" });
    }

    const body = JSON.parse(event.body || "{}");

    const hmac = crypto.createHmac("sha512", secret.trim());
    hmac.update(JSON.stringify(sortObject(body)));
    const calculatedSig = hmac.digest("hex");

    if (calculatedSig !== receivedSig) {
      return json(401, { error: "Invalid signature" });
    }

    const status = body.payment_status || "";
    const orderId = body.order_id || "";
    const paymentId = body.payment_id ? String(body.payment_id) : "";
    const amount = Number(body.price_amount || body.actually_paid || 0);
    const currency = body.price_currency || body.pay_currency || "usd";

    const email =
      body.order_description?.split("|")[1]?.trim()?.toLowerCase() || "";

    await supabaseRequest("payments", {
      method: "POST",
      body: JSON.stringify({
        email,
        order_id: orderId,
        payment_id: paymentId,
        amount,
        currency,
        status,
        raw: body,
        updated_at: new Date().toISOString()
      }),
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation"
      }
    });

    if ((status === "finished" || status === "confirmed") && email) {
      const proUntil = new Date();
      proUntil.setMonth(proUntil.getMonth() + 1);

      await supabaseRequest("profiles", {
        method: "POST",
        body: JSON.stringify({
          email,
          is_pro: true,
          plan: "pro",
          pro_until: proUntil.toISOString(),
          updated_at: new Date().toISOString()
        }),
        headers: {
          Prefer: "resolution=merge-duplicates,return=representation"
        }
      });
    }

    return json(200, { ok: true });

  } catch (error) {
    console.error("payment-webhook error:", error);
    return json(500, { error: "Webhook error", detail: error.message });
  }
};
