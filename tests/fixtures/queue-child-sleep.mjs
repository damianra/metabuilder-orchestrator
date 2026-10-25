// Hijo fake de larga vida para el test de cancelación: vive hasta que
// lo maten (SIGTERM default mata el proceso).
console.error('SLEEPY-START');
setInterval(() => {}, 10_000);
