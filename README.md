<!--
SPDX-FileCopyrightText: 2026 Ivan Buntic
SPDX-License-Identifier: MIT
-->

# eLab Voice Notes

## 1. Overview

A lightweight web application for adding speech-to-text laboratory notes to ELBUS/eLabFTW.

The application allows a user to:
1) Authenticate via API key and start a session.
2) Record a voice note in the browser.
3) Automatically transcribe after stopping the recording using OpenAI Whisper running on the server.
4) Review and edit the generated transcript.
5) Select an accessible ELBUS experiment from the dropdown.
6) Append the approved transcript to the experiment using the eLabFTW REST API.
7) Logout of session.

You need:

- An eLabFTW instance reachable from the application server, and personal API keys with write access for users.
- A Linux server with SSH access, administrator privileges, Docker Engine and the Docker Compose plugin. The production walkthrough below assumes Ubuntu, systemd and host-installed Nginx.
- A hostname pointing to the server and access to ports 80 (HTTP/certificate validation) and 443 (HTTPS).
- Enough memory, disk space and CPU for the image and the Whisper `base` model. Transcription performance depends on the server and recording length.

## 2. Quick start

On the server, obtain the deployment files by cloning the repository:

```bash
git clone https://github.com/IvBu1/voice-elbus.git
cd voice-elbus/deploy
cp .env.example .env
nano .env
```

Replace the example values with your instance details and select a published image tag from the [releases](https://github.com/IvBu1/voice-elbus/releases):

```dotenv
IMAGE_TAG=v0.4.0
ELABFTW_BASE_URL=https://elab.example.org/api/v2
ELABFTW_INSTANCE_NAME=Example Lab
APP_OPERATOR_NAME=University of Example
MAX_ATTACHMENT_MB=50
```

The version above is an example. Keep the `/api/v2` suffix in the API URL.

```bash
sudo docker compose pull
sudo docker compose up -d
sudo docker compose ps
curl --fail http://127.0.0.1:8000/health
```

Compose downloads the published image, it does not build the application. The container is reachable only through the server's loopback address until Nginx is configured. Startup can take time while Whisper loads. Complete section 4 before users log in: the supplied configuration enables secure cookies and expects HTTPS.

Run deployment commands from this `deploy/` directory. It can live elsewhere on your server, but keep `compose.yaml`, `.env` and the upload-limit script together.

## 3. Configuration

Compose reads `.env` for `${VARIABLE}` substitutions in `compose.yaml`. Its `environment` section then passes the application settings into the container, where Python reads them using `os.environ`. Python does not load `.env` itself.

| Variable | Required | Meaning / default |
| --- | --- | --- |
| `IMAGE_TAG` | For supplied Compose file | Published image version, used by Compose, not the application. |
| `ELABFTW_BASE_URL` | Yes | Full eLabFTW API URL, e.g. `https://elab.example.org/api/v2`. |
| `ELABFTW_INSTANCE_NAME` | Yes | Instance name shown on the webpage. |
| `APP_OPERATOR_NAME` | Yes | Institution shown in the footer. |
| `MAX_ATTACHMENT_MB` | Yes | Positive integer; `50` means 50,000,000 bytes. Used for audio uploads and the displayed limit. |
| `HOST_IP` | Yes | Application bind address; Compose sets `0.0.0.0` inside the container. |
| `COOKIE_SECURE` | No | Application default is `false`; supplied Compose sets `true` for HTTPS. |
| `APP_VERSION` | No | Footer version; defaults to `development`. |
| `APP_REVISION` | No | Commit hash; defaults to empty. |
| `APP_REPOSITORY_URL` | No | Repository URL for version links; defaults to empty. |

GitHub Actions supplies the last three values when building release images. They normally need no deployment override. To override one at runtime, explicitly add it to Compose's `environment` section; adding it only to `.env` is insufficient.

The inactivity timeout is currently four hours, configured by `SESSION_IDLE_TIMEOUT` in `backend/api.py`, rather than an environment variable. The transcription model is fixed to Whisper `base`.

## 4. Production deployment

### Prepare the server

All commands below run on the server after connecting with `ssh username@server`. Replace `voice.example.org` with your chosen service hostname throughout.

1. Ask your DNS administrator to create an A record pointing the hostname to the server's public IPv4 address. If an AAAA record exists, IPv6 must also reach this server.
2. Allow inbound TCP 80 and 443 through the server/provider firewalls. Retain SSH access, port 8000 should remain bound to localhost as in the supplied Compose file.
3. Install Docker Engine and the Compose plugin using the [official Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/). Then install the host tools:

```bash
sudo apt update
sudo apt install nginx certbot python3 curl
sudo docker compose version
```

### Obtain the first certificate using HTTP

Do not enable the full HTTPS example yet: its certificate files do not exist. First create an HTTP-only configuration:

```bash
sudo install -d -m 755 /var/www/certbot
sudo nano /etc/nginx/sites-available/voice-elbus
```

Paste this, replacing the hostname:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name voice.example.org;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type "text/plain";
        try_files $uri =404;
    }

    location / {
        return 404;
    }
}
```

On a new installation, enable the site with a symlink. If the link already exists, keep it:

```bash
sudo ln -s /etc/nginx/sites-available/voice-elbus /etc/nginx/sites-enabled/voice-elbus
sudo nginx -t
sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/certbot -d voice.example.org
```

Certbot validates control by making an HTTP request to this hostname and saves the certificate on the server. You do not need to operate the DNS server yourself. See the [Certbot webroot documentation](https://eff-certbot.readthedocs.io/en/stable/using.html#webroot).

### Enable HTTPS and the upload limit

From the repository's `deploy/` directory:

```bash
cp nginx.conf.example nginx.conf.local
nano nginx.conf.local
```

In this local copy:

- Replace every `voice.example.org` with your hostname, including certificate paths. Use `sudo certbot certificates` to confirm the actual paths.
- Change the upload-limit include to `/etc/nginx/snippets/voice-elab-upload-limit.conf` to match the current script. The supplied Nginx example currently uses the older `voice-elbus-upload-limit.conf` name.
- Remove the initial Certbot-style `if ($host = ...)` redirect. The HTTP `location /` already redirects, keeping the challenge location separate allows certificate validation over HTTP.

Install the HTTPS configuration, then run the script **before** manually testing/reloading Nginx, because the script creates the included snippet:

```bash
sudo cp /etc/nginx/sites-available/voice-elbus /etc/nginx/sites-available/voice-elbus.backup
sudo install -m 644 nginx.conf.local /etc/nginx/sites-available/voice-elbus
bash apply-upload-limit.sh
sudo docker compose up -d
curl --fail https://voice.example.org/health
```

Keep the backup outside `sites-enabled`. If Nginx validation fails, inspect the error and correct the configuration before reloading.

The script reads `MAX_ATTACHMENT_MB` from the resolved Compose configuration, validates it and creates the Nginx snippet. It tests and reloads Nginx, but does not start containers or pull images. For a 50 MB attachment limit it permits a 51,000,000-byte HTTP request, allowing space for multipart overhead, the application still enforces 50 MB for the audio itself. The frontend displays the same application limit.

Whenever changing `MAX_ATTACHMENT_MB`, run the script again and then `sudo docker compose up -d`. The script assumes the supplied service name `voice-elbus` and host-installed Nginx; keep those names consistent if adapting it.

Open the HTTPS page, check the certificate and footer, then test a short recording and an experiment submission. Nginx terminates HTTPS and proxies requests to `127.0.0.1:8000`; its configuration stays on the host, outside Docker.

### Certificate renewal

Keep the HTTP challenge location and port 80 available. Check that your Certbot installation has an automatic renewal timer or equivalent scheduled job:

```bash
systemctl list-timers --all | grep -i certbot
sudo certbot renew --dry-run
```

If no scheduler exists, configure one according to the [Certbot renewal instructions](https://eff-certbot.readthedocs.io/en/stable/using.html#automated-renewals). With the webroot method, add a deploy hook so Nginx loads renewed certificates:

```bash
sudo install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh > /dev/null <<'HOOK'
#!/bin/sh
nginx -t && systemctl reload nginx
HOOK
sudo chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
```

## 5. Updates

Choose a published release tag, edit `IMAGE_TAG` in `.env`, then run from the deployment directory:

```bash
sudo docker compose pull
sudo docker compose up -d
sudo docker compose ps
sudo docker compose logs --tail=50 voice-elbus
```

`pull` downloads the image, `up -d` recreates the container when necessary. Confirm the version in the webpage footer, refreshing the page if needed. Changing only the image tag does not require running the upload-limit script. Updating/recreating the container ends existing sessions; ask users to finish their notes first.

To roll back, select the previous known-working tag and repeat these commands. Prefer new release tags for new builds rather than replacing existing tags.

## 6. Authentication

Users create a personal API key in their eLabFTW account under **Settings → API keys**, with write access. Their account must also have permission to update the selected experiment and attach files. See the [eLabFTW API guidance](https://doc.elabftw.net/docs/usage/api/).

The key is submitted over HTTPS and held in backend process memory. The browser receives a random session identifier in an HttpOnly, SameSite=Lax cookie.

Sessions expire after four hours without authenticated application requests. Typing, recording and countdown polling do not extend the session. The page displays the remaining time. Disconnecting removes the session, restarting the backend loses all sessions. Reconnection is necessary after expiration, while the open page keeps the current draft/audio where possible. Closing or refreshing the page can lose the draft.

Audio is sent to the application server for transcription and temporarily written to disk, then deleted after the attempt. When attachment is selected, the audio is also uploaded to eLabFTW and retained there according to that instance's policies. The browser keeps the current recording for playback, there is no permanent application-side audio archive.

## 7. Local testing

### Docker
From the project roote directory:
1) build image via `docker build -t voice-elbus .`
2) run container via `docker run --rm -p 8000:8000 -e HOST_IP="0.0.0.0" voice-elbus`

The application is then available on: `http://localhost:8000`


## Local website

Start the application directly with python from the project root directory: 
1) `export HOST_IP="127.0.0.1" export ELABFTW_BASE_URL="<elabftw_api_base_url>" export ELABFTW_INSTANCE_NAME="<service_name>" export MAX_ATTACHMENT_MB="<number>" export APP_OPERATOR_NAME="operator_name"`
2) `python3 main.py`
3) open `http://localhost:8000`

## 8. License and credits

This software is distributed under the [MIT License](LICENSE).

Transcription uses [OpenAI Whisper](https://github.com/openai/whisper), experiment integration uses the [eLabFTW API](https://doc.elabftw.net/docs/usage/api/). Third-party components retain their own licenses.

This work was funded by Deutsche Forschungsgemeinschaft (DFG, German Research Foundation) under Germany’s Excellence Strategy - EXC 2075 - 390740016.

The funding acknowledgement refers to the software's development. Each deployment identifies its own operator through `APP_OPERATOR_NAME`.
