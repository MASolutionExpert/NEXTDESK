import './globals.css';
import NextDeskShell from '../components/NextDeskShell.jsx';

export const metadata = {
  title: 'NextDesk',
  description: 'Self-hosted real-time organizational messenger and helpdesk platform built with Next.js.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icons/icon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: [{ url: '/icons/icon-180.png', sizes: '180x180' }],
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#ecfdf5',
};

const themePreloadScript = `
(function () {
  try {
    var stored = localStorage.getItem("chatdesk-theme");
    var isDark = stored === "dark";
    if (isDark) {
      var root = document.documentElement;
      root.classList.add("dark", "sb-preload-dark");
      root.style.colorScheme = "dark";
      root.style.backgroundColor = "#020617";
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", "#020617");
    }
  } catch (_) {}
})();
`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style>{'html,body{background:#ffffff;}html.sb-preload-dark,html.sb-preload-dark body{background:#020617;}'}</style>
        <script dangerouslySetInnerHTML={{ __html: themePreloadScript }} />
      </head>
      <body suppressHydrationWarning>
        <NextDeskShell>{children}</NextDeskShell>
      </body>
    </html>
  );
}
