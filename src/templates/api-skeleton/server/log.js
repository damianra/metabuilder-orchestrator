// Request logging propio (~sin morgan): una línea por request —
// método, url, status y ms. Sin esto `docker logs`/`podman logs` (o el
// dev run local del dashboard) solo muestran el listen.
export const requestLogger = (req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - t0}ms`);
  });
  next();
};
