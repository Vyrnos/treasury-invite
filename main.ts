Deno.serve((req) => {
  const url = new URL(req.url);
  const groupId = url.searchParams.get("group");
  const groupName = url.searchParams.get("name") ?? "a group";

  if (!groupId) {
    return new Response("Invalid invite link", { status: 400 });
  }

  const ua = req.headers.get("user-agent") ?? "";
  const isAndroid = /android/i.test(ua);
  const isMobile = /android|iphone|ipad|ipod|mobile/i.test(ua);

  // Desktop browsers: redirect straight to the Flutter web app with invite params
  const webAppUrl = Deno.env.get("WEB_APP_URL") ?? "";
  if (!isMobile && webAppUrl) {
    return Response.redirect(
      `${webAppUrl}?group=${groupId}&name=${encodeURIComponent(groupName)}`,
      302,
    );
  }

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
  <title>The Treasury — You've been invited</title>
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
    }
    .btn-secondary {
      background: transparent;
      color: #C9A040;
      border: 1.5px solid #C9A040;
      margin-top: 12px;
    }
    #download-section { display: none; margin-top: 24px; }
    #download-section p {
      font-size: 14px;
      color: #6B6058;
      margin-bottom: 16px;
    }
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

      // If OS hands off to the app, the page becomes hidden
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
          document.getElementById('open-btn').classList.add('btn-secondary');
          document.getElementById('download-section').style.display = 'block';
        }
      }, 2500);
    }
  </script>
</head>
<body>
  <h1>The Treasury</h1>
  <p>You've been invited to join <strong style="color:#F5F0E8" id="group-name"></strong></p>
  <a id="open-btn" class="btn" href="#">Open in The Treasury</a>
  <div id="download-section">
    <p>Don't have the app yet? Download it below.</p>
    ${apkUrl ? `<a class="btn" href="${apkUrl}" download>Download The Treasury (Android)</a>` : ""}
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});
