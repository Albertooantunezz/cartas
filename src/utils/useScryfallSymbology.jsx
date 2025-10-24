// useScryfallSymbology.js
import { useEffect, useMemo, useState } from "react";

/**
 * Carga /symbology de Scryfall, cachea en localStorage 24h,
 * y expone un diccionario { "{G}": { svg_uri, english, ... }, ... }.
 */
export function useScryfallSymbology() {
  const [map, setMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let aborted = false;

    async function load() {
      setLoading(true);
      setErr("");

      // cache simple 24h
      try {
        const raw = localStorage.getItem("scryfall_symbology_v1");
        if (raw) {
          const cached = JSON.parse(raw);
          if (cached?.expires && cached.expires > Date.now()) {
            if (!aborted) {
              setMap(cached.map || {});
              setLoading(false);
              return;
            }
          }
        }
      } catch {}

      try {
        const res = await fetch("https://api.scryfall.com/symbology");
        if (!res.ok) throw new Error("No se pudo cargar symbology");
        const json = await res.json();
        const entries = json.data || [];

        const next = {};
        for (const s of entries) {
          // s.symbol => "{G}", "{T}", "{2/W}", etc.
          next[s.symbol] = s; // incluye svg_uri, english, appears_in_mana_costs, etc.
        }

        if (!aborted) {
          setMap(next);
          setLoading(false);
          try {
            localStorage.setItem(
              "scryfall_symbology_v1",
              JSON.stringify({ map: next, expires: Date.now() + 24 * 60 * 60 * 1000 })
            );
          } catch {}
        }
      } catch (e) {
        if (!aborted) {
          setErr(e.message || "Error cargando symbology");
          setLoading(false);
        }
      }
    }

    load();
    return () => { aborted = true; };
  }, []);

  return { symbols: map, loading, error: err };
}

/**
 * Convierte un string con tokens {..} a fragmento React con <img>.
 * - text: el texto con tokens (p.ej. "{T}: Add {G}.")
 * - size: "xs" | "sm" | "md" | "lg" (controla alto del icono)
 * - inline: si true, renderiza en línea (no añade <div>)
 */
export function useRenderMana(symbols) {
  return function RenderMana({ text, size = "sm", inline = false, className = "" }) {
    if (!text) return null;

    const tokenH = size === "xs" ? 14 : size === "sm" ? 16 : size === "md" ? 18 : 22;
    const parts = String(text).split(/(\{[^}]+\})/g); // separa tokens {..}

    const nodes = parts.map((part, i) => {
      const isToken = /^\{[^}]+\}$/.test(part);
      if (!isToken) {
        // preservar saltos de línea de oracle_text
        return part.split("\n").map((seg, idx, arr) => (
          <span key={`${i}-${idx}`}>
            {seg}
            {idx < arr.length - 1 ? <br /> : null}
          </span>
        ));
      }

      // Caso token
      const sym = symbols[part];
      if (!sym?.svg_uri) {
        // si no lo conocemos, muestra el literal {X}
        return <span key={i}>{part}</span>;
        // si prefieres ocultarlo: return null;
      }
      return (
        <img
          key={i}
          src={sym.svg_uri}
          alt={sym.english || part}
          title={sym.english || part}
          className="inline align-text-bottom"
          style={{ height: tokenH, width: "auto" }}
          loading="lazy"
        />
      );
    });

    if (inline) return <span className={className}>{nodes}</span>;
    return <div className={className}>{nodes}</div>;
  };
}
