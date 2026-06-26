// SPDX-License-Identifier: MIT WITH Commons-Clause
//! Content type definitions
//!
//! A ContentType defines a category of sheets (e.g., pages, journals, meetings).
//! Everything in a garden is a sheet; a ContentType is the per-type configuration
//! that drives the otherwise-shared sheet logic. The only per-type variation in
//! storage is the `organization` (how files are named/foldered).

use serde::{Deserialize, Serialize};

/// How a content type's sheets are named and foldered on disk.
///
/// This replaces the old `save_by_date: bool`, which could not express journals
/// (flat directory, but the filename *is* a date).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Organization {
    /// `{directory}/{name}.md` — freeform filename. (page, custom-flat)
    Flat,
    /// `{directory}/{name}.md` where `name` IS a date (`YYYY-MM-DD`). (journal)
    DateNamed,
    /// `{directory}/{YYYY-MM-DD}/{name}.md` — date subfolder + freeform name. (custom by-date)
    DateFoldered,
}

/// A content type defines how a category of sheets is stored and organized.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(from = "ContentTypeWire", into = "ContentTypeWire")]
pub struct ContentType {
    /// Unique identifier (e.g., "page", "journal", "meetings")
    pub id: String,

    /// Display name (e.g., "Page", "Journal", "Meetings")
    pub name: String,

    /// Directory relative to garden root (e.g., "pages", "journals", "meetings")
    pub directory: String,

    /// How sheets of this type are named/foldered on disk.
    pub organization: Organization,

    /// Markdown template for new sheets of this type
    pub template: String,
}

impl ContentType {
    /// Create a new content type (flat organization by default).
    pub fn new(id: impl Into<String>, name: impl Into<String>, directory: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            directory: directory.into(),
            organization: Organization::Flat,
            template: String::new(),
        }
    }

    /// Built-in "page" content type
    pub fn page() -> Self {
        Self::new("page", "Page", "pages")
    }

    /// Built-in "journal" content type (date-named: filename is the date).
    pub fn journal() -> Self {
        let mut ct = Self::new("journal", "Journal", "journals");
        ct.organization = Organization::DateNamed;
        ct
    }

    /// Default content types for a new garden
    pub fn defaults() -> Vec<Self> {
        vec![Self::page(), Self::journal()]
    }

    /// Check if this is a built-in content type
    pub fn is_builtin(&self) -> bool {
        self.id == "page" || self.id == "journal"
    }

    /// Whether sheets are foldered into date subdirectories (`{dir}/{date}/{name}.md`).
    ///
    /// This is the direct replacement for the old `save_by_date` flag: it is true
    /// only for `DateFoldered`, NOT for date-*named* types like journals.
    pub fn is_date_foldered(&self) -> bool {
        matches!(self.organization, Organization::DateFoldered)
    }

    /// Whether the filename itself is a date (`YYYY-MM-DD`), as for journals.
    pub fn is_date_named(&self) -> bool {
        matches!(self.organization, Organization::DateNamed)
    }

    /// Whether this type associates a date with each sheet (named or foldered).
    pub fn uses_date(&self) -> bool {
        matches!(
            self.organization,
            Organization::DateNamed | Organization::DateFoldered
        )
    }

    /// Whether `Page::name` embeds the content type's directory (and date subfolder).
    ///
    /// The default `page` type and date-named types (journals) use *bare* names
    /// (`"My Page"`, `"2026-01-21"`); every other type prefixes its directory
    /// (`"person/John"`, `"meeting/2026-01-30/Standup"`). This is load-bearing:
    /// `Page::name` is hashed into the link index and drives URLs, so the bare
    /// names of page/journal must be preserved. This is the one irreducible
    /// place where `page` is not a fully generic sheet.
    pub fn name_includes_directory(&self) -> bool {
        !(self.id == "page" || self.is_date_named())
    }
}

/// On-the-wire / on-disk representation of a [`ContentType`].
///
/// Provides backward compatibility with gardens written before `organization`
/// existed (they carried `saveByDate`), and dual-emits `saveByDate` so older
/// frontends keep working during the migration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContentTypeWire {
    id: String,
    name: String,
    directory: String,
    /// Present in current gardens; absent in legacy gardens (derived then).
    #[serde(default)]
    organization: Option<Organization>,
    /// Legacy field; still emitted for forward-compat with old frontends.
    #[serde(default)]
    save_by_date: bool,
    #[serde(default)]
    template: String,
}

impl From<ContentTypeWire> for ContentType {
    fn from(w: ContentTypeWire) -> Self {
        let organization = w.organization.unwrap_or_else(|| {
            // Legacy garden: derive from id + save_by_date. Journals are always
            // date-named regardless of the (historically inconsistent) flag.
            if w.id == "journal" {
                Organization::DateNamed
            } else if w.save_by_date {
                Organization::DateFoldered
            } else {
                Organization::Flat
            }
        });
        ContentType {
            id: w.id,
            name: w.name,
            directory: w.directory,
            organization,
            template: w.template,
        }
    }
}

impl From<ContentType> for ContentTypeWire {
    fn from(ct: ContentType) -> Self {
        ContentTypeWire {
            id: ct.id,
            name: ct.name,
            directory: ct.directory,
            organization: Some(ct.organization),
            // Dual-emit the legacy flag so an old frontend still behaves.
            save_by_date: matches!(ct.organization, Organization::DateFoldered),
            template: ct.template,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_content_types() {
        let defaults = ContentType::defaults();
        assert_eq!(defaults.len(), 2);
        assert_eq!(defaults[0].id, "page");
        assert_eq!(defaults[0].organization, Organization::Flat);
        assert_eq!(defaults[1].id, "journal");
        assert_eq!(defaults[1].organization, Organization::DateNamed);
    }

    #[test]
    fn test_is_builtin() {
        assert!(ContentType::page().is_builtin());
        assert!(ContentType::journal().is_builtin());
        assert!(!ContentType::new("meetings", "Meetings", "meetings").is_builtin());
    }

    #[test]
    fn test_organization_default() {
        let ct = ContentType::new("test", "Test", "test");
        assert_eq!(ct.organization, Organization::Flat);
        assert!(!ct.is_date_foldered());
        assert!(!ct.is_date_named());
        assert!(!ct.uses_date());
    }

    #[test]
    fn test_date_helpers() {
        assert!(ContentType::journal().is_date_named());
        assert!(!ContentType::journal().is_date_foldered());
        assert!(ContentType::journal().uses_date());

        let mut folder = ContentType::new("meeting", "Meeting", "meeting");
        folder.organization = Organization::DateFoldered;
        assert!(folder.is_date_foldered());
        assert!(!folder.is_date_named());
        assert!(folder.uses_date());
    }

    #[test]
    fn legacy_config_without_organization_derives_it() {
        // Legacy custom date-foldered type (saveByDate:true, no organization).
        let json = r#"{"id":"meeting","name":"Meeting","directory":"meeting","saveByDate":true}"#;
        let ct: ContentType = serde_json::from_str(json).unwrap();
        assert_eq!(ct.organization, Organization::DateFoldered);

        // Legacy flat type.
        let json = r#"{"id":"person","name":"Person","directory":"person","saveByDate":false}"#;
        let ct: ContentType = serde_json::from_str(json).unwrap();
        assert_eq!(ct.organization, Organization::Flat);

        // Legacy journal with the historically-wrong saveByDate:true is still DateNamed.
        let json = r#"{"id":"journal","name":"Journal","directory":"journals","saveByDate":true}"#;
        let ct: ContentType = serde_json::from_str(json).unwrap();
        assert_eq!(ct.organization, Organization::DateNamed);

        // Legacy journal with saveByDate:false is also DateNamed.
        let json = r#"{"id":"journal","name":"Journal","directory":"journals","saveByDate":false}"#;
        let ct: ContentType = serde_json::from_str(json).unwrap();
        assert_eq!(ct.organization, Organization::DateNamed);
    }

    #[test]
    fn serialize_dual_emits_save_by_date_and_organization() {
        let v = serde_json::to_value(ContentType::journal()).unwrap();
        assert_eq!(v["organization"], "dateNamed");
        // Journal is date-named, not date-foldered, so legacy saveByDate is false.
        assert_eq!(v["saveByDate"], false);

        let mut folder = ContentType::new("meeting", "Meeting", "meeting");
        folder.organization = Organization::DateFoldered;
        let v = serde_json::to_value(folder).unwrap();
        assert_eq!(v["organization"], "dateFoldered");
        assert_eq!(v["saveByDate"], true);
    }

    #[test]
    fn roundtrip_preserves_organization() {
        for ct in [
            ContentType::page(),
            ContentType::journal(),
            {
                let mut f = ContentType::new("meeting", "Meeting", "meeting");
                f.organization = Organization::DateFoldered;
                f
            },
        ] {
            let json = serde_json::to_string(&ct).unwrap();
            let back: ContentType = serde_json::from_str(&json).unwrap();
            assert_eq!(ct, back);
        }
    }
}
