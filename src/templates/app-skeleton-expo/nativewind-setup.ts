import { cssInterop } from 'nativewind';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { MotiView, MotiText } from 'moti';

// Mapea className → style para componentes de terceros que no lo
// soportan por defecto en NativeWind v4. Sin esto, `className` en
// estos componentes se ignora EN SILENCIO (el peor bug posible).
// Si agregás un componente de terceros con estilos, sumarle el
// cssInterop acá — nunca pasar style y className a la vez.
cssInterop(LinearGradient, { className: 'style' });
cssInterop(BlurView, { className: 'style' });
cssInterop(MotiView, { className: 'style' });
cssInterop(MotiText, { className: 'style' });
