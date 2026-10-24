import './globals.css';

export const metadata = {
  title: '__APP_NAME__',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
