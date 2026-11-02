/**
 * Stack mobile: Expo SDK 54 (React Native 0.81) + Expo Router +
 * NativeWind v4 + Moti. `kind:'mobile'` — fuera del picker frontend
 * web (listStacks('mobile') lo filtra para la pestaña propia).
 *
 * El gate determinístico es el render WEB vía react-native-web:
 * devCmd levanta Metro en modo web (:8081) y e2e corre Playwright
 * headless contra ese preview. El APK nativo queda fuera del
 * toolchain (finalCheckCommands corre buildCmd siempre — un build
 * Gradle rompería hosts sin Java/SDK).
 *
 * `alwaysSkeleton`: el scaffolding babel/metro/nativewind es demasiado
 * frágil para improvisarlo por prompt — preflight copia el skeleton
 * aun sin vertical (appType custom, lo normal en mobile).
 */
import { hasMarker, pkgDeps } from './helpers.js';

export default {
  id: 'expo-mobile',
  kind: 'mobile',
  label: 'Mobile — Expo (Android/iOS/Web)',
  skeletonDir: 'app-skeleton-expo',
  skeletonDesc: 'Expo + Expo Router + NativeWind + Moti + Playwright (web)',
  agentsStack: 'Expo + Expo Router + NativeWind + Moti',
  alwaysSkeleton: true,
  // Fragmento AGENTS propio (templates/AGENTS.mobile.md) — las reglas
  // web de AGENTS.ui.md (DOM/Tailwind web/imágenes <img>) no aplican a RN.
  uiDoc: 'AGENTS.mobile.md',
  // expo export → dist/ (app.json web.output: 'static') — el Dockerfile
  // web lo sirve como deploy del build web.
  buildDir: 'dist',

  toolchain: {
    manifest: 'package.json',
    installCmd: 'npm install',
    // 'npm run web' → el script del package.json lleva CI=1 (el spawn
    // del dashboard/smoke splitea argv sin shell — un prefijo VAR=
    // sería el binario y fallaría con ENOENT).
    devCmd: 'npm run web',
    devPort: 8081,
    testCmd: 'npx tsc --noEmit',
    testLabel: 'TypeScript (tsc)',
    e2eCmd: 'npm run test:e2e',
    // Smoke de bundle web — verifica que el proyecto compila. NO es el
    // APK: compilar nativo exige Java 17-21 + Android SDK (fase opt-in).
    buildCmd: 'npx expo export --platform web',
  },

  // Menor número gana: app.json + dep `expo` es marcador inequívoco.
  detectPriority: 5,
  detect: (dir) => hasMarker(dir, 'app.json') && Boolean(pkgDeps(dir).expo),

  // Shape real de validatePlan: keywords son AND (mentions() exige
  // todas en description+verify) — substrings únicos o el planner
  // entra en loop de repair sin poder satisfacerlas nunca.
  requirements: [
    {
      check: 'some',
      type: 'frontend',
      keywords: ['expo'],
      error: 'falta paso de init Expo con Expo Router',
      prompt:
        'Debe incluir un paso `frontend` de init Expo con Expo Router, NativeWind y las dependencias base (reanimated, moti, linear-gradient, blur).',
    },
    {
      check: 'some',
      type: 'frontend',
      keywords: ['animac'],
      error: 'falta paso frontend con animaciones',
      prompt:
        'Algún paso `frontend` debe implementar animaciones (Moti) con fallback `Platform.OS === "web"` para no romper el preview.',
    },
    {
      check: 'some',
      type: 'test',
      keywords: ['tsc'],
      error: 'falta paso test de typecheck',
      prompt:
        'Al menos un paso `type: "test"` de typecheck con verify `npx tsc --noEmit`.',
    },
    {
      check: 'some',
      type: 'e2e',
      keywords: ['playwright'],
      error: 'falta paso e2e con Playwright sobre el preview web',
      prompt:
        'Debe incluir un paso `type: "e2e"` con Playwright (contra el preview web en :8081) cuyo verify sea `npm run test:e2e`.',
    },
  ],

  readme: {
    stack: '- Expo + Expo Router + NativeWind + Moti (mobile — Android/iOS/web)',
    e2eSuffix: ' + Playwright sobre preview web (E2E)',
    dev: 'npm run web        # preview web en http://localhost:8081',
    tests: ['npm run test:e2e   # E2E Playwright (Chromium, preview web)'],
    // Sección "Build nativo" del README generado — solo mobile la emite
    // (finalizer pasa readme.nativeBuild como {{nativeBuild}}).
    nativeBuild: [
      '## Build nativo (APK/AAB)',
      '',
      'El proyecto incluye `build.sh` + `scripts/fix-signing.py` para compilar',
      'localmente. Requisitos del host: **JDK 17–21** (Gradle rechaza Java 25 —',
      'apuntar `JAVA_HOME`, ej. `export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64`)',
      'y **Android SDK** (`ANDROID_HOME`, ej. `~/Android/Sdk` — el script lo',
      'auto-detecta si está en esa ruta).',
      '',
      '```bash',
      'bash build.sh test --no-install      # APK debug (sin keystore)',
      'bash build.sh staging                # APK firmado (keystore en keys/staging/)',
      'bash build.sh production --format aab # AAB para Play Store',
      '```',
      '',
      'Los artefactos quedan en `builds/<entorno>/`. `android/`, `keys/` y',
      '`builds/` están gitignored — el keystore es irreemplazable, hacer',
      'backup fuera del repo. Alternativa gestionada: `eas build -p android`',
      '(keystore en la cuenta Expo, sin toolchain local).',
      '',
    ].join('\n'),
  },
};
