// swift-tools-version: 5.9
// SPDX-License-Identifier: MIT WITH Commons-Clause
import PackageDescription

// TendKit — the native iOS/iPadOS client's reusable logic, split into small,
// protocol-bounded, independently testable modules.
//
// TendModel/TendParser/TendAPI/TendSync/TendStore depend only on Foundation (and each
// other) and are `swift test`-able off-device. TendStoreGRDB is the only target with an
// external dependency (GRDB); it is isolated so the rest stays dependency-free, and it must
// be compiled on a Mac.
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
        .library(name: "TendStore", targets: ["TendStore"]),
        .library(name: "TendStoreGRDB", targets: ["TendStoreGRDB"]),
        .library(name: "TendAuth", targets: ["TendAuth"]),
    ],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift", from: "6.29.3"),
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
        .target(
            name: "TendStore",
            dependencies: ["TendModel", "TendAPI", "TendSync"]
        ),
        .testTarget(
            name: "TendStoreTests",
            dependencies: ["TendStore", "TendModel", "TendAPI", "TendSync"]
        ),
        .target(
            name: "TendStoreGRDB",
            dependencies: [
                "TendStore",
                "TendModel",
                .product(name: "GRDB", package: "GRDB.swift"),
            ]
        ),
        .target(
            name: "TendAuth",
            dependencies: ["TendModel"]
        ),
        .testTarget(
            name: "TendAuthTests",
            dependencies: ["TendAuth", "TendModel"]
        ),
    ]
)
