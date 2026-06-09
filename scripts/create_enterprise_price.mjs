// Create the $599/mo Enterprise Stripe price on the same product as the
// existing Pro $299. Outputs the new price id so we can set it as
// STRIPE_ENTERPRISE_PRICE_ID in Vercel.

import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PRODUCT_ID = "prod_UFFbKoLj7TQkj3";

const existing = await stripe.prices.list({
  product: PRODUCT_ID,
  active: true,
  limit: 50,
});
const already = existing.data.find(
  (p) =>
    p.unit_amount === 59900 &&
    p.currency === "usd" &&
    p.recurring?.interval === "month"
);
if (already) {
  console.log("EXISTING_PRICE", already.id);
  process.exit(0);
}

const price = await stripe.prices.create({
  product: PRODUCT_ID,
  unit_amount: 59900,
  currency: "usd",
  recurring: { interval: "month" },
  nickname: "CIA Feeds — Enterprise $599/mo",
  metadata: { kind: "enterprise_subscription" },
});

console.log("CREATED_PRICE", price.id);
console.log(
  JSON.stringify(
    {
      id: price.id,
      unit_amount: price.unit_amount,
      recurring: price.recurring,
      active: price.active,
    },
    null,
    2
  )
);
