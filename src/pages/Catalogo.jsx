import React, { useEffect, useMemo, useRef, useState } from "react";
import { useCart } from "../context/CartContext";

const SCRYFALL_API = "https://api.scryfall.com";

export default function Catalogo() {
  // -----------------------------
  // Filtros
  // -----------------------------
  const [name, setName] = useState("");
  const [codeQuery, setCodeQuery] = useState("");      // Búsqueda por código SET-#
  const [typeLine, setTypeLine] = useState("");        // Texto libre de tipo
  const [typeSelect, setTypeSelect] = useState("");    // Select de tipo
  const [setCode, setSetCode] = useState("");          // Código de colección (input)
  const [setsOptions, setSetsOptions] = useState([]);  // Opciones de colección para select
  const [rarity, setRarity] = useState("");
  const [isBorderless, setIsBorderless] = useState(false);
  const [isShowcase, setIsShowcase] = useState(false);
  const [isFullArt, setIsFullArt] = useState(false);
  const [isFoil, setIsFoil] = useState(false);

  // -----------------------------
  // Resultados + paginación
  // -----------------------------
  const [cards, setCards] = useState([]);
  const [nextPage, setNextPage] = useState(null);
  const [visibleCount, setVisibleCount] = useState(40);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showingPrintsByName, setShowingPrintsByName] = useState(false);

  // -----------------------------
  // Carrito
  // -----------------------------
  const { add, removeOne, items } = useCart();

  // -----------------------------
  // Dialog detalle
  // -----------------------------
  const [openDialog, setOpenDialog] = useState(false);
  const [selectedCard, setSelectedCard] = useState(null);
  const [selectedCardRulings, setSelectedCardRulings] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // -----------------------------
  // Helpers
  // -----------------------------
  const controllerRef = useRef(null);
  const sanitize = (v) => String(v).trim().replace(/\s+/g, "_").toLowerCase();

  const getCardImage = (c, size = "normal") => {
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

  // 👇 mapping de símbolo → ruta del icono (en /public)
  const manaSrcs = {
    T: "/mana/tap.png",
    W: "/mana/W.jpg",
    U: "/mana/U.png",
    B: "/mana/B.jpg",
    R: "/mana/R.jpg",
    G: "/mana/G.jpg",
    C: "/mana/C.png",
    // opcionales:
    Q: "/mana/untap.png",
    S: "/mana/S.jpg",
    X: "/mana/X.svg",
  };


  // 👇 helper: convierte texto con {T},{G}... en JSX con imágenes (respeta saltos de línea)
  function renderWithSymbols(text) {
    if (!text) return "";
    const tokenRe = /\{([A-Z])\}/g; // sólo 1 letra: T,W,U,B,R,G,C
    const parts = [];
    let lastIndex = 0;
    let m, key = 0;

    const pushText = (str) => {
      // respetar saltos de línea
      const lines = str.split("\n");
      lines.forEach((ln, i) => {
        if (ln) parts.push(<span key={`t-${key++}`}>{ln}</span>);
        if (i < lines.length - 1) parts.push(<br key={`br-${key++}`} />);
      });
    };

    while ((m = tokenRe.exec(text)) !== null) {
      // trozo previo
      if (m.index > lastIndex) pushText(text.slice(lastIndex, m.index));

      const sym = m[1]; // letra capturada
      const src = manaSrcs[sym];
      if (src) {
        parts.push(
          <img
            key={`img-${key++}`}
            src={src}
            alt={`{${sym}}`}
            className="inline-block h-4 align-text-bottom mx-0.5"
            draggable={false}
          />
        );
      } else {
        // si no lo reconocemos, dejamos el token tal cual
        parts.push(<span key={`unk-${key++}`}>{m[0]}</span>);
      }
      lastIndex = tokenRe.lastIndex;
    }

    // resto final
    if (lastIndex < text.length) pushText(text.slice(lastIndex));
    return <>{parts}</>;
  }

  // 🔁 SUSTITUYE tu función por esta:
  const getOracleText = (c) => {
    let text = "";
    if (c?.oracle_text) text = c.oracle_text;
    else if (Array.isArray(c?.card_faces)) {
      text = c.card_faces.map((f) => f.oracle_text).filter(Boolean).join("\n—\n");
    }
    return renderWithSymbols(text);
  };


  // Desambiguar un “código” tipo mh3-146 | mh3 146 | mh3/146
  const parseCode = (raw) => {
    if (!raw) return null;
    const s = String(raw).trim().toLowerCase().replace(/\s+/g, "-");
    const m = s.match(/^([a-z0-9]+)[\-\/\s_]+([0-9]+[a-z]?)$/i);
    if (!m) return null;
    return { set: m[1], number: m[2] };
  };

  // Query compuesta (cuando NO hay name ni codeQuery)
  const computedQuery = useMemo(() => {
    const q = [];
    if (typeSelect) q.push(`t:${sanitize(typeSelect)}`);
    if (typeLine) q.push(`t:${sanitize(typeLine)}`);
    if (setCode) q.push(`set:${sanitize(setCode)}`);
    if (rarity) q.push(`r:${sanitize(rarity)}`);
    if (isBorderless) q.push("is:borderless");
    if (isShowcase) q.push("is:showcase");
    if (isFullArt) q.push("is:fullart");
    if (isFoil) q.push("is:foil");
    q.push("game:paper");
    return q.length ? q.join(" ") : "*";
  }, [typeSelect, typeLine, setCode, rarity, isBorderless, isShowcase, isFullArt, isFoil]);

  // Cargar sets para el select
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${SCRYFALL_API}/sets`);
        if (!res.ok) return;
        const json = await res.json();
        const mapped = (json.data || [])
          .map(s => ({ code: s.code, name: s.name }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setSetsOptions(mapped);
      } catch { }
    })();
  }, []);

  // Búsqueda principal
  const fetchInitial = async () => {
    setError("");
    setLoading(true);
    setCards([]);
    setNextPage(null);

    if (controllerRef.current) controllerRef.current.abort();
    controllerRef.current = new AbortController();

    try {
      // 1) Prioridad: código SET-#
      const parsed = parseCode(codeQuery);
      if (parsed) {
        const url = `${SCRYFALL_API}/cards/${encodeURIComponent(parsed.set)}/${encodeURIComponent(parsed.number)}`;
        const res = await fetch(url, { signal: controllerRef.current.signal });
        if (!res.ok) throw new Error("No se encontró carta con ese código.");
        const card = await res.json();
        setCards([card]);
        setNextPage(null);
        setVisibleCount(40);
        setShowingPrintsByName(false);
        return;
      }

      // 2) Coincidencias por nombre (parcial)
      if (name.trim()) {
        setShowingPrintsByName(false);
        const q = `name:${name.trim()}*`;
        const url = `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(q)}&unique=prints&order=name`;
        const res = await fetch(url, { signal: controllerRef.current.signal });
        if (!res.ok) throw new Error("Error buscando por nombre.");
        const list = await res.json();
        setCards(list.data || []);
        setNextPage(list.has_more ? list.next_page : null);
        setVisibleCount(40);
        return;
      }

      // 3) Filtros generales
      setShowingPrintsByName(false);
      const url = `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(computedQuery)}&unique=prints&order=released`;
      const res = await fetch(url, { signal: controllerRef.current.signal });
      if (!res.ok) throw new Error("Error buscando cartas.");
      const list = await res.json();
      setCards(list.data || []);
      setNextPage(list.has_more ? list.next_page : null);
      setVisibleCount(40);
    } catch (err) {
      if (err?.name !== "AbortError") setError(err.message || "Error desconocido.");
    } finally {
      setLoading(false);
    }
  };

  const fetchMore = async () => {
    const next = visibleCount + 40;
    // si ya tenemos suficientes en memoria, solo ampliamos el visibleCount
    if (cards.length >= next) {
      setVisibleCount(next);
      return;
    }
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
  }, [name, codeQuery, computedQuery]);

  // Detalle
  const openCardDetail = async (card) => {
    setSelectedCard(card);
    setOpenDialog(true);
    setDetailLoading(true);
    setSelectedCardRulings([]);
    try {
      const rulingsRes = await fetch(`${SCRYFALL_API}/cards/${card.id}/rulings`);
      if (rulingsRes.ok) {
        const rulingsJson = await rulingsRes.json();
        setSelectedCardRulings(rulingsJson.data || []);
      }
    } catch { }
    finally {
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
      setVisibleCount(40);
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
    <div className="w-full min-h-screen bg-red-100 p-4 text-black">
      <h1 className="text-3xl font-bold mb-4">Catálogo</h1>

      <p className="text-sm text-gray-800 mb-4">
        Explora nuestro catálogo de cartas. Busca por <b>código</b> (<code>SET-#</code>), <b>nombre</b> o filtra por características.
      </p>

      {/* Filtros */}
      <form className="mb-5 rounded-xl border border-gray-200 bg-white shadow-sm" onSubmit={(e) => e.preventDefault()}>
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Filtros</h2>
          <p className="text-xs text-gray-600">
            Código prioriza una impresión exacta (ej: <code>mh3-146</code>). El nombre admite coincidencias parciales.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-7 gap-3 p-4">
          {/* Código */}
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1">Código (SET-#)</label>
            <input
              type="text"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-400"
              placeholder="Ej: mh3-146 o eld/1"
              value={codeQuery}
              onChange={(e) => setCodeQuery(e.target.value)}
            />
          </div>

          {/* Nombre */}
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1">Nombre</label>
            <input
              type="text"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-400"
              placeholder="Ej: Light, Li…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!!codeQuery.trim()}
            />
          </div>

          {/* Colección (select) */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Colección (selección)</label>
            <select
              className="cursor-pointer w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-400 disabled:bg-gray-100"
              value={setCode}
              onChange={(e) => setSetCode(e.target.value)}
              disabled={!!name.trim() || !!codeQuery.trim()}
            >
              <option value="">Todas</option>
              {setsOptions.map(s => (
                <option key={s.code} value={s.code}>{s.name} ({s.code.toUpperCase()})</option>
              ))}
            </select>
          </div>


          {/* Tipo (select) */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Tipo (selección)</label>
            <select
              className="cursor-pointer w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-400 disabled:bg-gray-100"
              value={typeSelect}
              onChange={(e) => setTypeSelect(e.target.value)}
              disabled={!!name.trim() || !!codeQuery.trim()}
            >
              <option value="">Todos</option>
              <option value="creature">Creature</option>
              <option value="instant">Instant</option>
              <option value="sorcery">Sorcery</option>
              <option value="artifact">Artifact</option>
              <option value="enchantment">Enchantment</option>
              <option value="planeswalker">Planeswalker</option>
              <option value="land">Land</option>
              <option value="battle">Battle</option>
            </select>
          </div>

          {/* Rareza */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Rareza</label>
            <select
              className="cursor-pointer w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-400 disabled:bg-gray-100"
              value={rarity}
              onChange={(e) => setRarity(e.target.value)}
              disabled={!!name.trim() || !!codeQuery.trim()}
            >
              <option value="">Todas</option>
              <option value="common">Common</option>
              <option value="uncommon">Uncommon</option>
              <option value="rare">Rare</option>
              <option value="mythic">Mythic</option>
            </select>
          </div>

          {/* Estilos */}
          <div className="md:col-span-3 flex flex-wrap items-center gap-4">
            <label className=" text-xs font-medium text-gray-700">Estilos:</label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-800 cursor-pointer">
              <input type="checkbox" className="cursor-pointer rounded border-gray-300 text-red-600 focus:ring-red-400 disabled:bg-gray-100"
                checked={isBorderless} onChange={(e) => setIsBorderless(e.target.checked)}
                disabled={!!name.trim() || !!codeQuery.trim()} />
              Borderless
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-800 cursor-pointer">
              <input type="checkbox" className="cursor-pointer rounded border-gray-300 text-red-600 focus:ring-red-400 disabled:bg-gray-100"
                checked={isFullArt} onChange={(e) => setIsFullArt(e.target.checked)}
                disabled={!!name.trim() || !!codeQuery.trim()} />
              Full Art
            </label>
          </div>
        </div>
      </form>

      {error && (
        <div className="bg-red-200 text-red-800 px-3 py-2 rounded mb-3">{error}</div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8 gap-3">
        {cards.slice(0, visibleCount).map((card) => {
          const img = getCardImage(card, "normal");
          const qtyInCart = (items.find(it => it.id === card.id)?.qty) || 0;

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

              {/* Overlay inferior: quitar 1 / añadir */}
              <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white px-2 py-1 flex items-center justify-end gap-2">
                <button
                  className="cursor-pointer px-2 py-1 bg-white/20 hover:bg-white/30 rounded text-xs"
                  onClick={(e) => { e.stopPropagation(); removeOne(card.id); }}
                  title="Quitar 1 del carrito"
                >
                  −
                </button>
                <button
                  className="px-2 py-1 bg-red-500 hover:bg-red-600 rounded text-xs cursor-pointer"
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      await add(card, 1);
                    } catch (err) {
                      alert(err?.message || "No se pudo añadir al carrito.");
                      console.error("Cart add error:", err);
                    }
                  }}
                  title="Añadir al carrito"
                >
                  Añadir ({qtyInCart})
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Cargar más */}
      <div className="flex justify-center my-6">
        {loading ? (
          <div className="text-sm text-gray-600">Cargando...</div>
        ) : (nextPage || cards.length > visibleCount) ? (
          <button
            onClick={fetchMore}
            className="cursor-pointer text-white px-4 py-2 bg-red-500 border border-gray-300 rounded-lg shadow hover:shadow-md"
          >
            Cargar más
          </button>
        ) : cards.length > 0 ? (
          <div className="text-sm text-gray-600">No hay más resultados.</div>
        ) : null}
      </div>

      {/* Dialog de detalle */}
      {openDialog && selectedCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpenDialog(false)} />
          <div className="relative bg-white rounded-xl shadow-xl max-w-4xl w-full overflow-hidden">
            <div className="flex flex-col md:flex-row">
              {/* Imagen grande sin recorte */}
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

                <div className="text-sm text-gray-700 space-y-1">
                  <div><span className="font-semibold">Set:</span> {selectedCard.set_name} ({selectedCard.set?.toUpperCase()}) • #{selectedCard.collector_number}</div>
                  <div>
                    <span className="font-semibold">Código:</span>{" "}
                    {selectedCard.set?.toUpperCase()}-{selectedCard.collector_number}
                    {selectedCard.lang ? ` • ${selectedCard.lang.toUpperCase()}` : ""}
                  </div>
                  <div><span className="font-semibold">Rareza:</span> {selectedCard.rarity}</div>
                  <div><span className="font-semibold">Legalidades:</span> {Object.entries(selectedCard.legalities || {}).filter(([_, v]) => v === "legal").map(([k]) => k).join(", ") || "—"}</div>
                </div>

                <div className="text-sm whitespace-pre-wrap bg-gray-50 p-2 rounded">
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
      )}
    </div>
  );
}
