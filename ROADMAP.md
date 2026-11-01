# MetaBuilder — Roadmap v14

## Estado

v13 completa: smoke runtime post-build, contract tests por endpoint,
review scoped al diff con screenshot, prompt pruning, component kit
pre-styled y `fastapi-mongo` (cierre de la matriz framework × DB).
Registro histórico: `docs/archive/` (ROADMAP-v1.md … ROADMAP-v13.md).

## Visión v14

**Nueva dimensión: mobile, no nuevo framework web.** v13 cerró el scope
de stacks web — v14 lo reabre solo en el eje *plataforma*: el
orquestador gana la capacidad de generar apps móviles reales (Expo /
React Native) sin tocar el flujo existente. El principio rector sigue
siendo el de v13 — **verificación determinística por sobre amplitud** —
por eso el stack nace con preview web headless (Playwright sobre
`react-native-web`), sin emulador ni cuentas cloud en el camino
obligatorio; el build nativo de APK queda como fase opt-in aislada.

Spec de referencia validada contra el registry: stack `expo-mobile`
(`kind: 'mobile'`, contrato real de `requirements`/`readme`/`detect`/
`toolchain`) + skeleton `app-skeleton-expo/` basado en lecciones de
producción (Expo SDK 54 / RN 0.81, Prebuild CNG, NativeWind v4, Moti).

## Backlog v14

| # | Tarea | Esfuerzo |
| --- | --- | --- |
| 1 | **Stack def `expo-mobile` + registro** — `src/stacks/expo-mobile.js` + import en `index.js`. `kind:'mobile'`, `skeletonDir:'app-skeleton-expo'`, `detect` = `hasMarker('app.json') && !!pkgDeps(dir).expo` con `detectPriority:5`, `readme` como **objeto** `{stack,e2eSuffix,dev,tests}` (contrato de `finalizer.js`), `requirements` con shape real `{check:'some',type,keywords,error,prompt}` y keywords AND-seguras (`['expo']`,`['animac']`,`['tsc']`,`['playwright']` — `mentions()` exige todos), toolchain: `installCmd:'npm install'`, `devCmd:'npm run web'` (spawn sin shell — nunca prefijos `VAR=` en devCmd), `devPort:8081`, `testCmd:'npx tsc --noEmit'`, `e2eCmd:'npm run test:e2e'`, `buildCmd:'npx expo export --platform web'` (smoke de bundle, sin APK). | S |
| 2 | **Skeleton `app-skeleton-expo/`** — árbol completo: `package.json` (deps pineadas Expo SDK 54/RN 0.81 + `@playwright/test`), `app.json` (plugins solo los que existen: `expo-router`, `expo-secure-store`; `expo-blur` va por autolinking), `babel.config.js` (reanimated plugin SIEMPRE último), `metro.config.js` (`withNativeWind`), `tailwind.config.js` (content `app/`+`src/`), `global.css`, `tsconfig.json`, `nativewind-env.d.ts` (sin esto `tsc` rechaza `className`), `nativewind-setup.ts` (`cssInterop` para LinearGradient/BlurView/MotiView), `app/_layout.tsx` (wrapper proporción móvil en web), `app/index.tsx` (ejemplo con fallback `Platform.OS==='web'`), `src/db/storage.ts` + `storage.web.ts` (resolución de plataformas — **nunca** un base que re-exporte `.native`), `playwright.config.js` (webServer `npm run web`, timeout 180s por Metro), `e2e/smoke.spec.ts`, `.gitignore` (`android/`/`ios/`/`keys/`/`*.jks`), `assets/` con PNGs reales, `AGENTS.md` del skeleton (reglas UI/fallback/sqlite/`expo install`). | M |
| 3 | **`server.js`: exponer y aceptar `kind:'mobile'`** — `listStacks('mobile')` al payload de options (~:521) y la validación de `stackFrontend` (~:861) contra `frontend + mobile`; hoy un POST con `stackFrontend:'expo-mobile'` devuelve 400. | XS |
| 4 | **Dashboard: pestaña Mobile + MobilePreview** — nueva pestaña que consume `stacks.mobile` y postea `scope:'frontend'` + `stackFrontend:'expo-mobile'`; iframe de preview con marco de teléfono (390×844, borde redondeado) sobre el puerto 8081 trackeado por `dev-run` (detecta el stack solo vía `detect`). | S |
| 5 | **Tests del stack en la suite vitest** — detect: positivo (app.json+expo) y negativo (app.json sin dep expo); requirements: shape y keywords no generan falsos negativos; toolchain: devCmd spliteable por `split(/\s+/)` sin env-prefix. | XS |
| 6 | **E2E real: generar una app mobile** — run completo `--scope frontend --stack-frontend expo-mobile`: install, `npm run web` levanta, preview renderiza en el iframe, `tsc --noEmit` pasa, `playwright test` verde headless, `validatePlan` sin loops de repair, `plan.stacks` persiste `expo-mobile` para resume. | S |
| 7 | **Verticals mobile en planner prompts** — traducir conceptos web→mobile (landing→onboarding con CTA fijo, form HTML→`TextInput`, grid→`FlatList`, modal DOM→`Modal` RN) para que el agente no genere patrones DOM en React Native. | S |
| 8 | **CLI picker incluye mobile** — `index.js` interactive ask usa `listStacks('frontend')`; extender a `frontend + mobile` (hoy el stack solo es accesible por flag `--stack-frontend expo-mobile`, que funciona vía `pick()` por id). | XS |
| 9 | **`--build-apk` opt-in (fase posterior)** — copia `build.sh` + `scripts/fix-signing.py` al proyecto, preflight Java 17–21 (rechaza 25) + Android SDK + keytool **solo** cuando el flag está presente, ejecuta `bash build.sh staging --no-install` (sin `./` — exec bit no garantizado en templates), reporta ruta del APK en `status.json`. Nunca en `toolchain.buildCmd` (rompería `finalCheckCommands` en hosts sin SDK). | M |

## Límites conocidos (documentados — no accionables hoy)

- **`expo-sqlite` no corre en web** — el preview usa el mock
  `storage.web.ts`; features de DB local no se ejercitan en el
  preview/e2e web (limitación aceptada, documentada en el AGENTS del
  skeleton).
- **E2E es sobre el render web**, no nativo — Playwright valida la UI
  vía `react-native-web`; comportamiento solo-nativo (gestos,
  permisos, storage real) queda fuera del gate hasta una fase con
  emulador/Maestro.
- **Sin iOS** — el host es Linux; el stack declara iOS pero ninguna
  fase lo ejercita ni lo puede ejercitar.
- **`--build-apk` requiere entorno local** — Java 17–21 + Android SDK
  + keytool en el host del orquestador; sin ellos la fase no aplica
  (por eso es opt-in, nunca parte del toolchain).

## Decisiones tomadas (v14)

- **`kind:'mobile'` separado de `'frontend'`** — permite pestaña propia
  en el dashboard y filtrado por `listStacks('mobile')`; `resolveStacks`
  resuelve por id sin chequear kind, así que `--stack-frontend
  expo-mobile` y `plan.stacks.frontend='expo-mobile'` funcionan sin
  tocar el grafo.
- **Preview web como gate determinístico** — `react-native-web` +
  wrapper de proporción móvil + Playwright headless reusando
  `~/.cache/ms-playwright` del host: el 90% del ciclo de validación no
  depende de emulador, SDK ni cuentas cloud (la misma filosofía del
  smoke de v13).
- **Build APK fuera del toolchain** — `finalCheckCommands` corre
  `buildCmd` siempre; compilar APK en cada verify rompería todo host
  sin Java/SDK. `buildCmd` es solo un smoke de bundle web
  (`expo export --platform web`).
- **E2E con Playwright, no Maestro** — Maestro exige emulador +
  instalación manual; Playwright corre headless con la infra ya
  instalada. Maestro queda como opcional futura para tests nativos.
- **Versión pineada a matriz probada** — las deps del skeleton copian
  las versiones verificadas en producción (SDK 54 / RN 0.81.5): Expo
  rompe con cualquier deriva de versiones; el agente no elige números.
