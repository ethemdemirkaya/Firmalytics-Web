import "@/styles/globals.css";
import { Space_Grotesk, Noto_Sans } from "next/font/google";
import Head from "next/head";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["300", "400", "500", "600", "700"],
});

const notoSans = Noto_Sans({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "700"],
});

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <title>Firmalytics PRO</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <main className={`${spaceGrotesk.variable} ${notoSans.variable} font-display`}>
        <Component {...pageProps} />
      </main>
    </>
  );
}