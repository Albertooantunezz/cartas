import React, { useState } from "react";
import ProductList from "../features/products/ProductList";
import Navbar from "../components/Navbar";
import Opinion from "../components/Opinion";
import { useCart } from "../context/CartContext";

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

export default function Home() {
  const { add } = useCart();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok:number, fail:string[] }

  const handleImport = async () => {
    setResult(null);

    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !/^sideboard:?$/i.test(l)); // ignora "SIDEBOARD:"

    if (lines.length === 0) {
      setResult({ ok: 0, fail: ["Pega una lista primero."] });
      return;
    }

    setBusy(true);
    try {
      const parsedOk = [];
      const failedLines = [];

      // 1) Parseo
      for (const ln of lines) {
        const p = parseMoxfieldLine(ln);
        if (!p) failedLines.push(ln);
        else parsedOk.push({ ...p, _line: ln });
      }

      // 2) Resolución en Scryfall (validación, no añadimos aún)
      const resolved = [];
      for (const entry of parsedOk) {
        try {
          const card = await fetchCardBySetNumber(entry.set, entry.number);
          resolved.push({ entry, card });
        } catch {
          failedLines.push(entry._line);
        }
      }

      // 3) Si falló cualquiera → mostramos listado de fallos y NO añadimos nada
      if (failedLines.length > 0) {
        setResult({ ok: 0, fail: failedLines });
        return;
      }

      // 4) Todo OK → añadimos al carrito
      for (const { entry, card } of resolved) {
        await add(card, entry.qty);
      }

      setResult({ ok: resolved.length, fail: [] });
    } catch (e) {
      console.error(e);
      setResult({ ok: 0, fail: ["Ha ocurrido un error inesperado."] });
    } finally {
      setBusy(false);
    }
  };


  return (
    <div className="relative top-0 w-full flex flex-col items-center justify-center">
      <div className="relative">
        <img src="/banner.jpg" alt="Banner Home" className="w-2000 h-140 object-cover opacity-70" />
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-white  w-full  text-center">
          <h2 className="text-3xl font-bold">¡Compra tu mazo!</h2>
          <button className="bg-red-500 text-white px-4 py-2 rounded-xl hover:bg-red-600 mt-5 w-50">
            <a href="/ofertas">Mazos</a>
          </button>
        </div>
      </div>

      <div className="text-center bg-red-100 w-full p-10 shadow-lg text-black md:px-20 lg:px-60">
        <h2 className="text-2xl font-bold ">Bienvenido a la tienda</h2>
        <span className="w-full bg-red-500 h-1 block mt-5 rounded-xl"></span>
        <p className="lg:text-xl mt-10">
          Lorem ipsum dolor sit amet consectetur adipisicing elit. Provident pariatur iure officia alias quam impedit
          excepturi qui necessitatibus. Accusantium magni quasi rem voluptates provident repellat iste commodi laborum?
          Obcaecati, maxime!
        </p>

        <div className="grid gap-4 grid-cols-1 sm:grid-cols-4 mt-10">
          <div className="bg-red-200 p-4 rounded-lg shadow">
            <h3 className="font-bold mt-2 text-4xl">2€</h3>
            <p>Una sola carta</p>
          </div>
          <div className="bg-red-200 p-4 rounded-lg shadow">
            <h3 className="font-bold mt-2 text-4xl">1.5€</h3>
            <p>+10 cartas</p>
          </div>
          <div className="bg-red-200 p-4 rounded-lg shadow">
            <h3 className="font-bold mt-2 text-4xl">1€</h3>
            <p>+50 cartas</p>
          </div>
          <div className="bg-red-200 p-4 rounded-lg shadow">
            <h3 className="font-bold mt-2 text-4xl">0.5€</h3>
            <p>+100 cartas</p>
          </div>
        </div>

        <button className="text-xl bg-red-500 text-white px-4 py-2 rounded-xl hover:bg-red-600 mt-10 w-50">
          <a href="/catalogo">Catálogo</a>
        </button>

        {/* ---------- Importador Moxfield ---------- */}
        <div className="mt-12 text-left">
          <h3 className="text-xl font-semibold mb-2">Importar lista (Moxfield)</h3>
          <p className="text-sm text-gray-700 mb-3">
            Pega líneas en formato <code>1 Nombre (SET) Número</code>. Validamos todas primero; si alguna falla, no se
            añadirá ninguna.
          </p>
          <textarea
            className="w-full h-64 rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400 font-mono text-sm"
            placeholder={`1 Ancient Tomb (VMA) 289\n1 Haunted Ridge (MID) 263 F\n1 Urza's Saga (MH2) 259\n...`}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-3 flex gap-2">
            <button
              className="px-4 py-2 rounded bg-red-500 hover:bg-red-600 text-white disabled:opacity-60"
              onClick={handleImport}
              disabled={busy || !text.trim()}
            >
              {busy ? "Importando..." : "Añadir lista al carrito"}
            </button>
            <button
              className="px-3 py-2 rounded bg-gray-100 hover:bg-gray-200"
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
              {result.ok > 0 && result.fail.length === 0 && (
                <div className="rounded-lg border border-green-200 bg-green-50 text-green-800 px-3 py-2">
                  <b>Se han añadido correctamente {result.ok} carta{result.ok > 1 ? "s" : ""} a tu carrito.</b>
                </div>
              )}

              {result.fail?.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 text-red-800 px-3 py-2">
                  <b>No se han encontrado las siguientes cartas:</b>
                  <ul className="list-disc ml-5 mt-1">
                    {result.fail.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

        </div>
        {/* ---------- /Importador Moxfield ---------- */}

        <Opinion />
      </div>
    </div>
  );
}
