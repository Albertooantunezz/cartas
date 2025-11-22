import React, { useEffect, useState } from "react";
import ProductList from "../features/products/ProductList";
import Navbar from "../components/Navbar";
import Opinion from "../components/Opinion";
import { useCart } from "../context/CartContext";

import { auth } from "../firebase";
import { onAuthStateChanged } from "firebase/auth";
import ManaText from "../components/ManaText";
import SEO from "../components/SEO";



const SCRYFALL_API = "https://api.scryfall.com";

// Parsear una línea Moxfield: "1 Deadly Rollick (SLD) 1754", "1 Haunted Ridge (MID) 263 F", etc.
function parseMoxfieldLine(line) {
  const raw = line.trim();
  if (!raw || /^sideboard:?$/i.test(raw)) return null; // ignora la cabecera "SIDEBOARD:"
  // cantidad
  const mQty = raw.match(/^(\d+)\s+(.*)$/);
  if (!mQty) return null;
  const qty = parseInt(mQty[1], 10);
  const rest = mQty[2].trim();
  // "Nombre (SET) NUMBER [F]"
  const m = rest.match(/^(.+?)\s+\(([A-Za-z0-9]+)\)\s+([A-Za-z0-9\-]+)(?:\s+F)?$/);
  if (!m) return null;
  const name = m[1].trim();
  const set = m[2].toLowerCase();         // scryfall usa minúsculas
  const number = m[3];                     // puede tener letras/guiones (p.ej. AFC-2)
  return { qty, name, set, number };
}

// Traer carta por set/collector_number
async function fetchCardBySetNumber(set, number) {
  const url = `${SCRYFALL_API}/cards/${encodeURIComponent(set)}/${encodeURIComponent(number)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`No encontrada: (${set.toUpperCase()}) ${number}${msg ? ` · ${msg}` : ""}`);
  }
  return res.json();
}

// Helpers de imagen y texto
function getCardImage(c, size = "normal") {
  try {
    if (c.image_uris?.[size]) return c.image_uris[size];
    if (Array.isArray(c.card_faces) && c.card_faces[0]?.image_uris?.[size]) {
      return c.card_faces[0].image_uris[size];
    }
    if (c.image_uris?.small) return c.image_uris.small;
    if (Array.isArray(c.card_faces) && c.card_faces[0]?.image_uris?.small) {
      return c.card_faces[0].image_uris.small;
    }
  } catch { }
  return "";
}
function getOracleText(c) {
  if (c?.oracle_text) return c.oracle_text;
  if (Array.isArray(c?.card_faces)) {
    return c.card_faces.map((f) => f.oracle_text).filter(Boolean).join("\n—\n");
  }
  return "";
}

export default function Home() {
  const { add } = useCart();

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  // Resultado breve (se mantiene para mensajes fuera del diálogo si quieres)
  const [result, setResult] = useState(null); // { mode:"preview"|"added", ok:number, fail:string[] }

  // --- Pre-Add Dialog (previsualización antes de añadir) ---
  const [preAddOpen, setPreAddOpen] = useState(false);
  const [preAddCards, setPreAddCards] = useState([]); // [{ entry, card }] (entry tiene qty)
  const [failedLines, setFailedLines] = useState([]); // string[]
  const [preAddSaving, setPreAddSaving] = useState(false);

  // Dialog de detalle
  const [openDialog, setOpenDialog] = useState(false);
  const [selectedCard, setSelectedCard] = useState(null);
  const [selectedCardRulings, setSelectedCardRulings] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [user, setUser] = useState(null);
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return () => unsub();
  }, []);


  // Pequeño contador del carrito visible en el diálogo (opcional, si CartContext no lo provee)
  const [localAdded, setLocalAdded] = useState({}); // id -> qty añadidas en esta sesión del diálogo

  // Importar: ahora NO añade directamente. Previsualiza en un diálogo y muestra fallos dentro.
  const handleImport = async () => {
    setResult(null);
    setFailedLines([]);
    setPreAddCards([]);
    setLocalAdded({});

    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !/^sideboard:?$/i.test(l)); // ignora "SIDEBOARD:"

    if (lines.length === 0) {
      // mostramos feedback minimal fuera (o puedes abrir igualmente un diálogo vacío)
      setResult({ ok: 0, fail: ["Pega una lista primero."] });
      return;
    }

    setBusy(true);
    try {
      const parsedOk = [];
      const failed = [];

      // 1) Parseo
      for (const ln of lines) {
        const p = parseMoxfieldLine(ln);
        if (!p) failed.push(ln);
        else parsedOk.push({ ...p, _line: ln });
      }

      // 2) Resolución en Scryfall (validación)
      const resolved = [];
      for (const entry of parsedOk) {
        try {
          const card = await fetchCardBySetNumber(entry.set, entry.number);
          resolved.push({ entry, card });
        } catch {
          failed.push(entry._line);
        }
      }

      // 3) Abrimos el diálogo SIEMPRE con las encontradas…
      setPreAddCards(resolved);
      setFailedLines(failed);
      setPreAddOpen(true);

      // …y fuera mostramos un resumen rápido opcional
      setResult({
        mode: "preview",
        ok: resolved.length,
        fail: failed,
      });

    } catch (e) {
      console.error(e);
      setResult({ ok: 0, fail: ["Ha ocurrido un error inesperado."] });
    } finally {
      setBusy(false);
    }
  };

  // Guardar todas las cartas encontradas en carrito (respetando qty)
  const saveAllToCart = async () => {
    if (!preAddCards.length) {
      setPreAddOpen(false);
      return;
    }
    setPreAddSaving(true);
    try {
      for (const { entry, card } of preAddCards) {
        if (!card?.id) continue;
        const qty = Math.max(1, entry.qty || 1);
        await add(card, qty);
      }
      // 🔴 Aquí dejamos claro el modo "added"
      setResult({
        mode: "added",
        ok: preAddCards.length,
        fail: failedLines || [],
      });
      setPreAddOpen(false);
    } catch (e) {
      console.error(e);
    } finally {
      setPreAddSaving(false);
    }
  };


  // Abrir detalle con rulings
  const openCardDetail = async (card) => {
    setSelectedCard(card);
    setOpenDialog(true);
    setDetailLoading(true);
    setSelectedCardRulings([]);
    try {
      const r = await fetch(`${SCRYFALL_API}/cards/${card.id}/rulings`);
      if (r.ok) {
        const j = await r.json();
        setSelectedCardRulings(j.data || []);
      }
    } catch { }
    setDetailLoading(false);
  };



  return (
    <div className="relative top-0 w-full flex flex-col items-center justify-center">
      <SEO
        title="Inicio - Tienda de Cartas"
        description="Bienvenido a la mejor tienda de cartas Magic. Explora nuestro catálogo y construye tu mazo."
      />
      <div className="relative">
        <img src="/banner.jpg" alt="Banner Home" className="w-2000 h-140 object-cover opacity-70" />
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-white  w-full  text-center">
          <h2 className="text-3xl font-bold">¡Explora nuestro catálogo!</h2>
          <a href="/catalogo">
            <button className="bg-[#0cd806] text-white px-4 py-2 rounded-xl hover:bg-[#09f202] mt-5 w-50 cursor-pointer">
              Catálogo
            </button>
          </a>
        </div>
      </div>

      <div className="text-center bg-black-800 w-full p-10 shadow-lg text-white md:px-20 lg:px-60">
        <h2 className="text-2xl font-bold ">Bienvenido a la tienda</h2>
        <span className="w-full bg-[#0cd806] h-1 block mt-5 mb-5 rounded-xl"></span>
        <p className="text-lg">
          Descubre la mejor selección de Proxys al mejor precio. En nuestra tienda encontrarás desde las últimas novedades hasta joyas clásicas para completar tu colección. Utiliza nuestro constructor de mazos avanzado para diseñar tu estrategia ganadora y adquiere todas las cartas que necesitas con un solo clic. ¡Únete a nuestra comunidad y lleva tu juego al siguiente nivel!
        </p>

        <div className="grid gap-4 grid-cols-1 sm:grid-cols-4 mt-10">
          <div className="bg-[#0cd806] p-4 rounded-lg shadow">
            <h3 className="font-bold mt-2 text-4xl">2€ p/u</h3>
            <p>8 cartas</p>
          </div>
          <div className="bg-[#0cd806] p-4 rounded-lg shadow">
            <h3 className="font-bold mt-2 text-4xl">1.5€ p/u</h3>
            <p>+8 cartas</p>
          </div>
          <div className="bg-[#0cd806] p-4 rounded-lg shadow">
            <h3 className="font-bold mt-2 text-4xl">1€ p/u</h3>
            <p>+40 cartas</p>
          </div>
          <div className="bg-[#0cd806] p-4 rounded-lg shadow">
            <h3 className="font-bold mt-2 text-4xl">0.5€ p/u</h3>
            <p>+50 cartas</p>
          </div>
        </div>

        {/* ---------- Importador Moxfield ---------- */}
        <div className="mt-12 text-left">
          <h3 className="text-xl font-semibold mb-2">Importar lista (Moxfield)</h3>
          <p className="text-sm text-white mb-3">
            Pega líneas en formato <code>1 Nombre (SET) Número</code>. Previsualizamos y podrás guardar todas las que se encuentren; si alguna falla, verás el aviso dentro del diálogo.
          </p>
          <textarea
            className="w-full h-64 rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#0cd806] font-mono text-sm"
            placeholder={`1 Ancient Tomb (VMA) 289\n1 Haunted Ridge (MID) 263 F\n1 Urza's Saga (MH2) 259\n...`}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-3 flex gap-2">
            <button
              className="px-4 py-2 rounded bg-[#0cd806] hover:bg-[#09f202] text-white disabled:opacity-60 cursor-pointer"
              onClick={handleImport}
              disabled={busy || !text.trim()}
            >
              {busy ? "Procesando..." : "Añadir lista al carrito"}
            </button>
            <button
              className="px-3 py-2 text-black rounded bg-gray-100 hover:bg-gray-200 cursor-pointer"
              onClick={() => {
                setText("");
                setResult(null);
              }}
              disabled={busy}
            >
              Limpiar
            </button>
          </div>

          {result && (
            <div className="mt-3 text-sm space-y-2">
              {typeof result.ok === "number" && result.ok >= 0 && (
                <div className="rounded-lg border border-green-200 bg-green-50 text-green-800 px-3 py-2">
                  <b>
                    {result.mode === "added"
                      ? `Se han añadido ${result.ok} carta${result.ok !== 1 ? "s" : ""} al carrito.`
                      : `Se han previsualizado ${result.ok} carta${result.ok !== 1 ? "s" : ""}.`}
                  </b>
                  {result.fail?.length ? (
                    <span className="ml-2 text-yellow-700">
                      {result.fail.length} línea(s) no se encontraron; revísalas en el diálogo.
                    </span>
                  ) : null}
                </div>
              )}
            </div>
          )}

        </div>
        {/* ---------- /Importador Moxfield ---------- */}

      </div>

      {/* =======================
          Dialogo: Previsualización
         ======================= */}
      {preAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setPreAddOpen(false)} />
          <div className="relative bg-[#242424] rounded-xl shadow-xl max-w-6xl w-full overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h3 className="text-lg font-semibold">
                Previsualizar {preAddCards.reduce((sum, it) => sum + (it.entry?.qty || 1), 0)} carta(s)
              </h3>
              <button className="text-gray-500 hover:text-gray-700" onClick={() => setPreAddOpen(false)}>✕</button>
            </div>

            {/* Aviso de fallos: no bloquea el guardado */}
            {(failedLines.length > 0) && (
              <div className="px-4 pt-3">
                <div className="rounded bg-yellow-50 text-yellow-800 border border-yellow-200 px-3 py-2 text-sm">
                  No se encontraron {failedLines.length} línea(s):
                  <ul className="list-disc ml-5 mt-1">
                    {failedLines.slice(0, 6).map((ln, i) => <li key={i}>{ln}</li>)}
                  </ul>
                  {failedLines.length > 6 && <div className="mt-1">… y más.</div>}
                </div>
              </div>
            )}

            <div className="p-4">
              {preAddCards.length === 0 ? (
                <div className="text-sm text-gray-600">No hay cartas que mostrar.</div>
              ) : (
                <div className="max-h-[65vh] overflow-auto pr-2">
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8 gap-3">
                    {preAddCards.map(({ entry, card }) => {
                      const img = getCardImage(card, "normal");
                      return (
                        <div
                          key={card.id}
                          onClick={() => openCardDetail(card)}   // click → detalle
                          title="Ver detalles"
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

                          {/* Badge con cantidad (SIN botones) */}
                          <div className="absolute top-2 left-2 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded">
                            x{entry.qty || 1}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>


            <div className="px-4 py-3 border-t flex items-center justify-end gap-2">
              {!user && (
                <div
                  className="mr-auto text-sm text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1"
                  aria-live="polite"
                >
                  Debes haber iniciado sesión para guardarlas.
                </div>
              )}
              <button className="cursor-pointer px-3 py-2 rounded bg-gray-100 hover:bg-gray-200 text-black" onClick={() => setPreAddOpen(false)}>
                Cancelar
              </button>
              <button
                className="px-3 py-2 rounded bg-[#0cd806] hover:bg-[#09f202] text-white disabled:opacity-60 cursor-pointer"
                onClick={saveAllToCart}
                disabled={preAddSaving || preAddCards.length === 0 || !user}
              >
                {preAddSaving ? "Guardando…" : "Guardar todas en carrito"}
              </button>


            </div>
          </div>
        </div >
      )
      }



      {/* =======================
          Dialogo: Detalle de carta
         ======================= */}
      {
        openDialog && selectedCard && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setOpenDialog(false)}>
            <div className="bg-[#141414] border border-[#0cd806] rounded-xl shadow-xl max-w-4xl w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="flex flex-col md:flex-row">
                <div className="md:w-1/2 flex items-center justify-center p-3 bg-[#1a1a1a]">
                  <img
                    src={getCardImage(selectedCard, "large") || getCardImage(selectedCard, "normal")}
                    alt={selectedCard.name}
                    className="rounded-lg max-h-[500px]"
                  />
                </div>
                <div className="md:w-1/2 p-4 space-y-2">
                  <div className="flex justify-between items-start gap-3">
                    <h2 className="text-xl font-bold">{selectedCard.name}</h2>
                    <button className="text-gray-500 hover:text-gray-300 cursor-pointer text-2xl leading-none" onClick={() => setOpenDialog(false)} aria-label="Cerrar">✕</button>
                  </div>

                  <div className="text-sm text-white">
                    <div><span className="font-semibold">Set:</span> {selectedCard.set_name} ({selectedCard.set?.toUpperCase()}) • #{selectedCard.collector_number}</div>
                    <div><span className="font-semibold">Rareza:</span> {selectedCard.rarity}</div>
                    <div><span className="font-semibold">Legalidades:</span> {Object.entries(selectedCard.legalities || {}).filter(([_, v]) => v === "legal").map(([k]) => k).join(", ") || "—"}</div>
                  </div>

                  <div className="text-sm bg-[#242424] p-3 rounded">
                    <div className="font-semibold mb-1">Texto de Reglas:</div>
                    <ManaText text={getOracleText(selectedCard) || "Sin texto de reglas."} size="sm" />
                  </div>

                </div>
              </div>
            </div>
          </div>
        )
      }

    </div >
  );
}
