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
  const isAndroid = /android/i.test(ua);
  const isMobile = /android|iphone|ipad|ipod|mobile/i.test(ua);
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
  const ogImage = Deno.env.get("OG_IMAGE_URL") ?? `${url.origin}/og-banner.png`;
  const ogTitle = `Join ${groupName} on The Treasury`;
  const ogDesc =
    `You've been invited to split and settle shared expenses in “${groupName}”.`;
  const ogMeta = `
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="The Treasury">
  <meta property="og:title" content="${esc(ogTitle)}">
  <meta property="og:description" content="${esc(ogDesc)}">
  <meta property="og:url" content="${esc(url.href)}">
  <meta property="og:image" content="${esc(ogImage)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="The Treasury">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${esc(ogImage)}">
  <meta name="twitter:title" content="${esc(ogTitle)}">
  <meta name="twitter:description" content="${esc(ogDesc)}">`;

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const apkUrl = supabaseUrl
    ? `${supabaseUrl}/storage/v1/object/public/releases/treasury-latest.apk`
    : null;

  const pageData = JSON.stringify({ groupName, isAndroid, apkUrl });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>The Treasury — You've been invited</title>${ogMeta}
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
    .btn-secondary {
      background: transparent;
      color: #C9A040;
      border: 1.5px solid #C9A040;
      margin-top: 12px;
    }
    #download-section { display: none; margin-top: 24px; width: 100%; }
    #post-download { display: none; }
    .steps {
      text-align: left;
      margin: 0 0 20px 0;
      padding: 16px;
      background: #1A1714;
      border-radius: 12px;
      border: 1px solid #2A2420;
    }
    .step {
      color: #6B6058;
      font-size: 14px;
      padding: 6px 0;
    }
    .step.active {
      color: #C9A040;
      font-weight: 600;
      font-size: 15px;
    }
    .hint {
      font-size: 13px;
      color: #6B6058;
      margin-top: 0;
      margin-bottom: 0;
    }
    @keyframes pulse-border {
      0%   { box-shadow: 0 0 0 0 rgba(201,160,64,0.5); }
      70%  { box-shadow: 0 0 0 10px rgba(201,160,64,0); }
      100% { box-shadow: 0 0 0 0 rgba(201,160,64,0); }
    }
    .btn-glow { animation: pulse-border 1.8s ease-out infinite; }
  </style>
  <script>
    const d = ${pageData};
    const params = new URLSearchParams(window.location.search);
    const groupId = params.get('group');
    const deepLink = 'treasury://invite?group=' + groupId + '&name=' + encodeURIComponent(d.groupName);

    document.addEventListener('DOMContentLoaded', () => {
      document.getElementById('group-name').textContent = d.groupName;
      document.getElementById('open-btn').href = deepLink;

      if (d.isAndroid) {
        setupAndroidFallback();
      } else {
        // Non-Android: attempt deep link immediately, no fallback needed
        setTimeout(() => { window.location.href = deepLink; }, 500);
      }
    });

    function setupAndroidFallback() {
      let appMayHaveOpened = false;

      document.addEventListener('visibilitychange', () => {
        if (document.hidden) appMayHaveOpened = true;
      });
      window.addEventListener('pagehide', () => { appMayHaveOpened = true; });
      window.addEventListener('blur', () => { appMayHaveOpened = true; });

      // Attempt deep link
      setTimeout(() => { window.location.href = deepLink; }, 500);

      // If still on page after 2.5s the app is not installed — show download option
      setTimeout(() => {
        if (!appMayHaveOpened && !document.hidden && d.apkUrl) {
          document.getElementById('download-section').style.display = 'block';
        }
      }, 2500);
    }

    async function onDownloadClick() {
      // Layer 2: write deferred invite payload to clipboard so the app can recover
      // it on first launch even if user closes this tab
      try {
        const ts = Math.floor(Date.now() / 1000);
        const payload = 'treasury-invite:' + groupId + ':' + encodeURIComponent(d.groupName) + ':' + ts;
        await navigator.clipboard.writeText(payload);
      } catch (_) { /* clipboard denied — layer 1 (return-here UX) still covers it */ }

      // Trigger APK download
      window.location.href = d.apkUrl;

      // Transition to post-download instruction state
      document.getElementById('pre-download').style.display = 'none';
      document.getElementById('post-download').style.display = 'block';
      document.getElementById('open-btn').classList.add('btn-glow');
    }
  </script>
</head>
<body>
  <h1>The Treasury</h1>
  <p>You've been invited to join <strong style="color:#F5F0E8" id="group-name"></strong></p>
  <a id="open-btn" class="btn" href="#">Open in The Treasury</a>
  <div id="download-section">
    <div id="pre-download">
      <p style="margin-bottom:16px">Don't have the app yet?</p>
      ${apkUrl ? `<button class="btn btn-secondary" onclick="onDownloadClick()">Download The Treasury (Android)</button>` : ""}
    </div>
    <div id="post-download">
      <div class="steps">
        <div class="step">① Install the downloaded APK</div>
        <div class="step">② Open The Treasury</div>
        <div class="step active">③ Return here and tap "Open in The Treasury"</div>
      </div>
      <p class="hint">The gold button above will open your group directly.</p>
    </div>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});
