// The page a browser lands on when a CLI-driven flow (sign-in, checkout)
// returns to the local listener: one card, the outcome, and "back to your
// terminal". Shared so every local-return page looks the same.
export function renderBrowserPage(title: string, accent: string, headline: string, body: string, icon: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} | Polylane</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --surface: #ffffff;
  --border: rgba(0, 0, 0, 0.08);
  --text: #171717;
  --text-muted: rgba(0, 0, 0, 0.55);
  --accent: ${accent};
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 12px 24px -12px rgba(0, 0, 0, 0.08);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0a0a0a;
    --surface: #121212;
    --border: rgba(255, 255, 255, 0.08);
    --text: #fafafa;
    --text-muted: rgba(255, 255, 255, 0.55);
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 12px 24px -12px rgba(0, 0, 0, 0.6);
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; }
body {
  font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--bg);
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
}
.wordmark {
  position: fixed;
  top: 24px;
  left: 32px;
  font-weight: 600;
  font-size: 16px;
  letter-spacing: -0.01em;
}
.wordmark::after {
  content: "";
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-left: 6px;
  border-radius: 50%;
  background: var(--accent);
  vertical-align: middle;
  transform: translateY(-1px);
}
.card {
  width: min(420px, calc(100% - 48px));
  padding: 40px 32px 32px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: var(--shadow);
  text-align: center;
}
.icon {
  width: 48px;
  height: 48px;
  margin: 0 auto 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}
.icon svg { width: 24px; height: 24px; stroke: currentColor; fill: none; stroke-width: 2.25; stroke-linecap: round; stroke-linejoin: round; }
h1 {
  margin: 0 0 8px;
  font-weight: 600;
  font-size: 20px;
  letter-spacing: -0.01em;
}
p {
  margin: 0;
  color: var(--text-muted);
  font-size: 14px;
  line-height: 1.5;
}
.hint {
  margin-top: 20px;
  font-size: 12px;
  color: var(--text-muted);
  font-family: 'DM Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
</style>
</head>
<body>
  <div class="wordmark">Polylane</div>
  <main class="card">
    <div class="icon">${icon}</div>
    <h1>${headline}</h1>
    <p>${body}</p>
  </main>
</body>
</html>`;
}

export const CHECK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="5 12.5 10 17.5 19 7.5"/></svg>';
export const ALERT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="7" x2="12" y2="13"/><line x1="12" y1="17" x2="12" y2="17.01"/><circle cx="12" cy="12" r="9"/></svg>';
