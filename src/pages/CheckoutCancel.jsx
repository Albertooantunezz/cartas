export default function CheckoutCancel() {
  return (
    <div className="min-h-screen bg-red-50 flex items-center justify-center">
      <div className="bg-white p-6 rounded-xl shadow border">
        <h1 className="text-xl font-bold">Pago cancelado</h1>
        <a className="mt-4 inline-block px-3 py-2 bg-gray-900 text-white rounded" href="/carrito">
          Volver al carrito
        </a>
      </div>
    </div>
  );
}
