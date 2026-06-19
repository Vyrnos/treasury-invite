# treasury-invite

Deno Deploy service behind `treasury-invite.meditec.deno.net` that backs The
Treasury's invite / deep links.

Given an invite URL like:

```
https://treasury-invite.meditec.deno.net?group=<groupId>&name=<groupName>
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

| Var             | Purpose                                                              |
| --------------- | ------------------------------------------------------------------- |
| `WEB_APP_URL`   | Flutter web app origin for the desktop redirect.                    |
| `SUPABASE_URL`  | Used to build the public APK download URL (Android fallback).        |
| `OG_IMAGE_URL`  | Optional. Overrides the default self-hosted `/og-banner.png` image.  |

## Local development

```sh
deno task dev    # watch mode
deno task start  # one-shot
```

Listens on `http://localhost:8000`. Test the crawler path with:

```sh
curl -A "WhatsApp/2" "http://localhost:8000/?group=abc&name=Ski%20Trip"
```
