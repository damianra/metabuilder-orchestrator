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

### Firma y Play Store (build nativo — fuera del toolchain de este repo)

- El pipeline genera y verifica la app vía preview web; el **APK/AAB
  nativo no se compila acá** (exige Java 17–21 + Android SDK — no
  instalarlos "por las dudas").
- **Vía recomendada — EAS Build** (`eas build --platform android`):
  EAS genera y guarda el *upload keystore* en la cuenta Expo, sin
  archivos locales (`eas credentials` para ver/descargar). Activá
  **Google Play App Signing** en Play Console: Google firma con su
  key y el upload key perdido se resetea — es el camino seguro.
- **Vía local** (solo si no hay EAS): `keytool -genkeypair -v
  -keyalg RSA -keysize 2048 -validity 10000 -alias upload
  -keystore keys/upload-keystore.jks`; `keys/` está gitignored —
  backup del keystore FUERA del repo (perderlo = no más updates).
  `npx expo prebuild` genera `android/`; los passwords van como env
  vars `MYAPP_UPLOAD_STORE_PASSWORD`/`MYAPP_UPLOAD_KEY_PASSWORD`
  (nunca commiteadas ni en `gradle.properties` trackeado) →
  `cd android && ./gradlew bundleRelease` produce el `.aab`.
- Nunca commitear keystores, fingerprints ni passwords de firma —
  `keys/`, `*.keystore`, `*.jks` ya están en `.gitignore`.

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
