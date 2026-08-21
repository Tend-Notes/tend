# Tend

A self-hosted digital garden for your thoughts. Tend is a browser-based outliner note-taking application with wiki-links, backlinks, full-text search, and Git backup.

## Features

- **Outliner editor** - Hierarchical block-based editing with keyboard-driven navigation
- **Wiki-links** - Connect pages with `[[Page Name]]` syntax
- **Backlinks** - See all pages that link to the current page
- **Full-text search** - Fast fuzzy search powered by Tantivy
- **Git backup** - Automatic commits with optional push to remote
- **Knowledge graph** - Visualize connections between pages
- **Theming** - 200+ Base16/Base24 themes
- **Markdown with structure** - Markdown files with block IDs

## Quick Start

### Docker

> **Read this first.** Tend has no built-in login. For any real deployment it
> must sit behind a reverse proxy that authenticates users and sets a
> `Remote-User` header — see [Authentication](#authentication) below. The command
> here is a **local, unauthenticated trial** bound to `127.0.0.1` only. Do not
> publish this port to a network without a proxy in front.

To try Tend on your own machine:

```bash
# Create a directory for your garden
mkdir -p ~/tend-data

# Local trial only: no authentication, bound to localhost.
docker run -d \
  --name tend \
  -p 127.0.0.1:3000:3000 \
  -e TEND_AUTH_REQUIRED=false \
  -e TEND_DEV_ALLOW_INSECURE=true \
  -e TEND_AUTH_DEFAULT_USER=me \
  -v ~/tend-data:/data \
  ghcr.io/tend-notes/tend:latest

# Open http://localhost:3000
```

`TEND_DEV_ALLOW_INSECURE=true` is required only because the container binds
`0.0.0.0` internally; the `127.0.0.1:` in the port mapping keeps it off the
network. For production, drop these three env vars and follow
[Authentication](#authentication).

Or use Docker Compose (also binds to loopback by default):

```bash
# Clone the repository
git clone https://github.com/tend-notes/tend.git
cd tend

# Start with docker-compose
docker compose up -d

# Your garden is stored in ./data by default
```

#### Docker Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `TEND_PORT` | `3000` | Port to listen on |
| `TEND_GARDEN_PATH` | `/data` | Path to garden directory |
| `TEND_AUTH_REQUIRED` | `true` | Require the proxy-set auth header. Set `false` only for local/dev use. |
| `TEND_AUTH_HEADER` | `Remote-User` | Header the proxy sets with the authenticated username. |
| `TEND_AUTH_VERIFY_URL` | (none) | Forward-auth verify endpoint for WebSocket auth. **Required** when `TEND_AUTH_REQUIRED=true`. |
| `TEND_TRUSTED_PROXIES` | `127.0.0.1/32,::1/128` | Peer IPs/CIDRs trusted to set `Remote-User` (see [Authentication](#authentication)). |
| `TEND_DEV_ALLOW_INSECURE` | `false` | Override the safety checks that refuse to start when auth is disabled on a non-loopback bind. Dev only. |
| `TEND_CORS_ORIGINS` | (none) | CORS allowed origins (see below) |
| `RUST_LOG` | `info` | Log level (`debug`, `info`, `warn`, `error`) |
| `GIT_AUTHOR_NAME` | `Tend` | Git commit author name |
| `GIT_AUTHOR_EMAIL` | `tend@localhost` | Git commit author email |

**CORS Configuration:**
- Empty/unset: Same-origin only (most secure, recommended for production)
- `*`: Allow all origins (for development or trusted reverse proxy setups)
- Comma-separated list: Allow specific origins (e.g., `https://notes.example.com,https://app.example.com`)

#### Building the Docker Image

```bash
docker build -t tend .
```

### NixOS

Add Tend to your NixOS configuration:

```nix
# flake.nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    tend.url = "github:tend-notes/tend";
  };

  outputs = { self, nixpkgs, tend }: {
    nixosConfigurations.myhost = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        tend.nixosModules.default
        {
          services.tend = {
            enable = true;
            port = 3000;
            host = "127.0.0.1";  # Use "0.0.0.0" to expose externally
            openFirewall = false;

            # Optional: Git backup configuration
            gitBackup = {
              enable = true;
              intervalMinutes = 30;
              autoPush = false;
              remoteUrl = "git@github.com:you/your-garden.git";
            };
          };
        }
      ];
    };
  };
}
```

#### NixOS Module Options

| Option | Default | Description |
|--------|---------|-------------|
| `services.tend.enable` | `false` | Enable the Tend service |
| `services.tend.port` | `3000` | Port to listen on |
| `services.tend.host` | `"127.0.0.1"` | Address to bind to |
| `services.tend.dataDir` | `"/var/lib/tend"` | Garden data directory |
| `services.tend.user` | `"tend"` | User to run as |
| `services.tend.group` | `"tend"` | Group to run as |
| `services.tend.openFirewall` | `false` | Open firewall for the port |
| `services.tend.auth.verifyUrl` | `null` | Forward-auth verify endpoint for WebSocket auth (see [Authentication](#authentication)) |
| `services.tend.auth.trustedProxies` | `[ "127.0.0.1/32" "::1/128" ]` | Peer IPs/CIDRs trusted to set `Remote-User` |
| `services.tend.gitBackup.enable` | `false` | Enable automatic Git backup |
| `services.tend.gitBackup.intervalMinutes` | `30` | Backup interval |
| `services.tend.gitBackup.autoPush` | `false` | Push after each backup |
| `services.tend.gitBackup.remoteUrl` | `null` | Git remote URL |
| `services.tend.extraEnvironment` | `{}` | Additional environment variables |

#### Running with Nix (without NixOS)

```bash
# Run directly
nix run github:tend-notes/tend

# Or build and run
nix build github:tend-notes/tend
./result/bin/tend
```

## Authentication

Tend has **no built-in login**. It delegates authentication to a reverse proxy
that sits in front of it (for example Caddy or nginx with [Authelia](https://www.authelia.com/)).
Understanding this model matters — misconfiguring it is the difference between a
private garden and an open one.

**How it works:**

1. The reverse proxy terminates TLS and authenticates the user (login page, MFA,
   whatever you configure).
2. On each authenticated request the proxy sets a header — `Remote-User` by
   default — containing the username, and forwards the request to Tend.
3. Tend trusts that header to decide whose garden to serve. There is no session,
   cookie, or password inside Tend itself.

Two things keep this from being spoofable, and **you are responsible for both**:

- **The proxy must set `Remote-User` itself from the verified session, and must
  not pass through a client-supplied copy.** The forward-auth configs below do
  this: the value comes from the auth server's response, which overwrites
  anything the client sent.
- **Tend must be reachable only through the proxy.** Tend enforces this itself:
  it only honors `Remote-User` from a trusted peer IP. By default that is
  **loopback only** (`127.0.0.1`, `::1`), which is correct when the proxy runs on
  the same host. A request arriving from anywhere else is rejected with `403`
  before it reaches your data — so even if the port is exposed, a direct client
  cannot impersonate a user. If your proxy connects from another host or a
  container network, list its address in `TEND_TRUSTED_PROXIES` (see below).

  There is no shared secret to manage or leak — the trust is the peer's network
  position. The server logs its effective trusted set at startup.

**Required settings for production:**

| Setting | Value |
|---------|-------|
| `TEND_AUTH_REQUIRED` | `true` (default) |
| `TEND_AUTH_VERIFY_URL` | your proxy's forward-auth verify endpoint — required so WebSocket connections (which can't go through the proxy's auth the same way) are verified. The server refuses to start without it when auth is required. |
| `TEND_TRUSTED_PROXIES` | leave default (loopback) if the proxy is on the same host; otherwise the proxy's IP/subnet |

### Caddy + Authelia

```caddy
notes.example.com {
    # Authenticate every request against Authelia. The Remote-User header is
    # taken from Authelia's response (the verified session), overwriting any
    # value the client may have sent.
    forward_auth authelia:9091 {
        uri /api/authz/forward-auth
        copy_headers Remote-User Remote-Groups Remote-Name Remote-Email
    }

    reverse_proxy 127.0.0.1:3000
}
```

Set `TEND_AUTH_VERIFY_URL=http://authelia:9091/api/verify` (or your Authelia
`/api/authz/forward-auth` endpoint) so WebSocket connections are verified too.

### nginx + Authelia

```nginx
server {
    listen 443 ssl http2;
    server_name notes.example.com;

    location / {
        # Authenticate against Authelia first.
        auth_request /authelia;
        # Pull the username from Authelia's response...
        auth_request_set $user $upstream_http_remote_user;
        # ...and set it explicitly. proxy_set_header replaces the header, so a
        # client-supplied Remote-User never reaches Tend.
        proxy_set_header Remote-User $user;

        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location = /authelia {
        internal;
        proxy_pass http://authelia:9091/api/verify;
        proxy_set_header X-Original-URL $scheme://$http_host$request_uri;
    }
}
```

If your proxy runs on a **different host or container** than Tend, add its
address to the trusted set, e.g. `TEND_TRUSTED_PROXIES=10.88.0.0/16`. Otherwise
Tend rejects it as an untrusted peer.

## Data Storage

Tend stores your notes as Markdown files in a simple directory structure:

```
garden/
├── pages/
│   ├── My First Page.md
│   └── Another Page.md
├── journals/
│   ├── 2026-01-21.md
│   └── 2026-01-20.md
└── .git/
```

Files are Markdown with block IDs:

```markdown
- This is a block with a [[wiki-link]]
  id:: a1b2c3d4-e5f6-7890-abcd-ef1234567890
  - Nested child block
    id:: b2c3d4e5-f6a7-8901-bcde-f12345678901
```

## Encryption

Tend supports optional encryption for gardens. When you create an encrypted garden, all your notes are encrypted at rest using [age](https://age-encryption.org/), a modern encryption tool.

### How It Works

- Encryption is chosen when creating a new garden (cannot be added later)
- Files are stored as `.md.age` instead of `.md`
- The passphrase is kept in memory while the garden is unlocked
- When switching to an encrypted garden, you must enter the passphrase

### What Is NOT Encrypted

**Filenames are not encrypted.** Page names like `My Secret Project.md.age` remain visible in the filesystem. If your page titles contain sensitive information, consider using neutral names.

### Search and Encrypted Gardens

By default, **search is disabled** for encrypted gardens. When you enable it, the search index is **built in memory only while the garden is unlocked and is never written to disk** — so full-text search works with no plaintext index at rest.

When creating an encrypted garden, you can choose to:

1. **Disable search entirely** (default) - No index is built. Searching an encrypted garden will show a message explaining this.

2. **Enable in-memory search** - The index is built in RAM on unlock and dropped on lock. You can optionally have it dropped after a period of non-use (default: 6 hours) and rebuilt on the next search, which may cause brief delays for large gardens.

The link/tag (backlink) index is handled the same way: for encrypted gardens it is kept in memory only and rebuilt from your notes on unlock, so page and link names are never stored in plaintext.

### Security Notes

- **Passphrase recovery is not possible.** If you forget your passphrase, your notes cannot be recovered.
- **Filenames are the only at-rest exposure.** Note content, the search index, and link/tag metadata are all either encrypted or kept in memory only. Page names (the `.age` filenames) are not encrypted.
- **Nothing under `.tend/` is pushed to a remote.** Git backup only pushes the encrypted `.age` content; indices and metadata stay local.
- Encryption only protects files at rest. Anyone with access to the running server while a garden is unlocked can read decrypted content.

### Recovering Files Outside Tend

Encrypted files use the standard age format and can be decrypted using the `age` command-line tool:

```bash
# Install age (available on macOS, Linux, Windows)
# macOS: brew install age
# Linux: apt install age / dnf install age
# Windows: scoop install age / winget install age

# Decrypt a single file
age -d -o "My Page.md" "pages/My Page.md.age"

# Decrypt all files in a garden
cd /path/to/garden
for f in pages/*.age journals/*.age; do
  age -d -o "${f%.age}" "$f"
done

# age will prompt for your passphrase interactively
```

This means you're never locked into Tend - your notes remain accessible with standard tools.

## Development

### Prerequisites

- Rust 1.75+
- Node.js 22+
- pnpm

### Using Nix (recommended)

```bash
# Enter development shell
nix develop

# Or with direnv
echo "use flake" > .envrc
direnv allow
```

### Manual Setup

```bash
# Install frontend dependencies
cd packages/web
pnpm install

# Run frontend dev server (port 5173)
pnpm dev

# In another terminal, run backend (port 3000)
# TEND_CORS_ORIGINS=* allows cross-origin requests from the Vite dev server
cd ../..
TEND_CORS_ORIGINS="*" cargo run -p tend-server
```

The frontend dev server (port 5173) and backend (port 3000) are different origins, so CORS must be enabled during development. The `.env.development` file sets `TEND_CORS_ORIGINS=*` for convenience.

## Acknowledgements

Tend is built with these excellent open source projects:

### Backend (Rust)

| Project | Purpose |
|---------|---------|
| [Axum](https://github.com/tokio-rs/axum) | Web framework - handles HTTP routes, WebSocket connections, and middleware |
| [Tokio](https://tokio.rs) | Async runtime - powers concurrent file I/O, network requests, and background tasks |
| [Tantivy](https://github.com/quickwit-oss/tantivy) | Full-text search engine - provides fast fuzzy search across all blocks |
| [gix](https://github.com/Byron/gitoxide) | Pure Rust Git implementation - handles backup commits and push to remote |
| [age](https://github.com/str4d/rage) | Modern encryption - encrypts garden files at rest with passphrase protection |
| [notify](https://github.com/notify-rs/notify) | File system watcher - detects external changes for multi-client sync |
| [Comrak](https://github.com/kivikakk/comrak) | CommonMark parser - renders markdown for backlinks and previews |

### Frontend (TypeScript/React)

| Project | Purpose |
|---------|---------|
| [React](https://react.dev) | UI framework - component architecture and reactive rendering |
| [CodeMirror 6](https://codemirror.net) | Text editor engine - powers the block editor with syntax highlighting, keybindings, and extensions |
| [Zustand](https://github.com/pmndrs/zustand) | State management - lightweight global state for pages, UI, and sync |
| [cmdk](https://cmdk.paco.me) | Command palette - the ⌘K interface for quick actions |
| [D3](https://d3js.org) | Data visualization - renders the interactive knowledge graph |
| [Framer Motion](https://www.framer.com/motion/) | Animation library - smooth transitions and micro-interactions |
| [Tailwind CSS](https://tailwindcss.com) | Utility-first CSS - rapid styling without leaving the markup |
| [highlight.js](https://highlightjs.org) | Syntax highlighting - colors code blocks in 190+ languages |

### Theming

| Project | Purpose |
|---------|---------|
| [tinted-theming](https://github.com/tinted-theming/home) | Base16/Base24 color schemes - 200+ community-created themes |

### Build & Development

| Project | Purpose |
|---------|---------|
| [Vite](https://vitejs.dev) | Frontend build tool - fast HMR development and optimized production builds |
| [Nix](https://nixos.org) | Reproducible builds - hermetic packaging for Docker and NixOS deployment |

## License

MIT with Commons Clause. See [LICENSE](LICENSE) for details.
