import Stripe from "stripe";
import getRawBody from "raw-body";
import { db } from "./_lib/firebaseAdmin.js";

export const config = { api: { bodyParser: false } }; // necesario

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  let event;
  try {
    const raw = await getRawBody(req);
    const sig = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("❌ Webhook signature verification failed", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const uid = session.metadata?.uid;
      if (!uid) throw new Error("UID ausente en metadata");

      // Line items (opcional, útil para snapshot)
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });

      const orderRef = db.collection("users").doc(uid).collection("orders").doc(session.id);
      const existing = await orderRef.get();
      if (!existing.exists) {
        await orderRef.set({
          createdAt: new Date(),
          stripeSessionId: session.id,
          payment_status: session.payment_status,
          amount_total: session.amount_total,
          currency: session.currency,
          unitEUR: Number(session.metadata?.unitEUR || 0),
          totalQty: Number(session.metadata?.totalQty || 0),
          items: lineItems.data.map(li => ({
            description: li.description,
            quantity: li.quantity,
            amount_subtotal: li.amount_subtotal,
            amount_total: li.amount_total,
            price: li.price?.id || null,
          })),
        });

        // Vaciar carrito
        const cartSnap = await db.collection("users").doc(uid).collection("cart").get();
        const batch = db.batch();
        cartSnap.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Error processing webhook:", err);
    res.status(500).send("Webhook handler failed");
  }
}
