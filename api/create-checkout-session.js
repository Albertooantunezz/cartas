import Stripe from "stripe";
import { db, auth } from "./_lib/firebaseAdmin.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ⚠️ Igualamos los tramos al UI de tu Carrito.jsx para evitar descuadres.
// (>=50 → 0.75€; >=40 → 1.00€; >=9 → 1.50€; resto → 2.00€) :contentReference[oaicite:2]{index=2}
function unitPriceEURFromQty(total) {
  if (total >= 50) return 0.75;
  if (total >= 40) return 1.0;
  if (total >= 9) return 1.5;
  return 2.0;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // 1) Verifica el ID token de Firebase enviado por el cliente
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: "Missing Firebase ID token" });

    const decoded = await auth.verifyIdToken(idToken);
    const uid = decoded.uid;

    // 2) Lee el carrito del usuario en Firestore (ordenado)
    const snap = await db.collection("users").doc(uid).collection("cart").orderBy("createdAt", "asc").get();
    if (snap.empty) return res.status(400).json({ error: "El carrito está vacío" });

    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const totalQty = items.reduce((s, it) => s + (it.qty || 0), 0);
    const unitEUR = unitPriceEURFromQty(totalQty);

    // 3) Construye line_items con precio único por unidad (seguro)
    const line_items = items.map((it) => ({
      price_data: {
        currency: "eur",
        unit_amount: Math.round(unitEUR * 100),
        product_data: {
          name: `${it.name} · ${it.set || ""} #${it.collector_number || ""}`.trim(),
          images: it.image ? [it.image] : undefined,
          metadata: {
            cardId: it.id,
            set: it.set || "",
            set_name: it.set_name || "",
            collector_number: String(it.collector_number || ""),
          },
        },
      },
      quantity: it.qty || 1,
    }));

    // 4) Origin seguro para success/cancel (sirve en local/preview/prod)
    const origin =
      req.headers.origin ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : process.env.FRONTEND_URL || "http://localhost:5173");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items,
      allow_promotion_codes: true,
      success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/checkout/cancel`,
      metadata: { uid, totalQty: String(totalQty), unitEUR: String(unitEUR) },
      customer_email: decoded.email || undefined,
    });

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error("create-checkout-session error", e);
    return res.status(500).json({ error: "No se pudo crear la sesión" });
  }
}
