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
  let groupId = url.searchParams.get("group");
  let groupName = url.searchParams.get("name") ?? undefined;

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
  // Sec-CH-UA-Mobile is a Client Hints header sent by Chromium-based browsers
  // (Chrome, Brave, Edge) and is ?1 on a mobile device even when the browser
  // is set to "desktop mode" — making it more reliable than the UA string alone.
  const chMobile = req.headers.get("sec-ch-ua-mobile");
  const chPlatform = (req.headers.get("sec-ch-ua-platform") ?? "").toLowerCase();
  const isAndroid = /android/i.test(ua) || chPlatform === '"android"';
  const isMobile = /android|iphone|ipad|ipod|mobile/i.test(ua) || chMobile === "?1";
  // Link-preview crawlers (WhatsApp, Facebook, Telegram, Twitter, Slack,
  // Discord, etc.) are not "mobile" and must NOT be redirected — they read the
  // Open Graph tags below to build the share card and do not run JavaScript.
  const isCrawler =
    /bot|crawl|spider|facebookexternalhit|whatsapp|telegram|twitterbot|slackbot|discordbot|linkedinbot|embedly|quora link preview|pinterest|vkshare|redditbot|skypeuripreview|google-?bot|bingbot|applebot/i
      .test(ua);

  // Desktop browsers (real users, not crawlers): redirect straight to the
  // Flutter web app with invite params.
  const webAppUrl = (Deno.env.get("WEB_APP_URL") ?? "").replace(/\/+$/, "");
  if (!isMobile && !isCrawler && webAppUrl) {
    return Response.redirect(
      `${webAppUrl}?group=${groupId}&name=${encodeURIComponent(groupName)}`,
      302,
    );
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
  const pageData = JSON.stringify({
    groupId,
    groupName,
    isAndroid,
    apkUrl,
    webAppUrl,
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Zaldo — You've been invited</title>${ogMeta}
  <style>
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
  <script>
    const d = ${pageData};
    const groupId = d.groupId;
    const nameEnc = encodeURIComponent(d.groupName);

    const schemeLink = 'treasury://invite?group=' + groupId + '&name=' + nameEnc;
    const webInvite = d.webAppUrl
      ? d.webAppUrl + '?group=' + groupId + '&name=' + nameEnc
      : '';

    // Android: intent:// is the reliable way to launch an installed app from
    // Chrome. If the app is NOT installed, the browser follows
    // browser_fallback_url straight to the web app — no dead-end, no Play Store.
    const androidLink = 'intent://invite?group=' + groupId + '&name=' + nameEnc +
      '#Intent;scheme=treasury;package=com.meditec.treasury;' +
      (webInvite ? 'S.browser_fallback_url=' + encodeURIComponent(webInvite) + ';' : '') +
      'end';

    const openLink = d.isAndroid ? androidLink : schemeLink;

    document.addEventListener('DOMContentLoaded', () => {
      document.getElementById('group-name').textContent = d.groupName;
      document.getElementById('open-btn').href = openLink;

      // Non-Android (iOS, etc.): try the app scheme immediately; if it opens,
      // the page goes to background (document.hidden = true). Only fall through
      // to the web app if the page is still visible after 1.5s — i.e. the app
      // was NOT installed / didn't respond.
      if (!d.isAndroid) {
        window.location.href = schemeLink;
        if (webInvite) {
          setTimeout(() => {
            if (!document.hidden) window.location.href = webInvite;
          }, 1500);
        }
      }
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
  ${isAndroid && apkUrl ? `<a class="applink" onclick="onGetApp()">Get the Android app</a>` : ""}
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});
