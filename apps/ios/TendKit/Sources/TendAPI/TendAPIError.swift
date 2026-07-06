// SPDX-License-Identifier: MIT WITH Commons-Clause
import Foundation
import TendModel

/// Errors surfaced by the API client. A version conflict is thrown as
/// ``TendModel/VersionConflictError`` (not one of these) so the sync engine can catch it
/// specifically; `.unauthorized` is broken out so the app can re-present the Authelia login.
public enum TendAPIError: Error, Sendable {
    /// 401 — the Authelia session cookie is missing/expired; re-authentication is needed.
    case unauthorized
    /// Any other non-2xx response, with the decoded error body when present.
    case http(status: Int, body: ApiErrorBody?)
    /// The request URL could not be constructed (e.g. a malformed server base URL).
    case invalidURL
    /// The response was not an HTTP response.
    case nonHTTPResponse
    /// The response body failed to decode into the expected type.
    case decoding(Error)
    /// The underlying transport (network) failed.
    case transport(Error)
}
