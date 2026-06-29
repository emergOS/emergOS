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
  <meta name="description" content="emergOS is an open-source Cloudflare-native crisis coordination starter for missing people, shelters, aid points, maps, tips, and printable flyers.">
  <meta property="og:title" content="emergOS">
  <meta property="og:description" content="Deploy a crisis coordination site before the first spreadsheet starts.">
  <meta property="og:type" content="website">
  <meta name="theme-color" content="#C91525">
  <link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%2024%2024%22%20width%3D%22128%22%20height%3D%22128%22%20color%3D%22%23c91525%22%20fill%3D%22none%22%20stroke%3D%22%23c91525%22%20stroke-width%3D%221%22%20stroke-linecap%3D%22round%22%3E%0A%20%20%20%20%3Cpath%20d%3D%22M8.39559%202.55196C9.8705%201.63811%2011.1578%202.00638%2011.9311%202.59299C12.2482%202.83351%2012.4067%202.95378%2012.5%202.95378C12.5933%202.95378%2012.7518%202.83351%2013.0689%202.59299C13.8422%202.00638%2015.1295%201.63811%2016.6044%202.55196C18.5401%203.75128%2018.9781%207.7079%2014.5133%2011.046C13.6629%2011.6818%2013.2377%2011.9996%2012.5%2011.9996C11.7623%2011.9996%2011.3371%2011.6818%2010.4867%2011.046C6.02195%207.7079%206.45994%203.75128%208.39559%202.55196Z%22%3E%3C/path%3E%0A%20%20%20%20%3Cpath%20d%3D%22M4%2014H6.39482C6.68897%2014%206.97908%2014.0663%207.24217%2014.1936L9.28415%2015.1816C9.54724%2015.3089%209.83735%2015.3751%2010.1315%2015.3751H11.1741C12.1825%2015.3751%2013%2016.1662%2013%2017.142C13%2017.1814%2012.973%2017.2161%2012.9338%2017.2269L10.3929%2017.9295C9.93707%2018.0555%209.449%2018.0116%209.025%2017.8064L6.84211%2016.7503%22%20stroke-linejoin%3D%22round%22%3E%3C/path%3E%0A%20%20%20%20%3Cpath%20d%3D%22M13%2016.5L17.5928%2015.0889C18.407%2014.8352%2019.2871%2015.136%2019.7971%2015.8423C20.1659%2016.3529%2020.0157%2017.0842%2019.4785%2017.3942L11.9629%2021.7305C11.4849%2022.0063%2010.9209%2022.0736%2010.3952%2021.9176L4%2020.0199%22%20stroke-linejoin%3D%22round%22%3E%3C/path%3E%0A%3C/svg%3E" type="image/svg+xml">
  <link rel="shortcut icon" href="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%2024%2024%22%20width%3D%22128%22%20height%3D%22128%22%20color%3D%22%23c91525%22%20fill%3D%22none%22%20stroke%3D%22%23c91525%22%20stroke-width%3D%221%22%20stroke-linecap%3D%22round%22%3E%0A%20%20%20%20%3Cpath%20d%3D%22M8.39559%202.55196C9.8705%201.63811%2011.1578%202.00638%2011.9311%202.59299C12.2482%202.83351%2012.4067%202.95378%2012.5%202.95378C12.5933%202.95378%2012.7518%202.83351%2013.0689%202.59299C13.8422%202.00638%2015.1295%201.63811%2016.6044%202.55196C18.5401%203.75128%2018.9781%207.7079%2014.5133%2011.046C13.6629%2011.6818%2013.2377%2011.9996%2012.5%2011.9996C11.7623%2011.9996%2011.3371%2011.6818%2010.4867%2011.046C6.02195%207.7079%206.45994%203.75128%208.39559%202.55196Z%22%3E%3C/path%3E%0A%20%20%20%20%3Cpath%20d%3D%22M4%2014H6.39482C6.68897%2014%206.97908%2014.0663%207.24217%2014.1936L9.28415%2015.1816C9.54724%2015.3089%209.83735%2015.3751%2010.1315%2015.3751H11.1741C12.1825%2015.3751%2013%2016.1662%2013%2017.142C13%2017.1814%2012.973%2017.2161%2012.9338%2017.2269L10.3929%2017.9295C9.93707%2018.0555%209.449%2018.0116%209.025%2017.8064L6.84211%2016.7503%22%20stroke-linejoin%3D%22round%22%3E%3C/path%3E%0A%20%20%20%20%3Cpath%20d%3D%22M13%2016.5L17.5928%2015.0889C18.407%2014.8352%2019.2871%2015.136%2019.7971%2015.8423C20.1659%2016.3529%2020.0157%2017.0842%2019.4785%2017.3942L11.9629%2021.7305C11.4849%2022.0063%2010.9209%2022.0736%2010.3952%2021.9176L4%2020.0199%22%20stroke-linejoin%3D%22round%22%3E%3C/path%3E%0A%3C/svg%3E" type="image/svg+xml">
  <style>
    :root {
      color-scheme: light;
      --red: #c91525;
      --red-dark: #a8121f;
      --text: #101114;
      --muted: #626a76;
      --soft: #f7f3f3;
      --line: #ede7e7;
      --bg: #ffffff;
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      --sans: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }

    html {
      scroll-behavior: smooth;
      width: 100%;
      overflow-x: hidden;
    }

    body {
      width: 100%;
      margin: 0;
      overflow-x: hidden;
      background: var(--bg);
      color: var(--text);
      font-family: var(--sans);
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    a { color: inherit; text-decoration: none; }

    .shell {
      width: min(1080px, calc(100% - clamp(28px, 6vw, 40px)));
      margin: 0 auto;
    }

    header {
      padding: 28px 0 12px;
    }

    .nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
    }

    .brand {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      color: var(--red);
      font-size: 35px;
      font-weight: 730;
      letter-spacing: -0.035em;
    }

    .mark {
      width: 42px;
      height: 42px;
      display: grid;
      place-items: center;
      color: var(--red);
      flex: 0 0 auto;
    }

    .mark svg {
      width: 48px;
      height: 48px;
      display: block;
    }

    .github-link {
      color: var(--muted);
      font-size: 14px;
      font-weight: 650;
    }

    .github-link:hover { color: var(--red); }

    main {
      /*padding: clamp(54px, 8vw, 88px) 0 clamp(56px, 8vw, 72px);*/
    }

    .hero {
      max-width: 860px;
    }

    .eyebrow {
      margin: 0 0 22px;
      color: var(--red);
      font-size: 14px;
      font-weight: 760;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    h1 {
      max-width: 840px;
      margin: 0;
      font-size: clamp(42px, 8.6vw, 96px);
      line-height: 0.96;
      letter-spacing: -0.06em;
      font-weight: 780;
    }

    .lead {
      max-width: 690px;
      margin: 30px 0 0;
      color: var(--muted);
      font-size: clamp(18px, 2vw, 24px);
      line-height: 1.5;
      letter-spacing: -0.015em;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 18px;
      margin-top: 38px;
    }

    .cf-deploy-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 0;
      transition: transform 160ms ease;
    }

    .cf-deploy-button:hover {
      transform: translateY(-1px);
    }

    .cf-deploy-button img {
      display: block;
      width: auto;
      max-width: 100%;
      height: 42px;
    }

    .text-link {
      color: var(--muted);
      font-size: 15px;
      font-weight: 690;
      letter-spacing: -0.01em;
    }

    .text-link:hover { color: var(--red); }

    .command-inline {
      color: var(--muted);
      font-family: var(--mono);
      font-size: 13px;
      line-height: 1.5;
    }

    section {
      margin-top: clamp(72px, 10vw, 104px);
    }

    .section-title {
      margin: 0;
      color: var(--red);
      font-size: 13px;
      font-weight: 780;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    .section-lead {
      max-width: 760px;
      margin: 16px 0 0;
      font-size: clamp(28px, 4vw, 48px);
      line-height: 1.05;
      letter-spacing: -0.043em;
      font-weight: 760;
    }

    .features {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: clamp(28px, 4vw, 44px);
      margin-top: clamp(34px, 4vw, 44px);
    }

    .feature h3 {
      margin: 0;
      font-size: 18px;
      line-height: 1.2;
      letter-spacing: -0.02em;
    }

    .feature p {
      margin: 12px 0 0;
      color: var(--muted);
      font-size: 16px;
      line-height: 1.58;
    }

    .deploy {
      display: grid;
      grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
      gap: 56px;
      align-items: start;
    }

    .deploy-copy p {
      margin: 16px 0 0;
      color: var(--muted);
      font-size: 18px;
      line-height: 1.58;
    }

    .terminal {
      margin: 2px 0 0;
      max-width: 100%;
      overflow: hidden;
      border-radius: 16px;
      background: #111318;
      color: #f4f4f5;
      font-family: var(--mono);
      box-shadow: 0 24px 70px rgb(16 17 20 / 14%);
    }

    .terminal-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 38px;
      padding: 0 14px;
      background: #e9e9ec;
      border-bottom: 1px solid rgb(0 0 0 / 12%);
    }

    .terminal-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #d0d0d4;
    }

    .terminal-title {
      flex: 1;
      margin-left: -40px;
      color: #5d626b;
      font-family: var(--sans);
      font-size: 12px;
      font-weight: 650;
      text-align: center;
      letter-spacing: -0.01em;
    }

    .terminal pre {
      margin: 0;
      padding: 22px;
      max-width: 100%;
      overflow-x: auto;
      color: inherit;
      background: transparent;
      font-family: inherit;
      font-size: 13px;
      line-height: 1.65;
      white-space: pre;
      -webkit-overflow-scrolling: touch;
    }

    .prompt { color: #aeb4bf; }
    .ok { color: #d7f7df; }
    .dim { color: #8f98a8; }

    code { font-family: var(--mono); }

    .note {
      margin-top: 18px;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.55;
    }

    footer {
      padding: 32px 0 34px;
      color: var(--muted);
      font-size: 13px;
    }

    .footer-inner {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      border-top: 1px solid var(--line);
      padding-top: 22px;
    }

    @media (max-width: 820px) {
      .features { grid-template-columns: 1fr; }
      .deploy { grid-template-columns: 1fr; gap: 32px; }
      .footer-inner { flex-direction: column; }
    }

    @media (max-width: 560px) {
      header { padding: 20px 0 6px; }

      .brand {
        gap: 10px;
        font-size: 35px;
      }

      .mark {
        width: 36px;
        height: 36px;
      }

      .mark svg {
        width: 42px;
        height: 42px;
      }

      .github-link { display: none; }

      h1 {
        font-size: clamp(38px, 12vw, 52px);
        line-height: 0.98;
        letter-spacing: -0.052em;
      }

      .eyebrow {
        margin-bottom: 18px;
        font-size: 12px;
        letter-spacing: 0.075em;
      }

      .lead {
        margin-top: 24px;
        font-size: 18px;
        line-height: 1.48;
      }

      .actions {
        width: 100%;
        align-items: stretch;
        flex-direction: column;
        gap: 14px;
        margin-top: 30px;
      }

      .cf-deploy-button {
        align-self: flex-start;
      }

      .cf-deploy-button img {
        height: 40px;
      }

      .text-link {
        width: 100%;
      }

      .command-inline {
        width: 100%;
        max-width: 100%;
        overflow-wrap: anywhere;
        font-size: 12px;
      }

      .section-title {
        font-size: 12px;
        letter-spacing: 0.085em;
      }

      .section-lead {
        margin-top: 14px;
        font-size: clamp(27px, 8vw, 34px);
        line-height: 1.08;
        letter-spacing: -0.035em;
      }

      .feature h3 { font-size: 17px; }
      .feature p { font-size: 15px; line-height: 1.55; }

      .deploy-copy p {
        font-size: 16px;
        line-height: 1.55;
      }

      .terminal {
        width: 100%;
        border-radius: 14px;
        box-shadow: 0 18px 46px rgb(16 17 20 / 12%);
      }

      .terminal-bar {
        height: 34px;
        padding: 0 12px;
      }

      .terminal-dot {
        width: 10px;
        height: 10px;
      }

      .terminal-title { display: none; }

      .terminal pre {
        padding: 16px;
        font-size: 11.5px;
        line-height: 1.6;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      .note {
        font-size: 13px;
      }

      footer {
        padding-bottom: 28px;
      }
    }

    @media (max-width: 380px) {
      h1 { font-size: 36px; }
      .lead { font-size: 17px; }
      .terminal pre { font-size: 11px; padding: 14px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="shell nav">
      <a class="brand" href="/" aria-label="emergOS home">
        <span class="mark" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round">
            <path d="M8.39559 2.55196C9.8705 1.63811 11.1578 2.00638 11.9311 2.59299C12.2482 2.83351 12.4067 2.95378 12.5 2.95378C12.5933 2.95378 12.7518 2.83351 13.0689 2.59299C13.8422 2.00638 15.1295 1.63811 16.6044 2.55196C18.5401 3.75128 18.9781 7.7079 14.5133 11.046C13.6629 11.6818 13.2377 11.9996 12.5 11.9996C11.7623 11.9996 11.3371 11.6818 10.4867 11.046C6.02195 7.7079 6.45994 3.75128 8.39559 2.55196Z"></path>
            <path d="M4 14H6.39482C6.68897 14 6.97908 14.0663 7.24217 14.1936L9.28415 15.1816C9.54724 15.3089 9.83735 15.3751 10.1315 15.3751H11.1741C12.1825 15.3751 13 16.1662 13 17.142C13 17.1814 12.973 17.2161 12.9338 17.2269L10.3929 17.9295C9.93707 18.0555 9.449 18.0116 9.025 17.8064L6.84211 16.7503" stroke-linejoin="round"></path>
            <path d="M13 16.5L17.5928 15.0889C18.407 14.8352 19.2871 15.136 19.7971 15.8423C20.1659 16.3529 20.0157 17.0842 19.4785 17.3942L11.9629 21.7305C11.4849 22.0063 10.9209 22.0736 10.3952 21.9176L4 20.0199" stroke-linejoin="round"></path>
          </svg>
        </span>
        <span>emergOS</span>
      </a>
      <a class="github-link" href="https://github.com/emergOS/emergOS">GitHub</a>
    </div>
  </header>

  <main>
    <div class="shell">
      <section class="hero" aria-label="emergOS introduction">
        <p class="eyebrow">Open-source crisis coordination</p>
        <h1>Deploy a response site before the spreadsheet chaos starts.</h1>
        <p class="lead">emergOS is a Cloudflare-native starter for missing people, found reports, shelters, aid points, maps, tips, organizations, and printable flyers. Fork it, configure the crisis, and ship.</p>
        <div class="actions">
          <a class="cf-deploy-button" href="https://deploy.workers.cloudflare.com/?url=https://github.com/emergOS/emergOS/tree/main/apps/emergos-worker" aria-label="Deploy emergOS to Cloudflare">
            <img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare">
          </a>
          <a class="text-link" href="https://github.com/emergOS/emergOS">GitHub</a>
          <span class="command-inline">or npm create @emergos/emergos@latest</span>
        </div>
      </section>

      <section aria-label="Core functionality">
        <p class="section-title">What it gives you</p>
        <h2 class="section-lead">The modules needed in the first critical hours, already wired together.</h2>
        <div class="features">
          <div class="feature">
            <h3>People and pets</h3>
            <p>Missing and found reports, photo upload, sightings, case pages, self-service updates, and printable flyers with QR codes.</p>
          </div>
          <div class="feature">
            <h3>Resources and map</h3>
            <p>Shelters, hospitals, aid centers, volunteer points, public updates, map layers, and a list fallback for low-bandwidth situations.</p>
          </div>
          <div class="feature">
            <h3>Moderation and partners</h3>
            <p>Review queues, consent controls, takedown flow, org pages, role scoping, audit logs, CSV import/export, and a token-scoped partner API.</p>
          </div>
        </div>
      </section>

      <section class="deploy" aria-label="Deployment">
        <div class="deploy-copy">
          <p class="section-title">Deploy fast</p>
          <h2 class="section-lead">One Worker. Crisis defaults included.</h2>
          <p>Use the Deploy to Cloudflare button for the Worker app, or generate a standalone project with country, locale, and crisis defaults. It runs on Cloudflare Workers with D1, R2, KV, Queues, Turnstile, Hono, React, Vite, and Wrangler.</p>
        </div>
        <div>
          <div class="terminal" aria-label="Terminal example">
            <div class="terminal-bar" aria-hidden="true">
              <span class="terminal-dot"></span>
              <span class="terminal-dot"></span>
              <span class="terminal-dot"></span>
              <span class="terminal-title">zsh · emergOS</span>
            </div>
            <pre><code><span class="prompt">martin@macbook ~ %</span> npm create @emergos/emergos@latest my-response -- \
  --profile earthquake \
  --country VE \
  --locale es-VE \
  --deployment cloudflare
<span class="ok">✔</span> created my-response
<span class="ok">✔</span> added earthquake response profile
<span class="ok">✔</span> configured es-VE for Venezuela
<span class="ok">✔</span> prepared Cloudflare Worker deployment

<span class="prompt">martin@macbook ~ %</span> cd my-response
<span class="prompt">martin@macbook my-response %</span> pnpm install
<span class="dim">Packages installed. Next: pnpm dev</span></code></pre>
          </div>
          <p class="note">Deploy Button support is for the Worker app. The CLI path creates standalone projects with earthquake, flood, hurricane, wildfire, conflict, and multi-crisis profiles.</p>
        </div>
      </section>
    </div>
  </main>

  <footer>
    <div class="shell footer-inner">
      <span>Not an emergency service. In immediate danger, contact local emergency services.</span>
      <span>emergOS is open source.</span>
    </div>
  </footer>
</body>
</html>`;

function htmlResponse(): Response {
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: https://deploy.workers.cloudflare.com; connect-src 'none'; script-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests",
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
