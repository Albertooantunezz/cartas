export default function handler(req, res) {
  res.status(200).json({
    hasProjectId: !!process.env.FIREBASE_PROJECT_ID,
    hasClientEmail: !!process.env.FIREBASE_CLIENT_EMAIL,
    hasPrivateKey: !!process.env.FIREBASE_PRIVATE_KEY,
    // solo para depurar la forma, sin exponer la clave:
    pkStartsWith: (process.env.FIREBASE_PRIVATE_KEY || '').slice(0, 30),
  });
}
