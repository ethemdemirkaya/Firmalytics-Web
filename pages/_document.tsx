import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="tr" className="dark">
      <Head>
        {/*  */}
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=block"
          rel="stylesheet"
        />
      </Head>
      <body className="antialiased h-screen w-screen overflow-hidden bg-background-dark text-slate-200">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}