// Carrito.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useCart } from "../context/CartContext";
import ManaText from "../components/ManaText";
import { getAuth } from "firebase/auth"; // ya usas auth en otras vistas
import { db } from "../firebase";
import { doc, getDoc } from "firebase/firestore";
import SEO from "../components/SEO";



const SCRYFALL_API = "https://api.scryfall.com";

// ---------- Utils ----------
function getCardImage(c, size = "normal") {
  try {
    if (c?.image_uris?.[size]) return c.image_uris[size];
    if (Array.isArray(c?.card_faces) && c.card_faces[0]?.image_uris?.[size]) {
      return c.card_faces[0].image_uris[size];
    }
    if (c?.image_uris?.small) return c.image_uris.small;
    if (Array.isArray(c?.card_faces) && c.card_faces[0]?.image_uris?.small) {
      return c.card_faces[0].image_uris.small;
    }
  } catch { }
  return "";
}

function getCardIdFromItem(it) {
  if (!it) return null;
  if (it.card && typeof it.card === "object" && it.card.id) return it.card.id;
  if (typeof it.card === "string") return it.card;
  if (it.cardId) return it.cardId;
  if (it.scryfallId) return it.scryfallId;
  if (it.id && typeof it.id === "string" && it.id.length > 20) return it.id;
  return null;
}

export default function Carrito() {
  const cartCtx = useCart();
  const { add } = cartCtx;
  const remove = cartCtx.remove ?? cartCtx.removeItem ?? cartCtx.delete;
  const setQty = cartCtx.setQty ?? cartCtx.updateQty ?? cartCtx.setQuantity;
  const clear = cartCtx.clear ?? cartCtx.empty ?? cartCtx.reset;

  const items = cartCtx.items ?? cartCtx.cartItems ?? cartCtx.cart ?? [];

  // Mantiene "pegado" el nuevo id durante un instante tras el replace
  const [lastSwap, setLastSwap] = useState(null); // { newId: string, ts: number }
  // Mantiene posición mientras se actualiza cantidad
  const [lastQtyUpdate, setLastQtyUpdate] = useState(null); // { id, ts }



  // ---------- Normalización de items ----------
  const baseItems = useMemo(() => {
    if (Array.isArray(items)) return items;
    if (items && typeof items === "object") {
      return Object.entries(items)
        .map(([key, value]) => {
          if (value && typeof value === "object" && ("card" in value || "cardId" in value || "scryfallId" in value)) {
            return value;
          }
          if (value && typeof value === "object" && "qty" in value) {
            return { card: { id: key }, qty: value.qty };
          }
          if (typeof value === "number") {
            return { card: { id: key }, qty: value };
          }
          return null;
        })
        .filter(Boolean);
    }
    return [];
  }, [items]);

  // Mapa que memoriza el orden visual en el que se añadieron las cartas
  const [visualOrderMap, setVisualOrderMap] = useState({});

  useEffect(() => {
    setVisualOrderMap((prev) => {
      const next = { ...prev };
      let changed = false;

      for (let i = 0; i < baseItems.length; i++) {
        const id = baseItems[i]?.card?.id || getCardIdFromItem(baseItems[i]);
        if (id && !(id in next)) {
          next[id] = Object.keys(next).length; // fija posición incremental una sola vez
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [baseItems]);




  // ---------- Autocarga de cartas por ID ----------
  const [loadedCards, setLoadedCards] = useState({}); // id -> card

  const [isPaying, setIsPaying] = useState(false);

  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState(null); // { code, percent }
  const [couponError, setCouponError] = useState("");
  const [couponInfo, setCouponInfo] = useState("");
  const [checkingCoupon, setCheckingCoupon] = useState(false);


  useEffect(() => {
    const fetchMissingCards = async () => {
      const toLoad = [];
      for (const it of baseItems) {
        const id = getCardIdFromItem(it);
        const hasName = it?.card && typeof it.card === "object" && it.card.name;
        if (id && !hasName && !loadedCards[id]) toLoad.push(id);
      }
      if (!toLoad.length) return;

      for (const id of toLoad) {
        try {
          const res = await fetch(`${SCRYFALL_API}/cards/${id}`);
          if (res.ok) {
            const card = await res.json();
            setLoadedCards((prev) => ({ ...prev, [id]: card }));
          }
        } catch {
          // ignora errores individuales
        }
      }
    };
    fetchMissingCards();
  }, [baseItems, loadedCards]);



  // ---------- ORDEN ESTABLE ----------
  const [orderIds, setOrderIds] = useState([]); // ids en orden de inserción
  useEffect(() => {
    const currentIds = baseItems.map(getCardIdFromItem).filter(Boolean);

    setOrderIds((prev) => {
      // Copiamos los ids previos que siguen existiendo
      const keep = prev.filter((id) => currentIds.includes(id));

      // Añadimos los nuevos (sin duplicar)
      const newOnes = currentIds.filter((id) => !keep.includes(id));

      // 🔥 Fix: mantener el orden exacto en el que ya estaban, sin recolocar nada
      // Si una carta se elimina, simplemente desaparece, pero las demás NO cambian de posición
      // Si una carta cambia de qty, no afecta al orden
      return [...keep, ...newOnes];
    });
  }, [baseItems]);




  // ---------- Wrappers y estados de UX ----------
  const [optimisticQty, setOptimisticQty] = useState({}); // id -> qty mostrada mientras actualiza
  const [isClearing, setIsClearing] = useState(false);
  const [freezeView, setFreezeView] = useState(false);
  const [snapshotItems, setSnapshotItems] = useState([]); // copia de lo que se muestra durante "Vaciando..."

  const removeSafe = async (cardOrId) => {
    if (!remove) return;
    const id = typeof cardOrId === "string" ? cardOrId : cardOrId?.id;
    try {
      await remove(id);
    } catch {
      try { await remove(cardOrId); } catch { }
    }
    // Mantiene el resto del orden sin cambios
    setOrderIds((prev) => prev.filter((x) => x !== id));

    setVisualOrderMap((prev) => {
      if (!id || !(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });

  };



  // Cambio de cantidad sin parpadeos: optimista. Evita quitar/añadir salvo caso extremo.
  const changeQty = async (card, delta, currentQty) => {
    const id = card?.id;
    if (!id) return;
    const nextQty = Math.max(0, (currentQty || 0) + delta);

    // Pintado optimista
    setOptimisticQty((p) => ({ ...p, [id]: nextQty }));
    setLastQtyUpdate({ id, ts: Date.now() });


    try {
      if (setQty) {
        await setQty(id, nextQty);
      } else {
        // Si no hay setQty: para subir, intenta sumar con add; para bajar, último recurso remove+add.
        if (delta > 0) {
          await add?.(card, delta);
        } else {
          if (nextQty === 0) {
            await removeSafe(card);
          } else {
            // fallback sin parpadeo: primero añade el diff (si tu contexto no lo soporta, pasamos a remove+add)
            const diff = nextQty - (currentQty || 0);
            if (diff > 0) {
              await add?.(card, diff);
            } else {
              // no hay API para restar: remove + add(nextQty)
              await removeSafe(card);
              await add?.(card, nextQty);
            }
          }
        }
      }
    } finally {
      // Quitamos la marca optimista (el contexto ya debería tener la qty real)
      setTimeout(() => {
        setOptimisticQty((p) => {
          const c = { ...p };
          delete c[id];
          return c;
        });
      }, 0);
    }
  };

  // Vaciar de una: congelamos vista, mostramos "Vaciando..." y limpiamos de golpe
  const clearSafe = async () => {
    setFreezeView(true);
    setSnapshotItems(orderedItems); // lo que se ve ahora se queda congelado
    setIsClearing(true);
    try {
      try { await clear?.(); } catch { }
      const ids = baseItems.map(getCardIdFromItem).filter(Boolean);
      await Promise.all(ids.map((id) => removeSafe(id))); // en paralelo
      setOrderIds([]); // resetea orden
    } finally {
      setIsClearing(false);
      setFreezeView(false);
    }
  };

  // ---------- Derivados para render ----------
  const [query, setQuery] = useState("");

  const normalizedItems = useMemo(() => {
    return baseItems.map((it) => {
      const id = getCardIdFromItem(it);
      let card = it.card;
      if ((!card || !card.name) && id && loadedCards[id]) {
        card = loadedCards[id];
      }
      return { card, qty: it.qty, _idGuess: id, _raw: it };
    });
  }, [baseItems, loadedCards]);

  // Ordenamos según orderIds (estable)
  const orderedItems = useMemo(() => {
    const idx = (id) => {
      const i = orderIds.indexOf(id);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return normalizedItems
      .slice()
      .sort((a, b) => idx(a._idGuess || a.card?.id) - idx(b._idGuess || b.card?.id));
  }, [normalizedItems, orderIds]);

  // Filtro respetando el orden
  const filteredItems = useMemo(() => {
    const base = freezeView ? snapshotItems : orderedItems;
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter(({ card }) => {
      const name = (card?.name || "").toLowerCase();
      const setName = (card?.set_name || "").toLowerCase();
      const setCode = (card?.set || "").toLowerCase();
      return name.includes(q) || setName.includes(q) || setCode.includes(q);
    });
  }, [orderedItems, snapshotItems, freezeView, query]);

  const totalUnits = useMemo(
    () => orderedItems.reduce((s, it) => s + (it.qty || 0), 0),
    [orderedItems]
  );

  const unitPrice = useMemo(() => {
    if (totalUnits >= 50) return 0.75;
    if (totalUnits >= 40) return 1.0;
    if (totalUnits >= 9) return 1.5;
    return 2.0;
  }, [totalUnits]);

  const subtotal = useMemo(() => totalUnits * unitPrice, [totalUnits, unitPrice]);

  const discountPercent = appliedCoupon?.percent || 0;

  const discountAmount = useMemo(() => {
    if (!discountPercent) return 0;
    return subtotal * (discountPercent / 100);
  }, [subtotal, discountPercent]);

  const totalWithDiscount = useMemo(
    () => Math.max(0, subtotal - discountAmount),
    [subtotal, discountAmount]
  );


  // ---------- Diálogo de estilos (prints) ----------
  const [printsOpen, setPrintsOpen] = useState(false);
  const [printsLoading, setPrintsLoading] = useState(false);
  const [printsError, setPrintsError] = useState("");
  const [prints, setPrints] = useState([]);
  const [printsNext, setPrintsNext] = useState(null);
  const [printsCard, setPrintsCard] = useState(null); // { card, qty }

  const openPrintsFor = async (normItem) => {
    setPrintsError("");
    setPrints([]);
    setPrintsNext(null);

    // Asegura tener carta completa (si solo teníamos id, la pedimos)
    let card = normItem?.card;
    const idGuess = normItem?._idGuess;
    if ((!card || !card.oracle_id) && idGuess) {
      try {
        const res = await fetch(`${SCRYFALL_API}/cards/${idGuess}`);
        if (res.ok) {
          card = await res.json();
          setLoadedCards((prev) => ({ ...prev, [idGuess]: card }));
        }
      } catch { }
    }

    if (!card?.oracle_id) {
      setPrintsCard(normItem);
      setPrintsOpen(true);
      setPrintsError("No se puede cargar estilos para esta carta.");
      return;
    }

    setPrintsCard({ card, qty: normItem.qty });
    setPrintsOpen(true);
    setPrintsLoading(true);
    try {
      const url = `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(
        `oracleid:${card.oracle_id}`
      )}&unique=prints&order=released`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("No se pudieron cargar los estilos.");
      const data = await res.json();
      setPrints(data.data || []);
      setPrintsNext(data.has_more ? data.next_page : null);
    } catch (e) {
      setPrintsError(e.message || "Error al cargar estilos.");
    } finally {
      setPrintsLoading(false);
    }
  };

  const loadMorePrints = async () => {
    if (!printsNext) return;
    setPrintsLoading(true);
    setPrintsError("");
    try {
      const res = await fetch(printsNext);
      if (!res.ok) throw new Error("No se pudieron cargar más estilos.");
      const data = await res.json();
      setPrints((prev) => [...prev, ...(data.data || [])]);
      setPrintsNext(data.has_more ? data.next_page : null);
    } catch (e) {
      setPrintsError(e.message || "Error al cargar más estilos.");
    } finally {
      setPrintsLoading(false);
    }
  };

  const replaceCartItemWithPrint = async (newCard) => {
    if (!printsCard?.card?.id || !newCard?.id) return;
    const oldCard = printsCard.card;
    const qty = printsCard.qty || 1;
    try {
      // Reemplaza el id en el mismo índice del array sin alterar el resto
      setOrderIds((prev) => {
        const next = [...prev];
        const i = next.indexOf(oldCard.id);
        if (i !== -1) next[i] = newCard.id;
        return next;
      });

      setVisualOrderMap((prev) => {
        const pos = prev[oldCard.id];
        if (pos === undefined) return prev;
        const next = { ...prev };
        delete next[oldCard.id];
        next[newCard.id] = pos; // misma posición para el nuevo id
        return next;
      });


      setLastSwap({ newId: newCard.id, ts: Date.now() });


      // Actualiza la carta real del carrito
      if (setQty) {
        await setQty(oldCard.id, 0);
        await add?.(newCard, qty);
      } else {
        await removeSafe(oldCard.id);
        await add?.(newCard, qty);
      }

      setPrintsOpen(false);
      setPrintsCard(null);
    } catch {
      setPrintsError("No se pudo actualizar la carta en el carrito.");
    }
  };

  const handleApplyCoupon = async () => {
    setCouponError("");
    setCouponInfo("");

    const raw = couponInput.trim();
    if (!raw) {
      setCouponError("Introduce un código.");
      return;
    }

    const code = raw.toUpperCase();

    // Si ya está aplicado ese mismo
    if (appliedCoupon && appliedCoupon.code === code) {
      setCouponInfo(`Ya se está aplicando el código ${code}.`);
      return;
    }

    setCheckingCoupon(true);
    try {
      const ref = doc(db, "discountCodes", code);
      const snap = await getDoc(ref);

      if (!snap.exists()) {
        setAppliedCoupon(null);
        setCouponError("Código no válido.");
        return;
      }

      const data = snap.data();
      const percent = Number(data.percent || 0);

      if (!percent || percent <= 0) {
        setAppliedCoupon(null);
        setCouponError("Este código no tiene un descuento válido.");
        return;
      }

      if (data.used) {
        setAppliedCoupon(null);
        setCouponError("Este código ya ha sido utilizado.");
        return;
      }

      // Podrías comprobar también data.disabled === true, si quieres tener un flag
      setAppliedCoupon({ code, percent });
      setCouponInfo(`Se aplicará un ${percent}% de descuento con el código ${code}.`);
    } catch (e) {
      console.error(e);
      setCouponError("No se pudo comprobar el código. Inténtalo de nuevo.");
    } finally {
      setCheckingCoupon(false);
    }
  };






  return (
    <div className="min-h-screen p-4" style={{ background: 'linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 50%, #0f0f0f 100%)' }}>
      <SEO
        title="Carrito de Compras - Tienda de Cartas"
        description="Revisa los artículos en tu carrito y finaliza tu compra."
      />
      <div className="mx-auto max-w-7xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold text-white" style={{ textShadow: '0 0 20px rgba(12, 216, 6, 0.3)' }}>Carrito</h1>
          <div className="flex items-center gap-3">
            {orderedItems.length > 0 && (
              <button
                className="px-4 py-2 rounded-lg text-white font-medium transition-all duration-300 hover:scale-105 disabled:opacity-60"
                style={{
                  background: 'linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%)',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)'
                }}
                onClick={clearSafe}
                disabled={isClearing}
              >
                {isClearing ? "Vaciando..." : "Vaciar"}
              </button>
            )}
            <button
              className="px-5 py-2.5 rounded-lg text-white font-bold transition-all duration-300 hover:scale-105 hover:shadow-2xl disabled:opacity-60 cursor-pointer"
              style={{
                background: 'linear-gradient(135deg, #0cd806 0%, #09f202 100%)',
                boxShadow: '0 4px 16px rgba(12, 216, 6, 0.4)'
              }}
              onClick={async () => {
                if (isPaying) return;

                setIsPaying(true);

                // Abre la ventana YA para evitar bloqueadores y dar feedback inmediato
                const checkoutWin = window.open("", "_blank");
                if (checkoutWin) {
                  checkoutWin.document.title = "Preparando pago…";
                  checkoutWin.document.body.innerHTML = `
        <div style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh">
          <div>
            <h1 style="font-size:20px;margin:0 0 8px">Preparando pago…</h1>
            <p style="color:#555;margin:0">Un momento, por favor.</p>
          </div>
        </div>`;
                }

                try {
                  const auth = getAuth();
                  const u = auth.currentUser;
                  if (!u) {
                    alert("Inicia sesión para continuar.");
                    if (checkoutWin) checkoutWin.close();
                    setIsPaying(false);
                    return;
                  }
                  const idToken = await u.getIdToken();

                  const resp = await fetch("/api/create-checkout-session", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${idToken}`,
                    },
                    body: JSON.stringify({
                      discountCode: appliedCoupon?.code || null,
                    }),
                  });


                  // lee como texto primero (por si viene HTML)
                  const text = await resp.text();
                  let data = {};
                  try { data = text ? JSON.parse(text) : {}; } catch { }

                  if (resp.ok && data.url) {
                    // redirige la nueva pestaña a Stripe
                    if (checkoutWin) {
                      checkoutWin.location.href = data.url;
                    } else {
                      // si el popup fue bloqueado, redirige la pestaña actual
                      window.location.href = data.url;
                    }
                  } else {
                    const msg = data.error || `No se pudo iniciar el Checkout (HTTP ${resp.status})`;
                    if (checkoutWin) {
                      checkoutWin.document.body.innerHTML = `
            <div style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh">
              <div>
                <h1 style="font-size:20px;margin:0 0 8px">No se pudo iniciar el pago</h1>
                <p style="color:#b00;margin:0">${msg}</p>
              </div>
            </div>`;
                      // cierra tras unos segundos
                      setTimeout(() => checkoutWin.close(), 2500);
                    }
                    alert(msg);
                    setIsPaying(false);
                  }
                } catch (e) {
                  console.error(e);
                  if (checkoutWin) {
                    checkoutWin.document.body.innerHTML = `
          <div style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh">
            <div>
              <h1 style="font-size:20px;margin:0 0 8px">Error inesperado</h1>
              <p style="color:#b00;margin:0">${String(e?.message || e)}</p>
            </div>
          </div>`;
                    setTimeout(() => checkoutWin.close(), 2500);
                  }
                  alert("Ocurrió un error al iniciar el pago.");
                  setIsPaying(false);
                }
              }}
              disabled={isPaying || orderedItems.length === 0 || isClearing}
            >
              {isPaying ? "⏳ Redirigiendo…" : "Hacer el pedido"}
            </button>

          </div>
        </div>

        {/* Filtros */}
        <form
          className="mb-5 rounded-xl bg-[#141414] shadow-lg px-5 py-4 transition-all duration-300 hover:shadow-2xl"
          style={{
            border: '1px solid rgba(12, 216, 6, 0.3)',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4), 0 0 20px rgba(12, 216, 6, 0.1)'
          }}
          onSubmit={(e) => e.preventDefault()}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-300 mb-1">Buscar en el carrito</label>
              <input
                type="text"
                className="w-full rounded-lg border border-gray-600 bg-[#1a1a1a] px-3 py-2 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0cd806]"
                placeholder="Nombre, colección o código de set…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="flex flex-col justify-between gap-2">
              <div className="text-sm text-gray-300">
                <div>Total unidades: <b>{totalUnits}</b></div>
                <div>Precio unitario base: <b>{unitPrice.toFixed(2)} €</b></div>
                <div>Subtotal: <b>{subtotal.toFixed(2)} €</b></div>
                {discountPercent > 0 && (
                  <>
                    <div>Descuento ({discountPercent}%): <b>-{discountAmount.toFixed(2)} €</b></div>
                    <div className="font-semibold">
                      Total con descuento: <b>{totalWithDiscount.toFixed(2)} €</b>
                    </div>
                  </>
                )}
              </div>

              <div className="mt-2">
                <label className="block text-xs font-medium text-gray-300 mb-1">
                  Código de descuento
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value)}
                    className="flex-1 rounded-lg border border-gray-600 bg-[#1a1a1a] text-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#0cd806] uppercase"
                    placeholder="INTRODUCE TU CÓDIGO"
                  />
                  <button
                    type="button"
                    onClick={handleApplyCoupon}
                    disabled={checkingCoupon || !couponInput.trim()}
                    className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm hover:bg-gray-800 disabled:opacity-60 cursor-pointer"
                  >
                    {checkingCoupon ? "Comprobando…" : "Aplicar"}
                  </button>
                </div>
                {couponInfo && (
                  <p className="mt-1 text-xs text-emerald-700">{couponInfo}</p>
                )}
                {couponError && (
                  <p className="mt-1 text-xs text-red-700">{couponError}</p>
                )}
              </div>
            </div>

          </div>
        </form>

        {/* Grid con scroll */}
        <div
          className="rounded-xl bg-[#141414] shadow-lg"
          style={{
            border: '1px solid rgba(12, 216, 6, 0.3)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5), 0 0 30px rgba(12, 216, 6, 0.15)'
          }}
        >
          <div className="max-h-[65vh] overflow-auto p-4">
            {filteredItems.length === 0 ? (
              <div className="text-sm text-gray-300 p-4">No hay cartas que coincidan con el filtro.</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {[...filteredItems]
                  .sort((a, b) => {
                    const idA = a.card?.id;
                    const idB = b.card?.id;
                    return (visualOrderMap[idA] ?? 0) - (visualOrderMap[idB] ?? 0);
                  })
                  .map((it) => {

                    const idGuess = it._idGuess || (it.card?.id ?? it.id);
                    let { card, qty } = it;
                    if ((!card || !card.name) && idGuess && loadedCards[idGuess]) {
                      card = loadedCards[idGuess];
                    }

                    if (!card || !card.id) {
                      return (
                        <div key={idGuess || Math.random()} className="relative rounded-lg overflow-hidden shadow bg-[#1a1a1a] border border-gray-700">
                          <div className="w-full h-[200px] bg-gray-200 flex items-center justify-center text-gray-500">
                            Cargando datos…
                          </div>
                          <div className="px-2 py-1 text-xs text-gray-400">ID: {idGuess || "—"}</div>
                        </div>
                      );
                    }

                    const displayQty = optimisticQty[card.id] ?? qty;
                    const img = getCardImage(card, "normal");

                    return (
                      <div
                        key={card.id || `${card.oracle_id}-fallback`}
                        className="relative group rounded-lg overflow-hidden bg-[#1a1a1a] transition-all duration-300 hover:scale-105"
                        style={{
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.6), 0 0 20px rgba(12, 216, 6, 0.3)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.4)';
                        }}
                      >
                        {/* Imagen clickable → abre estilos */}
                        <button
                          className="block w-full cursor-pointer"
                          onClick={() => openPrintsFor(it)}
                          title="Ver estilos (impresiones)"
                          disabled={isClearing}
                        >
                          {img ? (
                            <img
                              src={img}
                              alt={card?.name || "Carta"}
                              className="w-full h-[200px] object-contain p-2 bg-gray-800"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-[200px] bg-gray-200 flex items-center justify-center text-gray-500">
                              Sin imagen
                            </div>
                          )}
                        </button>

                        {/* Info corta */}
                        <div className="px-2 py-1">
                          <div className="text-xs text-white font-medium truncate" title={card?.name || ""}>
                            {card?.name || "—"}
                          </div>
                          <div
                            className="text-[11px] text-gray-400 truncate"
                            title={`${card.set_name} (${card.set?.toUpperCase()}) #${card.collector_number}`}
                          >
                            {card.set_name} ({card.set?.toUpperCase()}) · #{card.collector_number}
                          </div>
                        </div>

                        {/* Controles de cantidad y eliminar */}
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white px-2 py-1 flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            <button
                              className="px-2 py-0.5 bg-white/20 rounded hover:bg-white/30 cursor-pointer"
                              onClick={() => changeQty(card, -1, qty)}
                              title="Quitar 1"
                              disabled={isClearing}
                            >
                              −
                            </button>
                            <span className="w-7 text-center text-sm">{displayQty || 0}</span>
                            <button
                              className="px-2 py-0.5 bg-white/20 rounded hover:bg-white/30 cursor-pointer"
                              onClick={() => changeQty(card, +1, qty)}
                              title="Añadir 1"
                              disabled={isClearing}
                            >
                              +
                            </button>
                          </div>
                          <button
                            className="px-2 py-1 rounded text-xs cursor-pointer font-medium transition-all duration-200"
                            style={{
                              background: 'linear-gradient(135deg, #0cd806 0%, #09f202 100%)',
                              boxShadow: '0 2px 8px rgba(12, 216, 6, 0.3)'
                            }}
                            onClick={() => remove?.(card.id)}
                            title="Eliminar del carrito"
                            disabled={isClearing}
                          >
                            🗑️ Eliminar
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>

        {/* Totales al pie */}
        <div className="mt-4 text-right text-sm text-white">
          <div>Unidades: <b>{totalUnits}</b></div>
          <div>Precio unitario base: <b>{unitPrice.toFixed(2)} €</b></div>
          <div>Subtotal: <b>{subtotal.toFixed(2)} €</b></div>
          {discountPercent > 0 && (
            <div>
              Descuento ({discountPercent}%): <b>-{discountAmount.toFixed(2)} €</b>
            </div>
          )}
          <div className="text-lg">
            Total a pagar: <b>{totalWithDiscount.toFixed(2)} €</b>
          </div>
        </div>

      </div>

      {/* =======================
          Dialogo: Estilos (prints)
         ======================= */}
      {printsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backdropFilter: 'blur(8px)' }}>
          <div className="absolute inset-0 bg-black/70" onClick={() => setPrintsOpen(false)} />
          <div
            className="relative bg-[#141414] rounded-xl max-w-6xl w-full overflow-hidden"
            style={{
              border: '1px solid rgba(12, 216, 6, 0.3)',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.8), 0 0 40px rgba(12, 216, 6, 0.2)'
            }}
          >
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h3 className="text-lg font-semibold">
                Estilos de {printsCard?.card?.name || "—"}
              </h3>
              <button className="text-gray-500 hover:text-gray-700" onClick={() => setPrintsOpen(false)} aria-label="Cerrar">✕</button>
            </div>

            {printsError && (
              <div className="mx-4 mt-3 rounded bg-red-100 text-red-800 px-3 py-2 text-sm">
                {printsError}
              </div>
            )}

            <div className="p-4">
              {printsLoading ? (
                <div className="text-sm text-gray-600">Cargando estilos…</div>
              ) : prints.length === 0 ? (
                <div className="text-sm text-gray-600">No hay estilos disponibles.</div>
              ) : (
                <div className="max-h-[65vh] overflow-auto pr-2">
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8 gap-3">
                    {prints.map((p) => {
                      const img = getCardImage(p, "normal");
                      return (
                        <div
                          key={p.id}
                          onClick={() => replaceCartItemWithPrint(p)}
                          title={`Cambiar a: ${p.name} (${p.set?.toUpperCase()}) #${p.collector_number}`}
                          className="relative group rounded-lg overflow-hidden shadow hover:shadow-md cursor-pointer"
                          style={{
                            height: "180px",
                            backgroundImage: img ? `url(${img})` : "none",
                            backgroundSize: "contain",
                            backgroundRepeat: "no-repeat",
                            backgroundPosition: "center",
                            backgroundColor: img ? "transparent" : "#e5e7eb",
                          }}
                        >
                          {!img && (
                            <div className="absolute inset-0 flex items-center justify-center text-gray-500">
                              Sin imagen
                            </div>
                          )}
                          <div className="absolute top-1 left-1 bg-black/70 text-white text-[10px] px-1 rounded">
                            {p.set?.toUpperCase()} · #{p.collector_number}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Cargar más estilos si hay */}
                  <div className="flex justify-center my-4">
                    {printsNext ? (
                      <button
                        onClick={loadMorePrints}
                        className="px-4 py-2 bg-white border border-gray-300 rounded-lg shadow hover:shadow-md"
                      >
                        Cargar más
                      </button>
                    ) : (
                      <div className="text-xs text-gray-500">No hay más resultados.</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Pie: info de cantidad seleccionada se mantiene */}
            <div className="px-4 py-3 border-t text-sm text-gray-600">
              Mantendremos la misma cantidad ({printsCard?.qty || 1}) al cambiar de estilo.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
