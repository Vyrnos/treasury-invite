Deno.serve((req) => {
  const url = new URL(req.url);
  const groupId = url.searchParams.get("group");
  const groupName = url.searchParams.get("name") ?? "a group";

  if (!groupId) {
    return new Response("Invalid invite link", { status: 400 });
  }

  const deepLink = `treasury://invite?group=${groupId}&name=${encodeURIComponent(groupName)}`;

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
    a {
      background: #C9A040;
      color: #0F0D0B;
      padding: 16px 32px;
      border-radius: 12px;
      text-decoration: none;
      font-weight: 600;
      font-size: 16px;
    }
  </style>
  <script>
    const params = new URLSearchParams(window.location.search);
    const groupId = params.get('group');
    const groupName = params.get('name') ?? 'a group';
    const deepLink = 'treasury://invite?group=' + groupId + '&name=' + encodeURIComponent(groupName);
    document.addEventListener('DOMContentLoaded', () => {
      document.getElementById('group-name').textContent = groupName;
      document.getElementById('open-btn').href = deepLink;
      setTimeout(() => { window.location.href = deepLink; }, 500);
    });
  </script>
</head>
<body>
  <h1>The Treasury</h1>
  <p>You've been invited to join <strong style="color:#F5F0E8" id="group-name"></strong></p>
  <a id="open-btn" href="#">Open in The Treasury</a>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});
