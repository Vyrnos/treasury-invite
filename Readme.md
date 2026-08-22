# treasury-invite

Deno Deploy service behind `invite.getzaldo.com` that backs Zaldo's invite /
deep links. Also still reachable at the legacy `treasury-invite.meditec.deno.net`
host, kept alive for invite links shared before the getzaldo.com migration.

Given an invite URL like:

```
https://invite.getzaldo.com?group=<groupId>&name=<groupName>
```

it serves a landing page that:

- **Link-preview crawlers** (WhatsApp, Facebook, Telegram, Slack, Discord, …)
  receive HTML with Open Graph / Twitter card tags for a rich preview. The card
  image is served from this same service at `/og-banner.png`.
- **Desktop browsers** (real users) are 302-redirected to the Flutter web app
  (`WEB_APP_URL`) with the invite params.
- **Mobile browsers** get a page that attempts the `treasury://invite` deep
  link, with an Android APK-download fallback and a deferred-invite clipboard
  handoff.

## Environment variables

| Var                  | Purpose                                                          |
| -------------------- | ---------------------------------------------------------------- |
| `WEB_APP_URL`        | Flutter web app origin for the desktop redirect.                 |
| `SUPABASE_URL`       | APK download URL + short-code resolution RPC.                    |
| `SUPABASE_ANON_KEY`  | Auth for the `get_invite_info` RPC (resolves `/<code>` links).   |
| `OG_IMAGE_URL`       | Optional. Overrides the default self-hosted `/og-banner.png`.    |

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
