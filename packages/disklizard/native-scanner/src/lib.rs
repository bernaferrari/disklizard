use rayon::prelude::*;
use std::collections::{HashMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

mod accounting;
mod budget;
mod classification;
mod clone_metadata;
mod config;
mod filesystem;
mod protocol;
mod retention;
mod volume_progress;
mod work_progress;
use classification::{
    classify as classify_developer_artifact,
    is_evidence_name as is_developer_artifact_evidence_name,
    is_project_marker_name as is_developer_project_marker_name,
};
#[cfg(not(any(target_os = "macos", test)))]
use clone_metadata::{
    compare_utf16 as compare_utf16_strings, emitted_evidence as emitted_clone_evidence,
};
#[cfg(any(target_os = "macos", test))]
use clone_metadata::{
    compare_utf16 as compare_utf16_strings, emitted_evidence as emitted_clone_evidence,
    evidence_from_attributes as clone_evidence_from_attributes,
};
#[cfg(any(target_os = "macos", test))]
use clone_metadata::{ATTR_CMNEXT_CLONE_ID, ATTR_CMNEXT_CLONE_REFCNT, ATTR_CMNEXT_EXT_FLAGS};
#[cfg(test)]
use clone_metadata::{EF_MAY_SHARE_BLOCKS, EF_SHARES_ALL_BLOCKS};
#[cfg(target_os = "windows")]
use filesystem::metadata_kind;
use filesystem::{read_entries_portable, DirectoryRead};
use retention::ChildRetention;

const MAX_DISCOVERIES: usize = 96;
const MAX_FILE_DISCOVERIES: usize = 24;
const MAX_ISSUE_SAMPLES: usize = 12;
pub use config::{
    DeveloperArtifactInventoryOptions, DeveloperArtifactInventoryRequest, Request, SizeMode,
};
pub use protocol::{
    ArtifactInventoryState, CloneAccounting, CloneEvidence, CloneMetadataCapability,
    CloneUnavailableReason, CompactNode, DeveloperArtifact, DeveloperArtifactCleanupReadiness,
    DeveloperArtifactConfidence, DeveloperArtifactDirectoryIdentity, DeveloperArtifactEcosystem,
    DeveloperArtifactInventory, DeveloperArtifactInventoryStatus, DeveloperArtifactKind, Discovery,
    HardLink, Progress, ScanIssueSummary, ServerMessage, SharedStorageEvidence,
};

#[derive(Default)]
struct DeveloperArtifactInventoryStateData {
    max_items: usize,
    items: Vec<DeveloperArtifact>,
    matched_directories: usize,
    truncated: bool,
    skipped_symlink_count: usize,
    skipped_symlink_samples: Vec<String>,
    skipped_directory_count: usize,
    skipped_directory_samples: Vec<String>,
    excluded_count: usize,
    excluded_samples: Vec<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct DeveloperArtifactClassification {
    kind: DeveloperArtifactKind,
    ecosystem: DeveloperArtifactEcosystem,
    confidence: DeveloperArtifactConfidence,
    cleanup: DeveloperArtifactCleanupReadiness,
    evidence: Vec<String>,
}

type Emit = dyn Fn(&ServerMessage) -> io::Result<()> + Send + Sync;

/// The single map charge for one APFS full-clone group. Parallel traversal
/// charges whichever member arrives first; after the walk the charge moves to
/// the lexically first path so repeated scans place the bytes identically.
struct CloneOwner {
    charged: PathBuf,
    owner: PathBuf,
    size: u64,
    logical_size: u64,
}

pub struct Scanner {
    state: Arc<State>,
    pool: rayon::ThreadPool,
}

struct State {
    request: Request,
    preserve_names: HashSet<String>,
    collapse_names: HashSet<String>,
    signature_names: HashSet<String>,
    excluded_children: HashMap<PathBuf, HashSet<OsString>>,
    /// The visual map's legacy device/identity traversal guard.
    hard_links: [Mutex<HashSet<(u64, u64)>>; 64],
    /// APFS full-clone data streams already charged to the map. A full clone
    /// (EF_SHARES_ALL_BLOCKS) owns no private blocks, so only the first
    /// observed member of a clone ID is charged; later members cost 0 bytes.
    /// Without this, apps that clone themselves (Chrome's code-sign clones,
    /// Xcode, simulators) inflate totals far beyond the volume's used space.
    full_clones: [Mutex<HashMap<String, CloneOwner>>; 64],
    visited_directories: Mutex<HashSet<(u64, u64)>>,
    root_device: AtomicU64,
    /// Root dev/inode is the deep inventory's cycle and device-scope boundary.
    /// A device alone is insufficient: an absent root file id cannot prove
    /// that a same-device descendant is not an alias/cycle.
    root_directory_identity_available: AtomicBool,
    /// Kept separate from the visual map guard: inventory scope may end
    /// without omitting bytes or children from the map.
    inventory_visited_directories: Mutex<HashSet<(u64, u64)>>,
    #[cfg(test)]
    inventory_test_root_identity_unavailable: AtomicBool,
    #[cfg(test)]
    inventory_test_child_identity_unavailable: Mutex<Option<PathBuf>>,
    clone_metadata: AtomicU8,
    shared_storage_evidence_complete: AtomicBool,
    issues: Mutex<Issues>,
    developer_artifact_inventory: Option<Mutex<DeveloperArtifactInventoryStateData>>,
    files: AtomicUsize,
    dirs: AtomicUsize,
    bytes: AtomicU64,
    work_completed: Arc<AtomicU64>,
    expected_objects: Option<u64>,
    discoveries: AtomicUsize,
    file_discoveries: AtomicUsize,
    started_at: Instant,
    next_progress_ms: AtomicU64,
    emit: Arc<Emit>,
}

#[derive(Default)]
struct Issues {
    count: usize,
    samples: Vec<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct Entry {
    pub(crate) name: OsString,
    pub(crate) kind: EntryKind,
    pub(crate) logical_size: u64,
    pub(crate) allocated_size: u64,
    pub(crate) modified_at: Option<u64>,
    pub(crate) device: u64,
    pub(crate) file_id: u64,
    pub(crate) link_count: u64,
    pub(crate) clone_evidence: CloneEvidence,
}

#[cfg(not(target_os = "windows"))]
fn developer_artifact_directory_identity(
    entry: &Entry,
) -> Option<DeveloperArtifactDirectoryIdentity> {
    (entry.kind == EntryKind::Directory && entry.device > 0 && entry.file_id > 0)
        .then(|| {
            entry
                .modified_at
                .map(|modified_at| DeveloperArtifactDirectoryIdentity {
                    // POSIX native metadata is deliberately represented with the
                    // same device/inode pair Node exposes through bigint lstat.
                    platform: "posix",
                    device: entry.device.to_string(),
                    file_id: entry.file_id.to_string(),
                    modified_at,
                })
        })
        .flatten()
}

#[cfg(target_os = "windows")]
fn developer_artifact_directory_identity(
    _entry: &Entry,
) -> Option<DeveloperArtifactDirectoryIdentity> {
    // Do not manufacture a cross-runtime identity from Windows-native file
    // indexes. The desktop hydrates its own Node-compatible identity before
    // delivery; if that fails, the retained record stays partial and cannot
    // be used for deep cleanup.
    None
}

/// Better items sort first: larger aggregate size, then JavaScript-compatible
/// UTF-16 pathname order. The inverse of this order forms the bounded heap
/// root, so parallel traversal order cannot change retained items.
fn compare_developer_artifact_retention(
    left: &DeveloperArtifact,
    right: &DeveloperArtifact,
) -> std::cmp::Ordering {
    right
        .size
        .cmp(&left.size)
        .then_with(|| compare_utf16_strings(&left.path, &right.path))
}

fn is_worse_developer_artifact(left: &DeveloperArtifact, right: &DeveloperArtifact) -> bool {
    compare_developer_artifact_retention(left, right) == std::cmp::Ordering::Greater
}

/// A record is not safely deletable merely because it was classified. Its
/// opaque direct-directory identity must be present and non-zero so the
/// desktop can reject replacements between scan and Trash.
fn has_usable_developer_artifact_directory_identity(artifact: &DeveloperArtifact) -> bool {
    artifact
        .directory_identity
        .as_ref()
        .is_some_and(|identity| {
            !identity.device.is_empty()
                && identity.device != "0"
                && !identity.file_id.is_empty()
                && identity.file_id != "0"
        })
}

fn sift_worst_developer_artifact_up(items: &mut [DeveloperArtifact], mut child: usize) {
    while child > 0 {
        let parent = (child - 1) / 2;
        if !is_worse_developer_artifact(&items[child], &items[parent]) {
            break;
        }
        items.swap(child, parent);
        child = parent;
    }
}

fn sift_worst_developer_artifact_down(items: &mut [DeveloperArtifact], mut parent: usize) {
    loop {
        let left = parent * 2 + 1;
        let right = left + 1;
        let mut worst = parent;
        if left < items.len() && is_worse_developer_artifact(&items[left], &items[worst]) {
            worst = left;
        }
        if right < items.len() && is_worse_developer_artifact(&items[right], &items[worst]) {
            worst = right;
        }
        if worst == parent {
            return;
        }
        items.swap(parent, worst);
        parent = worst;
    }
}

fn retain_developer_artifact(
    items: &mut Vec<DeveloperArtifact>,
    max_items: usize,
    artifact: DeveloperArtifact,
) {
    if items.len() < max_items {
        items.push(artifact);
        let last = items.len() - 1;
        sift_worst_developer_artifact_up(items, last);
        return;
    }
    let Some(worst) = items.first() else {
        return;
    };
    if compare_developer_artifact_retention(&artifact, worst) != std::cmp::Ordering::Less {
        return;
    }
    items[0] = artifact;
    sift_worst_developer_artifact_down(items, 0);
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum EntryKind {
    File,
    Directory,
    Symlink,
    Other,
}

#[derive(Default)]
struct Measurement {
    size: u64,
    logical_size: u64,
    has_shared_storage_risk: bool,
    modified_at: Option<u64>,
    signatures: Option<Vec<String>>,
}

// Ordered by how conservatively a whole scan must be presented. One
// unobservable subtree means the root can no longer promise clone awareness,
// even when another directory returned APFS metadata successfully.
const CLONE_METADATA_UNOBSERVED: u8 = 0;
const CLONE_METADATA_AVAILABLE: u8 = 1;
const CLONE_METADATA_UNKNOWN: u8 = 2;
const CLONE_METADATA_UNAVAILABLE_SCANNER: u8 = 3;
const CLONE_METADATA_UNAVAILABLE_FILESYSTEM: u8 = 4;
const CLONE_METADATA_UNAVAILABLE_PLATFORM: u8 = 5;

fn initial_clone_metadata_status() -> u8 {
    #[cfg(target_os = "macos")]
    {
        CLONE_METADATA_UNOBSERVED
    }
    #[cfg(not(target_os = "macos"))]
    {
        CLONE_METADATA_UNAVAILABLE_PLATFORM
    }
}

fn clone_metadata_status(evidence: &CloneEvidence) -> u8 {
    match evidence {
        CloneEvidence::NotShared
        | CloneEvidence::MayShareBlocks { .. }
        | CloneEvidence::SharesAllBlocks { .. } => CLONE_METADATA_AVAILABLE,
        CloneEvidence::Unknown => CLONE_METADATA_UNKNOWN,
        CloneEvidence::Unavailable {
            reason: CloneUnavailableReason::Platform,
        } => CLONE_METADATA_UNAVAILABLE_PLATFORM,
        CloneEvidence::Unavailable {
            reason: CloneUnavailableReason::Filesystem,
        } => CLONE_METADATA_UNAVAILABLE_FILESYSTEM,
        CloneEvidence::Unavailable {
            reason: CloneUnavailableReason::Scanner,
        } => CLONE_METADATA_UNAVAILABLE_SCANNER,
    }
}

fn clone_metadata_capability(status: u8) -> CloneMetadataCapability {
    match status {
        CLONE_METADATA_AVAILABLE => CloneMetadataCapability::Available,
        CLONE_METADATA_UNAVAILABLE_PLATFORM => CloneMetadataCapability::Unavailable {
            reason: CloneUnavailableReason::Platform,
        },
        CLONE_METADATA_UNAVAILABLE_FILESYSTEM => CloneMetadataCapability::Unavailable {
            reason: CloneUnavailableReason::Filesystem,
        },
        CLONE_METADATA_UNAVAILABLE_SCANNER => CloneMetadataCapability::Unavailable {
            reason: CloneUnavailableReason::Scanner,
        },
        CLONE_METADATA_UNOBSERVED | CLONE_METADATA_UNKNOWN => CloneMetadataCapability::Unknown,
        _ => CloneMetadataCapability::Unknown,
    }
}

struct DeveloperArtifactObservation<'a> {
    path: &'a Path,
    name: &'a str,
    size: u64,
    logical_size: u64,
    modified_at: Option<u64>,
    /// Sibling project-marker names observed beside this directory.
    sibling_markers: &'a [String],
    signatures: &'a [String],
    directory_identity: Option<DeveloperArtifactDirectoryIdentity>,
}

struct DirectoryWalk {
    directory: Directory,
    directory_identity: Option<DeveloperArtifactDirectoryIdentity>,
    inventory_scope_allowed: bool,
    /// Project-marker names among this directory's siblings, observed by the
    /// parent walk that spawned it.
    sibling_markers: Arc<Vec<String>>,
}

struct Directory {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    file: fs::File,
    #[cfg(target_os = "windows")]
    handle: windows::DirectoryHandle,
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    path: PathBuf,
}

impl Directory {
    fn open(path: &Path) -> io::Result<Self> {
        #[cfg(target_os = "macos")]
        {
            Ok(Self {
                file: fs::File::open(path)?,
            })
        }
        #[cfg(target_os = "linux")]
        {
            Ok(Self {
                file: fs::File::open(path)?,
            })
        }
        #[cfg(target_os = "windows")]
        {
            Ok(Self {
                handle: windows::DirectoryHandle::open(path)?,
            })
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
        {
            Ok(Self {
                path: path.to_path_buf(),
            })
        }
    }

    fn open_child(&self, name: &OsStr, path: &Path) -> io::Result<Self> {
        #[cfg(target_os = "macos")]
        {
            let _ = path;
            Ok(Self {
                file: macos::open_child(&self.file, name)?,
            })
        }
        #[cfg(target_os = "linux")]
        {
            let _ = path;
            Ok(Self {
                file: linux::open_child(&self.file, name)?,
            })
        }
        #[cfg(target_os = "windows")]
        {
            let _ = name;
            Self::open(path)
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
        {
            let _ = name;
            Self::open(path)
        }
    }

    fn read_entries(&self, path: &Path) -> io::Result<DirectoryRead> {
        #[cfg(target_os = "macos")]
        if let Ok(entries) = macos::read_entries(&self.file) {
            return Ok(DirectoryRead {
                entries,
                ..DirectoryRead::default()
            });
        }
        #[cfg(target_os = "linux")]
        if let Ok(read) = linux::read_entries(&self.file, path) {
            return Ok(read);
        }
        #[cfg(target_os = "windows")]
        if let Ok(entries) = self.handle.read_entries() {
            return Ok(DirectoryRead {
                entries,
                ..DirectoryRead::default()
            });
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
        let _ = &self.path;
        read_entries_portable(path)
    }

    fn enrich_root(&self, entry: &mut Entry) {
        #[cfg(target_os = "windows")]
        self.handle.enrich_root(entry);
        #[cfg(not(target_os = "windows"))]
        let _ = entry;
    }
}

impl Scanner {
    pub fn new<F>(mut request: Request, emit: F) -> Result<Self, String>
    where
        F: Fn(&ServerMessage) -> io::Result<()> + Send + Sync + 'static,
    {
        request.concurrency = request.concurrency.clamp(1, 64);
        request.max_children = request.max_children.max(1);
        request.progress_interval_ms = request.progress_interval_ms.max(16);
        request.target_path = comparable_path(&request.target_path);
        let artifact_inventory_max = request
            .developer_artifact_inventory
            .as_ref()
            .and_then(DeveloperArtifactInventoryRequest::max_items);

        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(request.concurrency)
            .thread_name(|index| format!("disklizard-scan-{index}"))
            .build()
            .map_err(|error| error.to_string())?;
        #[cfg(target_os = "macos")]
        let mut exclude_paths = request.exclude_paths.clone();
        #[cfg(not(target_os = "macos"))]
        let exclude_paths = request.exclude_paths.clone();
        #[cfg(target_os = "macos")]
        if request.target_path == Path::new("/") {
            // The Data volume is already presented through root firmlinks
            // (/Users, /Applications, /Library, /private). Walking its mount
            // point would count and traverse the same directories twice.
            exclude_paths.push(PathBuf::from("/System/Volumes/Data"));
        }
        let state = Arc::new(State {
            preserve_names: normalized_names(&request.preserve_names),
            collapse_names: normalized_names(&request.collapse_names),
            signature_names: normalized_names(&request.signature_names),
            excluded_children: excluded_children(&exclude_paths),
            hard_links: std::array::from_fn(|_| Mutex::new(HashSet::new())),
            full_clones: std::array::from_fn(|_| Mutex::new(HashMap::new())),
            visited_directories: Mutex::new(HashSet::new()),
            root_device: AtomicU64::new(0),
            root_directory_identity_available: AtomicBool::new(false),
            inventory_visited_directories: Mutex::new(HashSet::new()),
            #[cfg(test)]
            inventory_test_root_identity_unavailable: AtomicBool::new(false),
            #[cfg(test)]
            inventory_test_child_identity_unavailable: Mutex::new(None),
            clone_metadata: AtomicU8::new(initial_clone_metadata_status()),
            shared_storage_evidence_complete: AtomicBool::new(true),
            issues: Mutex::new(Issues::default()),
            developer_artifact_inventory: artifact_inventory_max.map(|max_items| {
                Mutex::new(DeveloperArtifactInventoryStateData {
                    max_items,
                    ..DeveloperArtifactInventoryStateData::default()
                })
            }),
            files: AtomicUsize::new(0),
            dirs: AtomicUsize::new(0),
            bytes: AtomicU64::new(0),
            work_completed: Arc::new(AtomicU64::new(0)),
            expected_objects: volume_progress::expected_objects(&request.target_path),
            discoveries: AtomicUsize::new(0),
            file_discoveries: AtomicUsize::new(0),
            started_at: Instant::now(),
            next_progress_ms: AtomicU64::new(0),
            emit: Arc::new(emit),
            request,
        });
        Ok(Self { state, pool })
    }

    pub fn target_path(&self) -> &Path {
        &self.state.request.target_path
    }

    pub fn scan(&self) -> io::Result<CompactNode> {
        let target = self.state.request.target_path.clone();
        let metadata = fs::metadata(&target)?;
        let name = target
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|| target.to_string_lossy().into_owned());

        let mut root = self.pool.install(|| {
            if metadata.is_file() {
                #[cfg(target_os = "windows")]
                let entry = windows::entry_from_path(&target, OsString::from(&name), &metadata)
                    .unwrap_or_else(|_| Entry::from_metadata(OsString::from(&name), &metadata));
                #[cfg(not(target_os = "windows"))]
                let entry = Entry::from_metadata(OsString::from(&name), &metadata);
                self.state.observe_clone_metadata(&entry.clone_evidence);
                return Ok(self.state.file_node(entry, target.parent().unwrap_or(&target)));
            }
            if metadata.is_dir() {
                let directory = Directory::open(&target)?;
                let mut root_entry = Entry::from_metadata(OsString::from(&name), &metadata);
                directory.enrich_root(&mut root_entry);
                self.state
                    .root_device
                    .store(root_entry.device, Ordering::Relaxed);
                // The map retains its historic traversal guard regardless of
                // whether the optional deep inventory can prove a scope.
                let visual_root_identity_available =
                    root_entry.device > 0 && root_entry.file_id > 0;
                if visual_root_identity_available {
                    self.state
                        .visited_directories
                        .lock()
                        .expect("directory identity lock poisoned")
                        .insert((root_entry.device, root_entry.file_id));
                }
                let inventory_scope_allowed = self
                    .state
                    .initialize_inventory_directory_scope(&root_entry, &target);
                let root_identity = developer_artifact_directory_identity(&root_entry);
                return self.state.walk_dir(
                    &target,
                    name,
                    0,
                    false,
                    work_progress::Work::root(self.state.work_completed.clone()),
                    DirectoryWalk {
                        directory,
                        directory_identity: root_identity,
                        inventory_scope_allowed,
                        sibling_markers: Arc::new(Vec::new()),
                    },
                );
            }
            Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("unsupported scan target: {}", target.display()),
            ))
        })?;

        if self.state.request.size_mode == SizeMode::Physical {
            self.state.settle_clone_owners(&mut root, &target);
            accounting::normalize_complete_groups(&mut root);
        }
        // Bound the materialized tree after accounting so totals are final.
        if budget::prune_to_budget(&mut root, budget::DEFAULT_MAX_NODES) {
            self.state.mark_shared_storage_evidence_partial();
        }
        if self.state.request.size_mode == SizeMode::Physical {
            root.shared_storage_evidence = Some(self.state.shared_storage_evidence());
        }
        root.clone_metadata = Some(self.state.clone_metadata_capability());

        let issues = self.state.issues.lock().expect("issues lock poisoned");
        if issues.count > 0 {
            root.scan_issues = Some(ScanIssueSummary {
                unreadable_count: issues.count,
                sample_paths: issues.samples.clone(),
            });
        }
        drop(issues);

        root.developer_artifact_inventory = self.state.developer_artifact_inventory();

        // Parallel discovery charges bytes before complete hard-link and APFS
        // clone groups are normalized. The final progress event is a completed
        // accounting snapshot, so publish the returned root's post-normalized
        // size instead of the traversal accumulator.
        self.state.bytes.store(root.size, Ordering::Relaxed);
        self.state.emit_progress(&target, None, true, true);
        Ok(root)
    }
}

impl State {
    fn observe_clone_metadata(&self, evidence: &CloneEvidence) {
        self.observe_clone_metadata_status(clone_metadata_status(evidence));
    }

    fn observe_clone_metadata_status(&self, observed: u8) {
        let mut current = self.clone_metadata.load(Ordering::Relaxed);
        while observed > current {
            match self.clone_metadata.compare_exchange_weak(
                current,
                observed,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => return,
                Err(actual) => current = actual,
            }
        }
    }

    fn observe_clone_metadata_entries(&self, entries: &[Entry]) {
        // Clone flags apply to regular files. A directory's returned fork
        // attributes may legitimately be absent even on APFS, so ignore those
        // rather than downgrading a usable probe. Fold the regular entries so
        // one indeterminate/degraded response cannot be hidden by an earlier
        // ordinary file in the same bulk result.
        if let Some(observed) = entries
            .iter()
            .filter(|entry| entry.kind == EntryKind::File)
            .map(|entry| clone_metadata_status(&entry.clone_evidence))
            .max()
        {
            self.observe_clone_metadata_status(observed);
        }
    }

    fn clone_metadata_capability(&self) -> CloneMetadataCapability {
        clone_metadata_capability(self.clone_metadata.load(Ordering::Relaxed))
    }

    fn mark_shared_storage_evidence_partial(&self) {
        self.shared_storage_evidence_complete
            .store(false, Ordering::Relaxed);
    }

    fn shared_storage_evidence(&self) -> SharedStorageEvidence {
        if self
            .shared_storage_evidence_complete
            .load(Ordering::Relaxed)
        {
            SharedStorageEvidence::Complete
        } else {
            SharedStorageEvidence::Partial
        }
    }

    fn record_skipped_symlink(&self, path: &Path) {
        let Some(inventory) = &self.developer_artifact_inventory else {
            return;
        };
        let mut inventory = inventory.lock().expect("artifact inventory lock poisoned");
        inventory.skipped_symlink_count += 1;
        if inventory.skipped_symlink_samples.len() < MAX_ISSUE_SAMPLES {
            inventory
                .skipped_symlink_samples
                .push(path.to_string_lossy().into_owned());
        }
    }

    fn record_skipped_directory(&self, path: &Path) {
        let Some(inventory) = &self.developer_artifact_inventory else {
            return;
        };
        let mut inventory = inventory.lock().expect("artifact inventory lock poisoned");
        inventory.skipped_directory_count += 1;
        if inventory.skipped_directory_samples.len() < MAX_ISSUE_SAMPLES {
            inventory
                .skipped_directory_samples
                .push(path.to_string_lossy().into_owned());
        }
    }

    fn record_excluded_path(&self, path: &Path) {
        let Some(inventory) = &self.developer_artifact_inventory else {
            return;
        };
        let mut inventory = inventory.lock().expect("artifact inventory lock poisoned");
        inventory.excluded_count += 1;
        if inventory.excluded_samples.len() < MAX_ISSUE_SAMPLES {
            inventory
                .excluded_samples
                .push(path.to_string_lossy().into_owned());
        }
    }

    /// Marker names among a directory's entries, for classification of that
    /// directory's children: a manifest beside a conventional basename
    /// corroborates identity and a reinstall path.
    fn project_marker_signatures(&self, entries: &[Entry]) -> Vec<String> {
        if self.developer_artifact_inventory.is_none() {
            return Vec::new();
        }
        let mut markers: Vec<String> = entries
            .iter()
            .map(|entry| entry.name.to_string_lossy().to_lowercase())
            .filter(|name| is_developer_project_marker_name(name))
            .collect();
        markers.sort();
        markers.dedup();
        markers
    }

    fn artifact_direct_signatures(&self, path: &Path, entries: &[Entry]) -> Vec<String> {
        if self.developer_artifact_inventory.is_none() {
            return Vec::new();
        }
        let excluded_names = self.excluded_children.get(path);
        let mut signatures = entries
            .iter()
            .filter(|entry| entry.kind != EntryKind::Symlink && entry.kind != EntryKind::Other)
            .filter(|entry| !excluded_names.is_some_and(|names| names.contains(&entry.name)))
            .map(|entry| entry.name.to_string_lossy().to_lowercase())
            .filter(|name| is_developer_artifact_evidence_name(name))
            .collect::<Vec<_>>();
        signatures.sort_unstable();
        signatures.dedup();
        signatures
    }

    fn record_developer_artifact(&self, observation: DeveloperArtifactObservation<'_>) {
        let Some(inventory) = &self.developer_artifact_inventory else {
            return;
        };
        let parent_name = observation
            .path
            .parent()
            .and_then(Path::file_name)
            .map(|value| value.to_string_lossy().to_lowercase());
        let Some(classification) = classify_developer_artifact(
            observation.name,
            parent_name.as_deref(),
            observation.signatures,
            observation.sibling_markers,
        ) else {
            return;
        };

        let mut inventory = inventory.lock().expect("artifact inventory lock poisoned");
        inventory.matched_directories += 1;
        let artifact = DeveloperArtifact {
            name: observation.name.to_owned(),
            path: observation.path.to_string_lossy().into_owned(),
            size: observation.size,
            logical_size: (observation.logical_size != observation.size)
                .then_some(observation.logical_size),
            modified_at: observation.modified_at,
            directory_identity: observation.directory_identity,
            is_dir: true,
            signatures: (!observation.signatures.is_empty())
                .then(|| observation.signatures.to_vec()),
            kind: classification.kind,
            ecosystem: classification.ecosystem,
            confidence: classification.confidence,
            cleanup: classification.cleanup,
            evidence: classification.evidence,
            inventory_only: true,
        };
        let max_items = inventory.max_items;
        if inventory.items.len() >= max_items {
            inventory.truncated = true;
        }
        retain_developer_artifact(&mut inventory.items, max_items, artifact);
    }

    fn developer_artifact_inventory(&self) -> Option<DeveloperArtifactInventory> {
        let inventory = self.developer_artifact_inventory.as_ref()?;
        let issues = self.issues.lock().expect("issues lock poisoned");
        let mut inventory = inventory.lock().expect("artifact inventory lock poisoned");
        inventory
            .items
            .sort_unstable_by(compare_developer_artifact_retention);
        // Count only the final bounded top-K: this is the exact set exposed
        // to the UI, and each identity-less member must keep the status from
        // claiming complete safe cleanup coverage.
        let unavailable_directory_identity_count = inventory
            .items
            .iter()
            .filter(|item| !has_usable_developer_artifact_directory_identity(item))
            .count();
        let unavailable_directory_identity_sample_paths = inventory
            .items
            .iter()
            .filter(|item| !has_usable_developer_artifact_directory_identity(item))
            .take(MAX_ISSUE_SAMPLES)
            .map(|item| item.path.clone())
            .collect::<Vec<_>>();
        let partial = inventory.truncated
            || issues.count > 0
            || inventory.skipped_symlink_count > 0
            || inventory.skipped_directory_count > 0
            || inventory.excluded_count > 0
            || unavailable_directory_identity_count > 0;
        Some(DeveloperArtifactInventory {
            items: inventory.items.clone(),
            status: DeveloperArtifactInventoryStatus {
                state: if partial {
                    ArtifactInventoryState::Partial
                } else {
                    ArtifactInventoryState::Complete
                },
                max_items: inventory.max_items,
                scanned_directories: self.dirs.load(Ordering::Relaxed),
                matched_directories: inventory.matched_directories,
                truncated: inventory.truncated,
                unreadable_count: issues.count,
                unreadable_sample_paths: issues.samples.clone(),
                skipped_symlink_count: inventory.skipped_symlink_count,
                skipped_symlink_sample_paths: inventory.skipped_symlink_samples.clone(),
                skipped_directory_count: inventory.skipped_directory_count,
                skipped_directory_sample_paths: inventory.skipped_directory_samples.clone(),
                unavailable_directory_identity_count,
                unavailable_directory_identity_sample_paths,
                excluded_count: inventory.excluded_count,
                excluded_sample_paths: inventory.excluded_samples.clone(),
            },
        })
    }

    fn walk_dir(
        &self,
        path: &Path,
        name: String,
        depth: usize,
        collapsed: bool,
        work: work_progress::Work,
        input: DirectoryWalk,
    ) -> io::Result<CompactNode> {
        let DirectoryWalk {
            directory,
            directory_identity,
            inventory_scope_allowed,
            sibling_markers,
        } = input;
        if collapsed {
            let measured = self.size_only(
                path,
                directory,
                true,
                directory_identity,
                inventory_scope_allowed,
                sibling_markers.clone(),
                work,
            );
            if measured.has_shared_storage_risk {
                self.mark_shared_storage_evidence_partial();
            }
            let mut node = CompactNode::directory(
                name,
                measured.size,
                measured.logical_size,
                measured.modified_at,
                Vec::new(),
                true,
                measured.signatures,
            );
            node.has_shared_storage_risk = measured.has_shared_storage_risk;
            return Ok(node);
        }

        if depth > self.request.max_depth {
            let measured = self.size_only(
                path,
                directory,
                false,
                directory_identity,
                inventory_scope_allowed,
                sibling_markers.clone(),
                work,
            );
            if measured.has_shared_storage_risk {
                self.mark_shared_storage_evidence_partial();
            }
            let mut node = CompactNode::directory(
                name,
                measured.size,
                measured.logical_size,
                measured.modified_at,
                Vec::new(),
                true,
                None,
            );
            node.has_shared_storage_risk = measured.has_shared_storage_risk;
            return Ok(node);
        }

        let entries = match directory.read_entries(path) {
            Ok(read) => {
                // Readable siblings stay measured even when one child could
                // not be inspected; the gap is reported, not widened.
                self.record_partial_directory(path, &read);
                read.entries
            }
            Err(_) => {
                self.record_unreadable(path);
                let mut node = CompactNode::directory(name, 0, 0, None, Vec::new(), false, None);
                node.has_shared_storage_risk = true;
                return Ok(node);
            }
        };
        self.observe_clone_metadata_entries(&entries);
        self.dirs.fetch_add(1, Ordering::Relaxed);
        self.emit_progress(path, None, false, false);

        let excluded_names = self.excluded_children.get(path);
        let artifact_signatures = self.artifact_direct_signatures(path, &entries);
        let child_markers = Arc::new(self.project_marker_signatures(&entries));
        // Skipped entries have no traversal budget. Where directories exist,
        // direct files must not finish a large share before those subtrees run.
        let eligible = |entry: &Entry| {
            matches!(entry.kind, EntryKind::Directory | EntryKind::File)
                && !excluded_names.is_some_and(|names| names.contains(&entry.name))
        };
        let has_directories = entries
            .iter()
            .any(|entry| eligible(entry) && entry.kind == EntryKind::Directory);
        let weights: Vec<u64> = entries
            .iter()
            .map(|entry| {
                u64::from(
                    eligible(entry) && (!has_directories || entry.kind == EntryKind::Directory),
                )
            })
            .collect();
        let work_items = if weights.iter().any(|weight| *weight > 0) {
            work.split_weights(&weights)
        } else {
            // Still visit these entries to retain diagnostics, with no early credit.
            work.split_weights(&vec![1; entries.len()])
        };
        let process_entry = |(entry, work): (Entry, work_progress::Work)| {
            if entry.kind == EntryKind::Symlink {
                self.record_skipped_symlink(&path.join(&entry.name));
                return None;
            }
            if entry.kind == EntryKind::Other {
                return None;
            }
            if excluded_names.is_some_and(|names| names.contains(&entry.name)) {
                self.mark_shared_storage_evidence_partial();
                self.record_excluded_path(&path.join(&entry.name));
                return None;
            }
            if entry.kind == EntryKind::Directory {
                let child_path = path.join(&entry.name);
                let visual_child_allowed = self.claim_directory(&entry, &child_path);
                let child_inventory_scope_allowed = if inventory_scope_allowed {
                    if visual_child_allowed {
                        self.claim_inventory_directory(&entry, &child_path)
                    } else {
                        // The visual guard already records this alias or
                        // mount boundary for inventory status. Never let
                        // inventory scope alter map traversal.
                        false
                    }
                } else {
                    false
                };
                if !visual_child_allowed {
                    return None;
                }
                let entry_name = entry.name.to_string_lossy().into_owned();
                let child_identity = developer_artifact_directory_identity(&entry);
                let collapsed = self.collapse_names.contains(&entry_name.to_lowercase());
                match directory
                    .open_child(&entry.name, &child_path)
                    .and_then(|child| {
                        self.walk_dir(
                            &child_path,
                            entry_name,
                            depth + 1,
                            collapsed,
                            work,
                            DirectoryWalk {
                                directory: child,
                                directory_identity: child_identity,
                                inventory_scope_allowed: child_inventory_scope_allowed,
                                sibling_markers: Arc::clone(&child_markers),
                            },
                        )
                    }) {
                    Ok(node) => {
                        if depth == 0 {
                            self.emit_discovery(&node, &child_path);
                        }
                        Some(node)
                    }
                    Err(_) => {
                        self.record_unreadable(&child_path);
                        None
                    }
                }
            } else {
                let node = self.file_node(entry, path);
                if depth == 0 {
                    self.emit_discovery(&node, &path.join(&node.name));
                }
                Some(node)
            }
        };
        let retention = if has_directories {
            let retention = Mutex::new(ChildRetention::new(self.request.max_children));
            entries
                .into_par_iter()
                .zip(work_items.into_par_iter())
                .filter_map(process_entry)
                .for_each(|node| {
                    retention
                        .lock()
                        .expect("child retention lock poisoned")
                        .push(node, &self.preserve_names);
                });
            retention
                .into_inner()
                .expect("child retention lock poisoned")
        } else {
            // A flat directory has no recursive work to overlap. Serial
            // retention avoids Rayon tasks and a mutex for every file.
            let mut retention = ChildRetention::new(self.request.max_children);
            for item in entries.into_iter().zip(work_items) {
                if let Some(node) = process_entry(item) {
                    retention.push(node, &self.preserve_names);
                }
            }
            retention
        };
        let retained = retention.finish(name);
        if retained.evidence_became_partial {
            self.mark_shared_storage_evidence_partial();
        }
        self.emit_progress(path, None, false, false);
        let node = retained.node;
        if inventory_scope_allowed {
            self.record_developer_artifact(DeveloperArtifactObservation {
                path,
                name: &node.name,
                size: node.size,
                logical_size: node.logical_size.unwrap_or(node.size),
                modified_at: node.modified_at,
                sibling_markers: &sibling_markers,
                signatures: &artifact_signatures,
                directory_identity,
            });
        }
        Ok(node)
    }

    #[allow(clippy::too_many_arguments)]
    fn size_only(
        &self,
        path: &Path,
        directory: Directory,
        capture_signatures: bool,
        directory_identity: Option<DeveloperArtifactDirectoryIdentity>,
        inventory_scope_allowed: bool,
        sibling_markers: Arc<Vec<String>>,
        work: work_progress::Work,
    ) -> Measurement {
        let entries = match directory.read_entries(path) {
            Ok(read) => {
                self.record_partial_directory(path, &read);
                read.entries
            }
            Err(_) => {
                self.record_unreadable(path);
                return Measurement::default();
            }
        };
        self.observe_clone_metadata_entries(&entries);
        self.dirs.fetch_add(1, Ordering::Relaxed);

        let signatures = capture_signatures.then(|| {
            let mut names: Vec<String> = entries
                .iter()
                .map(|entry| entry.name.to_string_lossy().to_lowercase())
                .filter(|name| self.signature_names.contains(name))
                .collect();
            names.sort_unstable();
            names.dedup();
            names
        });

        let excluded_names = self.excluded_children.get(path);
        let artifact_signatures = self.artifact_direct_signatures(path, &entries);
        let child_markers = Arc::new(self.project_marker_signatures(&entries));
        // Skipped entries have no traversal budget. Where directories exist,
        // direct files must not finish a large share before those subtrees run.
        let eligible = |entry: &Entry| {
            matches!(entry.kind, EntryKind::Directory | EntryKind::File)
                && !excluded_names.is_some_and(|names| names.contains(&entry.name))
        };
        let has_directories = entries
            .iter()
            .any(|entry| eligible(entry) && entry.kind == EntryKind::Directory);
        let weights: Vec<u64> = entries
            .iter()
            .map(|entry| {
                u64::from(
                    eligible(entry) && (!has_directories || entry.kind == EntryKind::Directory),
                )
            })
            .collect();
        let work_items = if weights.iter().any(|weight| *weight > 0) {
            work.split_weights(&weights)
        } else {
            // Still visit these entries to retain diagnostics, with no early credit.
            work.split_weights(&vec![1; entries.len()])
        };
        let measure_entry = |(entry, work): (Entry, work_progress::Work)| {
            if entry.kind == EntryKind::Symlink {
                self.record_skipped_symlink(&path.join(&entry.name));
                return Measurement::default();
            }
            if entry.kind == EntryKind::Other {
                return Measurement::default();
            }
            if excluded_names.is_some_and(|names| names.contains(&entry.name)) {
                self.mark_shared_storage_evidence_partial();
                self.record_excluded_path(&path.join(&entry.name));
                return Measurement::default();
            }
            if entry.kind == EntryKind::Directory {
                let child_path = path.join(&entry.name);
                let visual_child_allowed = self.claim_directory(&entry, &child_path);
                let child_inventory_scope_allowed = if inventory_scope_allowed {
                    if visual_child_allowed {
                        self.claim_inventory_directory(&entry, &child_path)
                    } else {
                        // `claim_directory` already reported the visual
                        // boundary; avoid double-counting it here.
                        false
                    }
                } else {
                    false
                };
                if !visual_child_allowed {
                    return Measurement::default();
                }
                let child_identity = developer_artifact_directory_identity(&entry);
                return directory
                    .open_child(&entry.name, &child_path)
                    .map(|child| {
                        self.size_only(
                            &child_path,
                            child,
                            false,
                            child_identity,
                            child_inventory_scope_allowed,
                            Arc::clone(&child_markers),
                            work,
                        )
                    })
                    .unwrap_or_else(|_| {
                        self.record_unreadable(&child_path);
                        Measurement::default()
                    });
            }
            let has_shared_storage_risk = entry.may_share_physical_storage();
            let measured = self.measure_file(&entry, path);
            self.files.fetch_add(1, Ordering::Relaxed);
            self.bytes.fetch_add(measured.0, Ordering::Relaxed);
            Measurement {
                size: measured.0,
                logical_size: measured.1.unwrap_or(measured.0),
                has_shared_storage_risk,
                modified_at: entry.modified_at,
                signatures: None,
            }
        };
        let combine = |left: Measurement, right: Measurement| Measurement {
            size: left.size.saturating_add(right.size),
            logical_size: left.logical_size.saturating_add(right.logical_size),
            has_shared_storage_risk: left.has_shared_storage_risk || right.has_shared_storage_risk,
            modified_at: latest(left.modified_at, right.modified_at),
            signatures: None,
        };
        let measured = if has_directories {
            entries
                .into_par_iter()
                .zip(work_items.into_par_iter())
                .map(measure_entry)
                .reduce(Measurement::default, combine)
        } else {
            entries
                .into_iter()
                .zip(work_items)
                .map(measure_entry)
                .fold(Measurement::default(), combine)
        };
        self.emit_progress(path, None, false, false);

        let result = Measurement {
            signatures: signatures.filter(|names| !names.is_empty()),
            ..measured
        };
        if inventory_scope_allowed {
            let name = path
                .file_name()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.to_string_lossy().into_owned());
            self.record_developer_artifact(DeveloperArtifactObservation {
                path,
                name: &name,
                size: result.size,
                logical_size: result.logical_size,
                modified_at: result.modified_at,
                sibling_markers: &sibling_markers,
                signatures: &artifact_signatures,
                directory_identity,
            });
        }
        result
    }

    fn file_node(&self, entry: Entry, parent: &Path) -> CompactNode {
        let name = entry.name.to_string_lossy().into_owned();
        let (size, logical_size, hard_link, clone_accounting) =
            self.measure_file(&entry, parent);
        let hard_link_metadata = (self.request.size_mode == SizeMode::Physical
            && entry.file_id > 0
            && entry.link_count > 1)
            .then_some((
                (entry.device, entry.file_id),
                entry.link_count,
                entry.allocated_size,
            ));
        self.files.fetch_add(1, Ordering::Relaxed);
        self.bytes.fetch_add(size, Ordering::Relaxed);
        CompactNode {
            name,
            size,
            logical_size,
            modified_at: entry.modified_at,
            hard_link,
            clone_evidence: emitted_clone_evidence(&entry.clone_evidence),
            clone_accounting,
            clone_metadata: None,
            shared_storage_evidence: None,
            developer_artifact_inventory: None,
            hard_link_identity: hard_link_metadata.map(|metadata| metadata.0),
            reported_hard_link_count: hard_link_metadata.map(|metadata| metadata.1),
            hard_link_physical_size: hard_link_metadata.map(|metadata| metadata.2),
            has_shared_storage_risk: entry.may_share_physical_storage(),
            is_dir: false,
            children: Vec::new(),
            is_other: false,
            other_count: None,
            is_collapsed: false,
            signatures: None,
            scan_issues: None,
        }
    }

    /// Move each clone group's charge to its deterministic owner.
    fn settle_clone_owners(&self, root: &mut CompactNode, root_path: &Path) {
        for shard in &self.full_clones {
            let owners = shard.lock().expect("clone lock poisoned");
            for owner in owners.values() {
                if owner.charged == owner.owner {
                    continue;
                }
                let delta = owner.size as i128;
                let moved_out = accounting::adjust_path_charge(
                    root,
                    root_path,
                    &owner.charged,
                    -delta,
                    Some((CloneAccounting::Secondary, owner.logical_size)),
                );
                if moved_out {
                    accounting::adjust_path_charge(
                        root,
                        root_path,
                        &owner.owner,
                        delta,
                        Some((CloneAccounting::Primary, owner.logical_size)),
                    );
                }
            }
        }
    }

    fn measure_file(
        &self,
        entry: &Entry,
        parent: &Path,
    ) -> (u64, Option<u64>, Option<HardLink>, Option<CloneAccounting>) {
        let original_size = match self.request.size_mode {
            SizeMode::Physical => entry.allocated_size,
            SizeMode::Logical => entry.logical_size,
        };
        let mut size = original_size;
        let mut hard_link = None;
        if self.request.size_mode == SizeMode::Physical && entry.link_count == 0 {
            // Windows bulk directory records do not include the hard-link
            // count. Treat that evidence as partial instead of retaining every
            // file identity for the entire scan or silently claiming complete
            // physical ownership.
            self.mark_shared_storage_evidence_partial();
        }
        if self.request.size_mode == SizeMode::Physical && entry.file_id > 0 && entry.link_count > 1
        {
            let identity = (entry.device, entry.file_id);
            let shard = ((entry.device ^ entry.file_id) as usize) & (self.hard_links.len() - 1);
            let mut claimed = self.hard_links[shard]
                .lock()
                .expect("hard-link lock poisoned");
            if claimed.insert(identity) {
                if entry.link_count > 1 {
                    hard_link = Some(HardLink::Primary);
                }
            } else {
                size = 0;
                hard_link = Some(HardLink::Secondary);
            }
        }
        let mut clone_accounting = None;
        if self.request.size_mode == SizeMode::Physical && hard_link.is_none() && size > 0 {
            if let CloneEvidence::SharesAllBlocks {
                clone_id: Some(clone_id),
                reported_full_clone_count,
            } = &entry.clone_evidence
            {
                if !clone_id.is_empty() && reported_full_clone_count.is_some_and(|count| count > 1) {
                    let shard = clone_id
                        .bytes()
                        .fold(0usize, |hash, byte| hash.wrapping_mul(31).wrapping_add(byte as usize))
                        & (self.full_clones.len() - 1);
                    let file_path = parent.join(&entry.name);
                    let mut owners = self.full_clones[shard].lock().expect("clone lock poisoned");
                    let first = match owners.get_mut(clone_id) {
                        Some(owner) => {
                            if clone_metadata::compare_utf16(
                                &file_path.to_string_lossy(),
                                &owner.owner.to_string_lossy(),
                            ) == std::cmp::Ordering::Less
                            {
                                owner.owner = file_path;
                            }
                            false
                        }
                        None => {
                            owners.insert(
                                clone_id.clone(),
                                CloneOwner {
                                    charged: file_path.clone(),
                                    owner: file_path,
                                    size,
                                    logical_size: entry.logical_size,
                                },
                            );
                            true
                        }
                    };
                    drop(owners);
                    if first {
                        clone_accounting = Some(CloneAccounting::Primary);
                    } else {
                        size = 0;
                        clone_accounting = Some(CloneAccounting::Secondary);
                    }
                }
            }
        }
        let logical_size = (entry.logical_size != size).then_some(entry.logical_size);
        (size, logical_size, hard_link, clone_accounting)
    }

    /// Legacy visual-map traversal guard. Keep this independent from optional
    /// deep-inventory scope: an unavailable inventory identity must never
    /// remove a valid map branch or its measured bytes.
    fn claim_directory(&self, entry: &Entry, path: &Path) -> bool {
        let root_device = self.root_device.load(Ordering::Relaxed);
        if root_device > 0 && entry.device > 0 && entry.device != root_device {
            self.mark_shared_storage_evidence_partial();
            self.record_skipped_directory(path);
            return false;
        }
        if entry.file_id == 0 {
            return true;
        }
        let claimed = self
            .visited_directories
            .lock()
            .expect("directory identity lock poisoned")
            .insert((entry.device, entry.file_id));
        if !claimed {
            self.mark_shared_storage_evidence_partial();
            self.record_skipped_directory(path);
        }
        claimed
    }

    /// Establish the stricter scope used only by the deep inventory. The map
    /// still uses `claim_directory` above, including its permissive fallback
    /// when a filesystem cannot supply a directory file ID.
    fn initialize_inventory_directory_scope(&self, root: &Entry, path: &Path) -> bool {
        if self.developer_artifact_inventory.is_none() {
            return false;
        }
        #[cfg(test)]
        let test_forced_unavailable = self
            .inventory_test_root_identity_unavailable
            .load(Ordering::Relaxed);
        #[cfg(not(test))]
        let test_forced_unavailable = false;
        let scope_available = !test_forced_unavailable && root.device > 0 && root.file_id > 0;
        self.root_directory_identity_available
            .store(scope_available, Ordering::Relaxed);
        if !scope_available {
            self.record_skipped_directory(path);
            return false;
        }
        self.inventory_visited_directories
            .lock()
            .expect("inventory directory identity lock poisoned")
            .insert((root.device, root.file_id));
        true
    }

    /// A deep-inventory-only identity claim. False means the map may continue
    /// but artifacts in this branch must not be discovered or reported as
    /// complete coverage.
    fn claim_inventory_directory(&self, entry: &Entry, path: &Path) -> bool {
        if self.developer_artifact_inventory.is_none() {
            return false;
        }
        #[cfg(test)]
        let test_child_identity_unavailable = self
            .inventory_test_child_identity_unavailable
            .lock()
            .expect("inventory test identity lock poisoned")
            .as_ref()
            .is_some_and(|expected| expected == path);
        #[cfg(not(test))]
        let test_child_identity_unavailable = false;
        let root_device = self.root_device.load(Ordering::Relaxed);
        if !self
            .root_directory_identity_available
            .load(Ordering::Relaxed)
            || root_device == 0
            || entry.device == 0
            || entry.file_id == 0
            || entry.device != root_device
            || test_child_identity_unavailable
        {
            self.record_skipped_directory(path);
            return false;
        }
        let claimed = self
            .inventory_visited_directories
            .lock()
            .expect("inventory directory identity lock poisoned")
            .insert((entry.device, entry.file_id));
        if !claimed {
            self.record_skipped_directory(path);
        }
        claimed
    }

    fn record_unreadable(&self, path: &Path) {
        self.mark_shared_storage_evidence_partial();
        let mut issues = self.issues.lock().expect("issues lock poisoned");
        issues.count += 1;
        if issues.samples.len() < MAX_ISSUE_SAMPLES {
            issues.samples.push(path.to_string_lossy().into_owned());
        }
    }

    /// Report a directory whose enumeration succeeded but whose coverage is
    /// partial: enumerated children that could not be inspected, or an
    /// enumeration stream that ended early. The measured majority stays.
    fn record_partial_directory(&self, path: &Path, read: &DirectoryRead) {
        for child in &read.unreadable_children {
            self.record_unreadable(child);
        }
        if read.enumeration_incomplete {
            self.record_unreadable(path);
        }
    }

    fn emit_discovery(&self, node: &CompactNode, path: &Path) {
        if node.size == 0 {
            return;
        }
        let index = self.discoveries.fetch_add(1, Ordering::Relaxed);
        if index >= MAX_DISCOVERIES {
            return;
        }
        if !node.is_dir {
            let file_index = self.file_discoveries.fetch_add(1, Ordering::Relaxed);
            if file_index >= MAX_FILE_DISCOVERIES {
                return;
            }
        }
        self.emit_progress(
            path,
            Some(Discovery {
                name: node.name.clone(),
                path: path.to_string_lossy().into_owned(),
                size: node.size,
                modified_at: node.modified_at,
                is_dir: node.is_dir,
            }),
            true,
            false,
        );
    }

    fn emit_progress(&self, path: &Path, discovery: Option<Discovery>, force: bool, done: bool) {
        if !force {
            let elapsed = self.started_at.elapsed().as_millis() as u64;
            let mut next = self.next_progress_ms.load(Ordering::Relaxed);
            loop {
                if elapsed < next {
                    return;
                }
                match self.next_progress_ms.compare_exchange_weak(
                    next,
                    elapsed.saturating_add(self.request.progress_interval_ms),
                    Ordering::Relaxed,
                    Ordering::Relaxed,
                ) {
                    Ok(_) => break,
                    Err(current) => next = current,
                }
            }
        }
        let message = ServerMessage::Progress {
            progress: Progress {
                files_scanned: self.files.load(Ordering::Relaxed),
                dirs_scanned: self.dirs.load(Ordering::Relaxed),
                current_path: path.to_string_lossy().into_owned(),
                size: self.bytes.load(Ordering::Relaxed),
                discovery,
                percent: if done {
                    100.0
                } else if let Some(expected) = self.expected_objects {
                    volume_progress::percent(
                        (self.files.load(Ordering::Relaxed) + self.dirs.load(Ordering::Relaxed))
                            as u64,
                        expected,
                    )
                } else {
                    work_progress::Work::percent(&self.work_completed)
                },
                done,
            },
        };
        let _ = (self.emit)(&message);
    }
}

pub(crate) fn metadata_clone_evidence() -> CloneEvidence {
    #[cfg(target_os = "macos")]
    {
        // MetadataExt cannot expose APFS clone flags. Directory bulk entries
        // use getattrlistbulk below; this path is only a conservative fallback
        // (or a single-file root).
        CloneEvidence::Unavailable {
            reason: CloneUnavailableReason::Scanner,
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        CloneEvidence::Unavailable {
            reason: CloneUnavailableReason::Platform,
        }
    }
}

impl Entry {
    /// A regular file whose physical ownership cannot be inferred from its
    /// lone pathname. This stays scanner-private; it is used only to decide
    /// whether a later collapsed/trimmed branch lost safety-relevant evidence.
    fn may_share_physical_storage(&self) -> bool {
        self.kind == EntryKind::File
            && (self.link_count > 1 || !matches!(self.clone_evidence, CloneEvidence::NotShared))
    }
}

fn normalized_names(names: &[String]) -> HashSet<String> {
    names.iter().map(|name| name.to_lowercase()).collect()
}

fn excluded_children(paths: &[PathBuf]) -> HashMap<PathBuf, HashSet<OsString>> {
    let mut result: HashMap<PathBuf, HashSet<OsString>> = HashMap::new();
    for path in paths {
        let path = comparable_path(path);
        let Some(parent) = path.parent() else {
            continue;
        };
        let Some(name) = path.file_name() else {
            continue;
        };
        result
            .entry(comparable_path(parent))
            .or_default()
            .insert(name.to_os_string());
    }
    result
}

fn comparable_path(path: &Path) -> PathBuf {
    // A filesystem root has no parent. Trimming its trailing separator turns
    // `C:\\` into drive-relative `C:` on Windows and breaks whole-drive scans.
    if path.parent().is_none() {
        return path.to_path_buf();
    }
    let value = path.to_string_lossy();
    let trimmed = value.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        return path.to_path_buf();
    }
    PathBuf::from(trimmed)
}

fn latest(left: Option<u64>, right: Option<u64>) -> Option<u64> {
    match (left, right) {
        (Some(left), Some(right)) => Some(left.max(right)),
        (Some(value), None) | (None, Some(value)) => Some(value),
        (None, None) => None,
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use super::{DirectoryRead, Entry, EntryKind};
    use std::cell::RefCell;
    use std::ffi::{CString, OsStr, OsString};
    use std::fs::File;
    use std::io;
    use std::mem::MaybeUninit;
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::ffi::{OsStrExt, OsStringExt};
    use std::path::Path;
    use std::ptr;

    const DIRECTORY_BUFFER_SIZE: usize = 256 * 1024;
    const DIRENT_HEADER_SIZE: usize = 19;

    thread_local! {
        static DIRECTORY_BUFFER: RefCell<Vec<u8>> = RefCell::new(vec![0_u8; DIRECTORY_BUFFER_SIZE]);
    }

    pub(super) fn open_child(directory: &File, name: &OsStr) -> io::Result<File> {
        let name = CString::new(name.as_bytes())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "NUL in filename"))?;
        let descriptor = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
            )
        };
        if descriptor < 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(unsafe { File::from_raw_fd(descriptor) })
    }

    pub(super) fn read_entries(directory: &File, path: &Path) -> io::Result<DirectoryRead> {
        DIRECTORY_BUFFER
            .with(|buffer| read_entries_into(directory.as_raw_fd(), path, &mut buffer.borrow_mut()))
    }

    fn read_entries_into(
        descriptor: libc::c_int,
        path: &Path,
        buffer: &mut [u8],
    ) -> io::Result<DirectoryRead> {
        let mut read = DirectoryRead::default();
        loop {
            let bytes = unsafe {
                libc::syscall(
                    libc::SYS_getdents64,
                    descriptor,
                    buffer.as_mut_ptr().cast::<libc::c_void>(),
                    buffer.len(),
                )
            };
            if bytes < 0 {
                return Err(io::Error::last_os_error());
            }
            if bytes == 0 {
                return Ok(read);
            }

            let mut offset = 0_usize;
            while offset < bytes as usize {
                if offset.saturating_add(DIRENT_HEADER_SIZE) > bytes as usize {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "truncated getdents64 entry",
                    ));
                }
                let record_length = unsafe {
                    ptr::read_unaligned(buffer.as_ptr().add(offset + 16).cast::<u16>()) as usize
                };
                if record_length < DIRENT_HEADER_SIZE
                    || offset.saturating_add(record_length) > bytes as usize
                {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "invalid getdents64 entry length",
                    ));
                }
                let name_bytes = &buffer[offset + DIRENT_HEADER_SIZE..offset + record_length];
                let name_length = name_bytes
                    .iter()
                    .position(|byte| *byte == 0)
                    .unwrap_or(name_bytes.len());
                let name = &name_bytes[..name_length];
                offset += record_length;
                if name == b"." || name == b".." || name.is_empty() {
                    continue;
                }
                let name = OsString::from_vec(name.to_vec());
                // One child whose stat failed must not erase its readable
                // siblings: report it and keep measuring the rest.
                match stat_entry(descriptor, &name) {
                    Ok(entry) => read.entries.push(entry),
                    Err(_) => read.unreadable_children.push(path.join(&name)),
                }
            }
        }
    }

    fn stat_entry(descriptor: libc::c_int, name: &OsStr) -> io::Result<Entry> {
        let encoded = CString::new(name.as_bytes())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "NUL in filename"))?;
        let mut value = MaybeUninit::<libc::statx>::zeroed();
        let result = unsafe {
            libc::statx(
                descriptor,
                encoded.as_ptr(),
                libc::AT_SYMLINK_NOFOLLOW | libc::AT_NO_AUTOMOUNT,
                libc::STATX_TYPE
                    | libc::STATX_MODE
                    | libc::STATX_NLINK
                    | libc::STATX_INO
                    | libc::STATX_SIZE
                    | libc::STATX_BLOCKS
                    | libc::STATX_MTIME,
                value.as_mut_ptr(),
            )
        };
        if result < 0 {
            return stat_entry_fallback(descriptor, name, &encoded);
        }
        let value = unsafe { value.assume_init() };
        let kind = mode_kind(value.stx_mode as libc::mode_t);
        let modified_at = timestamp_millis(value.stx_mtime.tv_sec, value.stx_mtime.tv_nsec as i64);
        Ok(Entry {
            name: name.to_os_string(),
            kind,
            logical_size: value.stx_size,
            allocated_size: value.stx_blocks.saturating_mul(512),
            modified_at,
            device: device_id(value.stx_dev_major, value.stx_dev_minor),
            file_id: value.stx_ino,
            link_count: value.stx_nlink as u64,
            clone_evidence: super::metadata_clone_evidence(),
        })
    }

    fn stat_entry_fallback(
        descriptor: libc::c_int,
        name: &OsStr,
        encoded: &CString,
    ) -> io::Result<Entry> {
        let mut value = MaybeUninit::<libc::stat>::zeroed();
        let result = unsafe {
            libc::fstatat(
                descriptor,
                encoded.as_ptr(),
                value.as_mut_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        };
        if result < 0 {
            return Err(io::Error::last_os_error());
        }
        let value = unsafe { value.assume_init() };
        Ok(Entry {
            name: name.to_os_string(),
            kind: mode_kind(value.st_mode),
            logical_size: value.st_size.max(0) as u64,
            allocated_size: value.st_blocks.max(0) as u64 * 512,
            modified_at: timestamp_millis(value.st_mtime, value.st_mtime_nsec),
            device: value.st_dev,
            file_id: value.st_ino,
            link_count: value.st_nlink,
            clone_evidence: super::metadata_clone_evidence(),
        })
    }

    fn mode_kind(mode: libc::mode_t) -> EntryKind {
        match mode & libc::S_IFMT {
            libc::S_IFREG => EntryKind::File,
            libc::S_IFDIR => EntryKind::Directory,
            libc::S_IFLNK => EntryKind::Symlink,
            _ => EntryKind::Other,
        }
    }

    fn device_id(major: u32, minor: u32) -> u64 {
        // Match Linux dev_t/MetadataExt::dev encoding so root-device checks
        // compare statx results with the root's fstat metadata correctly.
        let major = major as u64;
        let minor = minor as u64;
        ((major & 0x0fff) << 8)
            | (minor & 0x00ff)
            | ((major & !0x0fff) << 32)
            | ((minor & !0x00ff) << 12)
    }

    fn timestamp_millis(seconds: i64, nanoseconds: i64) -> Option<u64> {
        if seconds < 0 || nanoseconds < 0 {
            return None;
        }
        Some(
            (seconds as u64)
                .saturating_mul(1000)
                .saturating_add(nanoseconds as u64 / 1_000_000),
        )
    }
}

#[cfg(target_os = "windows")]
mod windows {
    use super::{Entry, EntryKind};
    use std::cell::RefCell;
    use std::ffi::{c_void, OsString};
    use std::io;
    use std::mem::{offset_of, size_of};
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use std::os::windows::io::{FromRawHandle, OwnedHandle};
    use std::path::Path;
    use std::ptr;

    type Handle = *mut c_void;

    const INVALID_HANDLE_VALUE: Handle = -1_isize as Handle;
    const FILE_LIST_DIRECTORY: u32 = 0x0001;
    const FILE_READ_ATTRIBUTES: u32 = 0x0080;
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_SHARE_WRITE: u32 = 0x0000_0002;
    const FILE_SHARE_DELETE: u32 = 0x0000_0004;
    const OPEN_EXISTING: u32 = 3;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
    const FILE_ID_BOTH_DIRECTORY_INFO: i32 = 10;
    const FILE_STANDARD_INFO: i32 = 1;
    const ERROR_NO_MORE_FILES: i32 = 18;
    const DIRECTORY_BUFFER_SIZE: usize = 256 * 1024;
    const WINDOWS_TO_UNIX_MILLIS: i64 = 11_644_473_600_000;

    thread_local! {
        // u64 backing guarantees the alignment required by Windows directory
        // information structures while still exposing a byte-sized capacity.
        static DIRECTORY_BUFFER: RefCell<Vec<u64>> =
            RefCell::new(vec![0_u64; DIRECTORY_BUFFER_SIZE / size_of::<u64>()]);
    }

    #[repr(C)]
    struct FileTime {
        low: u32,
        high: u32,
    }

    #[repr(C)]
    struct ByHandleFileInformation {
        attributes: u32,
        creation_time: FileTime,
        last_access_time: FileTime,
        last_write_time: FileTime,
        volume_serial_number: u32,
        file_size_high: u32,
        file_size_low: u32,
        number_of_links: u32,
        file_index_high: u32,
        file_index_low: u32,
    }

    #[repr(C)]
    struct FileIdBothDirectoryInfo {
        next_entry_offset: u32,
        file_index: u32,
        creation_time: i64,
        last_access_time: i64,
        last_write_time: i64,
        change_time: i64,
        end_of_file: i64,
        allocation_size: i64,
        file_attributes: u32,
        file_name_length: u32,
        ea_size: u32,
        short_name_length: i8,
        short_name: [u16; 12],
        file_id: i64,
        file_name: [u16; 1],
    }

    #[repr(C)]
    struct FileStandardInfo {
        allocation_size: i64,
        end_of_file: i64,
        number_of_links: u32,
        delete_pending: u8,
        directory: u8,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateFileW(
            file_name: *const u16,
            desired_access: u32,
            share_mode: u32,
            security_attributes: *const c_void,
            creation_disposition: u32,
            flags_and_attributes: u32,
            template_file: Handle,
        ) -> Handle;
        fn CloseHandle(object: Handle) -> i32;
        fn GetFileInformationByHandle(
            file: Handle,
            information: *mut ByHandleFileInformation,
        ) -> i32;
        fn GetFileInformationByHandleEx(
            file: Handle,
            information_class: i32,
            information: *mut c_void,
            buffer_size: u32,
        ) -> i32;
    }

    pub(super) struct DirectoryHandle {
        handle: OwnedHandle,
        device: u64,
        file_id: u64,
        link_count: u64,
    }

    impl DirectoryHandle {
        pub(super) fn open(path: &Path) -> io::Result<Self> {
            let encoded: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
            let raw = unsafe {
                CreateFileW(
                    encoded.as_ptr(),
                    FILE_LIST_DIRECTORY,
                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                    ptr::null(),
                    OPEN_EXISTING,
                    FILE_FLAG_BACKUP_SEMANTICS,
                    ptr::null_mut(),
                )
            };
            if raw == INVALID_HANDLE_VALUE {
                return Err(io::Error::last_os_error());
            }
            let mut information = std::mem::MaybeUninit::<ByHandleFileInformation>::zeroed();
            if unsafe { GetFileInformationByHandle(raw, information.as_mut_ptr()) } == 0 {
                unsafe { CloseHandle(raw) };
                return Err(io::Error::last_os_error());
            }
            let information = unsafe { information.assume_init() };
            Ok(Self {
                handle: unsafe { OwnedHandle::from_raw_handle(raw) },
                device: information.volume_serial_number as u64,
                file_id: ((information.file_index_high as u64) << 32)
                    | information.file_index_low as u64,
                link_count: information.number_of_links as u64,
            })
        }

        pub(super) fn read_entries(&self) -> io::Result<Vec<Entry>> {
            DIRECTORY_BUFFER.with(|buffer| {
                let mut buffer = buffer.borrow_mut();
                read_entries_into(
                    self,
                    buffer.as_mut_ptr().cast(),
                    buffer.len() * size_of::<u64>(),
                )
            })
        }

        pub(super) fn enrich_root(&self, entry: &mut Entry) {
            entry.device = self.device;
            entry.file_id = self.file_id;
            entry.link_count = self.link_count;
        }
    }

    pub(super) fn entry_from_path(
        path: &Path,
        name: OsString,
        metadata: &std::fs::Metadata,
    ) -> io::Result<Entry> {
        let encoded: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let raw = unsafe {
            CreateFileW(
                encoded.as_ptr(),
                FILE_READ_ATTRIBUTES,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                ptr::null(),
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS,
                ptr::null_mut(),
            )
        };
        if raw == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error());
        }
        let handle = unsafe { OwnedHandle::from_raw_handle(raw) };
        let mut identity = std::mem::MaybeUninit::<ByHandleFileInformation>::zeroed();
        if unsafe { GetFileInformationByHandle(handle.as_raw_handle(), identity.as_mut_ptr()) } == 0
        {
            return Err(io::Error::last_os_error());
        }
        let identity = unsafe { identity.assume_init() };
        let mut standard = std::mem::MaybeUninit::<FileStandardInfo>::zeroed();
        if unsafe {
            GetFileInformationByHandleEx(
                handle.as_raw_handle(),
                FILE_STANDARD_INFO,
                standard.as_mut_ptr().cast(),
                size_of::<FileStandardInfo>() as u32,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        let standard = unsafe { standard.assume_init() };
        let modified =
            ((identity.last_write_time.high as i64) << 32) | identity.last_write_time.low as i64;
        Ok(Entry {
            name,
            kind: super::metadata_kind(metadata),
            logical_size: standard.end_of_file.max(0) as u64,
            allocated_size: standard.allocation_size.max(0) as u64,
            modified_at: windows_millis(modified),
            device: identity.volume_serial_number as u64,
            file_id: ((identity.file_index_high as u64) << 32) | identity.file_index_low as u64,
            link_count: standard.number_of_links as u64,
            clone_evidence: super::metadata_clone_evidence(),
        })
    }

    fn read_entries_into(
        directory: &DirectoryHandle,
        buffer: *mut u8,
        length: usize,
    ) -> io::Result<Vec<Entry>> {
        let mut entries = Vec::new();
        loop {
            let result = unsafe {
                GetFileInformationByHandleEx(
                    directory.handle.as_raw_handle(),
                    FILE_ID_BOTH_DIRECTORY_INFO,
                    buffer.cast(),
                    length as u32,
                )
            };
            if result == 0 {
                let error = io::Error::last_os_error();
                if error.raw_os_error() == Some(ERROR_NO_MORE_FILES) {
                    return Ok(entries);
                }
                return Err(error);
            }

            let mut offset = 0_usize;
            loop {
                let entry = parse_entry(
                    directory.device,
                    unsafe { buffer.add(offset) },
                    length - offset,
                )?;
                let next =
                    unsafe { ptr::read_unaligned(buffer.add(offset).cast::<u32>()) } as usize;
                if entry.name != "." && entry.name != ".." {
                    entries.push(entry);
                }
                if next == 0 {
                    break;
                }
                if next < offset_of!(FileIdBothDirectoryInfo, file_name)
                    || offset.saturating_add(next) >= length
                {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "invalid Windows directory entry length",
                    ));
                }
                offset += next;
            }
        }
    }

    fn parse_entry(device: u64, start: *const u8, available: usize) -> io::Result<Entry> {
        const NAME_OFFSET: usize = offset_of!(FileIdBothDirectoryInfo, file_name);
        if available < NAME_OFFSET {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "truncated Windows directory entry",
            ));
        }
        let name_bytes = unsafe {
            ptr::read_unaligned(
                start
                    .add(offset_of!(FileIdBothDirectoryInfo, file_name_length))
                    .cast::<u32>(),
            )
        } as usize;
        if name_bytes & 1 != 0 || NAME_OFFSET.saturating_add(name_bytes) > available {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "invalid Windows filename length",
            ));
        }
        let name = OsString::from_wide(
            &(0..name_bytes / 2)
                .map(|index| unsafe {
                    ptr::read_unaligned(start.add(NAME_OFFSET + index * 2).cast::<u16>())
                })
                .collect::<Vec<_>>(),
        );
        let attributes = unsafe {
            ptr::read_unaligned(
                start
                    .add(offset_of!(FileIdBothDirectoryInfo, file_attributes))
                    .cast::<u32>(),
            )
        };
        let kind = if attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            EntryKind::Symlink
        } else if attributes & FILE_ATTRIBUTE_DIRECTORY != 0 {
            EntryKind::Directory
        } else {
            EntryKind::File
        };
        let logical_size = unsafe {
            ptr::read_unaligned(
                start
                    .add(offset_of!(FileIdBothDirectoryInfo, end_of_file))
                    .cast::<i64>(),
            )
        }
        .max(0) as u64;
        let allocated_size = unsafe {
            ptr::read_unaligned(
                start
                    .add(offset_of!(FileIdBothDirectoryInfo, allocation_size))
                    .cast::<i64>(),
            )
        }
        .max(0) as u64;
        let modified = unsafe {
            ptr::read_unaligned(
                start
                    .add(offset_of!(FileIdBothDirectoryInfo, last_write_time))
                    .cast::<i64>(),
            )
        };
        let file_id = unsafe {
            ptr::read_unaligned(
                start
                    .add(offset_of!(FileIdBothDirectoryInfo, file_id))
                    .cast::<i64>(),
            )
        } as u64;
        Ok(Entry {
            name,
            kind,
            logical_size,
            allocated_size,
            modified_at: windows_millis(modified),
            device,
            file_id,
            // FILE_ID_BOTH_DIR_INFO omits the hard-link count. Zero means
            // unknown: the scanner deduplicates repeated IDs without marking
            // every first sighting as a hard link.
            link_count: 0,
            clone_evidence: super::metadata_clone_evidence(),
        })
    }

    fn windows_millis(value: i64) -> Option<u64> {
        if value <= 0 {
            return None;
        }
        value
            .checked_div(10_000)?
            .checked_sub(WINDOWS_TO_UNIX_MILLIS)?
            .try_into()
            .ok()
    }

    trait OwnedHandleRaw {
        fn as_raw_handle(&self) -> Handle;
    }

    impl OwnedHandleRaw for OwnedHandle {
        fn as_raw_handle(&self) -> Handle {
            use std::os::windows::io::AsRawHandle;
            AsRawHandle::as_raw_handle(self)
        }
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{clone_evidence_from_attributes, Entry, EntryKind};
    use libc::{c_int, c_void, size_t};
    use std::cell::RefCell;
    use std::ffi::{CString, OsStr, OsString};
    use std::fs::File;
    use std::io;
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::ffi::{OsStrExt, OsStringExt};
    use std::ptr;

    const ATTR_BIT_MAP_COUNT: u16 = 5;
    const ATTR_CMN_NAME: u32 = 0x0000_0001;
    const ATTR_CMN_DEVID: u32 = 0x0000_0002;
    const ATTR_CMN_OBJTYPE: u32 = 0x0000_0008;
    const ATTR_CMN_MODTIME: u32 = 0x0000_0400;
    const ATTR_CMN_FILEID: u32 = 0x0200_0000;
    const ATTR_CMN_RETURNED_ATTRS: u32 = 0x8000_0000;
    const ATTR_DIR_ALLOCSIZE: u32 = 0x0000_0008;
    const ATTR_FILE_LINKCOUNT: u32 = 0x0000_0001;
    const ATTR_FILE_ALLOCSIZE: u32 = 0x0000_0004;
    const ATTR_FILE_DATALENGTH: u32 = 0x0000_0200;
    const FSOPT_PACK_INVAL_ATTRS: u64 = 0x0000_0008;
    const FSOPT_ATTR_CMN_EXTENDED: u64 = 0x0000_0020;
    const VREG: u32 = 1;
    const VDIR: u32 = 2;
    const VLNK: u32 = 5;
    const ATTRIBUTE_BUFFER_SIZE: usize = 256 * 1024;

    thread_local! {
        // getattrlistbulk only borrows this while parsing one directory. Rayon
        // workers can therefore reuse their buffer across thousands of folders
        // instead of repeatedly allocating and zeroing 256 KB.
        static ATTRIBUTE_BUFFER: RefCell<Vec<u8>> = RefCell::new(vec![0_u8; ATTRIBUTE_BUFFER_SIZE]);
    }

    #[repr(C)]
    struct AttrList {
        bitmapcount: u16,
        reserved: u16,
        commonattr: u32,
        volattr: u32,
        dirattr: u32,
        fileattr: u32,
        forkattr: u32,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct AttributeSet {
        commonattr: u32,
        volattr: u32,
        dirattr: u32,
        fileattr: u32,
        forkattr: u32,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct AttrReference {
        dataoffset: i32,
        length: u32,
    }

    enum BulkReadError {
        /// No directory batch was returned, so retrying with a smaller
        /// attribute request cannot omit entries.
        BeforeFirstBatch(io::Error),
        /// Retrying after a batch would continue from an advanced directory
        /// cursor and silently lose entries, so preserve the real error.
        AfterFirstBatch(io::Error),
    }

    impl BulkReadError {
        fn into_io(self) -> io::Error {
            match self {
                Self::BeforeFirstBatch(error) | Self::AfterFirstBatch(error) => error,
            }
        }
    }

    unsafe extern "C" {
        fn getattrlistbulk(
            dirfd: c_int,
            attrlist: *mut AttrList,
            attrbuf: *mut c_void,
            attrbufsize: size_t,
            options: u64,
        ) -> c_int;
    }

    pub(super) fn open_child(directory: &File, name: &OsStr) -> io::Result<File> {
        let name = CString::new(name.as_bytes())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "NUL in filename"))?;
        let descriptor = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
            )
        };
        if descriptor < 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(unsafe { File::from_raw_fd(descriptor) })
    }

    pub(super) fn read_entries(directory: &File) -> io::Result<Vec<Entry>> {
        let mut extended_attributes = entry_attributes(true);
        ATTRIBUTE_BUFFER.with(|buffer| {
            let mut buffer = buffer.borrow_mut();
            match read_entries_into(directory, &mut extended_attributes, &mut buffer, true) {
                Ok(entries) => Ok(entries),
                // Some non-APFS filesystems reject extended common attrs
                // outright. Retry only before consuming any directory batch,
                // then scan normally with clone evidence unavailable.
                Err(BulkReadError::BeforeFirstBatch(_)) => {
                    // Reset the directory cursor defensively: a failed first
                    // bulk request should not advance it, but resetting makes
                    // the fallback safe even on an implementation that does.
                    let _ = unsafe { libc::lseek(directory.as_raw_fd(), 0, libc::SEEK_SET) };
                    let mut basic_attributes = entry_attributes(false);
                    read_entries_into(directory, &mut basic_attributes, &mut buffer, false)
                        .map_err(BulkReadError::into_io)
                }
                Err(error) => Err(error.into_io()),
            }
        })
    }

    fn entry_attributes(include_clone_attributes: bool) -> AttrList {
        AttrList {
            bitmapcount: ATTR_BIT_MAP_COUNT,
            reserved: 0,
            commonattr: ATTR_CMN_RETURNED_ATTRS
                | ATTR_CMN_NAME
                | ATTR_CMN_DEVID
                | ATTR_CMN_OBJTYPE
                | ATTR_CMN_MODTIME
                | ATTR_CMN_FILEID,
            volattr: 0,
            dirattr: 0,
            fileattr: ATTR_FILE_LINKCOUNT | ATTR_FILE_ALLOCSIZE | ATTR_FILE_DATALENGTH,
            // Extended common attrs are requested through `forkattr` when
            // FSOPT_ATTR_CMN_EXTENDED is set. They are the supported APFS
            // clone evidence API; file lengths alone cannot identify clones.
            forkattr: if include_clone_attributes {
                super::ATTR_CMNEXT_CLONE_ID
                    | super::ATTR_CMNEXT_EXT_FLAGS
                    | super::ATTR_CMNEXT_CLONE_REFCNT
            } else {
                0
            },
        }
    }

    fn read_entries_into(
        directory: &File,
        attributes: &mut AttrList,
        buffer: &mut [u8],
        include_clone_attributes: bool,
    ) -> Result<Vec<Entry>, BulkReadError> {
        let mut entries = Vec::new();
        let mut saw_batch = false;

        loop {
            let count = unsafe {
                getattrlistbulk(
                    directory.as_raw_fd(),
                    attributes,
                    buffer.as_mut_ptr().cast(),
                    buffer.len(),
                    FSOPT_PACK_INVAL_ATTRS
                        | if include_clone_attributes {
                            FSOPT_ATTR_CMN_EXTENDED
                        } else {
                            0
                        },
                )
            };
            if count < 0 {
                let error = io::Error::last_os_error();
                return Err(if saw_batch {
                    BulkReadError::AfterFirstBatch(error)
                } else {
                    BulkReadError::BeforeFirstBatch(error)
                });
            }
            if count == 0 {
                return Ok(entries);
            }
            saw_batch = true;

            let mut offset = 0_usize;
            for _ in 0..count {
                let entry = parse_entry(buffer, offset, include_clone_attributes)
                    .map_err(BulkReadError::AfterFirstBatch)?;
                let length =
                    read::<u32>(buffer, offset).map_err(BulkReadError::AfterFirstBatch)? as usize;
                if length < 4 || offset.saturating_add(length) > buffer.len() {
                    return Err(BulkReadError::AfterFirstBatch(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "invalid bulk entry length",
                    )));
                }
                offset += length;
                if entry.name.as_bytes() != b"." && entry.name.as_bytes() != b".." {
                    entries.push(entry);
                }
            }
        }
    }

    fn parse_entry(
        buffer: &[u8],
        start: usize,
        include_clone_attributes: bool,
    ) -> io::Result<Entry> {
        let mut cursor = start + 4;
        let returned = take::<AttributeSet>(buffer, &mut cursor)?;
        let name_reference_start = cursor;
        let name_reference = take::<AttrReference>(buffer, &mut cursor)?;
        let device = take::<i32>(buffer, &mut cursor)? as u32 as u64;
        let object_type = take::<u32>(buffer, &mut cursor)?;
        let seconds = take::<i64>(buffer, &mut cursor)?;
        let nanoseconds = take::<i64>(buffer, &mut cursor)?;
        let file_id = take::<u64>(buffer, &mut cursor)?;
        if (returned.dirattr & ATTR_DIR_ALLOCSIZE) != 0 {
            let _ = take::<i64>(buffer, &mut cursor)?;
        }
        // FSOPT_PACK_INVAL_ATTRS keeps every requested scalar in order, even
        // when an attribute does not apply to this entry. Read that stable
        // layout first, then use the returned set to decide whether a value is
        // meaningful. The optional clone scalars exist only in the extended
        // request; the basic fallback intentionally does not consume them.
        let raw_link_count = take::<u32>(buffer, &mut cursor)? as u64;
        let raw_file_allocated_size = take::<i64>(buffer, &mut cursor)?;
        let raw_file_length = take::<i64>(buffer, &mut cursor)?;
        let link_count = if (returned.fileattr & ATTR_FILE_LINKCOUNT) != 0 {
            raw_link_count
        } else {
            1
        };
        let (file_allocated_size, file_length) =
            decoded_file_sizes(returned.fileattr, raw_file_allocated_size, raw_file_length);
        let clone_evidence = if include_clone_attributes {
            let raw_clone_id = take::<u64>(buffer, &mut cursor)?;
            let raw_extended_flags = take::<u64>(buffer, &mut cursor)?;
            let raw_full_clone_count = take::<u32>(buffer, &mut cursor)?;
            clone_evidence_from_attributes(
                returned.forkattr,
                raw_clone_id,
                raw_extended_flags,
                raw_full_clone_count,
            )
        } else {
            clone_evidence_from_attributes(0, 0, 0, 0)
        };

        let name_start = name_reference_start
            .checked_add_signed(name_reference.dataoffset as isize)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "invalid name offset"))?;
        let name_end = name_start
            .checked_add(name_reference.length as usize)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "invalid name length"))?;
        let mut name = buffer
            .get(name_start..name_end)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "name outside bulk buffer"))?
            .to_vec();
        if name.last() == Some(&0) {
            name.pop();
        }
        let kind = match object_type {
            VREG => EntryKind::File,
            VDIR => EntryKind::Directory,
            VLNK => EntryKind::Symlink,
            _ => EntryKind::Other,
        };
        let modified_at = if seconds > 0 && (returned.commonattr & ATTR_CMN_MODTIME) != 0 {
            Some(
                (seconds as u64)
                    .saturating_mul(1000)
                    .saturating_add((nanoseconds.max(0) as u64) / 1_000_000),
            )
        } else {
            None
        };
        Ok(Entry {
            name: OsString::from_vec(name),
            kind,
            logical_size: file_length,
            allocated_size: file_allocated_size,
            modified_at,
            device,
            file_id,
            link_count,
            clone_evidence,
        })
    }

    fn decoded_file_sizes(
        returned_file_attributes: u32,
        raw_allocated_size: i64,
        raw_data_length: i64,
    ) -> (u64, u64) {
        let allocated_size = if (returned_file_attributes & ATTR_FILE_ALLOCSIZE) != 0 {
            raw_allocated_size.max(0) as u64
        } else {
            0
        };
        let logical_size = if (returned_file_attributes & ATTR_FILE_DATALENGTH) != 0 {
            raw_data_length.max(0) as u64
        } else {
            0
        };
        (allocated_size, logical_size)
    }

    fn take<T: Copy>(buffer: &[u8], cursor: &mut usize) -> io::Result<T> {
        let value = read::<T>(buffer, *cursor)?;
        *cursor += std::mem::size_of::<T>();
        Ok(value)
    }

    fn read<T: Copy>(buffer: &[u8], offset: usize) -> io::Result<T> {
        let end = offset
            .checked_add(std::mem::size_of::<T>())
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "bulk attribute overflow"))?;
        if end > buffer.len() {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "truncated bulk attributes",
            ));
        }
        Ok(unsafe { ptr::read_unaligned(buffer.as_ptr().add(offset).cast::<T>()) })
    }

    trait OsStringBytes {
        fn as_bytes(&self) -> &[u8];
    }

    impl OsStringBytes for OsString {
        fn as_bytes(&self) -> &[u8] {
            use std::os::unix::ffi::OsStrExt;
            self.as_os_str().as_bytes()
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn dataless_file_keeps_logical_size_with_zero_allocation() {
            let (allocated_size, logical_size) = decoded_file_sizes(
                ATTR_FILE_ALLOCSIZE | ATTR_FILE_DATALENGTH,
                0,
                8 * 1024 * 1024,
            );

            assert_eq!(allocated_size, 0);
            assert_eq!(logical_size, 8 * 1024 * 1024);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use std::io::Write;

    fn request(path: &Path, size_mode: SizeMode) -> Request {
        Request {
            target_path: path.to_path_buf(),
            max_depth: 10,
            concurrency: 4,
            max_children: 48,
            preserve_names: Vec::new(),
            collapse_names: Vec::new(),
            signature_names: Vec::new(),
            progress_interval_ms: 100,
            size_mode,
            exclude_paths: Vec::new(),
            developer_artifact_inventory: None,
        }
    }

    fn scan(request: Request) -> CompactNode {
        Scanner::new(request, |_| Ok(())).unwrap().scan().unwrap()
    }

    #[test]
    fn charges_an_apfs_full_clone_group_once() {
        let root = tempfile::tempdir().unwrap();
        let scanner = Scanner::new(request(root.path(), SizeMode::Physical), |_| Ok(())).unwrap();
        let clone = |file_id: u64, clone_id: &str| Entry {
            name: OsString::from(format!("copy-{file_id}.bin")),
            kind: EntryKind::File,
            logical_size: 4096,
            allocated_size: 4096,
            modified_at: None,
            device: 7,
            file_id,
            link_count: 1,
            clone_evidence: CloneEvidence::SharesAllBlocks {
                clone_id: Some(clone_id.into()),
                reported_full_clone_count: Some(3),
            },
        };

        let first = scanner.state.measure_file(&clone(1, "42"), root.path());
        let second = scanner.state.measure_file(&clone(2, "42"), root.path());
        let third = scanner.state.measure_file(&clone(3, "42"), root.path());
        let other_group = scanner.state.measure_file(&clone(4, "43"), root.path());
        assert_eq!(first.0, 4096);
        assert!(matches!(first.3, Some(CloneAccounting::Primary)));
        assert_eq!(second.0, 0);
        assert_eq!(second.1, Some(4096));
        assert!(matches!(second.3, Some(CloneAccounting::Secondary)));
        assert_eq!(third.0, 0);
        assert_eq!(other_group.0, 4096);
    }

    #[test]
    fn logical_scans_never_deduplicate_clones() {
        let root = tempfile::tempdir().unwrap();
        let scanner = Scanner::new(request(root.path(), SizeMode::Logical), |_| Ok(())).unwrap();
        let entry = Entry {
            name: OsString::from("clone.bin"),
            kind: EntryKind::File,
            logical_size: 4096,
            allocated_size: 4096,
            modified_at: None,
            device: 7,
            file_id: 1,
            link_count: 1,
            clone_evidence: CloneEvidence::SharesAllBlocks {
                clone_id: Some("42".into()),
                reported_full_clone_count: Some(2),
            },
        };
        assert_eq!(scanner.state.measure_file(&entry, root.path()).0, 4096);
        assert_eq!(scanner.state.measure_file(&entry, root.path()).0, 4096);
    }

    #[test]
    fn does_not_retain_every_unknown_windows_file_identity() {
        let root = tempfile::tempdir().unwrap();
        let scanner = Scanner::new(request(root.path(), SizeMode::Physical), |_| Ok(())).unwrap();
        let entry = Entry {
            name: OsString::from("unknown-link-count.bin"),
            kind: EntryKind::File,
            logical_size: 32,
            allocated_size: 32,
            modified_at: None,
            device: 7,
            file_id: 99,
            link_count: 0,
            clone_evidence: CloneEvidence::Unavailable {
                reason: CloneUnavailableReason::Platform,
            },
        };

        assert_eq!(scanner.state.measure_file(&entry, root.path()).0, 32);
        assert_eq!(scanner.state.measure_file(&entry, root.path()).0, 32);
        assert!(scanner
            .state
            .hard_links
            .iter()
            .all(|shard| shard.lock().unwrap().is_empty()));
        assert!(matches!(
            scanner.state.shared_storage_evidence(),
            SharedStorageEvidence::Partial
        ));
    }

    #[test]
    fn final_progress_uses_the_returned_root_accounting() {
        let root = tempfile::tempdir().unwrap();
        File::create(root.path().join("file.bin"))
            .unwrap()
            .write_all(&[7_u8; 32])
            .unwrap();
        let progress = Arc::new(Mutex::new(Vec::new()));
        let observed = progress.clone();
        let result = Scanner::new(request(root.path(), SizeMode::Physical), move |message| {
            if let ServerMessage::Progress { progress } = message {
                if progress.done {
                    observed.lock().unwrap().push(progress.size);
                }
            }
            Ok(())
        })
        .unwrap()
        .scan()
        .unwrap();

        assert_eq!(progress.lock().unwrap().as_slice(), &[result.size]);
    }

    #[test]
    fn scans_nested_logical_sizes() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("project")).unwrap();
        File::create(root.path().join("project/app.bin"))
            .unwrap()
            .write_all(&[0_u8; 31])
            .unwrap();
        File::create(root.path().join("readme.md"))
            .unwrap()
            .write_all(&[0_u8; 7])
            .unwrap();

        let result = scan(request(root.path(), SizeMode::Logical));
        assert_eq!(result.size, 38);
        assert_eq!(result.children.len(), 2);
        assert!(result.clone_metadata.is_some());
    }

    #[cfg(unix)]
    #[test]
    fn charges_parallel_hard_links_once() {
        let root = tempfile::tempdir().unwrap();
        let primary = root.path().join("primary.bin");
        File::create(&primary)
            .unwrap()
            .write_all(&[0_u8; 4096])
            .unwrap();
        fs::hard_link(&primary, root.path().join("parallel.bin")).unwrap();

        let result = scan(request(root.path(), SizeMode::Physical));
        let allocated =
            Entry::from_metadata(OsString::from("file"), &fs::metadata(primary).unwrap())
                .allocated_size;
        assert_eq!(result.size, allocated);
        assert_eq!(
            result.shared_storage_evidence,
            Some(SharedStorageEvidence::Complete)
        );
        // Apparent bytes retain both pathnames even while physical accounting
        // charges the shared inode only once.
        assert_eq!(result.logical_size, Some(8_192));
        assert_eq!(
            result
                .children
                .iter()
                .filter(|child| child.hard_link.is_some())
                .count(),
            2
        );
        // Traversal is parallel, but the persisted map must not let scheduler
        // timing choose which equal pathname is the physical primary.
        assert_eq!(
            result
                .children
                .iter()
                .find(|child| child.name == "parallel.bin")
                .and_then(|child| child.hard_link),
            Some(HardLink::Primary)
        );
        assert_eq!(
            result
                .children
                .iter()
                .find(|child| child.name == "primary.bin")
                .and_then(|child| child.hard_link),
            Some(HardLink::Secondary)
        );
    }

    #[cfg(unix)]
    #[test]
    fn marks_shared_storage_evidence_partial_when_a_collapsed_branch_has_hard_links() {
        let root = tempfile::tempdir().unwrap();
        let collapsed = root.path().join("collapsed");
        fs::create_dir(&collapsed).unwrap();
        let first = collapsed.join("first.bin");
        File::create(&first)
            .unwrap()
            .write_all(&[0_u8; 4096])
            .unwrap();
        fs::hard_link(&first, collapsed.join("second.bin")).unwrap();

        let mut request = request(root.path(), SizeMode::Physical);
        request.collapse_names = vec!["collapsed".into()];
        let result = scan(request);

        assert_eq!(
            result.shared_storage_evidence,
            Some(SharedStorageEvidence::Partial)
        );
        assert!(result.children[0].shared_storage_evidence.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn marks_physical_sharing_partial_when_an_inventory_artifact_is_collapsed() {
        let root = tempfile::tempdir().unwrap();
        let modules = root.path().join("node_modules");
        fs::create_dir(&modules).unwrap();
        let first = modules.join("first.bin");
        File::create(&first)
            .unwrap()
            .write_all(&[0_u8; 4096])
            .unwrap();
        fs::hard_link(&first, modules.join("second.bin")).unwrap();

        let mut options = request(root.path(), SizeMode::Physical);
        options.collapse_names = vec!["node_modules".into()];
        options.developer_artifact_inventory =
            Some(DeveloperArtifactInventoryRequest::Enabled(true));
        let result = scan(options);

        assert_eq!(
            result.shared_storage_evidence,
            Some(SharedStorageEvidence::Partial)
        );
        let inventory = result.developer_artifact_inventory.expect("root inventory");
        assert!(inventory
            .items
            .iter()
            .any(|item| item.name == "node_modules" && item.inventory_only));
    }

    #[cfg(unix)]
    #[test]
    fn marks_shared_storage_evidence_partial_when_other_truncates_hard_links() {
        let root = tempfile::tempdir().unwrap();
        File::create(root.path().join("largest.bin"))
            .unwrap()
            .write_all(&[0_u8; 16_384])
            .unwrap();
        let first = root.path().join("linked-00.bin");
        File::create(&first)
            .unwrap()
            .write_all(&[0_u8; 4096])
            .unwrap();
        for index in 1..13 {
            fs::hard_link(&first, root.path().join(format!("linked-{index:02}.bin"))).unwrap();
        }

        let mut request = request(root.path(), SizeMode::Physical);
        request.max_children = 1;
        let result = scan(request);

        assert_eq!(
            result.shared_storage_evidence,
            Some(SharedStorageEvidence::Partial)
        );
        assert!(result.children.iter().any(|node| node.is_other));
    }

    #[test]
    fn preserves_clone_evidence_without_reassigning_bytes() {
        let full = clone_evidence_from_attributes(
            ATTR_CMNEXT_CLONE_ID | ATTR_CMNEXT_EXT_FLAGS | ATTR_CMNEXT_CLONE_REFCNT,
            42,
            EF_MAY_SHARE_BLOCKS | EF_SHARES_ALL_BLOCKS,
            3,
        );
        assert_eq!(
            full,
            CloneEvidence::SharesAllBlocks {
                clone_id: Some("42".into()),
                reported_full_clone_count: Some(3),
            }
        );

        let partial =
            clone_evidence_from_attributes(ATTR_CMNEXT_EXT_FLAGS, 0, EF_MAY_SHARE_BLOCKS, 0);
        assert_eq!(partial, CloneEvidence::MayShareBlocks { clone_id: None });

        assert_eq!(
            clone_evidence_from_attributes(0, 0, 0, 0),
            CloneEvidence::Unavailable {
                reason: CloneUnavailableReason::Filesystem,
            }
        );

        assert!(emitted_clone_evidence(&CloneEvidence::NotShared).is_none());
        assert!(emitted_clone_evidence(&CloneEvidence::Unavailable {
            reason: CloneUnavailableReason::Scanner,
        })
        .is_none());
        assert_eq!(emitted_clone_evidence(&full), Some(full));
    }

    #[test]
    fn maps_scan_root_clone_metadata_capability() {
        assert_eq!(
            clone_metadata_capability(CLONE_METADATA_UNAVAILABLE_FILESYSTEM),
            CloneMetadataCapability::Unavailable {
                reason: CloneUnavailableReason::Filesystem,
            }
        );
        assert_eq!(
            clone_metadata_capability(CLONE_METADATA_UNKNOWN),
            CloneMetadataCapability::Unknown
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn accounts_complete_apfs_clone_groups_when_the_volume_reports_them() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.bin");
        let clone = root.path().join("clone.bin");
        File::create(&source)
            .unwrap()
            .write_all(&[0_u8; 8_192])
            .unwrap();
        assert!(std::process::Command::new("cp")
            .arg("-c")
            .arg(&source)
            .arg(&clone)
            .status()
            .unwrap()
            .success());

        let result = scan(request(root.path(), SizeMode::Physical));
        let clone_nodes: Vec<&CompactNode> = result
            .children
            .iter()
            .filter(|node| {
                matches!(
                    node.clone_evidence,
                    Some(CloneEvidence::SharesAllBlocks {
                        clone_id: Some(_),
                        reported_full_clone_count: Some(2),
                    })
                )
            })
            .collect();

        // macOS runners can place temporary files on a non-APFS filesystem.
        // Synthetic coverage above proves the normalization; this assertion
        // verifies the end-to-end API whenever the volume reports clone facts.
        if clone_nodes.len() != 2 {
            return;
        }

        let primary = clone_nodes
            .iter()
            .find(|node| node.clone_accounting == Some(CloneAccounting::Primary))
            .unwrap();
        let secondary = clone_nodes
            .iter()
            .find(|node| node.clone_accounting == Some(CloneAccounting::Secondary))
            .unwrap();
        assert_eq!(secondary.size, 0);
        assert_eq!(secondary.logical_size, Some(primary.size));
        assert_eq!(result.size, primary.size);
        assert_eq!(result.logical_size, Some(primary.size * 2));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn charges_windows_hard_links_once() {
        let root = tempfile::tempdir().unwrap();
        let primary = root.path().join("primary.bin");
        File::create(&primary)
            .unwrap()
            .write_all(&[0_u8; 4096])
            .unwrap();
        fs::hard_link(&primary, root.path().join("parallel.bin")).unwrap();

        let result = scan(request(root.path(), SizeMode::Physical));
        assert_eq!(
            result
                .children
                .iter()
                .filter(|child| child.size > 0)
                .count(),
            1
        );
        assert_eq!(
            result
                .children
                .iter()
                .filter(|child| child.hard_link == Some(HardLink::Secondary))
                .count(),
            1
        );
    }

    #[test]
    fn collapses_artifacts_and_keeps_signatures() {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("project/target/debug");
        fs::create_dir_all(&target).unwrap();
        File::create(root.path().join("project/target/.rustc_info.json"))
            .unwrap()
            .write_all(&[0_u8; 7])
            .unwrap();
        File::create(target.join("app"))
            .unwrap()
            .write_all(&[0_u8; 23])
            .unwrap();
        let mut options = request(root.path(), SizeMode::Logical);
        options.collapse_names = vec!["target".into()];
        options.signature_names = vec![".rustc_info.json".into(), "debug".into()];

        let result = scan(options);
        let target = &result.children[0].children[0];
        assert!(target.is_collapsed);
        assert_eq!(target.size, 30);
        assert_eq!(
            target.signatures.as_deref(),
            Some(&[".rustc_info.json".into(), "debug".into()][..])
        );
    }

    #[test]
    fn sibling_project_markers_promote_a_conventional_artifact() {
        let root = tempfile::tempdir().unwrap();
        let web = root.path().join("web");
        let stray = root.path().join("stray");
        fs::create_dir_all(web.join("node_modules/pkg")).unwrap();
        fs::create_dir_all(stray.join("node_modules")).unwrap();
        File::create(web.join("package.json"))
            .unwrap()
            .write_all(&[0_u8; 1])
            .unwrap();
        File::create(web.join("package-lock.json"))
            .unwrap()
            .write_all(&[0_u8; 1])
            .unwrap();
        File::create(web.join("node_modules/pkg/index.js"))
            .unwrap()
            .write_all(&[0_u8; 5])
            .unwrap();
        File::create(stray.join("node_modules/index.js"))
            .unwrap()
            .write_all(&[0_u8; 3])
            .unwrap();

        let mut options = request(root.path(), SizeMode::Logical);
        options.max_depth = 0;
        options.developer_artifact_inventory = Some(DeveloperArtifactInventoryRequest::Options(
            DeveloperArtifactInventoryOptions { max_items: Some(8) },
        ));
        let result = scan(options);
        let inventory = result.developer_artifact_inventory.expect("root inventory");

        let corroborated = inventory
            .items
            .iter()
            .find(|item| item.path == web.join("node_modules").to_string_lossy())
            .unwrap();
        assert!(matches!(
            corroborated.confidence,
            DeveloperArtifactConfidence::Verified
        ));
        assert!(matches!(
            corroborated.cleanup,
            DeveloperArtifactCleanupReadiness::Eligible
        ));
        assert_eq!(
            corroborated.evidence,
            vec![
                "name:node_modules".to_string(),
                "parent:package-lock.json".to_string(),
                "parent:package.json".to_string(),
            ]
        );
        let uncorroborated = inventory
            .items
            .iter()
            .find(|item| item.path == stray.join("node_modules").to_string_lossy())
            .unwrap();
        assert!(matches!(
            uncorroborated.confidence,
            DeveloperArtifactConfidence::Likely
        ));
        assert!(matches!(
            uncorroborated.cleanup,
            DeveloperArtifactCleanupReadiness::Review
        ));
    }
    #[test]
    fn indexes_deep_developer_artifacts_outside_the_visual_tree() {
        let root = tempfile::tempdir().unwrap();
        let project = root.path().join("one/two/project");
        fs::create_dir_all(project.join("node_modules/pkg")).unwrap();
        fs::create_dir_all(project.join("target/debug")).unwrap();
        fs::create_dir_all(project.join("build")).unwrap();
        File::create(project.join("node_modules/pkg/index.js"))
            .unwrap()
            .write_all(&[0_u8; 13])
            .unwrap();
        File::create(project.join("target/.rustc_info.json"))
            .unwrap()
            .write_all(&[0_u8; 7])
            .unwrap();
        File::create(project.join("target/debug/app"))
            .unwrap()
            .write_all(&[0_u8; 17])
            .unwrap();
        File::create(project.join("build/artifact.bin"))
            .unwrap()
            .write_all(&[0_u8; 19])
            .unwrap();

        let mut options = request(root.path(), SizeMode::Logical);
        options.max_depth = 0;
        options.developer_artifact_inventory = Some(DeveloperArtifactInventoryRequest::Options(
            DeveloperArtifactInventoryOptions {
                max_items: Some(16),
            },
        ));
        let result = scan(options);
        let inventory = result.developer_artifact_inventory.expect("root inventory");

        #[cfg(not(target_os = "windows"))]
        assert_eq!(inventory.status.state, ArtifactInventoryState::Complete);
        #[cfg(target_os = "windows")]
        assert_eq!(inventory.status.state, ArtifactInventoryState::Partial);
        assert_eq!(inventory.status.matched_directories, 3);
        let modules = inventory
            .items
            .iter()
            .find(|item| item.path == project.join("node_modules").to_string_lossy())
            .unwrap();
        assert_eq!(modules.size, 13);
        assert!(matches!(modules.kind, DeveloperArtifactKind::Dependencies));
        assert!(matches!(
            modules.ecosystem,
            DeveloperArtifactEcosystem::Node
        ));
        // A basename alone is discovery, not verified disposability: the
        // name-only match stays review-gated even though it is recognized.
        assert!(matches!(
            modules.confidence,
            DeveloperArtifactConfidence::Likely
        ));
        assert!(matches!(
            modules.cleanup,
            DeveloperArtifactCleanupReadiness::Review
        ));
        #[cfg(not(target_os = "windows"))]
        {
            let identity = modules
                .directory_identity
                .as_ref()
                .expect("POSIX directory identity");
            assert_eq!(identity.platform, "posix");
            assert_ne!(identity.device, "0");
            assert_ne!(identity.file_id, "0");
        }
        #[cfg(target_os = "windows")]
        assert!(modules.directory_identity.is_none());
        let target = inventory
            .items
            .iter()
            .find(|item| item.path == project.join("target").to_string_lossy())
            .unwrap();
        assert_eq!(target.size, 24);
        assert!(matches!(target.ecosystem, DeveloperArtifactEcosystem::Rust));
        assert!(matches!(
            target.confidence,
            DeveloperArtifactConfidence::Verified
        ));
        assert_eq!(
            target.signatures.as_deref(),
            Some(&[".rustc_info.json".into(), "debug".into()][..])
        );
        let build = inventory
            .items
            .iter()
            .find(|item| item.path == project.join("build").to_string_lossy())
            .unwrap();
        assert!(matches!(
            build.ecosystem,
            DeveloperArtifactEcosystem::Generic
        ));
        assert!(matches!(
            build.cleanup,
            DeveloperArtifactCleanupReadiness::Review
        ));
        #[cfg(not(target_os = "windows"))]
        assert_eq!(inventory.status.unavailable_directory_identity_count, 0);
        #[cfg(target_os = "windows")]
        assert_eq!(
            inventory.status.unavailable_directory_identity_count,
            inventory.items.len()
        );
    }

    #[test]
    fn marks_retained_identityless_artifacts_as_partial() {
        let root = tempfile::tempdir().unwrap();
        let mut options = request(root.path(), SizeMode::Logical);
        options.developer_artifact_inventory =
            Some(DeveloperArtifactInventoryRequest::Enabled(true));
        let scanner = Scanner::new(options, |_| Ok(())).unwrap();
        let candidate = root.path().join("node_modules");

        scanner
            .state
            .record_developer_artifact(DeveloperArtifactObservation {
                path: &candidate,
                name: "node_modules",
                size: 17,
                logical_size: 17,
                modified_at: None,
                sibling_markers: &[],
                signatures: &[],
                directory_identity: None,
            });

        let inventory = scanner
            .state
            .developer_artifact_inventory()
            .expect("opt-in inventory");
        assert_eq!(inventory.status.state, ArtifactInventoryState::Partial);
        assert_eq!(inventory.status.unavailable_directory_identity_count, 1);
        assert_eq!(
            inventory.status.unavailable_directory_identity_sample_paths,
            vec![candidate.to_string_lossy().into_owned()]
        );
    }

    #[test]
    fn bounds_the_native_artifact_inventory_but_reports_all_matches() {
        let root = tempfile::tempdir().unwrap();
        for name in ["a", "b", "c"] {
            let modules = root.path().join(name).join("node_modules");
            fs::create_dir_all(&modules).unwrap();
            File::create(modules.join("index.js"))
                .unwrap()
                .write_all(&[0_u8; 1])
                .unwrap();
        }
        let mut options = request(root.path(), SizeMode::Logical);
        options.max_depth = 0;
        options.developer_artifact_inventory = Some(DeveloperArtifactInventoryRequest::Options(
            DeveloperArtifactInventoryOptions { max_items: Some(2) },
        ));

        let result = scan(options);
        let inventory = result.developer_artifact_inventory.expect("root inventory");
        assert_eq!(inventory.items.len(), 2);
        assert_eq!(inventory.status.matched_directories, 3);
        assert!(inventory.status.truncated);
        assert!(matches!(
            inventory.status.state,
            ArtifactInventoryState::Partial
        ));
    }

    #[test]
    fn retains_deterministic_artifact_top_k_in_utf16_path_order() {
        let root = tempfile::tempdir().unwrap();
        // U+1F600 starts with a high surrogate in JavaScript and therefore
        // sorts before U+E000 in the cross-backend UTF-16 order.
        let emoji = root.path().join("😀/node_modules");
        let private_use = root.path().join("\u{e000}/node_modules");
        for directory in [&emoji, &private_use] {
            fs::create_dir_all(directory).unwrap();
            File::create(directory.join("index.js"))
                .unwrap()
                .write_all(&[0_u8; 1])
                .unwrap();
        }

        let mut options = request(root.path(), SizeMode::Logical);
        options.max_depth = 0;
        options.developer_artifact_inventory = Some(DeveloperArtifactInventoryRequest::Options(
            DeveloperArtifactInventoryOptions { max_items: Some(1) },
        ));

        for _ in 0..6 {
            let result = scan(options.clone());
            let inventory = result.developer_artifact_inventory.expect("root inventory");
            assert_eq!(inventory.status.matched_directories, 2);
            assert!(inventory.status.truncated);
            assert_eq!(inventory.items.len(), 1);
            assert_eq!(inventory.items[0].path, emoji.to_string_lossy());
        }
    }

    #[test]
    fn marks_inventory_partial_when_directory_identity_or_device_scope_is_skipped() {
        let root = tempfile::tempdir().unwrap();
        let mut options = request(root.path(), SizeMode::Logical);
        options.developer_artifact_inventory =
            Some(DeveloperArtifactInventoryRequest::Enabled(true));
        let scanner = Scanner::new(options, |_| Ok(())).unwrap();
        scanner.state.root_device.store(7, Ordering::Relaxed);
        scanner
            .state
            .root_directory_identity_available
            .store(true, Ordering::Relaxed);

        let repeated = Entry {
            name: OsString::from("repeat"),
            kind: EntryKind::Directory,
            logical_size: 0,
            allocated_size: 0,
            modified_at: None,
            device: 7,
            file_id: 99,
            link_count: 1,
            clone_evidence: CloneEvidence::NotShared,
        };
        let first_path = root.path().join("first-observation");
        let repeated_path = root.path().join("repeat-alias");
        // The visual guard remains permissive for an unknown file ID. The
        // stricter inventory guard gets its own identity set and boundaries.
        assert!(scanner.state.claim_directory(&repeated, &first_path));
        assert!(!scanner.state.claim_directory(&repeated, &repeated_path));
        assert!(scanner
            .state
            .claim_inventory_directory(&repeated, &first_path));
        assert!(!scanner
            .state
            .claim_inventory_directory(&repeated, &repeated_path));

        let cross_device = Entry {
            name: OsString::from("other-device"),
            kind: EntryKind::Directory,
            logical_size: 0,
            allocated_size: 0,
            modified_at: None,
            device: 8,
            file_id: 100,
            link_count: 1,
            clone_evidence: CloneEvidence::NotShared,
        };
        let cross_device_path = root.path().join("other-device");
        assert!(!scanner
            .state
            .claim_directory(&cross_device, &cross_device_path));
        assert!(!scanner
            .state
            .claim_inventory_directory(&cross_device, &cross_device_path));

        let unknown_identity = Entry {
            name: OsString::from("unknown-identity"),
            kind: EntryKind::Directory,
            logical_size: 0,
            allocated_size: 0,
            modified_at: None,
            device: 7,
            file_id: 0,
            link_count: 1,
            clone_evidence: CloneEvidence::NotShared,
        };
        let unknown_identity_path = root.path().join("unknown-identity");
        assert!(scanner
            .state
            .claim_directory(&unknown_identity, &unknown_identity_path));
        assert!(!scanner
            .state
            .claim_inventory_directory(&unknown_identity, &unknown_identity_path));

        // A root with device 7 but no file id cannot safely establish the
        // inventory's directory identity scope.
        scanner
            .state
            .root_directory_identity_available
            .store(false, Ordering::Relaxed);
        scanner.state.root_device.store(7, Ordering::Relaxed);
        let unknown_root_path = root.path().join("root-file-id-zero");
        assert!(!scanner
            .state
            .claim_inventory_directory(&repeated, &unknown_root_path));

        assert!(matches!(
            scanner.state.shared_storage_evidence(),
            SharedStorageEvidence::Partial
        ));
        let inventory = scanner
            .state
            .developer_artifact_inventory()
            .expect("opt-in inventory");
        assert!(matches!(
            inventory.status.state,
            ArtifactInventoryState::Partial
        ));
        assert!(inventory.status.skipped_directory_count >= 4);
        assert!(inventory
            .status
            .skipped_directory_sample_paths
            .contains(&repeated_path.to_string_lossy().into_owned()));
        assert!(inventory
            .status
            .skipped_directory_sample_paths
            .contains(&unknown_identity_path.to_string_lossy().into_owned()));
    }

    #[test]
    fn keeps_native_visual_map_when_inventory_identity_scope_is_unavailable() {
        let root = tempfile::tempdir().unwrap();
        let project = root.path().join("project");
        let modules = project.join("node_modules");
        fs::create_dir_all(&modules).unwrap();
        File::create(root.path().join("visible.bin"))
            .unwrap()
            .write_all(&[0_u8; 3])
            .unwrap();
        File::create(modules.join("index.js"))
            .unwrap()
            .write_all(&[0_u8; 17])
            .unwrap();

        let mut map_options = request(root.path(), SizeMode::Logical);
        map_options.max_depth = 0;
        let baseline = scan(map_options.clone());
        let map_children = |node: &CompactNode| {
            node.children
                .iter()
                .map(|child| {
                    (
                        child.name.clone(),
                        child.size,
                        child.logical_size,
                        child.is_collapsed,
                    )
                })
                .collect::<Vec<_>>()
        };

        let mut inventory_options = map_options.clone();
        inventory_options.developer_artifact_inventory =
            Some(DeveloperArtifactInventoryRequest::Enabled(true));
        let root_scope_scanner = Scanner::new(inventory_options.clone(), |_| Ok(())).unwrap();
        root_scope_scanner
            .state
            .inventory_test_root_identity_unavailable
            .store(true, Ordering::Relaxed);
        let root_scope = root_scope_scanner.scan().unwrap();
        assert_eq!(root_scope.size, baseline.size);
        assert_eq!(root_scope.logical_size, baseline.logical_size);
        assert_eq!(map_children(&root_scope), map_children(&baseline));
        assert_eq!(
            root_scope.shared_storage_evidence, baseline.shared_storage_evidence,
            "inventory scope must not change map storage-accounting capability"
        );
        let root_inventory = root_scope
            .developer_artifact_inventory
            .expect("inventory requested");
        assert!(matches!(
            root_inventory.status.state,
            ArtifactInventoryState::Partial
        ));
        assert!(root_inventory.items.is_empty());
        assert_eq!(
            root_inventory.status.skipped_directory_sample_paths,
            vec![root.path().to_string_lossy().into_owned()]
        );

        let child_scope_scanner = Scanner::new(inventory_options, |_| Ok(())).unwrap();
        *child_scope_scanner
            .state
            .inventory_test_child_identity_unavailable
            .lock()
            .unwrap() = Some(project.clone());
        let child_scope = child_scope_scanner.scan().unwrap();
        assert_eq!(child_scope.size, baseline.size);
        assert_eq!(child_scope.logical_size, baseline.logical_size);
        assert_eq!(map_children(&child_scope), map_children(&baseline));
        assert_eq!(
            child_scope.shared_storage_evidence, baseline.shared_storage_evidence,
            "inventory scope must not change map storage-accounting capability"
        );
        let child_inventory = child_scope
            .developer_artifact_inventory
            .expect("inventory requested");
        assert!(matches!(
            child_inventory.status.state,
            ArtifactInventoryState::Partial
        ));
        assert!(child_inventory.items.is_empty());
        assert_eq!(
            child_inventory.status.skipped_directory_sample_paths,
            vec![project.to_string_lossy().into_owned()]
        );
    }

    #[test]
    fn marks_depth_cutoffs_for_lazy_expansion() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("project/src/deep")).unwrap();
        File::create(root.path().join("project/src/deep/app.bin"))
            .unwrap()
            .write_all(&[0_u8; 23])
            .unwrap();
        let mut options = request(root.path(), SizeMode::Logical);
        options.max_depth = 0;

        let result = scan(options);
        let project = result
            .children
            .iter()
            .find(|child| child.name == "project")
            .unwrap();
        assert!(project.is_collapsed);
        assert!(project.children.is_empty());
        assert_eq!(project.size, 23);
    }

    #[test]
    fn preserves_filesystem_roots_while_trimming_folder_separators() {
        assert_eq!(comparable_path(Path::new("/")), PathBuf::from("/"));
        assert_eq!(
            comparable_path(Path::new("/tmp/project/")),
            PathBuf::from("/tmp/project")
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn preserves_windows_drive_roots() {
        assert_eq!(comparable_path(Path::new(r"C:\")), PathBuf::from(r"C:\"));
        assert_eq!(
            comparable_path(Path::new(r"\\server\share\")),
            PathBuf::from(r"\\server\share\")
        );
        assert_eq!(
            comparable_path(Path::new(r"C:\workspace\")),
            PathBuf::from(r"C:\workspace")
        );
    }
}
