[English](/README.md) | [فارسی](/README.fa_IR.md)

<div align="center">

# <img src="./client/public/chatdesk-logo.svg" alt="ChatDesk"> ChatDesk

![Version](https://img.shields.io/badge/version-1.0.0-emerald)
![License: MIT](https://img.shields.io/badge/License-MIT-red.svg)

**Self-hosted support messenger — a messenger feel with a ticketing engine behind it**

</div>

## What is ChatDesk?

ChatDesk is a secure, lightweight, self-hosted chat platform built for customer
support teams. Your customers sign up, pick the department they need, and land
in a real conversation — while your operators get a fair-routed, enterprise
helpdesk behind the scenes.

## Key Features

- 🎧 **Helpdesk Mode**: Departments, operator roles, and fair routing (round-robin / least-busy) for incoming support requests
- 💬 **Messenger Feel**: Direct messages, groups, and channels with a real-time chat experience
- 🗂️ **Ticketing Engine**: Request status, assignment, tags, and internal notes that stay hidden from customers
- 📁 **Media Support**: File uploads, voice messages, video transcoding
- 🔔 **Push Notifications**: Web push with VAPID
- 📞 **Voice & Video Calls**: Real-time peer-to-peer calling
- 📡 **Remote Channels**: Mirror Telegram or ChatDesk channels
- 🛡️ **Admin Panel**: Full management interface with owner role, operator accounts, and department management
- 📊 **Reports**: Conversation volume, response times, and operator activity
- 🔒 **Security**: Encryption at rest, bcrypt hashing, rate limiting
- 📱 **PWA**: Installable progressive web app
- ☁️ **Cloud Deployment**: PaaS and CaaS deployment with object storage support
- 🌍 **i18n**: English and Persian/Farsi support

## Quick Start

The easiest way to install ChatDesk is the deployment script. On an Ubuntu
server (22.04+) with sudo access, run:

```bash
curl -fsSL https://raw.githubusercontent.com/miladalefbusiness/chatdesk/main/scripts/install.sh | bash
```

The script handles dependencies, builds the app, configures Nginx, and can set
up SSL for you. After installation, access it again anytime with:

```bash
chatdesk-deploy
```

> [!TIP]
> A domain name pointing to your server's public IP is recommended, and HTTPS
> is required for push notifications (except on `localhost`).

### Testing a dev build

The `dev` branch carries work-in-progress releases before they land on `main`.
To install the current dev build on a test server:

```bash
curl -fsSL https://raw.githubusercontent.com/miladalefbusiness/chatdesk/dev/scripts/install.sh | bash
```

The installer remembers which branch it came from, so updates pulled with
`chatdesk-deploy` stay on the same branch. Once a dev build is verified, it is
merged into `main` and released to production installs.

## Documentation

Full documentation lives in the [docs](/docs) folder:

- [Deployment Script](/docs/Deployment-Script.md)
- [Helpdesk Setup](/docs/Helpdesk-Setup.md)
- [Install via Docker](/docs/Installation-Docker.md)
- [Cloud Deployment](/docs/Cloud-Deployment.md)
- [Manual Installation](/docs/Manual-Installation.md)
- [Configure Nginx](/docs/Nginx-Configuration.md)
- [SSL Certificates](/docs/SSL-Certificates.md)
- [Running behind a CDN](/docs/CDN-Setup.md)
- [Running behind a domain + subpath](/docs/Subpath-Hosting.md)
- [Environment Variables](/docs/Environment-Variables.md)
- [Object Storage](/docs/Object-Storage.md)
- [Media Worker](/docs/Media-Worker.md)
- [Admin Panel](/docs/Admin-Panel.md)
- [Remote Channel Setup](/docs/Remote-Channel-Setup.md)
- [Push Notification Proxy](/docs/Push-Notification-Proxy.md)
- [Voice & Video Calls](/docs/Voice-Video-Calls.md)
- [Updating the deployed app](/docs/Updating.md)
- [Database Commands](/docs/Database-Commands.md)
- [Troubleshooting](/docs/Troubleshooting.md)

Persian documentation is available under [docs/fa](/docs/fa).

## Project Structure

| Path      | Description                                        |
| --------- | -------------------------------------------------- |
| `client/` | React 19 + Vite frontend (PWA)                     |
| `server/` | Express 5 API with SSE realtime (Knex ORM)         |
| `worker/` | Media transcoding worker (ffmpeg)                  |
| `docs/`   | English and Persian documentation                  |

## Contributing

Contributions are welcome. Please read the [contributing guide](/CONTRIBUTING.md)
and open an issue at `https://github.com/miladalefbusiness/chatdesk/issues`
before starting work on a large change.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE)
file for details.
