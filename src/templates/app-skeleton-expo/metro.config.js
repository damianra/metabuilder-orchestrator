const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// tslib: con package-exports (default en SDK 54) Metro resuelve el
// condition "import" → tslib.es6.mjs (ESM puro, sin default export).
// Los helpers __extends hacen tslib.default → undefined → crash
// "Cannot destructure property '__extends' of 'tslib.default'".
// Forzamos el build CJS (tslib.js) solo para este paquete — apagar
// package-exports global rompería reanimated/worklets/expo-router.
const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'tslib') {
    return context.resolveRequest(context, 'tslib/tslib.js', platform);
  }
  return (defaultResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
