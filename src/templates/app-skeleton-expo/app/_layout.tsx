import { Stack } from 'expo-router';
import { Platform, View } from 'react-native';
import '../global.css';
import '../nativewind-setup';

export default function RootLayout() {
  const content = <Stack screenOptions={{ headerShown: false }} />;

  // Marco de proporción móvil para el preview web del dashboard — el
  // contenido se ve como dentro de un teléfono (max 430px centrado).
  if (Platform.OS === 'web') {
    return (
      <View className="flex-1 bg-gray-100 items-center justify-center">
        <View className="w-full max-w-[430px] h-full bg-white shadow-2xl overflow-hidden">
          {content}
        </View>
      </View>
    );
  }
  return content;
}
