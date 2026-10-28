// Perfil de cumplimiento: autenticación de usuarios. Se infiere cuando
// la idea menciona login/registro/cuentas — o se fuerza con
// --compliance auth.
export default {
  id: 'auth',
  label: 'Autenticación',
  infer: /(login|log\s?in|registro|register|signup|sign\s?up|cuenta|account|perfil|usuarios?|members?|miembros?)/,
  promptBlock: `
- Autenticación: sesiones en cookies httpOnly + SameSite + Secure (nunca tokens en localStorage ni en el body de respuestas al frontend); passwords hasheados con bcrypt o argon2 (nunca texto plano ni hash propio); rate limit en endpoints de login/registro (el rate limit base del skeleton ya aplica); CSRF token en formularios autenticados; rutas protegidas verifican sesión server-side (nunca solo en el cliente).`,
  requirements: [
    {
      check: 'some',
      type: 'backend',
      keywords: ['sesion'],
      error: 'algún paso backend debe declarar la autenticación (sesiones httpOnly, hashing, rate limit en login)',
      prompt:
        'Algún paso `backend` debe declarar la autenticación: cookies httpOnly+SameSite+Secure, password hashing (bcrypt/argon2), rate limit en login, verificación server-side.',
    },
  ],
};
