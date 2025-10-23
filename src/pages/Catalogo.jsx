import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Catalogo.jsx
 * - Grid de cartas: imágenes pequeñas y completas (object-contain), 20 primeras + "Cargar más".
 * - Overlay en la imagen: contador + botón de carrito.
 * - Dialog con detalle y botón "Ver todos sus estilos" si aplica.
 * - Filtros con mayor legibilidad (fondo blanco, bordes, focus ring, tipografía más clara).
 */

const SCRYFALL_API = "https://api.scryfall.com";

export default function Catalogo() {
  // -----------------------------
  // Estado de filtros (UI)
  // -----------------------------
  const [name, setName] = useState("");              // Nombre de carta → si se usa, mostramos todos los estilos (prints)
  const [typeLine, setTypeLine] = useState("");      // Tipo (p.ej. "Creature", "Instant", etc.)
  const [setCode, setSetCode] = useState("");        // Código de colección (p.ej. "mh3", "eld", etc.)
  const [rarity, setRarity] = useState("");          // Rareza: common|uncommon|rare|mythic
  const [isBorderless, setIsBorderless] = useState(false);
  const [isShowcase, setIsShowcase] = useState(false);
  const [isFullArt, setIsFullArt] = useState(false);
  const [isFoil, setIsFoil] = useState(false);

  // -----------------------------
  // Resultados y paginación
  // -----------------------------
  const [cards, setCards] = useState([]);
  const [nextPage, setNextPage] = useState(null);
  const [visibleCount, setVisibleCount] = useState(40); // 👈 mostramos 40 por tanda
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showingPrintsByName, setShowingPrintsByName] = useState(false);



  // -----------------------------
  // Carrito (id -> cantidad)
  // -----------------------------
  const [cart, setCart] = useState({});
  const addToCart = (cardId, qty = 1) => {
    setCart((prev) => ({ ...prev, [cardId]: (prev[cardId] || 0) + qty }));
  };
  const removeFromCart = (cardId, qty = 1) => {
    setCart((prev) => {
      const current = prev[cardId] || 0;
      const next = Math.max(0, current - qty);
      const copy = { ...prev, [cardId]: next };
      if (next === 0) delete copy[cardId];
      return copy;
    });
  };

  // -----------------------------
  // Dialog de detalle
  // -----------------------------
  const [openDialog, setOpenDialog] = useState(false);
  const [selectedCard, setSelectedCard] = useState(null);
  const [selectedCardRulings, setSelectedCardRulings] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  // control de cantidad dentro del overlay por carta (id->qty a añadir)
  // (contador eliminado) ahora cada clic en "Añadir" suma 1 al carrito.
  // Usa el botón "−" del overlay para quitar 1 del carrito.


  // -----------------------------
  // Helpers
  // -----------------------------
  const getCardImage = (c, size = "normal") => {
    // Siempre intentamos mostrar la carta entera (object-contain en el JSX)
    try {
      if (c.image_uris?.[size]) return c.image_uris[size];
      if (Array.isArray(c.card_faces) && c.card_faces[0]?.image_uris?.[size]) {
        return c.card_faces[0].image_uris[size];
      }
    } catch { }
    try {
      if (c.image_uris?.small) return c.image_uris.small;
      if (Array.isArray(c.card_faces) && c.card_faces[0]?.image_uris?.small) {
        return c.card_faces[0].image_uris.small;
      }
    } catch { }
    return "";
  };

  const getOracleText = (c) => {
    if (c.oracle_text) return c.oracle_text;
    if (Array.isArray(c.card_faces)) {
      return c.card_faces.map((f) => f.oracle_text).filter(Boolean).join("\n—\n");
    }
    return "";
  };

  // -----------------------------
  // Query (cuando NO hay nombre)
  // -----------------------------
  const sanitize = (v) => String(v).trim().replace(/\s+/g, "_").toLowerCase();

  const computedQuery = useMemo(() => {
    const q = [];
    if (typeLine) q.push(`t:${sanitize(typeLine)}`);
    if (setCode) q.push(`set:${sanitize(setCode)}`);
    if (rarity) q.push(`r:${sanitize(rarity)}`);
    if (isBorderless) q.push("is:borderless");
    if (isShowcase) q.push("is:showcase");
    if (isFullArt) q.push("is:fullart");
    if (isFoil) q.push("is:foil");
    q.push("game:paper");
    return q.length ? q.join(" ") : "*";
  }, [typeLine, setCode, rarity, isBorderless, isShowcase, isFullArt, isFoil]);

  // -----------------------------
  // Búsqueda principal
  // -----------------------------
  const controllerRef = useRef(null);

  const fetchInitial = async () => {
    setError("");
    setLoading(true);
    setCards([]);
    setNextPage(null);

    if (controllerRef.current) controllerRef.current.abort();
    controllerRef.current = new AbortController();

    try {
      if (name.trim()) {
        // Coincidencias parciales por prefijo: name:<texto>*
        setShowingPrintsByName(false); // ahora listamos coincidencias, prints completos quedarán para el diálogo
        const q = `name:${name.trim()}*`;
        const url = `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(q)}&unique=prints&order=name`;
        const res = await fetch(url, { signal: controllerRef.current.signal });
        if (!res.ok) throw new Error("Error buscando por nombre.");
        const list = await res.json();
        setCards(list.data || []);
        setNextPage(list.has_more ? list.next_page : null);
        setVisibleCount(40);
      } else {
        setShowingPrintsByName(false);
        const url = `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(
          computedQuery
        )}&unique=prints&order=released`;
        const res = await fetch(url, { signal: controllerRef.current.signal });
        if (!res.ok) throw new Error("Error buscando cartas.");
        const list = await res.json();

        setCards(list.data || []);
        setNextPage(list.has_more ? list.next_page : null);
      }
    } catch (err) {
      if (err?.name !== "AbortError") {
        setError(err.message || "Error desconocido.");
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchMore = async () => {
    const next = visibleCount + 40;
    // Si ya tenemos suficientes en memoria, solo incrementa el visibleCount
    if (cards.length >= next) {
      setVisibleCount(next);
      return;
    }
    // Si no, pide más a la API y luego incrementa el visibleCount
    setLoading(true);
    setError("");
    try {
      if (nextPage) {
        const res = await fetch(nextPage);
        if (!res.ok) throw new Error("No se pudo cargar más.");
        const list = await res.json();
        setCards((prev) => [...prev, ...(list.data || [])]);
        setNextPage(list.has_more ? list.next_page : null);
      }
      setVisibleCount((v) => v + 40);
    } catch (err) {
      setError(err.message || "Error desconocido.");
    } finally {
      setLoading(false);
    }
  };


  useEffect(() => {
    fetchInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, computedQuery]);

  // -----------------------------
  // Detalle
  // -----------------------------
  const openCardDetail = async (card) => {
    setSelectedCard(card);
    setOpenDialog(true);
    setDetailError("");
    setDetailLoading(true);
    setSelectedCardRulings([]);

    try {
      const rulingsRes = await fetch(`${SCRYFALL_API}/cards/${card.id}/rulings`);
      if (rulingsRes.ok) {
        const rulingsJson = await rulingsRes.json();
        setSelectedCardRulings(rulingsJson.data || []);
      }
    } catch (err) {
      setDetailError("No se pudieron cargar los rulings.");
    } finally {
      setDetailLoading(false);
    }
  };

  const viewAllPrintsFromDialog = async () => {
    if (!selectedCard?.oracle_id) return;
    setOpenDialog(false);
    setLoading(true);
    setError("");

    try {
      const printsUrl = `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(
        `oracleid:${selectedCard.oracle_id}`
      )}&unique=prints&order=released`;
      const res = await fetch(printsUrl);
      if (!res.ok) throw new Error("No se pudieron cargar los estilos.");
      const list = await res.json();

      setCards(list.data || []);
      setNextPage(list.has_more ? list.next_page : null);
      setShowingPrintsByName(true);
    } catch (err) {
      setError(err.message || "Error desconocido.");
    } finally {
      setLoading(false);
    }
  };

  // -----------------------------
  // Render
  // -----------------------------
  return (
    <div className="w-full min-h-screen bg-red-100 p-4">
      <h1 className="text-3xl font-bold mb-4">Catálogo</h1>

      {/* Descripción / Intro opcional */}
      <p className="text-sm text-gray-800 mb-4">
        Explora nuestro catálogo de cartas de Magic. Usa los filtros para buscar por nombre, tipo, colección y estilo.
      </p>

      {/* -----------------------------
          Filtros (MEJOR LEGIBILIDAD)
         ----------------------------- */}
      <form 
        className="mb-5 rounded-xl border border-gray-200 bg-white shadow-sm z-1"
        onSubmit={(e) => e.preventDefault()}
      >
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Filtros</h2>
          <p className="text-xs text-gray-600">
            Busca por nombre para ver todos los estilos de esa carta. Si no usas nombre, filtra por características.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 p-4">
          {/* Nombre */}
          <div className="col-span-1 md:col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1">Nombre (muestra todos los estilos)</label>
            <input
              type="text"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-400"
              placeholder="Ej: Lightning Bolt"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Tipo */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Tipo</label>
            <input
              type="text"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-400 disabled:bg-gray-100"
              placeholder="Ej: creature, instant..."
              value={typeLine}
              onChange={(e) => setTypeLine(e.target.value)}
              disabled={!!name.trim()}
            />
          </div>

          {/* Set */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Colección (código)</label>
            <input
              type="text"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-400 disabled:bg-gray-100"
              placeholder="Ej: mh3, eld..."
              value={setCode}
              onChange={(e) => setSetCode(e.target.value)}
              disabled={!!name.trim()}
            />
          </div>

          {/* Rareza */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Rareza</label>
            <select
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-400 disabled:bg-gray-100"
              value={rarity}
              onChange={(e) => setRarity(e.target.value)}
              disabled={!!name.trim()}
            >
              <option value="">Todas</option>
              <option value="common">Common</option>
              <option value="uncommon">Uncommon</option>
              <option value="rare">Rare</option>
              <option value="mythic">Mythic</option>
            </select>
          </div>

          {/* Estilos */}
          <div className="md:col-span-2 flex flex-wrap items-center gap-4">
            <label className="text-xs font-medium text-gray-700">Estilos:</label>

            <label className="inline-flex items-center gap-2 text-sm text-gray-800">
              <input
                type="checkbox"
                checked={isBorderless}
                onChange={(e) => setIsBorderless(e.target.checked)}
                disabled={!!name.trim()}
                className="rounded border-gray-300 text-red-600 focus:ring-red-400 disabled:bg-gray-100"
              />
              Borderless
            </label>

            <label className="inline-flex items-center gap-2 text-sm text-gray-800">
              <input
                type="checkbox"
                checked={isShowcase}
                onChange={(e) => setIsShowcase(e.target.checked)}
                disabled={!!name.trim()}
                className="rounded border-gray-300 text-red-600 focus:ring-red-400 disabled:bg-gray-100"
              />
              Showcase
            </label>

            <label className="inline-flex items-center gap-2 text-sm text-gray-800">
              <input
                type="checkbox"
                checked={isFullArt}
                onChange={(e) => setIsFullArt(e.target.checked)}
                disabled={!!name.trim()}
                className="rounded border-gray-300 text-red-600 focus:ring-red-400 disabled:bg-gray-100"
              />
              Full Art
            </label>

            <label className="inline-flex items-center gap-2 text-sm text-gray-800">
              <input
                type="checkbox"
                checked={isFoil}
                onChange={(e) => setIsFoil(e.target.checked)}
                disabled={!!name.trim()}
                className="rounded border-gray-300 text-red-600 focus:ring-red-400 disabled:bg-gray-100"
              />
              Foil
            </label>
          </div>
        </div>
      </form>

      {/* Estado */}
      {error && (
        <div className="bg-red-200 text-red-800 px-3 py-2 rounded mb-3">
          {error}
        </div>
      )}

      {/* -----------------------------
          Grid de cartas (IMÁGENES PEQUEÑAS Y COMPLETAS)
         ----------------------------- */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8 gap-3">
        {cards.slice(0, visibleCount).map((card) => {


          const img = getCardImage(card, "normal");
          const inCart = cart[card.id] || 0;

          return (
            <div
              key={card.id}
              onClick={() => openCardDetail(card)}
              title="Ver detalles"
              className="relative group rounded-lg overflow-hidden shadow hover:shadow-md cursor-pointer"
              style={{
                height: '180px',
                backgroundImage: img ? `url(${img})` : 'none',
                backgroundSize: 'contain',
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'center',
                backgroundColor: img ? 'transparent' : '#e5e7eb'
              }}
            >
              {!img && (
                <div className="absolute inset-0 flex items-center justify-center text-gray-500">
                  Sin imagen
                </div>
              )}


              <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white px-2 py-1 flex items-center justify-end gap-2">
                <button
                  className="px-2 py-1 bg-white/20 hover:bg-white/30 rounded text-xs"
                  onClick={(e) => { e.stopPropagation(); removeFromCart(card.id, 1); }}
                  title="Quitar 1 del carrito"
                >
                  −
                </button>
                <button
                  className="px-2 py-1 bg-red-500 hover:bg-red-600 rounded text-xs"
                  onClick={(e) => { e.stopPropagation(); addToCart(card.id, 1); }}
                  title="Añadir al carrito"
                >
                  Añadir ({inCart || 0})
                </button>
              </div>


             
              <button
                className="px-2 py-1 bg-white/20 hover:bg-white/30 rounded text-xs ml-2"
                onClick={(e) => { e.stopPropagation(); removeFromCart(card.id, 1); }}
                title="Quitar 1 del carrito"
              >
                −
              </button>

            </div>

          );
        })}
      </div>

      {/* Cargar más */}
      {loading ? (
        <div className="text-sm text-gray-600 flex ">Cargando...</div>
      ) : (nextPage || cards.length > visibleCount) ? (
        <div className="flex justify-center">
        <button
          onClick={fetchMore}
          className="px-4 py-2 bg-red-500 border border-gray-300 rounded-lg shadow hover:shadow-md  mt-4 text-white"
        >
          Cargar más
        </button>
      </div>
      ) : cards.length > 0 ? (
        <div className="text-sm text-gray-600 flex">No hay más resultados.</div>
      ) : null}


      {/* -----------------------------
          Dialog de detalle
         ----------------------------- */}
      {
        openDialog && selectedCard && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => setOpenDialog(false)}
            />
            <div className="relative bg-white rounded-xl shadow-xl max-w-4xl w-full overflow-hidden">
              <div className="flex flex-col md:flex-row">
                {/* Imagen grande SIN recorte */}
                <div className="md:w-1/2 bg-gray-50 flex items-center justify-center p-3">
                  <img
                    src={getCardImage(selectedCard, "large") || getCardImage(selectedCard, "normal")}
                    alt={selectedCard.name}
                    className="w-full h-[520px] object-contain"
                  />
                </div>

                {/* Info */}
                <div className="md:w-1/2 p-4 space-y-2">
                  <div className="flex justify-between items-start gap-3">
                    <h2 className="text-xl font-bold">{selectedCard.name}</h2>
                    <button
                      className="text-gray-500 hover:text-gray-700"
                      onClick={() => setOpenDialog(false)}
                      aria-label="Cerrar"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="text-sm text-gray-700">
                    <div><span className="font-semibold">Set:</span> {selectedCard.set_name} ({selectedCard.set?.toUpperCase()}) • #{selectedCard.collector_number}</div>
                    <div><span className="font-semibold">Rareza:</span> {selectedCard.rarity}</div>
                    <div><span className="font-semibold">Legalidades:</span> {Object.entries(selectedCard.legalities || {}).filter(([_, v]) => v === "legal").map(([k]) => k).join(", ") || "—"}</div>
                  </div>

                  <div className="text-sm whitespace-pre-wrap bg-gray-50 p-2 rounded text-gray-800 border border-gray-200 max-h-48 overflow-auto">
                    {getOracleText(selectedCard) || "Sin texto de reglas."}
                  </div>

                 

                  <div className="text-xs text-gray-600 max-h-32 overflow-auto border-t pt-2">
                    <div className="font-semibold mb-1">Rulings</div>
                    {detailLoading ? (
                      <div>Cargando rulings...</div>
                    ) : selectedCardRulings.length ? (
                      <ul className="list-disc ml-5 space-y-1">
                        {selectedCardRulings.map((r) => (
                          <li key={r.comment + r.published_at}>
                            <span className="font-medium">{r.published_at}:</span> {r.comment}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div>Sin rulings.</div>
                    )}
                  </div>

                  {!showingPrintsByName && (
                    <button
                      className="mt-2 w-full py-2 bg-red-500 hover:bg-red-600 text-white rounded"
                      onClick={viewAllPrintsFromDialog}
                    >
                      Ver todos sus estilos
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      }
    </div >
  );
}
