/**
 * Copy this file to config.js and set your n8n webhook URL.
 * config.js is gitignored — safe to put your production webhook there.
 *
 * On Netlify you can also set the webhook in the in-app Settings panel;
 * it is saved to localStorage in the browser.
 */
export const N8N_WEBHOOK_URL = "https://your-n8n-instance.app.n8n.cloud/webhook/spatial-vision";

/** Minimum seconds between n8n calls (avoids spamming while camera runs). */
export const N8N_MIN_INTERVAL_SEC = 4;

/** Use n8n for natural spatial sentences; if false, speaks locally only. */
export const USE_N8N = true;
