## Reglas de UI y desarrollo mobile (React Native / Expo — obligatorias)

**Contexto**: app React Native con Expo Router. NO existe DOM: los
componentes son `View`, `Text`, `TextInput`, `FlatList`, `Modal`,
`Pressable`, `ScrollView`, `KeyboardAvoidingView` de `react-native` —
nunca elementos HTML ni patrones web (`<div>`, `onClick`, `className`
con utilidades CSS-web-only, `<form>`, `<input>`).

### Estilos — NativeWind v4

- `className` es el estándar sobre `View`, `Text`, etc. (componentes
  core de RN). Sobre componentes de TERCEROS (`LinearGradient`,
  `BlurView`, `MotiView`) funciona porque `nativewind-setup.ts` ya
  registra `cssInterop` — si agregás un componente de terceros con
  estilos, sumale el `cssInterop` ahí. Nunca pasar `style` y
  `className` a la vez.
- Las utilidades que solo existen en CSS web (`bg-gradient-to-*`,
  `backdrop-blur`, `line-clamp`, `cursor-*`) NO existen en nativo:
  reservarlas al branch `Platform.OS === 'web'`.
- **Nunca agregues plugins a `babel.config.js`** — en Reanimated 4.x
  el plugin de worklets lo inyecta solo `babel-preset-expo`;
  declarar `react-native-reanimated/plugin` (no existe en 4.x) o
  `react-native-worklets/plugin` a mano produce double-plugin y
  crashes crípticos en runtime.

### Diseño no genérico y animaciones

- Priorizá `moti` (`MotiView`, `MotiText`) para animaciones de
  entrada/salida y micro-interacciones — `from`/`animate`/`transition`.
- `expo-linear-gradient` para fondos con profundidad y `expo-blur`
  (`BlurView`) para glassmorphism (sheets, cards flotantes).
- Iconos: `lucide-react-native`. Imágenes remotas: `expo-image`
  (no `<img>`) o `Image` de RN con `source={{ uri }}`.

### Fallback web OBLIGATORIO (crash silencioso = bug más grave posible)

- `react-native-reanimated` (en algunos casos), `expo-blur` y
  `expo-sqlite` NO funcionan en el preview web. El preview web corre
  Playwright headless — si un componente nativo rompe el render web,
  TODO el gate e2e falla.
- Toda pantalla debe renderizar completa en web: usá
  `Platform.OS === 'web'` con fallback a `View`/`Text` + className
  cuando un componente nativo no tenga equivalente web.
- La capa de DB usa resolución de plataformas: `src/db/storage.ts`
  (nativo, `expo-sqlite`) y `src/db/storage.web.ts` (mock en memoria).
  **Nunca** crear un archivo base que haga `export * from './*.native'`
  — fuerza el import nativo en web y crashea.
- `expo-sqlite`: `runAsync`/`getAllAsync` reciben SOLO arrays de
  primitivos (string|number|boolean|null). Fechas → `toISOString()`,
  undefined → `null`. Nunca objetos anidados como params.

### Navegación y estructura

- Expo Router: pantallas en `app/` (file-based, `app/index.tsx` =
  `/`). Links con `<Link>` de `expo-router` o `router.push()`.
- `app/_layout.tsx` monta el `Stack` y el marco de proporción móvil
  del preview web — no sacar ese wrapper.

### Dependencias

- `npx expo install <paquete>` para cualquier `expo-*` /
  `react-native-*` — `npm install` a mano puede desalinear la matriz
  de versiones de Expo y romper el bundle.
- **Nunca** editar `android/` ni `ios/` — `expo prebuild` los
  regenera (CNG) y todo cambio manual se pierde.

### Equivalencias web → mobile (para traducir las reglas genéricas)

- "Checkbox de consentimiento en formularios": en mobile, un
  `Pressable` con estado (check visual) + copy "Acepto la política de
  privacidad" — el submit deshabilitado hasta aceptar.
- "Página /privacidad": pantalla `app/privacy.tsx` navegable desde el
  footer/settings — mismas exigencias de contenido (datos, finalidad,
  retención, derechos, contacto).
- "Scripts de terceros con tracking": no aplica en nativo; igual se
  prohíben SDKs de analytics/tracking sin consentimiento.
- `dangerouslySetInnerHTML` no existe en RN — equivalente: nunca
  interpolar input de usuario en URIs/`Linking.openURL` sin sanitizar.

{{imageSources}}
