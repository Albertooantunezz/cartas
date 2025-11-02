export default function CheckoutSuccess() {
  return (
    <div className="min-h-screen bg-red-50 flex items-center justify-center">
      <div className="bg-white p-6 rounded-xl shadow border">
        <h1 className="text-xl font-bold">¡Pago completado!</h1>
        <p className="text-sm text-gray-700 mt-2">
          Tu pedido se está registrando. Lo verás en “Mi cuenta”.
        </p>
        <a className="mt-4 inline-block px-3 py-2 bg-red-500 text-white rounded" href="/cuenta">
          Ver mis pedidos
        </a>
      </div>
    </div>
  );
}
