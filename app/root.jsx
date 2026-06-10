import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              /* Prevent giant Polaris Spinner during initial load (FOUC) */
              .Polaris-Spinner {
                width: 44px !important;
                height: 44px !important;
                display: block !important;
                margin: 20vh auto !important;
              }
              .Polaris-Spinner svg {
                width: 44px !important;
                height: 44px !important;
              }
            `,
          }}
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
