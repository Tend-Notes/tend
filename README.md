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
- **Logseq-compatible** - Markdown files with block IDs

## Quick Start

### Docker

The easiest way to run Tend:

```bash
# Create a directory for your garden
mkdir -p ~/tend-data

# Run with Docker
docker run -d \
  --name tend \
  -p 3000:3000 \
  -v ~/tend-data:/data \
  ghcr.io/crawfordlong/tend:latest

# Open http://localhost:3000
```

Or use Docker Compose:

```bash
# Clone the repository
git clone https://github.com/crawfordlong/tend.git
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
    tend.url = "github:crawfordlong/tend";
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
| `services.tend.gitBackup.enable` | `false` | Enable automatic Git backup |
| `services.tend.gitBackup.intervalMinutes` | `30` | Backup interval |
| `services.tend.gitBackup.autoPush` | `false` | Push after each backup |
| `services.tend.gitBackup.remoteUrl` | `null` | Git remote URL |
| `services.tend.extraEnvironment` | `{}` | Additional environment variables |

#### Running with Nix (without NixOS)

```bash
# Run directly
nix run github:crawfordlong/tend

# Or build and run
nix build github:crawfordlong/tend
./result/bin/tend
```

### Reverse Proxy

For production, run Tend behind a reverse proxy like Caddy or nginx.

#### Caddy

```caddy
notes.example.com {
    reverse_proxy localhost:3000
}
```

#### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name notes.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

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

Files are Logseq-compatible Markdown with block IDs:

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

By default, **search is disabled** for encrypted gardens. This is a security measure because the search index stores the full plaintext content of all blocks.

When creating an encrypted garden, you can choose to:

1. **Disable search entirely** (default) - No search index is created. Searching an encrypted garden will show a message explaining this.

2. **Enable search with auto-expiry** - A plaintext search index is created in `.tend/search_index/`. You can configure the index to auto-delete after a period of inactivity (default: 6 hours). The index will be rebuilt from scratch when you search again after expiry, which may cause brief delays for large gardens.

### Security Notes

- **Passphrase recovery is not possible.** If you forget your passphrase, your notes cannot be recovered.
- **Filenames are visible.** Only file contents are encrypted, not page names.
- If search is enabled, the index in `.tend/` contains full block text. For maximum security, either disable search or delete `.tend/` when not using the garden.
- Encryption only protects files at rest. Anyone with access to the running server can read decrypted content.

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
