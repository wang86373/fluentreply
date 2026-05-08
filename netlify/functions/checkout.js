const Stripe = require("stripe");

const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

exports.handler = async function (event) {
  try {

    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: ""
      };
    }

    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: corsHeaders,
        body: "Method Not Allowed"
      };
    }

    const STRIPE_SECRET_KEY =
      process.env.STRIPE_SECRET_KEY;

    const STRIPE_PRICE_ID =
      process.env.STRIPE_PRICE_ID;

    const SITE_URL =
      process.env.SITE_URL;

    if (
      !STRIPE_SECRET_KEY ||
      !STRIPE_PRICE_ID ||
      !SITE_URL
    ) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Missing server configuration"
        })
      };
    }

    const stripe =
      new Stripe(STRIPE_SECRET_KEY);

    const body =
      JSON.parse(event.body || "{}");

    const email =
      (body.email || "")
      .trim()
      .toLowerCase();

    if (
      !email ||
      !email.includes("@")
    ) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Invalid email"
        })
      };
    }

    const session =
      await stripe.checkout.sessions.create({
        mode: "subscription",

        customer_email: email,

        line_items: [
          {
            price: STRIPE_PRICE_ID,
            quantity: 1
          }
        ],

        success_url:
          `${SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,

        cancel_url:
          `${SITE_URL}/`
      });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        url: session.url
      })
    };

    } catch (err) {
    console.log("ENV CHECK", {
      hasSecret: !!process.env.STRIPE_SECRET_KEY,
      hasPrice: !!process.env.STRIPE_PRICE_ID,
      priceId: process.env.STRIPE_PRICE_ID,
      hasSiteUrl: !!process.env.SITE_URL,
      siteUrl: process.env.SITE_URL
    });

    console.error("STRIPE ERROR:", err);

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Payment creation failed",
        message: err.message
      })
    };
  }
};
};
