# treasury-invite

Deno Deploy service behind `invite.getzaldo.com` that backs Zaldo's invite /
deep links. Also still reachable at the legacy `treasury-invite.meditec.deno.net`
host, kept alive for invite links shared before the getzaldo.com migration.

Given an invite URL like:

```
https://invite.getzaldo.com?group=<groupId>&name=<groupName>
```

it routes the visitor by who they are:

- **Link-preview crawlers** (WhatsApp, Facebook, Telegram, Slack, Discord, …)
  receive HTML with Open Graph / Twitter card tags for a rich preview. The card
  image is served from this same service at `/og-banner.png`.
- **Android browsers** get a landing page whose button fires an `intent://` deep
  link into the installed app, with `browser_fallback_url` pointing at the web
  app, plus an APK-download link and a deferred-invite clipboard handoff.
- **Everyone else — desktop and iPhone** — is 302-redirected straight to the
  Flutter web app with `?group=&name=` intact.

iPhones used to get the mobile landing page, which tried `treasury://invite?…`
first and only fell through to the web app after 1.5 s. There is no iOS build
(`ios/Runner/Info.plist` registers no `CFBundleURLTypes`), so Safari answered
with a modal "Cannot Open Page — the address is invalid" that blocked the
fallback. Nothing outside Android claims the scheme, so nothing outside Android
should be offered it.

## Configuration

The Flutter web app origin is the `WEB_APP_URL` **constant at the top of
`main.ts`**, not an env var. It was an env var set in the Deno Deploy dashboard
and it silently drifted to a stale Cloudflare Pages preview host during the
getzaldo.com migration; that host 301s to getzaldo.com and drops the query
string, so every invite arrived with no group to join. The `WEB_APP_URL` env
var is now ignored and can be deleted from Deno Deploy.

| Var                          | Purpose                                                        |
| ---------------------------- | -------------------------------------------------------------- |
| `SUPABASE_URL`               | APK download URL + short-code resolution RPC.                  |
| `SUPABASE_ANON_KEY`          | Auth for the `get_invite_info` RPC (resolves `/<code>` links). |
| `OG_IMAGE_URL`               | Optional. Overrides the default self-hosted `/og-banner.png`.  |
| `ANDROID_SHA256_FINGERPRINT` | App Links cert fingerprint for `/.well-known/assetlinks.json`. |

Link formats accepted: `/<code>` (8-char base62, resolved via Supabase) and the
legacy `?group=<uuid>&name=<name>` (still live in already-shared chats).

## Local development

```sh
deno task dev    # watch mode
deno task start  # one-shot
```

Listens on `http://localhost:8000`. Test the crawler path with:

```sh
curl -A "WhatsApp/2" "http://localhost:8000/?group=abc&name=Ski%20Trip"
```
