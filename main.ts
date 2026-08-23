// Resolve a short invite code to its group via the Supabase RPC. Returns
// { group_id, name } or null (unknown/archived code, or env not configured).
async function resolveInvite(
  code: string,
): Promise<{ group_id: string; name: string } | null> {
  const base = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!base || !key) return null;
  try {
    const r = await fetch(`${base}/rest/v1/rpc/get_invite_info`, {
      method: "POST",
      headers: {
        "apikey": key,
        "authorization": `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ p_code: code }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data && data.group_id ? data : null;
  } catch {
    return null;
  }
}

// Origin of the Flutter web app that invite links hand visitors off to.
//
// Hard-coded on purpose. This used to be the WEB_APP_URL env var set in the
// Deno Deploy dashboard, and during the getzaldo.com migration it was left
// pointing at a stale Cloudflare Pages preview host
// (https://main.treasury-9rg.pages.dev). That host now answers with a 301 to
// getzaldo.com which *drops the query string* — so ?group=<id>&name=<name>
// never reached the app and every visitor landed on a bare sign-in page with
// no invite to accept. A constant in version control cannot drift out of sync
// with SupabaseService.inviteHost on the Flutter side the way a dashboard
// setting did. Delete the WEB_APP_URL env var from Deno Deploy; it is ignored.
const WEB_APP_URL = "https://getzaldo.com";

// The web app reads ?group=&name= off its own URL (see _handleUri in
// lib/main.dart) — keep this the single place that shape is built.
const webInviteUrl = (groupId: string, groupName: string) =>
  `${WEB_APP_URL}?group=${groupId}&name=${encodeURIComponent(groupName)}`;

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Android App Links verification: the OS fetches this file when installing/updating
  // the app to confirm that this domain may open com.meditec.treasury. Requires
  // ANDROID_SHA256_FINGERPRINT env var — get it from:
  //   keytool -list -v -keystore release.jks -alias <alias>
  // or from the Play Console > Setup > App integrity > App signing key certificate.
  if (url.pathname === "/.well-known/assetlinks.json") {
    const fingerprint = Deno.env.get("ANDROID_SHA256_FINGERPRINT");
    const assetlinks = [{
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "com.meditec.treasury",
        sha256_cert_fingerprints: fingerprint ? [fingerprint] : [],
      },
    }];
    return new Response(JSON.stringify(assetlinks), {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=3600",
      },
    });
  }

  // Open Graph share image, served from this same service so the invite link is
  // self-contained (no dependency on the Flutter web app being deployed). The
  // module-relative fetch works both locally (file://) and on Deno Deploy
  // (https module URL).
  if (url.pathname === "/og-banner.png") {
    const asset = await fetch(new URL("./og-banner.png", import.meta.url));
    return new Response(asset.body, {
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=86400",
      },
    });
  }

  // Two link formats are supported:
  //   New (pretty):  /<code>           — 8-char base62, resolved via Supabase
  //   Legacy:        ?group=<uuid>&name=<name>  — still live in shared chats
  //
  // Both legacy params are attacker-controlled: this endpoint is unauthenticated
  // and anyone can craft a link to it. groupId must therefore be shape-checked
  // as a UUID (it is interpolated into an intent:// URL and a treasury:// scheme
  // link), and groupName is length-capped so a link cannot carry a payload-sized
  // string. Escaping still does the real work below — this is the outer bound.
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const rawGroup = url.searchParams.get("group");
  let groupId = rawGroup && UUID_RE.test(rawGroup) ? rawGroup : null;
  let groupName = url.searchParams.get("name")?.slice(0, 80) ?? undefined;

  const code = url.pathname.replace(/^\/+|\/+$/g, "");
  if (!groupId && /^[A-Za-z0-9]{8}$/.test(code)) {
    const info = await resolveInvite(code);
    if (info) {
      groupId = info.group_id;
      groupName = info.name;
    }
  }

  if (!groupId) {
    return new Response("Invalid or expired invite link", { status: 404 });
  }
  groupName = groupName ?? "a group";

  const ua = req.headers.get("user-agent") ?? "";
  // Sec-CH-UA-Platform is a Client Hints header sent by Chromium-based browsers
  // (Chrome, Brave, Edge) and still reports "Android" when the browser is set
  // to "desktop mode" — more reliable than the UA string alone.
  const chPlatform = (req.headers.get("sec-ch-ua-platform") ?? "").toLowerCase();
  const isAndroid = /android/i.test(ua) || chPlatform === '"android"';
  // Link-preview crawlers (WhatsApp, Facebook, Telegram, Twitter, Slack,
  // Discord, etc.) must NOT be redirected — they read the Open Graph tags below
  // to build the share card and do not run JavaScript.
  const isCrawler =
    /bot|crawl|spider|facebookexternalhit|whatsapp|telegram|twitterbot|slackbot|discordbot|linkedinbot|embedly|quora link preview|pinterest|vkshare|redditbot|skypeuripreview|google-?bot|bingbot|applebot/i
      .test(ua);

  // Everyone who is not on Android and is not a crawler — desktop *and iPhone*
  // — goes straight to the Flutter web app.
  //
  // iPhones used to get the landing page below, which immediately assigned
  // location.href = "treasury://invite?…" and only fell through to the web app
  // 1.5 s later if the page was still visible. There is no iOS build of this
  // app: ios/Runner/Info.plist registers no CFBundleURLTypes, so nothing on the
  // device claims the treasury:// scheme. Safari answered it with a modal
  // "Cannot Open Page — the address is invalid" that the visitor had to dismiss
  // and that swallowed the timed fallback. Skipping the scheme entirely is the
  // whole fix for iPhone: one redirect, no dialog, no wait.
  if (!isAndroid && !isCrawler) {
    return Response.redirect(webInviteUrl(groupId, groupName), 302);
  }

  // Open Graph / Twitter card metadata for rich link previews (WhatsApp et al).
  // Attribute values are user-controlled (groupName), so HTML-escape them.
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  // Per-group cache-buster on the image URL: the banner bytes are identical for
  // every group, and Telegram/WhatsApp key their preview cache on the image URL
  // — a shared URL gets deduped and repeats render as a small thumbnail. A
  // unique ?g=<id> gives each group its own cached (large) card. The banner
  // route matches on pathname only, so the query is ignored when serving.
  const ogImageBase = Deno.env.get("OG_IMAGE_URL") ?? `${url.origin}/og-banner.png`;
  const ogImage = `${ogImageBase}${ogImageBase.includes("?") ? "&" : "?"}g=${encodeURIComponent(groupId)}`;
  const ogTitle = `Join ${groupName} on Zaldo`;
  const ogDesc =
    `You've been invited to split and settle shared expenses in “${groupName}”.`;
  const ogMeta = `
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Zaldo">
  <meta property="og:title" content="${esc(ogTitle)}">
  <meta property="og:description" content="${esc(ogDesc)}">
  <meta property="og:url" content="${esc(url.href)}">
  <meta property="og:image" content="${esc(ogImage)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="Zaldo">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${esc(ogImage)}">
  <meta name="twitter:title" content="${esc(ogTitle)}">
  <meta name="twitter:description" content="${esc(ogDesc)}">`;

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const apkUrl = supabaseUrl
    ? `${supabaseUrl}/storage/v1/object/public/releases/treasury-latest.apk`
    : null;

  // groupId is resolved server-side (it is NOT in the URL for short-code links),
  // so pass it explicitly — the page JS must not read it from the query string.
  //
  // JSON.stringify is NOT sufficient on its own here. It escapes quotes and
  // backslashes, but leaves "<" and "/" alone — so a groupName containing
  // "</script>" closes the block early and everything after it is parsed as
  // HTML. That was live: ?group=<uuid>&name=</script><img src=x onerror=...>
  // executed attacker script on this origin, which is the origin that hands
  // visitors an APK to install. Escaping the three characters that can end a
  // script block (plus the two line terminators JSON allows raw but JS does
  // not) makes the payload inert while keeping it valid JSON.
  const jsonForScript = (value: unknown) =>
    JSON.stringify(value)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026")
      .replace(new RegExp("[\\u2028\\u2029]", "g"), (c: string) =>
        c.charCodeAt(0) === 0x2028 ? "\\u2028" : "\\u2029"
      );

  const pageData = jsonForScript({
    groupId,
    groupName,
    isAndroid,
    apkUrl,
    webInvite: webInviteUrl(groupId, groupName),
  });

  // Per-response nonce so the CSP below can allow exactly this page's own
  // script and style block and nothing else — no 'unsafe-inline', which would
  // hand any future injection the same privileges as the real script.
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Zaldo — You've been invited</title>${ogMeta}
  <style nonce="${nonce}">
    body {
      background: #0F0D0B;
      color: #F5F0E8;
      font-family: -apple-system, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 24px;
      box-sizing: border-box;
      text-align: center;
    }
    h1 { color: #C9A040; font-size: 28px; margin-bottom: 8px; }
    p { color: #6B6058; font-size: 16px; margin-bottom: 32px; }
    .btn {
      display: inline-block;
      background: #C9A040;
      color: #0F0D0B;
      padding: 16px 32px;
      border-radius: 12px;
      text-decoration: none;
      font-weight: 600;
      font-size: 16px;
      width: 100%;
      box-sizing: border-box;
      cursor: pointer;
      border: none;
    }
    .applink {
      display: inline-block;
      margin-top: 18px;
      color: #6B6058;
      font-size: 14px;
      text-decoration: underline;
      text-underline-offset: 3px;
      cursor: pointer;
    }
  </style>
  <script nonce="${nonce}">
    const d = ${pageData};
    const groupId = d.groupId;
    const nameEnc = encodeURIComponent(d.groupName);

    // Android: intent:// is the reliable way to launch an installed app from
    // Chrome. If the app is NOT installed, the browser follows
    // browser_fallback_url straight to the web app — no dead-end, no Play Store.
    const androidLink = 'intent://invite?group=' + groupId + '&name=' + nameEnc +
      '#Intent;scheme=treasury;package=com.meditec.treasury;' +
      'S.browser_fallback_url=' + encodeURIComponent(d.webInvite) + ';' +
      'end';

    // Only Android browsers and link-preview crawlers are served this page —
    // every other visitor was already 302'd to the web app, so the non-Android
    // href here is a plain safe default (crawlers do not run JS anyway). No
    // treasury:// attempt: nothing outside Android registers that scheme.
    const openLink = d.isAndroid ? androidLink : d.webInvite;

    document.addEventListener('DOMContentLoaded', () => {
      document.getElementById('group-name').textContent = d.groupName;
      document.getElementById('open-btn').href = openLink;

      // Bound here rather than as an inline onclick= attribute: the CSP has no
      // 'unsafe-inline', which is what makes the nonce meaningful.
      const getApp = document.getElementById('get-app');
      if (getApp) getApp.addEventListener('click', onGetApp);
    });

    // Optional native install: stash the invite on the clipboard so the freshly
    // installed app can recover it on first launch, then download the APK.
    async function onGetApp() {
      try {
        const ts = Math.floor(Date.now() / 1000);
        await navigator.clipboard.writeText(
          'treasury-invite:' + groupId + ':' + nameEnc + ':' + ts,
        );
      } catch (_) { /* clipboard denied — not critical */ }
      window.location.href = d.apkUrl;
    }
  </script>
</head>
<body>
  <h1>Zaldo</h1>
  <p>You've been invited to join <strong style="color:#F5F0E8" id="group-name"></strong></p>
  <a id="open-btn" class="btn" href="#">Open in Zaldo</a>
  ${isAndroid && apkUrl ? `<a class="applink" id="get-app">Get the Android app</a>` : ""}
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // default-src 'none' means anything not named below is refused outright.
      // The page loads no subresources: its script and style are inline (and
      // nonced), and the OG banner is fetched by crawlers from the meta tags,
      // never by this document. img-src stays 'self' for the favicon request
      // browsers make regardless.
      "Content-Security-Policy": [
        "default-src 'none'",
        `script-src 'nonce-${nonce}'`,
        `style-src 'nonce-${nonce}'`,
        "img-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join("; "),
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      // The invite page is per-link and carries a group name; keep it out of
      // shared caches.
      "Cache-Control": "no-store",
    },
  });
});
