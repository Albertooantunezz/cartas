export default function CheckoutCancel() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 50%, #0f0f0f 100%)' }}>
      <div className="max-w-md w-full bg-[#141414] border border-red-500/30 rounded-2xl shadow-[0_0_40px_rgba(239,68,68,0.1)] p-8 text-center backdrop-blur-sm">
        <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
          <span className="text-3xl text-red-500">✕</span>
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Pago cancelado</h1>
        <p className="text-gray-400 mb-8">Has cancelado el proceso de pago. No se ha realizado ningún cargo en tu cuenta.</p>

        <a
          href="/carrito"
          className="inline-block w-full px-6 py-3 rounded-xl font-bold text-white transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-gray-700/30"
          style={{
            background: 'linear-gradient(135deg, #242424 0%, #333 100%)',
            border: '1px solid rgba(255,255,255,0.1)'
          }}
        >
          Volver al carrito
        </a>
      </div>
    </div>
  );
}
