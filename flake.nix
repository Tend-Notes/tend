{
  description = "Tend - A digital garden for your thoughts";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, flake-utils, rust-overlay }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        overlays = [ (import rust-overlay) ];
        pkgs = import nixpkgs {
          inherit system overlays;
        };

        rustToolchain = pkgs.rust-bin.stable.latest.default.override {
          extensions = [ "rust-src" "rust-analyzer" ];
        };

        # Native build inputs needed for Rust crates
        nativeBuildInputs = with pkgs; [
          pkg-config
        ];

        # Libraries needed at build time
        buildInputs = with pkgs; [
          openssl
        ] ++ lib.optionals stdenv.isDarwin [
          darwin.apple_sdk.frameworks.Security
          darwin.apple_sdk.frameworks.SystemConfiguration
        ];

      in {
        devShells.default = pkgs.mkShell {
          inherit nativeBuildInputs buildInputs;

          packages = with pkgs; [
            # Rust
            rustToolchain
            cargo-watch
            cargo-edit

            # Node.js
            nodejs_20
            nodePackages.pnpm

            # Tools
            git
            jq

            # Optional: for database exploration
            # sqlite
          ];

          shellHook = ''
            echo "Tend development environment"
            echo "Rust: $(rustc --version)"
            echo "Node: $(node --version)"
            echo "pnpm: $(pnpm --version)"
            echo ""
            echo "Commands:"
            echo "  cargo build          - Build backend"
            echo "  cargo watch -x run   - Run backend with auto-reload"
            echo "  pnpm install         - Install frontend deps"
            echo "  pnpm dev             - Run frontend dev server"
          '';

          # For openssl-sys
          OPENSSL_DIR = "${pkgs.openssl.dev}";
          OPENSSL_LIB_DIR = "${pkgs.openssl.out}/lib";

          # Rust backtrace for debugging
          RUST_BACKTRACE = "1";
        };

        # Package for production build
        packages.default = pkgs.rustPlatform.buildRustPackage {
          pname = "tend";
          version = "0.1.0";
          src = ./.;
          cargoLock.lockFile = ./Cargo.lock;

          inherit nativeBuildInputs buildInputs;

          # Build frontend first
          preBuild = ''
            cd packages/web
            ${pkgs.nodePackages.pnpm}/bin/pnpm install --frozen-lockfile
            ${pkgs.nodePackages.pnpm}/bin/pnpm build
            cd ../..
          '';

          meta = with pkgs.lib; {
            description = "A digital garden for your thoughts";
            homepage = "https://github.com/yourusername/tend";
            license = licenses.mit; # Note: With Commons Clause
            maintainers = [ ];
          };
        };
      }
    ) // {
      # NixOS module for running as a service
      nixosModules.default = { config, lib, pkgs, ... }:
        with lib;
        let
          cfg = config.services.tend;
        in {
          options.services.tend = {
            enable = mkEnableOption "Tend digital garden";

            port = mkOption {
              type = types.port;
              default = 3000;
              description = "Port to listen on";
            };

            dataDir = mkOption {
              type = types.path;
              default = "/var/lib/tend";
              description = "Directory for storing data";
            };

            user = mkOption {
              type = types.str;
              default = "tend";
              description = "User to run Tend as";
            };

            group = mkOption {
              type = types.str;
              default = "tend";
              description = "Group to run Tend as";
            };

            gitBackup = {
              enable = mkEnableOption "automatic git backup";

              intervalMinutes = mkOption {
                type = types.int;
                default = 30;
                description = "Backup interval in minutes";
              };

              autoPush = mkOption {
                type = types.bool;
                default = false;
                description = "Automatically push to remote after backup";
              };
            };
          };

          config = mkIf cfg.enable {
            users.users.${cfg.user} = {
              isSystemUser = true;
              group = cfg.group;
              home = cfg.dataDir;
              createHome = true;
            };

            users.groups.${cfg.group} = {};

            systemd.services.tend = {
              description = "Tend Digital Garden";
              after = [ "network.target" ];
              wantedBy = [ "multi-user.target" ];

              environment = {
                TEND_DATA_DIR = cfg.dataDir;
                TEND_PORT = toString cfg.port;
                TEND_HOST = "0.0.0.0";
                TEND_GIT_ENABLED = if cfg.gitBackup.enable then "true" else "false";
                TEND_GIT_BACKUP_INTERVAL = toString cfg.gitBackup.intervalMinutes;
                TEND_GIT_AUTO_PUSH = if cfg.gitBackup.autoPush then "true" else "false";
                RUST_LOG = "info";
              };

              serviceConfig = {
                Type = "simple";
                User = cfg.user;
                Group = cfg.group;
                ExecStart = "${self.packages.${pkgs.system}.default}/bin/tend";
                Restart = "on-failure";
                RestartSec = 5;

                # Hardening
                NoNewPrivileges = true;
                PrivateTmp = true;
                ProtectSystem = "strict";
                ProtectHome = true;
                ReadWritePaths = [ cfg.dataDir ];
              };
            };

            # Initialize git repo if not exists
            systemd.services.tend-init = {
              description = "Initialize Tend data directory";
              before = [ "tend.service" ];
              wantedBy = [ "tend.service" ];

              serviceConfig = {
                Type = "oneshot";
                User = cfg.user;
                Group = cfg.group;
              };

              script = ''
                if [ ! -d "${cfg.dataDir}/.git" ]; then
                  ${pkgs.git}/bin/git init "${cfg.dataDir}"
                  mkdir -p "${cfg.dataDir}/pages" "${cfg.dataDir}/journals"
                fi
              '';
            };
          };
        };
    };
}
