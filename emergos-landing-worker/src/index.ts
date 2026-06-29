const logoSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round">
  <path d="M8.39559 2.55196C9.8705 1.63811 11.1578 2.00638 11.9311 2.59299C12.2482 2.83351 12.4067 2.95378 12.5 2.95378C12.5933 2.95378 12.7518 2.83351 13.0689 2.59299C13.8422 2.00638 15.1295 1.63811 16.6044 2.55196C18.5401 3.75128 18.9781 7.7079 14.5133 11.046C13.6629 11.6818 13.2377 11.9996 12.5 11.9996C11.7623 11.9996 11.3371 11.6818 10.4867 11.046C6.02195 7.7079 6.45994 3.75128 8.39559 2.55196Z"></path>
  <path d="M4 14H6.39482C6.68897 14 6.97908 14.0663 7.24217 14.1936L9.28415 15.1816C9.54724 15.3089 9.83735 15.3751 10.1315 15.3751H11.1741C12.1825 15.3751 13 16.1662 13 17.142C13 17.1814 12.973 17.2161 12.9338 17.2269L10.3929 17.9295C9.93707 18.0555 9.449 18.0116 9.025 17.8064L6.84211 16.7503" stroke-linejoin="round"></path>
  <path d="M13 16.5L17.5928 15.0889C18.407 14.8352 19.2871 15.136 19.7971 15.8423C20.1659 16.3529 20.0157 17.0842 19.4785 17.3942L11.9629 21.7305C11.4849 22.0063 10.9209 22.0736 10.3952 21.9176L4 20.0199" stroke-linejoin="round"></path>
</svg>`;

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>emergOS</title>
  <meta name="description" content="emergOS is an open-source emergency response toolkit currently in development.">
  <meta property="og:title" content="emergOS">
  <meta property="og:description" content="Open-source emergency response tooling.">
  <meta property="og:type" content="website">
  <meta name="theme-color" content="#C91525">
  <style>
    :root {
      color-scheme: light;
      --red: #c91525;
      --red-dark: #a8121f;
      --text: #111827;
      --muted: #5b6472;
      --line: #eceff3;
      --bg: #ffffff;
    }

    * {
      box-sizing: border-box;
    }

    html {
      min-height: 100%;
    }

    body {
      min-height: 100vh;
      margin: 0;
      background:
        radial-gradient(circle at top right, rgb(201 21 37 / 7%), transparent 32rem),
        var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }

    a {
      color: inherit;
      text-decoration: none;
    }

    .page {
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr auto;
    }

    .shell {
      width: min(960px, calc(100% - 40px));
      margin: 0 auto;
    }

    header {
      padding: 28px 0;
    }

    .brand {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      font-weight: 720;
      font-size: 28px;
      color: var(--red);
    }

    .mark {
      width: 40px;
      height: 40px;
      display: grid;
      place-items: center;
      color: var(--red);
      background: rgb(255 255 255 / 72%);
      backdrop-filter: blur(12px);
    }

    .mark svg {
      width: 48px;
      height: 48px;
    }

    main {
      display: grid;
      place-items: center;
      padding: 48px 0 80px;
    }

    .hero {
      max-width: 760px;
    }

    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--red-dark);
      font-size: 14px;
      font-weight: 650;
      margin-bottom: 24px;
    }

    .status::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--red);
      box-shadow: 0 0 0 5px rgb(201 21 37 / 10%);
    }

    h1 {
      max-width: 720px;
      margin: 0;
      font-size: clamp(44px, 8vw, 92px);
      line-height: 0.95;
      letter-spacing: -0.04em;
    }

    p {
      max-width: 600px;
      margin: 28px 0 0;
      color: var(--muted);
      font-size: clamp(18px, 2vw, 22px);
      line-height: 1.55;
    }

    .cta {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 48px;
      margin-top: 36px;
      padding: 0 18px;
      color: #fff;
      background: var(--red);
      border: 1px solid var(--red);
      border-radius: 12px;
      font-weight: 700;
      transition: background 160ms ease, transform 160ms ease;
    }

    .cta:hover {
      background: var(--red-dark);
      transform: translateY(-1px);
    }

    footer {
      padding: 28px 0;
      color: var(--muted);
      font-size: 13px;
      text-align: center;
    }

    @media (max-width: 640px) {
      .shell {
        width: min(100% - 28px, 960px);
      }

      header {
        padding-top: 20px;
      }

      main {
        place-items: start center;
        padding-top: 72px;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <header>
      <div class="shell">
        <a class="brand" href="/" aria-label="emergOS home">
          <span class="mark">${logoSvg}</span>
          <span>emergOS</span>
        </a>
      </div>
    </header>

    <main>
      <section class="shell hero" aria-label="emergOS">
        <h1>Emergency response tooling for the first critical hours.</h1>
        <p>
          Open-source infrastructure for missing people, shelters, aid coordination, and printable offline search materials.
        </p>
        <a class="cta" href="https://github.com/emergOS">View on GitHub</a>
      </section>
    </main>

    <footer>
      <div class="shell">
        Not an emergency service. In immediate danger, contact local emergency services.
      </div>
    </footer>
  </div>
</body>
</html>`;

function htmlResponse(): Response {
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      "content-security-policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; connect-src 'none'; script-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY"
    }
  });
}

export default {
  async fetch(): Promise<Response> {
    return htmlResponse();
  }
};
