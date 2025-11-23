import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { auth, db } from "../firebase";
import {
  onAuthStateChanged,
} from "firebase/auth";
import {
  collection,
  query,
  where,
  limit,
  getDocs,
  onSnapshot,
  doc,
  getDocsFromCache,
  serverTimestamp,
  writeBatch,
  addDoc,
  orderBy,
} from "firebase/firestore";

/**
 * Reglas de precio por volumen (EUR por carta):
 *  ≤ 8   → 2.00
 *  ≥ 20  → 1.50
 *  ≥ 40  → 1.00
 *  ≥ 50  → 0.75
 */
function computeTierPricing(totalQty) {
  if (totalQty >= 50) return { unit: 0.75, tier: "≥50" };
  if (totalQty >= 40) return { unit: 1.0, tier: "≥40" };
  if (totalQty >= 20) return { unit: 1.5, tier: "≥20" };
  return { unit: 2.0, tier: "≤8" };
}

export default function CheckoutSuccess() {
  const [search] = useSearchParams();
  const sessionId = search.get("session_id") || "";
  const [user, setUser] = useState(null);

  // UI state
  const [status, setStatus] = useState("checking"); // checking | finalizing | success | error
  const [message, setMessage] = useState("Confirmando tu pago…");
  const [order, setOrder] = useState(null);

  // 1) Observa la sesión de usuario
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return () => unsub();
  }, []);

  // 2) Suscríbete al pedido por sessionId (si el webhook ya lo creó, lo veremos enseguida)
  useEffect(() => {
    if (!user || !sessionId) return;

    const ordersRef = collection(db, "users", user.uid, "orders");
    const q = query(ordersRef, where("checkoutSessionId", "==", sessionId), limit(1));

    // Escucha en tiempo real por si el webhook lo crea unos ms después
    const unsub = onSnapshot(q, (snap) => {
      if (!snap.empty) {
        const docSnap = snap.docs[0];
        const data = { id: docSnap.id, ...docSnap.data() };
        setOrder(data);
        setStatus("success");
        setMessage("¡Pago confirmado!");
      }
    });

    return () => unsub();
  }, [user, sessionId]);

  // 3) Fallback: si tras ~2.4s no hay pedido, lo finalizamos desde el cliente:
  //    - Lee carrito
  //    - Calcula total por volumen
  //    - Crea pedido con checkoutSessionId
  //    - Vacía carrito
  useEffect(() => {
    if (!user || !sessionId) return;
    if (order) return; // ya encontrado por webhook

    let timeout = setTimeout(async () => {
      try {
        setStatus("finalizing");
        setMessage("Terminando de registrar tu pedido…");

        // Evita duplicados: mira de nuevo si existe el pedido antes de crear nada
        const existRef = collection(db, "users", user.uid, "orders");
        const existQ = query(existRef, where("checkoutSessionId", "==", sessionId), limit(1));
        const exist = await getDocs(existQ);
        if (!exist.empty) {
          const docSnap = exist.docs[0];
          const data = { id: docSnap.id, ...docSnap.data() };
          setOrder(data);
          setStatus("success");
          setMessage("¡Pago confirmado!");
          return;
        }

        // Lee carrito actual
        const cartRef = collection(db, "users", user.uid, "cart");
        // Ordenar no es crítico aquí; leemos todos
        const cartSnap = await getDocs(cartRef);
        const items = [];
        let totalQty = 0;

        cartSnap.forEach((d) => {
          const it = { id: d.id, ...d.data() };
          const qty = Number(it.qty || 0);
          if (qty > 0) {
            items.push({
              cardId: it.id,
              name: it.name,
              set: it.set,
              set_name: it.set_name,
              collector_number: it.collector_number,
              qty,
              // Precio referencia por carta (si quieres guardarlo), aunque el total final usa el tier global:
              eurRef: typeof it.eur === "number" ? it.eur : null,
            });
            totalQty += qty;
          }
        });

        // Si el carrito está vacío, asumimos que el webhook ya vació todo:
        if (totalQty === 0) {
          setStatus("success");
          setMessage("¡Pago confirmado!");
          // Intento de recuperar el último pedido reciente (opcional)
          const recentQ = query(
            collection(db, "users", user.uid, "orders"),
            orderBy("createdAt", "desc"),
            limit(1)
          );
          const recent = await getDocs(recentQ);
          if (!recent.empty) {
            const d0 = recent.docs[0];
            setOrder({ id: d0.id, ...d0.data() });
          }
          return;
        }

        const { unit, tier } = computeTierPricing(totalQty);
        const totalEUR = Number((unit * totalQty).toFixed(2));

        // Escribe pedido + vacía carrito con batch idempotente
        const batch = writeBatch(db);

        // Crea pedido
        const newOrderRef = collection(db, "users", user.uid, "orders");
        const newOrder = {
          createdAt: serverTimestamp(),
          status: "paid",
          totalEUR,
          totalQty,
          unitPrice: unit,
          tier, // "≤8" | "≥20" | "≥40" | "≥50"
          items,
          checkoutSessionId: sessionId,
          source: "success-fallback", // útil para auditar si vino del fallback
        };
        const orderDocRef = await addDoc(newOrderRef, newOrder);

        // Vacía carrito
        cartSnap.forEach((d) => batch.delete(doc(db, "users", user.uid, "cart", d.id)));
        await batch.commit();

        // Termina UI
        setOrder({ id: orderDocRef.id, ...newOrder });
        setStatus("success");
        setMessage("¡Pedido creado y carrito vaciado!");
      } catch (e) {
        console.error(e);
        setStatus("error");
        setMessage("Tu pago se confirmó, pero hubo un problema al registrar el pedido. Puedes reintentar.");
      }
    }, 2400);

    return () => clearTimeout(timeout);
  }, [user, sessionId, order]);

  // 4) Render
  if (!sessionId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 50%, #0f0f0f 100%)' }}>
        <div className="max-w-lg w-full bg-[#141414] border border-red-500/30 rounded-2xl shadow-2xl p-6 text-center">
          <h1 className="text-xl font-bold text-red-500">Falta session_id</h1>
          <p className="text-gray-400 mt-1">Vuelve al carrito e inicia el pago de nuevo.</p>
          <div className="mt-6">
            <Link to="/carrito" className="inline-block px-6 py-2 rounded-xl font-bold text-white transition-all duration-300 hover:scale-105"
              style={{
                background: 'linear-gradient(135deg, #242424 0%, #333 100%)',
                border: '1px solid rgba(255,255,255,0.1)'
              }}>
              Volver al carrito
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const isLoading = status === "checking" || status === "finalizing";

  return (
    <div className="min-h-screen p-4 text-white flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 50%, #0f0f0f 100%)' }}>
      <div className="w-full max-w-3xl">
        <div className="bg-[#141414] border border-[#0cd806]/20 rounded-2xl shadow-[0_0_40px_rgba(12,216,6,0.1)] overflow-hidden backdrop-blur-sm">
          <div className="p-8 border-b border-gray-800">
            <div className="flex items-start gap-4">
              <div className={`shrink-0 h-12 w-12 rounded-full flex items-center justify-center ${status === "success" ? "bg-[#0cd806]/20 text-[#0cd806]" : status === "error" ? "bg-red-500/20 text-red-500" : "bg-yellow-500/20 text-yellow-500"}`}>
                <span className="text-2xl font-bold">
                  {status === "success" ? "✓" : status === "error" ? "!" : "…"}
                </span>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">
                  {status === "success" ? "¡Pago completado!" : status === "error" ? "Incidencia al registrar el pedido" : "Confirmando tu pago…"}
                </h1>
                <p className="text-gray-400 mt-2">{message}</p>
                <p className="text-xs text-gray-600 mt-2 font-mono">session_id: <code className="break-all">{sessionId}</code></p>
              </div>
            </div>
          </div>

          <div className="p-8">
            {/* Resumen del pedido */}
            {order ? (
              <div className="space-y-6">
                <div className="flex items-center justify-between bg-[#1a1a1a] p-4 rounded-xl border border-gray-800">
                  <div>
                    <div className="text-sm text-gray-500">Nº de pedido</div>
                    <div className="font-mono text-[#0cd806] text-lg">#{order.id?.slice?.(-6)?.toUpperCase?.() || "—"}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-gray-500">Total</div>
                    <div className="text-2xl font-bold text-white">{typeof order.totalEUR === "number" ? `${order.totalEUR.toFixed(2)} €` : "—"}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="rounded-xl border border-gray-800 bg-[#1a1a1a] p-4">
                    <div className="text-xs text-gray-500 uppercase tracking-wider">Estado</div>
                    <div className="font-medium text-white mt-1 capitalize">{order.status || "paid"}</div>
                  </div>
                  <div className="rounded-xl border border-gray-800 bg-[#1a1a1a] p-4">
                    <div className="text-xs text-gray-500 uppercase tracking-wider">Unidades</div>
                    <div className="font-medium text-white mt-1">{order.totalQty || (order.items?.reduce?.((s, i) => s + (i.qty || 0), 0) || 0)}</div>
                  </div>
                </div>

                <div>
                  <h2 className="font-bold text-lg mb-4 text-white">Artículos</h2>
                  {order.items?.length ? (
                    <ul className="divide-y divide-gray-800 rounded-xl border border-gray-800 bg-[#1a1a1a] overflow-hidden">
                      {order.items.map((it, idx) => (
                        <li key={idx} className="p-4 flex items-center justify-between hover:bg-[#242424] transition-colors">
                          <div className="min-w-0 pr-4">
                            <div className="font-medium text-white truncate">{it.name}</div>
                            <div className="text-xs text-gray-500 truncate mt-0.5">{it.set_name || it.set} · #{it.collector_number || it.cardId}</div>
                          </div>
                          <div className="text-sm font-bold text-[#0cd806] whitespace-nowrap">x{it.qty}</div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-sm text-gray-500 italic">No hay items para mostrar.</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-gray-400 py-8 text-center">
                {isLoading ? (
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-2 border-[#0cd806] border-t-transparent rounded-full animate-spin"></div>
                    <span>Buscando tu pedido…</span>
                  </div>
                ) : "No encontramos el pedido todavía."}
              </div>
            )}

            {/* Acciones */}
            <div className="mt-8 flex flex-wrap gap-3 pt-6 border-t border-gray-800">
              <Link
                to="/catalogo"
                className="px-6 py-3 rounded-xl border border-gray-700 text-gray-300 hover:bg-[#242424] hover:text-white transition-colors font-medium"
              >
                Seguir comprando
              </Link>
              <Link
                to="/cuenta"
                className="px-6 py-3 rounded-xl font-bold text-white transition-all duration-300 hover:scale-105 shadow-lg hover:shadow-[#0cd806]/20"
                style={{
                  background: 'linear-gradient(135deg, #0cd806 0%, #09f202 100%)',
                }}
              >
                Ver mis pedidos
              </Link>

              {status === "error" && (
                <button
                  onClick={() => window.location.reload()}
                  className="px-6 py-3 rounded-xl bg-red-600 text-white hover:bg-red-500 transition-colors font-medium"
                >
                  Reintentar
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Nota de seguridad */}
        <p className="text-xs text-gray-500 mt-4 text-center">
          Si tu pedido no aparece al instante, puede tardar unos segundos en procesarse.
          Después lo verás también en <Link to="/cuenta" className="text-[#0cd806] hover:underline">Mi cuenta</Link>.
        </p>
      </div>
    </div>
  );
}
