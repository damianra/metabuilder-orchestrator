import { View, Text, Platform } from 'react-native';
import { MotiView } from 'moti';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';

export default function Home() {
  // Fallback web: solo View/Text con className (RNW los entiende).
  // bg-gradient-to-* es Tailwind CSS web — NO existe en NativeWind
  // nativo; por eso el gradient nativo va en el otro branch.
  if (Platform.OS === 'web') {
    return (
      <View className="flex-1 items-center justify-center p-6 bg-gradient-to-b from-indigo-500 to-purple-600">
        <Text className="text-white text-2xl font-bold">__APP_NAME__</Text>
        <Text className="text-white/70 mt-2">Welcome</Text>
      </View>
    );
  }

  // Nativo: componentes de terceros con className via cssInterop
  // (configurado en nativewind-setup.ts).
  return (
    <LinearGradient colors={['#6366f1', '#9333ea']} className="flex-1">
      <MotiView
        from={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', damping: 15 }}
        className="flex-1 items-center justify-center p-6"
      >
        <BlurView intensity={50} className="rounded-3xl p-8">
          <Text className="text-white text-2xl font-bold">__APP_NAME__</Text>
          <Text className="text-white/70 mt-2">Welcome</Text>
        </BlurView>
      </MotiView>
    </LinearGradient>
  );
}
