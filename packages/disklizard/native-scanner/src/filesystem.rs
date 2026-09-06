//! Platform-neutral filesystem metadata helpers.
//!
//! Platform modules can override entry discovery where they have a safer or
//! faster primitive, while the scanner keeps one portable fallback.

use super::{metadata_clone_evidence, Entry, EntryKind};
use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// One directory enumeration that survived individual entry failures.
///
/// `Err` from a reader means the directory itself could not be opened or
/// enumerated from the start. A child that was enumerated but could not be
/// inspected must never discard its readable siblings: it is reported here so
/// the scan can keep the measured majority and mark coverage partial.
#[derive(Default)]
pub(crate) struct DirectoryRead {
    pub entries: Vec<Entry>,
    /// Enumerated children whose metadata could not be read. Their bytes are
    /// unmeasured, so any aggregate over this directory is partial.
    pub unreadable_children: Vec<PathBuf>,
    /// Enumeration itself failed mid-stream, so names after the failure are
    /// unknown rather than absent.
    pub enumeration_incomplete: bool,
}

pub(crate) fn read_entries_portable(path: &Path) -> io::Result<DirectoryRead> {
    Ok(read_entries_with(fs::read_dir(path)?, path, inspect_entry))
}

/// Map one enumerated child to an `Entry` through its own metadata lookup.
fn inspect_entry(entry: &fs::DirEntry) -> io::Result<Entry> {
    let metadata = fs::symlink_metadata(entry.path())?;
    #[cfg(target_os = "windows")]
    {
        crate::windows::entry_from_path(&entry.path(), entry.file_name(), &metadata)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(Entry::from_metadata(entry.file_name(), &metadata))
    }
}

/// Collect a directory listing, continuing past per-entry inspection failures
/// so one vanishing or unreadable child cannot erase its readable siblings.
fn read_entries_with(
    listing: fs::ReadDir,
    path: &Path,
    inspect: impl Fn(&fs::DirEntry) -> io::Result<Entry>,
) -> DirectoryRead {
    let mut read = DirectoryRead::default();
    for result in listing {
        let entry = match result {
            Ok(entry) => entry,
            Err(_) => {
                // The enumeration stream broke; names after this point are
                // unknown. Keep what was already read and mark it incomplete.
                read.enumeration_incomplete = true;
                break;
            }
        };
        match inspect(&entry) {
            Ok(parsed) => read.entries.push(parsed),
            Err(_) => read.unreadable_children.push(path.join(entry.file_name())),
        }
    }
    read
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;

    fn write(path: &Path, bytes: usize) {
        File::create(path)
            .unwrap()
            .write_all(&vec![0_u8; bytes])
            .unwrap();
    }

    #[test]
    fn one_failed_metadata_lookup_keeps_readable_siblings_measured() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("project");
        fs::create_dir_all(&directory).unwrap();
        write(&directory.join("readable-a"), 3);
        write(&directory.join("poison"), 5);
        write(&directory.join("readable-b"), 7);

        let read = read_entries_with(fs::read_dir(&directory).unwrap(), &directory, |entry| {
            if entry.file_name() == "poison" {
                Err(io::Error::new(io::ErrorKind::NotFound, "vanished"))
            } else {
                inspect_entry(entry)
            }
        });

        let mut names: Vec<OsString> = read
            .entries
            .iter()
            .map(|entry| entry.name.clone())
            .collect();
        names.sort();
        assert_eq!(
            names,
            vec![OsString::from("readable-a"), OsString::from("readable-b")]
        );
        assert_eq!(read.entries[0].logical_size, 3);
        assert_eq!(read.entries[1].logical_size, 7);
        assert_eq!(read.unreadable_children, vec![directory.join("poison")]);
        assert!(!read.enumeration_incomplete);
    }

    #[test]
    fn a_real_directory_reads_complete() {
        let root = tempfile::tempdir().unwrap();
        write(&root.path().join("file"), 11);

        let read = read_entries_portable(root.path()).unwrap();

        assert_eq!(read.entries.len(), 1);
        assert!(read.unreadable_children.is_empty());
        assert!(!read.enumeration_incomplete);
    }

    #[test]
    fn an_unopenable_directory_is_an_error_not_an_empty_read() {
        let root = tempfile::tempdir().unwrap();
        write(&root.path().join("file"), 11);

        let error_kind = match read_entries_portable(&root.path().join("file")) {
            Err(error) => error.kind(),
            Ok(_) => panic!("a regular file must not enumerate as a directory"),
        };

        assert_eq!(error_kind, io::ErrorKind::NotADirectory);
    }
}
