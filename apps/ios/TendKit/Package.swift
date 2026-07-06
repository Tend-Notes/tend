// swift-tools-version: 5.9
// SPDX-License-Identifier: MIT WITH Commons-Clause
import PackageDescription

// TendKit — the native iOS/iPadOS client's reusable logic, split into small,
// protocol-bounded, independently testable modules. Modules are added as the
// implementation phases land; today: TendModel (wire types + domain model),
// which depends only on Foundation and therefore builds/tests anywhere Swift runs.
let package = Package(
    name: "TendKit",
    platforms: [
        .iOS(.v17),
        .macOS(.v14), // lets `swift test` run the pure-logic modules off-device
    ],
    products: [
        .library(name: "TendModel", targets: ["TendModel"]),
        .library(name: "TendParser", targets: ["TendParser"]),
        .library(name: "TendAPI", targets: ["TendAPI"]),
        .library(name: "TendSync", targets: ["TendSync"]),
    ],
    targets: [
        .target(
            name: "TendModel"
        ),
        .testTarget(
            name: "TendModelTests",
            dependencies: ["TendModel"]
        ),
        .target(
            name: "TendParser"
        ),
        .testTarget(
            name: "TendParserTests",
            dependencies: ["TendParser"]
        ),
        .target(
            name: "TendAPI",
            dependencies: ["TendModel"]
        ),
        .testTarget(
            name: "TendAPITests",
            dependencies: ["TendAPI", "TendModel"]
        ),
        .target(
            name: "TendSync",
            dependencies: ["TendModel"]
        ),
        .testTarget(
            name: "TendSyncTests",
            dependencies: ["TendSync", "TendModel"]
        ),
    ]
)
