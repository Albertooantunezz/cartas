import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export default function ReviewCarousel({ reviews }) {
  const [index, setIndex] = useState(0);

  const next = () => setIndex((prev) => (prev + 1) % reviews.length);
  const prev = () => setIndex((prev) => (prev - 1 + reviews.length) % reviews.length);

  const review = reviews[index];

  return (
    <div className="relative w-full max-w-xl mx-auto p-6">
      <div className="bg-[#0cd806] shadow-xl rounded-2xl p-6 flex flex-col items-center text-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={index}
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            transition={{ duration: 0.4 }}
            className="flex flex-col items-center"
          >
            <img
              src={review.image}
              alt={review.name}
              className="w-20 h-20 rounded-full object-cover border-4 border-white mb-4"
            />
            <p className="text-white italic mb-3">“{review.text}”</p>
            <h3 className="font-semibold text-lg">{review.name}</h3>
            <p className="text-sm text-white">{review.role}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Botones de navegación */}
      <button
        onClick={prev}
        className="absolute left-2 top-1/2 -translate-y-1/2 bg-gray-800 text-white rounded-full p-2 hover:bg-gray-700"
      >
        ←
      </button>
      <button
        onClick={next}
        className="absolute right-2 top-1/2 -translate-y-1/2 bg-gray-800 text-white rounded-full p-2 hover:bg-gray-700"
      >
        →
      </button>

      {/* Indicadores */}
      <div className="flex justify-center mt-4 space-x-2">
        {reviews.map((_, i) => (
          <div
            key={i}
            className={`w-3 h-3 rounded-full ${
              i === index ? "bg-[#0cd806]" : "bg-gray-300"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
