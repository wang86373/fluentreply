exports.handler = async function (event) {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: "Method not allowed"
      };
    }

    const body = JSON.parse(event.body || "{}");

    console.log("NOWPayments webhook received:", body);

    if (body.payment_status === "finished" || body.payment_status === "confirmed") {
      const email = body.order_description?.split("|")[1]?.trim() || "";

      console.log("Payment success for:", email);

      /*
        下一步这里会接 Supabase：
        付款成功后，把用户 is_pro 改成 true。
      */
    }

    return {
      statusCode: 200,
      body: "OK"
    };

  } catch (error) {
    console.error("Webhook error:", error);

    return {
      statusCode: 500,
      body: "Webhook error"
    };
  }
};
