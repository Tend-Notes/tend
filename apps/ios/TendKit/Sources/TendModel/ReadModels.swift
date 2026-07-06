// SPDX-License-Identifier: MIT WITH Commons-Clause
import Foundation

// Read-only response models for the list/query endpoints. All camelCase, matching the
// web client's contract in `packages/web/src/lib/api.ts`.

/// One task across the whole garden — `GET /todos` (wrapped in ``TaskList``).
public struct TaskItem: Codable, Equatable, Identifiable, Sendable {
    public var uuid: String
    public var status: String
    public var content: String
    public var pageName: String
    public var pageTitle: String
    public var isJournal: Bool
    public var journalDate: String?
    public var dueDate: String?
    public var startDate: String?
    public var priority: String?
    /// Present in the backend payload; absent from the TS contract, so optional.
    public var contentType: String?

    public var id: String { uuid }

    public init(
        uuid: String, status: String, content: String,
        pageName: String, pageTitle: String, isJournal: Bool,
        journalDate: String? = nil, dueDate: String? = nil,
        startDate: String? = nil, priority: String? = nil, contentType: String? = nil
    ) {
        self.uuid = uuid
        self.status = status
        self.content = content
        self.pageName = pageName
        self.pageTitle = pageTitle
        self.isJournal = isJournal
        self.journalDate = journalDate
        self.dueDate = dueDate
        self.startDate = startDate
        self.priority = priority
        self.contentType = contentType
    }
}

public struct TaskList: Codable, Equatable, Sendable {
    public var tasks: [TaskItem]
    public init(tasks: [TaskItem]) { self.tasks = tasks }
}

/// A tag and how many blocks carry it — `GET /tags`.
public struct TagInfo: Codable, Equatable, Identifiable, Sendable {
    public var name: String
    public var count: Int
    public var id: String { name }
    public init(name: String, count: Int) { self.name = name; self.count = count }
}

/// A block that links to a given page — `GET /pages/{name}/backlinks`.
public struct BacklinkRef: Codable, Equatable, Identifiable, Sendable {
    public var pageName: String
    public var pageTitle: String
    public var blockUuid: String
    public var blockContent: String
    public var isJournal: Bool
    public var journalDate: String?

    public var id: String { blockUuid }

    public init(
        pageName: String, pageTitle: String, blockUuid: String,
        blockContent: String, isJournal: Bool, journalDate: String? = nil
    ) {
        self.pageName = pageName
        self.pageTitle = pageTitle
        self.blockUuid = blockUuid
        self.blockContent = blockContent
        self.isJournal = isJournal
        self.journalDate = journalDate
    }
}

/// One full-text search hit — inside ``SearchResponse`` from `GET /search`.
public struct SearchResult: Codable, Equatable, Identifiable, Sendable {
    public var uuid: String
    public var content: String
    public var pageName: String
    public var pageTitle: String
    public var isJournal: Bool
    public var score: Double

    public var id: String { uuid }

    public init(
        uuid: String, content: String, pageName: String,
        pageTitle: String, isJournal: Bool, score: Double
    ) {
        self.uuid = uuid
        self.content = content
        self.pageName = pageName
        self.pageTitle = pageTitle
        self.isJournal = isJournal
        self.score = score
    }
}

/// Search availability, notably for encrypted gardens where the index may be disabled
/// or rebuilding.
public struct SearchStatus: Codable, Equatable, Sendable {
    public var disabled: Bool
    public var rebuilding: Bool
    public var message: String?
    public init(disabled: Bool, rebuilding: Bool, message: String? = nil) {
        self.disabled = disabled
        self.rebuilding = rebuilding
        self.message = message
    }
}

public struct SearchResponse: Codable, Equatable, Sendable {
    public var results: [SearchResult]
    public var status: SearchStatus?
    public init(results: [SearchResult], status: SearchStatus? = nil) {
        self.results = results
        self.status = status
    }
}

/// How a content type lays its files out on disk (`GET/PUT /content-types`).
public enum Organization: String, Codable, CaseIterable, Sendable {
    case flat
    case dateNamed
    case dateFoldered
}

/// A content type — the built-in `page`/`journal` plus any custom types.
public struct ContentType: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var directory: String
    public var organization: Organization
    public var template: String

    public init(
        id: String, name: String, directory: String,
        organization: Organization, template: String
    ) {
        self.id = id
        self.name = name
        self.directory = directory
        self.organization = organization
        self.template = template
    }
}
