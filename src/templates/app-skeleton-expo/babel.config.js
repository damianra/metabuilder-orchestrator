module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    // ⚠️ NO agregar 'react-native-reanimated/plugin' ni
    // 'react-native-worklets/plugin': en Reanimated 4.x el plugin vive
    // en react-native-worklets y babel-preset-expo lo inyecta
    // automáticamente — declararlo a mano produce double-plugin
    // (crashes crípticos de worklets en runtime).
    plugins: [],
  };
};
