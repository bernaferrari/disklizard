//! Platform-neutral filesystem metadata helpers.
//!
//! Platform modules can override entry discovery where they have a safer or
//! faster primitive, while the scanner keeps one portable fallback.

use super::{metadata_clone_evidence, Entry, EntryKind};
use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::Path;
use std::time::UNIX_EPOCH;

pub(crate) fn read_entries_portable(path: &Path) -> io::Result<Vec<Entry>> {
    fs::read_dir(path)?
        .map(|result| match result {
            Ok(entry) => match fs::symlink_metadata(entry.path()) {
                #[cfg(target_os = "windows")]
                Ok(metadata) => {
                    crate::windows::entry_from_path(&entry.path(), entry.file_name(), &metadata)
                }
                #[cfg(not(target_os = "windows"))]
                Ok(metadata) => Ok(Entry::from_metadata(entry.file_name(), &metadata)),
                Err(error) => Err(error),
            },
            Err(error) => Err(error),
        })
        .collect()
}

pub(crate) fn metadata_kind(metadata: &fs::Metadata) -> EntryKind {
    let file_type = metadata.file_type();
    if file_type.is_symlink() {
        return EntryKind::Symlink;
    }
    if file_type.is_dir() {
        return EntryKind::Directory;
    }
    if file_type.is_file() {
        return EntryKind::File;
    }
    EntryKind::Other
}

pub(crate) fn metadata_millis(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
}

impl Entry {
    pub(crate) fn from_metadata(name: OsString, metadata: &fs::Metadata) -> Self {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            Self {
                name,
                kind: metadata_kind(metadata),
                logical_size: metadata.len(),
                allocated_size: metadata.blocks().saturating_mul(512),
                modified_at: metadata_millis(metadata),
                device: metadata.dev(),
                file_id: metadata.ino(),
                link_count: metadata.nlink(),
                clone_evidence: metadata_clone_evidence(),
            }
        }
        #[cfg(not(unix))]
        {
            Self {
                name,
                kind: metadata_kind(metadata),
                logical_size: metadata.len(),
                allocated_size: metadata.len(),
                modified_at: metadata_millis(metadata),
                device: 0,
                file_id: 0,
                link_count: 1,
                clone_evidence: metadata_clone_evidence(),
            }
        }
    }
}
