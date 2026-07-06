<!-- SPDX-License-Identifier: MIT WITH Commons-Clause -->
# Tend for iOS / iPadOS

A native SwiftUI client for a self-hosted [Tend](../../) server. It is **not** a
WebView wrapper — every surface is native except the one-time Authelia login page
(which is Authelia's own web form, used only to capture the session cookie).

See the approved design in the plan file referenced by the team; the short version:

- **Full parity** with the web app (outliner editor, tasks, wiki-links, tags, block
  refs, search, journals, command palette, git/backup, import, settings).
- **Offline-first**: an encrypted local SQLite store is the source of truth for the UI;
  a sync engine reconciles with the server using the backend's per-page `version`
  optimistic-concurrency model.
- **Security/privacy/modularity/efficiency by design** — see the plan.

## Repository layout

```
apps/ios/
  TendKit/                 Swift Package — all reusable logic, independently testable
    Package.swift
    Sources/
      TendModel/           Wire types + domain model (pure Foundation)
      …                    (TendParser, TendAPI, TendStore, TendSync, TendAuth,
                            TendEditor, TendFeatures added in later phases)
    Tests/
      TendModelTests/      Golden JSON round-trip tests for the wire contract
  App/                     Xcode app + Share Extension + Widget targets (added later,
                           generated from project.yml via XcodeGen)
```

The heavy lifting lives in **TendKit** (a Swift Package) so each module is small,
protocol-bounded, and unit-testable. The Xcode app target is thin composition.

## Building

> This project targets Apple platforms and must be built on **macOS with Xcode 15+**
> (iOS 17 SDK). It cannot be built on Linux — it depends on SwiftUI/UIKit/WebKit/WidgetKit.

The pure-logic package is CI/CLI-testable even without Xcode UI:

```sh
cd apps/ios/TendKit
swift test          # runs TendModel (and later, TendParser/TendSync) unit tests
```

The full app (once the App target lands) will be generated with
[XcodeGen](https://github.com/yonaskolb/XcodeGen):

```sh
cd apps/ios/App
xcodegen generate   # produces Tend.xcodeproj from project.yml
open Tend.xcodeproj
```

## Wire-contract notes (important)

The backend JSON is **not uniformly cased**:

- **Response** bodies (`Page`, `Block`, `PageMeta`, `TaskItem`, …) are **camelCase**
  (`parentUuid`, `rootBlocks`, `contentType`, `journalDate`, …).
- **Request** bodies for page writes use a **snake_case** block shape:
  `{ uuid, content, parent_uuid, children, collapsed, properties }`.

`TendModel` therefore keeps `Block` (camelCase, for decoding responses) separate from
`BlockPayload` (snake_case `parent_uuid`, for encoding write requests). Do not merge them.
