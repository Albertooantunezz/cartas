import React from "react";
import ReviewCarousel from "./ReviewCarousel";

export default function Opinion() {
  return (
    <div className="w-full max-w-4xl mx-auto p-6">
      <h2 className="text-2xl font-bold mb-4 mt-10">Opiniones de nuestros clientes</h2>
      <ReviewCarousel reviews={reviews} />
    </div>
  );
}

const reviews = [
  {
    name: "Laura Fernández",
    role: "Cliente habitual",
    image: "https://randomuser.me/api/portraits/women/68.jpg",
    text: "¡Los productos son de excelente calidad! Siempre llegan a tiempo y el servicio al cliente es genial.",
  },
  {
    name: "Carlos Gómez",
    role: "Comprador verificado",
    image: "https://randomuser.me/api/portraits/men/44.jpg",
    text: "He comprado varias veces y siempre he tenido una experiencia muy buena. ¡Recomendado!",
  },
  {
    name: "María López",
    role: "Clienta satisfecha",
    image: "https://randomuser.me/api/portraits/women/32.jpg",
    text: "Me encanta la atención al detalle en cada pedido. Sin duda seguiré comprando aquí.",
  },
];