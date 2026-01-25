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

        # Build the frontend using pnpm with fixed-output deps
        frontend = pkgs.stdenv.mkDerivation (finalAttrs: {
          pname = "tend-frontend";
          version = "0.1.0";
          src = ./.;

          nativeBuildInputs = with pkgs; [
            nodejs_22
            pnpm_10
            pnpmConfigHook
          ];

          # Fixed-output derivation for pnpm dependencies
          pnpmDeps = pkgs.fetchPnpmDeps {
            inherit (finalAttrs) pname version src;
            fetcherVersion = 3;
            hash = "sha256-Lwn0aeDCbF7OrtLppNtCMc51MA6nuBwsv1LtwI2We00=";
          };

          buildPhase = ''
            runHook preBuild
            cd packages/web
            pnpm run build
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall
            cp -r dist $out
            runHook postInstall
          '';
        });

        # Build the Rust backend
        backend = pkgs.rustPlatform.buildRustPackage {
          pname = "tend-server";
          version = "0.1.0";
          src = ./.;
          cargoLock.lockFile = ./Cargo.lock;

          inherit buildInputs;
          nativeBuildInputs = nativeBuildInputs ++ [
            # TODO: Remove for production - only needed for tests
            pkgs.git
          ];

          # Only build the server binary
          cargoBuildFlags = [ "-p" "tend-server" ];

          meta = with pkgs.lib; {
            description = "Tend backend server";
            license = licenses.mit;
          };
        };

        # Combined package with static files
        tend = pkgs.stdenv.mkDerivation {
          pname = "tend";
          version = "0.1.0";

          dontUnpack = true;
          dontBuild = true;

          nativeBuildInputs = [ pkgs.makeWrapper ];

          installPhase = ''
            mkdir -p $out/bin $out/share/tend/static

            # Copy frontend static files
            cp -r ${frontend}/* $out/share/tend/static/

            # Create wrapper that sets TEND_STATIC_DIR
            makeWrapper ${backend}/bin/tend $out/bin/tend \
              --set-default TEND_STATIC_DIR "$out/share/tend/static"
          '';

          meta = with pkgs.lib; {
            description = "A digital garden for your thoughts";
            homepage = "https://github.com/crawfordlong/tend";
            license = licenses.mit; # Note: With Commons Clause
            mainProgram = "tend";
          };
        };

      in {
        # Development shell
        devShells.default = pkgs.mkShell {
          inherit nativeBuildInputs buildInputs;

          packages = with pkgs; [
            # Rust
            rustToolchain
            cargo-watch
            cargo-edit

            # Node.js
            nodejs_22
            nodePackages.pnpm

            # Tools
            git
            jq
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

        # Production packages
        packages = {
          default = tend;
          inherit tend backend frontend;
        };

        # For `nix run`
        apps.default = {
          type = "app";
          program = "${tend}/bin/tend";
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

            package = mkOption {
              type = types.package;
              default = self.packages.${pkgs.system}.default;
              defaultText = literalExpression "pkgs.tend";
              description = "The Tend package to use";
            };

            host = mkOption {
              type = types.str;
              default = "127.0.0.1";
              description = "Address to bind to. Use 0.0.0.0 to listen on all interfaces.";
            };

            port = mkOption {
              type = types.port;
              default = 3000;
              description = "Port to listen on";
            };

            dataDir = mkOption {
              type = types.path;
              default = "/var/lib/tend";
              description = "Directory for storing garden data";
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

            openFirewall = mkOption {
              type = types.bool;
              default = false;
              description = "Whether to open the firewall for the Tend port";
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

              remoteUrl = mkOption {
                type = types.nullOr types.str;
                default = null;
                description = "Git remote URL for push/pull operations";
              };
            };

            auth = {
              verifyUrl = mkOption {
                type = types.nullOr types.str;
                default = null;
                description = ''
                  URL to verify authentication for WebSocket connections.
                  Required when using a reverse proxy with forward auth (e.g., Caddy + Authelia).
                  WebSocket connections will forward cookies to this URL for verification.
                  Example: "http://localhost:9091/api/verify" for Authelia.
                '';
                example = "http://localhost:9091/api/verify";
              };
            };

            extraEnvironment = mkOption {
              type = types.attrsOf types.str;
              default = {};
              description = "Extra environment variables for the Tend service";
              example = literalExpression ''
                {
                  RUST_LOG = "debug";
                }
              '';
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

            networking.firewall.allowedTCPPorts = mkIf cfg.openFirewall [ cfg.port ];

            systemd.services.tend = {
              description = "Tend Digital Garden";
              after = [ "network.target" ];
              wantedBy = [ "multi-user.target" ];

              path = [ pkgs.git ];

              environment = {
                TEND_BASE_DIR = cfg.dataDir;
                TEND_PORT = toString cfg.port;
                TEND_HOST = cfg.host;
                TEND_BACKUP_INTERVAL_MINUTES = toString cfg.gitBackup.intervalMinutes;
                TEND_AUTO_PUSH = if cfg.gitBackup.autoPush then "true" else "false";
                RUST_LOG = "info";
              } // optionalAttrs (cfg.auth.verifyUrl != null) {
                TEND_AUTH_VERIFY_URL = cfg.auth.verifyUrl;
              } // cfg.extraEnvironment;

              serviceConfig = {
                Type = "simple";
                User = cfg.user;
                Group = cfg.group;
                ExecStart = "${cfg.package}/bin/tend";
                Restart = "on-failure";
                RestartSec = 5;
                WorkingDirectory = cfg.dataDir;

                # Hardening
                NoNewPrivileges = true;
                PrivateTmp = true;
                ProtectSystem = "strict";
                ProtectHome = true;
                ReadWritePaths = [ cfg.dataDir ];
                CapabilityBoundingSet = "";
                AmbientCapabilities = "";
                ProtectKernelTunables = true;
                ProtectKernelModules = true;
                ProtectControlGroups = true;
                RestrictNamespaces = true;
                LockPersonality = true;
                RestrictRealtime = true;
                RestrictSUIDSGID = true;
                RemoveIPC = true;
                PrivateMounts = true;
              };
            };

            # Initialize git repo and directory structure
            systemd.services.tend-init = {
              description = "Initialize Tend data directory";
              before = [ "tend.service" ];
              wantedBy = [ "tend.service" ];

              serviceConfig = {
                Type = "oneshot";
                User = cfg.user;
                Group = cfg.group;
                RemainAfterExit = true;
              };

              script = ''
                # Create directory structure
                # Base dir for config, Gardens/Notes for default garden
                mkdir -p "${cfg.dataDir}"
                mkdir -p "${cfg.dataDir}/Gardens/Notes/pages"
                mkdir -p "${cfg.dataDir}/Gardens/Notes/journals"

                # Initialize git in default garden if not already done
                if [ ! -d "${cfg.dataDir}/Gardens/Notes/.git" ]; then
                  ${pkgs.git}/bin/git -C "${cfg.dataDir}/Gardens/Notes" init
                  ${pkgs.git}/bin/git -C "${cfg.dataDir}/Gardens/Notes" config user.name "Tend"
                  ${pkgs.git}/bin/git -C "${cfg.dataDir}/Gardens/Notes" config user.email "tend@localhost"
                fi

                ${optionalString (cfg.gitBackup.remoteUrl != null) ''
                  # Set up remote if configured
                  if ! ${pkgs.git}/bin/git -C "${cfg.dataDir}/Gardens/Notes" remote get-url origin >/dev/null 2>&1; then
                    ${pkgs.git}/bin/git -C "${cfg.dataDir}/Gardens/Notes" remote add origin "${cfg.gitBackup.remoteUrl}"
                  else
                    ${pkgs.git}/bin/git -C "${cfg.dataDir}/Gardens/Notes" remote set-url origin "${cfg.gitBackup.remoteUrl}"
                  fi
                ''}
              '';
            };
          };
        };

      # Overlay for including in other flakes
      overlays.default = final: prev: {
        tend = self.packages.${final.system}.default;
      };
    };
}
