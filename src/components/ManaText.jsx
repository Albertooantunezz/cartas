// ManaText.jsx
import React from "react";
import { useScryfallSymbology, useRenderMana } from "../utils/useScryfallSymbology.jsx";

export default function ManaText({ text, size = "sm", inline = false, className = "" }) {
  const { symbols, loading } = useScryfallSymbology();
  const RenderMana = useRenderMana(symbols);

  if (loading) {
    // placeholder rápido (puedes devolver null si no quieres parpadeo)
    return inline
      ? <span className={className}>{text}</span>
      : <div className={className}>{text}</div>;
  }

  return <RenderMana text={text} size={size} inline={inline} className={className} />;
}
