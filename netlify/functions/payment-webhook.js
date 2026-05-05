exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body);

    // 只处理已付款
    if (body.payment_status === "finished") {
      const email = body.order_description;

      // 调用 Supabase
      await fetch(process.env.SUPABASE_URL + "/rest/v1/users", {
        method: "PATCH",
        headers: {
          "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          is_pro: true
        })
      });
    }

    return {
      statusCode: 200,
      body: "OK"
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: err.message
    };
  }
};
