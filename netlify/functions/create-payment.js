exports.handler = async (event) => {
  try {
    const { email } = JSON.parse(event.body);

    const response = await fetch("https://api.nowpayments.io/v1/payment", {
      method: "POST",
      headers: {
        "x-api-key": process.env.NOWPAYMENTS_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        price_amount: 10,
        price_currency: "usd",
        pay_currency: "usdttrc20",
        order_id: Date.now().toString(),
        order_description: "FluentReply Pro",
        success_url: process.env.SITE_URL,
        cancel_url: process.env.SITE_URL
      })
    });

    const data = await response.json();

    return {
      statusCode: 200,
      body: JSON.stringify(data)
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
