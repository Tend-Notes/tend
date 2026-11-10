// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Where a sheet's file lives, and what a listing makes of it.
//!
//! Pure: no filesystem, no clock, no async. Split out for the same reason
//! `names` was — the browser writes a local garden through the File System
//! Access API and has to land on byte-identical paths — and because the four
//! combinations of {plain, encrypted} x {encoded, legacy-raw} were four copies
//! of the same function in `fs.rs` and `encrypted_fs.rs`.
//!
//! # Concepts
//!
//! - **content type** — decides the shape: flat, date-foldered, or namespaced
//!   ([`ContentType::is_date_foldered`], [`ContentType::is_namespaced`]).
//! - **bare name** — what the user typed: `"Shopping"`, or `"MyBook/Chapter 14"`
//!   for a namespaced type. Not the qualified page name.
//! - **relative segments** — a file's path below the garden root, one directory
//!   name per element, because that is how a directory handle is walked.
//! - **extension** — [`MD_EXT`] or [`ENCRYPTED_EXT`]. The only difference
//!   between a plain garden's layout and an encrypted one.

use chrono::{NaiveDate, Utc};
use tend_core::parser::parse_journal_filename;
use tend_core::{ContentType, PageMeta};

use crate::names::{decode_filename, encode_filename};

/// Extension of a sheet file in a plain garden.
pub const MD_EXT: &str = "md";

/// Extension of a sheet file in an encrypted garden.
pub const ENCRYPTED_EXT: &str = "md.age";

/// The date-folder and journal-filename format. ISO, and the only one written.
const DATE_FMT: &str = "%Y-%m-%d";

/// A sheet file's path below the garden root, one segment per element.
///
/// `date` must already be resolved — this function never reads the clock. For a
/// date-foldered type `None` means no date folder at all, which is not a path
/// the server writes; its callers default the date first.
///
/// `encode` percent-encodes the leaf filename ([`encode_filename`]). False
/// gives the legacy un-encoded form, which is still read for gardens written
/// before encoding existed.
pub fn sheet_rel(
    content_type: &ContentType,
    name: &str,
    date: Option<NaiveDate>,
    ext: &str,
    encode: bool,
) -> Vec<String> {
    let leaf = |s: &str| format!("{}.{}", if encode { encode_filename(s) } else { s.to_string() }, ext);

    let mut segments = vec![content_type.directory.clone()];
    if content_type.is_namespaced() {
        // `name` is "namespace/leaf"; the namespace is real subfolders (any
        // depth), and only the leaf filename is encoded.
        match name.rsplit_once('/') {
            Some((namespace, base)) => {
                segments.extend(namespace.split('/').map(str::to_string));
                segments.push(leaf(base));
            }
            None => segments.push(leaf(name)),
        }
    } else if content_type.is_date_foldered() {
        if let Some(d) = date {
            segments.push(d.format(DATE_FMT).to_string());
        }
        segments.push(leaf(name));
    } else {
        segments.push(leaf(name));
    }
    segments
}

/// The bare name and filed-under date of a file a listing walk found, or `None`
/// if the file is not a sheet of this type.
///
/// `rel_dirs` are the directory names between the content-type directory and
/// the file — the date folder for a date-foldered type, the namespace segments
/// for a namespaced one, empty for a flat one. `filename` includes the
/// extension.
///
/// This is the inverse of [`sheet_rel`], and the per-file step of every listing
/// walk, plain or encrypted.
pub fn sheet_ref(
    content_type: &ContentType,
    rel_dirs: &[String],
    filename: &str,
    ext: &str,
) -> Option<(String, Option<NaiveDate>)> {
    let base = filename.strip_suffix(&format!(".{ext}"))?;
    if base.is_empty() {
        return None;
    }

    if content_type.is_date_foldered() {
        // A folder that is not a date still yields its files, dateless, which is
        // what the directory walk has always done.
        let date = rel_dirs
            .first()
            .and_then(|d| NaiveDate::parse_from_str(d, DATE_FMT).ok());
        Some((decode_filename(base), date))
    } else if content_type.is_namespaced() {
        let name = if rel_dirs.is_empty() {
            decode_filename(base)
        } else {
            format!("{}/{}", rel_dirs.join("/"), decode_filename(base))
        };
        Some((name, None))
    } else if content_type.is_date_named() {
        // Journals: only date-named files count, and the name is normalized
        // through the parsed date, so a legacy "2025_01_18" lists as
        // "2025-01-18".
        let date = parse_journal_filename(base)?;
        Some((date.format(DATE_FMT).to_string(), None))
    } else {
        Some((decode_filename(base), None))
    }
}

/// A sheet's `PageMeta` from its name and date alone — no file read.
///
/// Only `name` (qualified) and `journal_date` are meaningful; the rest are
/// placeholders. Used by the name-only listing that resolves which sheets exist
/// without reading or decrypting their bodies.
pub fn sheet_ref_meta(
    content_type: &ContentType,
    bare_name: &str,
    date: Option<NaiveDate>,
) -> PageMeta {
    PageMeta {
        name: tend_core::qualify_name(content_type, bare_name, date),
        title: bare_name.to_string(),
        content_type: content_type.id.clone(),
        is_journal: content_type.is_date_named(),
        journal_date: date,
        block_count: 0,
        created_at: Utc::now(),
        modified_at: Utc::now(),
    }
}

/// A sheet's full `PageMeta` from its name, date, block count and file
/// timestamps, without parsing the body.
///
/// Mirrors exactly the metadata `read_sheet` + `PageMeta::from` produce — only
/// `block_count` needs the body, and it is counted cheaply. See the
/// `list_sheets_metadata_matches_read_sheet_parse` test in `fs.rs`.
pub fn sheet_meta(
    content_type: &ContentType,
    bare_name: &str,
    date: Option<NaiveDate>,
    block_count: usize,
    created_at: chrono::DateTime<Utc>,
    modified_at: chrono::DateTime<Utc>,
) -> PageMeta {
    // For date-named types (journals) the name IS the date.
    let resolved_date = if content_type.is_date_named() {
        NaiveDate::parse_from_str(bare_name, DATE_FMT).ok()
    } else {
        date
    };
    let is_journal = content_type.id == "journal";
    let title = if is_journal {
        resolved_date
            .map(|d| d.format("%A, %B %-d, %Y").to_string())
            .unwrap_or_else(|| bare_name.to_string())
    } else {
        bare_name.to_string()
    };
    // journal_date is set for journals and for any date-foldered type.
    let journal_date = if is_journal || content_type.is_date_foldered() {
        resolved_date
    } else {
        None
    };
    PageMeta {
        name: tend_core::qualify_name(content_type, bare_name, resolved_date),
        title,
        content_type: content_type.id.clone(),
        is_journal,
        journal_date,
        block_count,
        created_at,
        modified_at,
    }
}

/// Order a listing the way the sidebar expects it: date-named types newest date
/// first, everything else most recently modified first.
pub fn sort_sheets(sheets: &mut [PageMeta], content_type: &ContentType) {
    if content_type.is_date_named() {
        sheets.sort_by_key(|s| std::cmp::Reverse(s.journal_date));
    } else {
        sheets.sort_by_key(|s| std::cmp::Reverse(s.modified_at));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tend_core::Organization;

    fn flat() -> ContentType {
        let mut ct = ContentType::page();
        ct.id = "note".to_string();
        ct.directory = "notes".to_string();
        ct
    }

    fn dated() -> ContentType {
        let mut ct = flat();
        ct.id = "meeting".to_string();
        ct.organization = Organization::DateFoldered;
        ct.directory = "meetings".to_string();
        ct
    }

    fn namespaced() -> ContentType {
        let mut ct = flat();
        ct.id = "book".to_string();
        ct.organization = Organization::Namespaced;
        ct.directory = "books".to_string();
        ct
    }

    fn jan18() -> NaiveDate {
        NaiveDate::from_ymd_opt(2025, 1, 18).unwrap()
    }

    /// One row of the sheet_rel table: inputs, then the segments expected.
    struct RelCase {
        content_type: ContentType,
        name: &'static str,
        date: Option<NaiveDate>,
        ext: &'static str,
        encode: bool,
        want: &'static [&'static str],
    }

    fn rel(
        content_type: ContentType,
        name: &'static str,
        date: Option<NaiveDate>,
        ext: &'static str,
        encode: bool,
        want: &'static [&'static str],
    ) -> RelCase {
        RelCase { content_type, name, date, ext, encode, want }
    }

    /// Every layout, in both extensions and both encodings.
    #[test]
    fn sheet_rel_table() {
        let cases = vec![
            rel(flat(), "Shopping", None, MD_EXT, true, &["notes", "Shopping.md"]),
            rel(flat(), "Shopping", None, ENCRYPTED_EXT, true, &["notes", "Shopping.md.age"]),
            rel(dated(), "Standup", Some(jan18()), MD_EXT, true, &["meetings", "2025-01-18", "Standup.md"]),
            rel(dated(), "Standup", Some(jan18()), ENCRYPTED_EXT, true, &["meetings", "2025-01-18", "Standup.md.age"]),
            rel(namespaced(), "MyBook/Chapter 14", None, MD_EXT, true, &["books", "MyBook", "Chapter 14.md"]),
            rel(namespaced(), "MyBook/Chapter 14", None, ENCRYPTED_EXT, true, &["books", "MyBook", "Chapter 14.md.age"]),
            rel(namespaced(), "Series/MyBook/Ch 1", None, MD_EXT, true, &["books", "Series", "MyBook", "Ch 1.md"]),
            rel(namespaced(), "Loose", None, MD_EXT, true, &["books", "Loose.md"]),
            rel(flat(), "A:B", None, MD_EXT, true, &["notes", "A%3AB.md"]),
            rel(namespaced(), "A:B/C:D", None, MD_EXT, true, &["books", "A:B", "C%3AD.md"]),
            rel(flat(), "A:B", None, MD_EXT, false, &["notes", "A:B.md"]),
            rel(namespaced(), "A:B/C:D", None, MD_EXT, false, &["books", "A:B", "C:D.md"]),
            rel(dated(), "Standup", None, MD_EXT, true, &["meetings", "Standup.md"]),
        ];
        for case in &cases {
            assert_eq!(
                sheet_rel(&case.content_type, case.name, case.date, case.ext, case.encode),
                case.want,
                "sheet_rel({}, {:?}, {:?}, {}, {})",
                case.content_type.id,
                case.name,
                case.date,
                case.ext,
                case.encode
            );
        }
    }

    /// `sheet_ref` undoes `sheet_rel`: the segments it produces come back as the
    /// name and date that made them.
    #[test]
    fn sheet_ref_inverts_sheet_rel() {
        let cases: &[(ContentType, &str, Option<NaiveDate>)] = &[
            (flat(), "Shopping", None),
            (flat(), "A:B", None),
            (dated(), "Standup", Some(jan18())),
            (namespaced(), "MyBook/Chapter 14", None),
            (namespaced(), "Series/MyBook/Ch 1", None),
            (namespaced(), "Loose", None),
        ];
        for ext in [MD_EXT, ENCRYPTED_EXT] {
            for (ct, name, date) in cases {
                let segments = sheet_rel(ct, name, *date, ext, true);
                let (dirs, filename) = segments[1..].split_at(segments.len() - 2);
                let got = sheet_ref(ct, dirs, &filename[0], ext);
                assert_eq!(
                    got,
                    Some((name.to_string(), *date)),
                    "round trip of {name:?} as {segments:?}"
                );
            }
        }
    }

    #[test]
    fn sheet_ref_rejects_a_file_of_another_shape() {
        let ct = flat();
        assert_eq!(sheet_ref(&ct, &[], "notes.txt", MD_EXT), None, "wrong extension");
        assert_eq!(sheet_ref(&ct, &[], "Shopping.md", ENCRYPTED_EXT), None, "plain in an encrypted garden");
        assert_eq!(sheet_ref(&ct, &[], "Shopping.md.age", MD_EXT), None, "encrypted name, plain extension");
        assert_eq!(sheet_ref(&ct, &[], ".md", MD_EXT), None, "no name at all");
    }

    #[test]
    fn sheet_ref_normalizes_a_legacy_journal_filename() {
        let journal = ContentType::journal();
        assert!(journal.is_date_named());
        assert_eq!(
            sheet_ref(&journal, &[], "2025_01_18.md", MD_EXT),
            Some(("2025-01-18".to_string(), None)),
            "an underscore-separated journal lists under its ISO name"
        );
        assert_eq!(
            sheet_ref(&journal, &[], "Shopping.md", MD_EXT),
            None,
            "a journal directory ignores anything not date-named"
        );
    }

    #[test]
    fn sheet_ref_keeps_a_file_in_a_folder_that_is_not_a_date() {
        // The walk has always listed these, dateless, rather than hiding them.
        assert_eq!(
            sheet_ref(&dated(), &["not-a-date".to_string()], "Standup.md", MD_EXT),
            Some(("Standup".to_string(), None))
        );
    }

    #[test]
    fn sort_sheets_orders_by_date_or_by_modified() {
        let journal = ContentType::journal();
        let mut sheets = vec![
            sheet_ref_meta(&journal, "2025-01-18", Some(jan18())),
            sheet_ref_meta(&journal, "2025-03-01", NaiveDate::from_ymd_opt(2025, 3, 1)),
        ];
        sort_sheets(&mut sheets, &journal);
        assert_eq!(sheets[0].title, "2025-03-01", "newest journal first");

        let ct = flat();
        let old = Utc::now() - chrono::Duration::days(2);
        let mut sheets = vec![
            sheet_meta(&ct, "Older", None, 0, old, old),
            sheet_meta(&ct, "Newer", None, 0, Utc::now(), Utc::now()),
        ];
        sort_sheets(&mut sheets, &ct);
        assert_eq!(sheets[0].title, "Newer", "most recently modified first");
    }
}
