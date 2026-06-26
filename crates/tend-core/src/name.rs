// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Canonical sheet-name handling — the single authority for turning a sheet's
//! parts (content type + bare name + optional date) into its canonical name
//! string, and back.
//!
//! The canonical name is what is stored as [`crate::Page::name`], used as the
//! link-index key, and written inside `[[wikilinks]]`. It is NOT the on-disk
//! path (that is the storage layer's concern) and NOT the display name (which
//! may be truncated for cleanliness). Storage paths/filenames are unchanged by
//! this module — it only centralizes how names are parsed and generated so the
//! format lives in exactly one place instead of being re-implemented at every
//! call site.
//!
//! Canonical forms, by content-type organization:
//! - page (flat, default):        `My Page`                         (bare)
//! - journal (date-named):        `2026-01-21`                      (bare date)
//! - custom flat:                 `person/John`                     (dir-prefixed)
//! - custom date-foldered:        `meeting/2026-01-30/Standup`      (dir + date + name)
//!
//! Parsing rule (matches the long-standing app behavior): a name whose first
//! segment is a known *directory-prefixed* content type's directory belongs to
//! that type; anything else is a page. Page and journal use bare names, so they
//! are never matched by prefix — a bare name is a page, and journals are
//! resolved through their own date/calendar path, not by parsing a bare date.

use chrono::NaiveDate;

use crate::ContentType;

/// A sheet name decomposed into its parts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedName {
    /// Content type id ("page", or a custom type's id).
    pub content_type_id: String,
    /// The bare name within the type ("My Page", "John", "Standup").
    pub bare_name: String,
    /// Associated date for date-foldered types (the subfolder date).
    pub date: Option<NaiveDate>,
}

/// Build the canonical name for a content type + bare name (+ date).
///
/// This reproduces exactly the form the storage layer assigns to `Page::name`,
/// so it is a faithful drop-in for hand-built name strings.
pub fn qualify(content_type: &ContentType, bare_name: &str, date: Option<NaiveDate>) -> String {
    if !content_type.name_includes_directory() {
        // page, journal: bare name (the directory is implicit).
        bare_name.to_string()
    } else if content_type.is_date_foldered() {
        match date {
            Some(d) => format!("{}/{}/{}", content_type.directory, d.format("%Y-%m-%d"), bare_name),
            None => format!("{}/{}", content_type.directory, bare_name),
        }
    } else {
        format!("{}/{}", content_type.directory, bare_name)
    }
}

/// Split a canonical name back into its bare name and date, given a KNOWN
/// content type. Inverse of [`qualify`].
pub fn split<'a>(content_type: &ContentType, canonical: &'a str) -> (&'a str, Option<NaiveDate>) {
    if !content_type.name_includes_directory() {
        // page (no date) or journal (the bare name is the date).
        if content_type.is_date_named() {
            let date = NaiveDate::parse_from_str(canonical, "%Y-%m-%d").ok();
            (canonical, date)
        } else {
            (canonical, None)
        }
    } else {
        let rest = canonical
            .strip_prefix(&content_type.directory)
            .and_then(|s| s.strip_prefix('/'))
            .unwrap_or(canonical);
        if content_type.is_date_foldered() {
            if let Some((date_str, bare)) = rest.split_once('/') {
                let date = NaiveDate::parse_from_str(date_str, "%Y-%m-%d").ok();
                (bare, date)
            } else {
                (rest, None)
            }
        } else {
            (rest, None)
        }
    }
}

/// Parse a canonical name, inferring the content type from a known directory
/// prefix. A name with no matching prefix is a page (the bare fallback).
pub fn parse(raw: &str, content_types: &[ContentType]) -> ParsedName {
    for ct in content_types {
        // Only directory-prefixed types are detectable by prefix; page and
        // journal use bare names and fall through to the page default.
        if !ct.name_includes_directory() {
            continue;
        }
        let prefix = format!("{}/", ct.directory);
        if raw.starts_with(&prefix) {
            let (bare, date) = split(ct, raw);
            return ParsedName {
                content_type_id: ct.id.clone(),
                bare_name: bare.to_string(),
                date,
            };
        }
    }
    ParsedName {
        content_type_id: "page".to_string(),
        bare_name: raw.to_string(),
        date: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Organization;

    fn page() -> ContentType {
        ContentType::page()
    }
    fn journal() -> ContentType {
        ContentType::journal()
    }
    fn flat() -> ContentType {
        ContentType::new("person", "Person", "person")
    }
    fn foldered() -> ContentType {
        let mut ct = ContentType::new("meeting", "Meeting", "meeting");
        ct.organization = Organization::DateFoldered;
        ct
    }
    fn d() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 1, 30).unwrap()
    }

    #[test]
    fn qualify_matches_storage_forms() {
        assert_eq!(qualify(&page(), "My Page", None), "My Page");
        assert_eq!(qualify(&journal(), "2026-01-21", None), "2026-01-21");
        assert_eq!(qualify(&flat(), "John", None), "person/John");
        assert_eq!(qualify(&foldered(), "Standup", Some(d())), "meeting/2026-01-30/Standup");
    }

    #[test]
    fn split_is_inverse_of_qualify() {
        for (ct, bare, date) in [
            (page(), "My Page", None),
            (journal(), "2026-01-21", NaiveDate::from_ymd_opt(2026, 1, 21)),
            (flat(), "John", None),
            (foldered(), "Standup", Some(d())),
        ] {
            let canonical = qualify(&ct, bare, date);
            let (got_bare, got_date) = split(&ct, &canonical);
            assert_eq!(got_bare, bare, "bare mismatch for {}", ct.id);
            assert_eq!(got_date, date, "date mismatch for {}", ct.id);
        }
    }

    #[test]
    fn parse_infers_custom_types_by_prefix() {
        let cts = [page(), journal(), flat(), foldered()];

        let p = parse("person/John", &cts);
        assert_eq!(p.content_type_id, "person");
        assert_eq!(p.bare_name, "John");
        assert_eq!(p.date, None);

        let m = parse("meeting/2026-01-30/Standup", &cts);
        assert_eq!(m.content_type_id, "meeting");
        assert_eq!(m.bare_name, "Standup");
        assert_eq!(m.date, Some(d()));
    }

    #[test]
    fn parse_bare_name_is_a_page() {
        let cts = [page(), journal(), flat(), foldered()];

        // Bare name -> page.
        let p = parse("My Page", &cts);
        assert_eq!(p.content_type_id, "page");
        assert_eq!(p.bare_name, "My Page");

        // A bare date is a page too (journals are resolved via their own path,
        // not by parsing a bare date — matches existing behavior).
        let j = parse("2026-01-21", &cts);
        assert_eq!(j.content_type_id, "page");
        assert_eq!(j.bare_name, "2026-01-21");
    }

    #[test]
    fn parse_round_trips_qualify_for_directory_types() {
        let cts = [page(), journal(), flat(), foldered()];
        for (ct, bare, date) in [
            (flat(), "John", None),
            (foldered(), "Standup", Some(d())),
        ] {
            let canonical = qualify(&ct, bare, date);
            let p = parse(&canonical, &cts);
            assert_eq!(p.content_type_id, ct.id);
            assert_eq!(p.bare_name, bare);
            assert_eq!(p.date, date);
        }
    }
}
