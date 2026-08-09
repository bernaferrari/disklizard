use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Instant, UNIX_EPOCH};

const MAX_DISCOVERIES: usize = 96;
const MAX_FILE_DISCOVERIES: usize = 24;
const MAX_ISSUE_SAMPLES: usize = 12;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub target_path: PathBuf,
    #[serde(default = "default_max_depth")]
    pub max_depth: usize,
    #[serde(default = "default_concurrency")]
    pub concurrency: usize,
    #[serde(default = "default_max_children")]
    pub max_children: usize,
    #[serde(default)]
    pub preserve_names: Vec<String>,
    #[serde(default)]
    pub collapse_names: Vec<String>,
    #[serde(default)]
    pub signature_names: Vec<String>,
    #[serde(default = "default_progress_interval")]
    pub progress_interval_ms: u64,
    #[serde(default)]
    pub size_mode: SizeMode,
    #[serde(default)]
    pub exclude_paths: Vec<PathBuf>,
}

fn default_max_depth() -> usize {
    10
}

fn default_concurrency() -> usize {
    std::thread::available_parallelism()
        // APFS metadata traversal benefits from overlap, but excessive workers
        // contend on the same volume and become slower. Keep a little I/O
        // headroom without doubling every logical core.
        .map(|threads| threads.get().saturating_add(2))
        .unwrap_or(8)
        .clamp(4, 12)
}

fn default_max_children() -> usize {
    48
}

fn default_progress_interval() -> u64 {
    100
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SizeMode {
    #[default]
    Physical,
    Logical,
}

/// Compact protocol node. Paths and extensions are reconstructed by the
/// desktop process, avoiding the repeated parent prefixes that dominated the
/// wire payload for large trees.
#[derive(Clone, Debug, Serialize)]
pub struct CompactNode {
    #[serde(rename = "n")]
    pub name: String,
    #[serde(rename = "s")]
    pub size: u64,
    #[serde(rename = "l", skip_serializing_if = "Option::is_none")]
    pub logical_size: Option<u64>,
    #[serde(rename = "m", skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<u64>,
    #[serde(rename = "h", skip_serializing_if = "Option::is_none")]
    pub hard_link: Option<HardLink>,
    #[serde(rename = "d", skip_serializing_if = "is_false")]
    pub is_dir: bool,
    #[serde(rename = "c", skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<CompactNode>,
    #[serde(rename = "o", skip_serializing_if = "is_false")]
    pub is_other: bool,
    #[serde(rename = "x", skip_serializing_if = "is_false")]
    pub is_collapsed: bool,
    #[serde(rename = "g", skip_serializing_if = "Option::is_none")]
    pub signatures: Option<Vec<String>>,
    #[serde(rename = "q", skip_serializing_if = "Option::is_none")]
    pub scan_issues: Option<ScanIssueSummary>,
}

fn is_false(value: &bool) -> bool {
    !value
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum HardLink {
    Primary,
    Secondary,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanIssueSummary {
    pub unreadable_count: usize,
    pub sample_paths: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub files_scanned: usize,
    pub dirs_scanned: usize,
    pub current_path: String,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub discovery: Option<Discovery>,
    #[serde(skip_serializing_if = "is_false")]
    pub done: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Discovery {
    pub name: String,
    pub path: String,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<u64>,
    pub is_dir: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ServerMessage {
    Progress {
        progress: Progress,
    },
    Done {
        protocol: u8,
        #[serde(rename = "rootPath")]
        root_path: String,
        root: CompactNode,
    },
    Error {
        message: String,
    },
}

type Emit = dyn Fn(&ServerMessage) -> io::Result<()> + Send + Sync;

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
    hard_links: [Mutex<HashSet<(u64, u64)>>; 64],
    visited_directories: Mutex<HashSet<(u64, u64)>>,
    root_device: AtomicU64,
    issues: Mutex<Issues>,
    files: AtomicUsize,
    dirs: AtomicUsize,
    bytes: AtomicU64,
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
struct Entry {
    name: OsString,
    kind: EntryKind,
    logical_size: u64,
    allocated_size: u64,
    modified_at: Option<u64>,
    device: u64,
    file_id: u64,
    link_count: u64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum EntryKind {
    File,
    Directory,
    Symlink,
    Other,
}

#[derive(Default)]
struct Measurement {
    size: u64,
    modified_at: Option<u64>,
    signatures: Option<Vec<String>>,
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

    fn read_entries(&self, path: &Path) -> io::Result<Vec<Entry>> {
        #[cfg(target_os = "macos")]
        if let Ok(entries) = macos::read_entries(&self.file) {
            return Ok(entries);
        }
        #[cfg(target_os = "linux")]
        if let Ok(entries) = linux::read_entries(&self.file) {
            return Ok(entries);
        }
        #[cfg(target_os = "windows")]
        if let Ok(entries) = self.handle.read_entries() {
            return Ok(entries);
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
            visited_directories: Mutex::new(HashSet::new()),
            root_device: AtomicU64::new(0),
            issues: Mutex::new(Issues::default()),
            files: AtomicUsize::new(0),
            dirs: AtomicUsize::new(0),
            bytes: AtomicU64::new(0),
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
                return Ok(self.state.file_node(entry));
            }
            if metadata.is_dir() {
                let directory = Directory::open(&target)?;
                let mut root_entry = Entry::from_metadata(OsString::from(&name), &metadata);
                directory.enrich_root(&mut root_entry);
                self.state
                    .root_device
                    .store(root_entry.device, Ordering::Relaxed);
                if root_entry.file_id > 0 {
                    self.state
                        .visited_directories
                        .lock()
                        .expect("directory identity lock poisoned")
                        .insert((root_entry.device, root_entry.file_id));
                }
                return self.state.walk_dir(&target, name, 0, false, directory);
            }
            Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("unsupported scan target: {}", target.display()),
            ))
        })?;

        let issues = self.state.issues.lock().expect("issues lock poisoned");
        if issues.count > 0 {
            root.scan_issues = Some(ScanIssueSummary {
                unreadable_count: issues.count,
                sample_paths: issues.samples.clone(),
            });
        }
        drop(issues);

        self.state.emit_progress(&target, None, true, true);
        Ok(root)
    }
}

impl State {
    fn walk_dir(
        &self,
        path: &Path,
        name: String,
        depth: usize,
        collapsed: bool,
        directory: Directory,
    ) -> io::Result<CompactNode> {
        if collapsed {
            let measured = self.size_only(path, directory, true);
            return Ok(CompactNode::directory(
                name,
                measured.size,
                measured.modified_at,
                Vec::new(),
                true,
                measured.signatures,
            ));
        }

        if depth > self.request.max_depth {
            let measured = self.size_only(path, directory, false);
            return Ok(CompactNode::directory(
                name,
                measured.size,
                measured.modified_at,
                Vec::new(),
                true,
                None,
            ));
        }

        let entries = match directory.read_entries(path) {
            Ok(entries) => entries,
            Err(_) => {
                self.record_unreadable(path);
                return Ok(CompactNode::directory(
                    name,
                    0,
                    None,
                    Vec::new(),
                    false,
                    None,
                ));
            }
        };
        self.dirs.fetch_add(1, Ordering::Relaxed);
        self.emit_progress(path, None, false, false);

        let excluded_names = self.excluded_children.get(path);
        let children: Vec<CompactNode> = entries
            .into_par_iter()
            .filter_map(|entry| {
                if entry.kind == EntryKind::Symlink || entry.kind == EntryKind::Other {
                    return None;
                }
                if excluded_names.is_some_and(|names| names.contains(&entry.name)) {
                    return None;
                }
                if entry.kind == EntryKind::Directory {
                    if !self.claim_directory(&entry) {
                        return None;
                    }
                    let entry_name = entry.name.to_string_lossy().into_owned();
                    let child_path = path.join(&entry.name);
                    let collapsed = self.collapse_names.contains(&entry_name.to_lowercase());
                    match directory
                        .open_child(&entry.name, &child_path)
                        .and_then(|child| {
                            self.walk_dir(&child_path, entry_name, depth + 1, collapsed, child)
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
                    let node = self.file_node(entry);
                    if depth == 0 {
                        self.emit_discovery(&node, &path.join(&node.name));
                    }
                    Some(node)
                }
            })
            .collect();

        let mut visible = Vec::with_capacity(children.len());
        let mut total = 0_u64;
        let mut modified_at = None;
        for child in children {
            if child.size == 0 && child.children.is_empty() && child.hard_link.is_none() {
                continue;
            }
            total = total.saturating_add(child.size);
            modified_at = latest(modified_at, child.modified_at);
            visible.push(child);
        }

        let children = self.limit_children(visible);
        self.emit_progress(path, None, false, false);
        Ok(CompactNode::directory(
            name,
            total,
            modified_at,
            children,
            false,
            None,
        ))
    }

    fn size_only(
        &self,
        path: &Path,
        directory: Directory,
        capture_signatures: bool,
    ) -> Measurement {
        let entries = match directory.read_entries(path) {
            Ok(entries) => entries,
            Err(_) => {
                self.record_unreadable(path);
                return Measurement::default();
            }
        };
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
        let measured = entries
            .into_par_iter()
            .map(|entry| {
                if entry.kind == EntryKind::Symlink || entry.kind == EntryKind::Other {
                    return Measurement::default();
                }
                if excluded_names.is_some_and(|names| names.contains(&entry.name)) {
                    return Measurement::default();
                }
                if entry.kind == EntryKind::Directory {
                    if !self.claim_directory(&entry) {
                        return Measurement::default();
                    }
                    let child_path = path.join(&entry.name);
                    return directory
                        .open_child(&entry.name, &child_path)
                        .map(|child| self.size_only(&child_path, child, false))
                        .unwrap_or_else(|_| {
                            self.record_unreadable(&child_path);
                            Measurement::default()
                        });
                }
                let measured = self.measure_file(&entry);
                self.files.fetch_add(1, Ordering::Relaxed);
                self.bytes.fetch_add(measured.0, Ordering::Relaxed);
                Measurement {
                    size: measured.0,
                    modified_at: entry.modified_at,
                    signatures: None,
                }
            })
            .reduce(Measurement::default, |left, right| Measurement {
                size: left.size.saturating_add(right.size),
                modified_at: latest(left.modified_at, right.modified_at),
                signatures: None,
            });
        self.emit_progress(path, None, false, false);

        Measurement {
            signatures: signatures.filter(|names| !names.is_empty()),
            ..measured
        }
    }

    fn file_node(&self, entry: Entry) -> CompactNode {
        let name = entry.name.to_string_lossy().into_owned();
        let (size, logical_size, hard_link) = self.measure_file(&entry);
        self.files.fetch_add(1, Ordering::Relaxed);
        self.bytes.fetch_add(size, Ordering::Relaxed);
        CompactNode {
            name,
            size,
            logical_size,
            modified_at: entry.modified_at,
            hard_link,
            is_dir: false,
            children: Vec::new(),
            is_other: false,
            is_collapsed: false,
            signatures: None,
            scan_issues: None,
        }
    }

    fn measure_file(&self, entry: &Entry) -> (u64, Option<u64>, Option<HardLink>) {
        let original_size = match self.request.size_mode {
            SizeMode::Physical => entry.allocated_size,
            SizeMode::Logical => entry.logical_size,
        };
        let mut size = original_size;
        let mut hard_link = None;
        if self.request.size_mode == SizeMode::Physical
            && entry.file_id > 0
            && entry.link_count != 1
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
        let logical_size = (entry.logical_size != size).then_some(entry.logical_size);
        (size, logical_size, hard_link)
    }

    fn claim_directory(&self, entry: &Entry) -> bool {
        let root_device = self.root_device.load(Ordering::Relaxed);
        if root_device > 0 && entry.device > 0 && entry.device != root_device {
            return false;
        }
        if entry.file_id == 0 {
            return true;
        }
        self.visited_directories
            .lock()
            .expect("directory identity lock poisoned")
            .insert((entry.device, entry.file_id))
    }

    fn limit_children(&self, mut children: Vec<CompactNode>) -> Vec<CompactNode> {
        if children.len() <= self.request.max_children {
            children.sort_unstable_by_key(|node| std::cmp::Reverse(node.size));
            return children;
        }
        children.select_nth_unstable_by(self.request.max_children, |left, right| {
            right.size.cmp(&left.size)
        });
        let rest = children.split_off(self.request.max_children);
        children.sort_unstable_by_key(|node| std::cmp::Reverse(node.size));
        let mut hidden = Vec::new();
        for child in rest {
            if contains_preserved(&child, &self.preserve_names) {
                children.push(child);
            } else {
                hidden.push(child);
            }
        }
        children.sort_unstable_by_key(|node| std::cmp::Reverse(node.size));
        let size = hidden.iter().map(|child| child.size).sum();
        if size == 0 {
            return children;
        }
        let modified_at = hidden
            .iter()
            .fold(None, |value, child| latest(value, child.modified_at));
        let hidden_count = hidden.len();
        if hidden.len() > 12 {
            hidden.select_nth_unstable_by(12, |left, right| right.size.cmp(&left.size));
            hidden.truncate(12);
        }
        hidden.sort_unstable_by_key(|node| std::cmp::Reverse(node.size));
        children.push(CompactNode {
            name: format!("Other ({hidden_count} items)"),
            size,
            logical_size: None,
            modified_at,
            hard_link: None,
            is_dir: true,
            children: hidden,
            is_other: true,
            is_collapsed: false,
            signatures: None,
            scan_issues: None,
        });
        children
    }

    fn record_unreadable(&self, path: &Path) {
        let mut issues = self.issues.lock().expect("issues lock poisoned");
        issues.count += 1;
        if issues.samples.len() < MAX_ISSUE_SAMPLES {
            issues.samples.push(path.to_string_lossy().into_owned());
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
                done,
            },
        };
        let _ = (self.emit)(&message);
    }
}

impl CompactNode {
    fn directory(
        name: String,
        size: u64,
        modified_at: Option<u64>,
        children: Vec<CompactNode>,
        is_collapsed: bool,
        signatures: Option<Vec<String>>,
    ) -> Self {
        Self {
            name,
            size,
            logical_size: None,
            modified_at,
            hard_link: None,
            is_dir: true,
            children,
            is_other: false,
            is_collapsed,
            signatures,
            scan_issues: None,
        }
    }
}

impl Entry {
    fn from_metadata(name: OsString, metadata: &fs::Metadata) -> Self {
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
            }
        }
    }
}

fn read_entries_portable(path: &Path) -> io::Result<Vec<Entry>> {
    fs::read_dir(path)?
        .map(|result| match result {
            Ok(entry) => match fs::symlink_metadata(entry.path()) {
                #[cfg(target_os = "windows")]
                Ok(metadata) => {
                    windows::entry_from_path(&entry.path(), entry.file_name(), &metadata)
                }
                #[cfg(not(target_os = "windows"))]
                Ok(metadata) => Ok(Entry::from_metadata(entry.file_name(), &metadata)),
                Err(error) => Err(error),
            },
            Err(error) => Err(error),
        })
        .collect()
}

fn metadata_kind(metadata: &fs::Metadata) -> EntryKind {
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

fn metadata_millis(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
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

fn contains_preserved(node: &CompactNode, preserve_names: &HashSet<String>) -> bool {
    if preserve_names.contains(&node.name.to_lowercase()) {
        return true;
    }
    node.children
        .iter()
        .any(|child| contains_preserved(child, preserve_names))
}

#[cfg(target_os = "linux")]
mod linux {
    use super::{Entry, EntryKind};
    use std::cell::RefCell;
    use std::ffi::{CString, OsStr, OsString};
    use std::fs::File;
    use std::io;
    use std::mem::MaybeUninit;
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::ffi::{OsStrExt, OsStringExt};
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

    pub(super) fn read_entries(directory: &File) -> io::Result<Vec<Entry>> {
        DIRECTORY_BUFFER
            .with(|buffer| read_entries_into(directory.as_raw_fd(), &mut buffer.borrow_mut()))
    }

    fn read_entries_into(descriptor: libc::c_int, buffer: &mut [u8]) -> io::Result<Vec<Entry>> {
        let mut entries = Vec::new();
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
                return Ok(entries);
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
                entries.push(stat_entry(descriptor, OsString::from_vec(name.to_vec()))?);
            }
        }
    }

    fn stat_entry(descriptor: libc::c_int, name: OsString) -> io::Result<Entry> {
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
            name,
            kind,
            logical_size: value.stx_size,
            allocated_size: value.stx_blocks.saturating_mul(512),
            modified_at,
            device: device_id(value.stx_dev_major, value.stx_dev_minor),
            file_id: value.stx_ino,
            link_count: value.stx_nlink as u64,
        })
    }

    fn stat_entry_fallback(
        descriptor: libc::c_int,
        name: OsString,
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
            name,
            kind: mode_kind(value.st_mode),
            logical_size: value.st_size.max(0) as u64,
            allocated_size: value.st_blocks.max(0) as u64 * 512,
            modified_at: timestamp_millis(value.st_mtime, value.st_mtime_nsec),
            device: value.st_dev,
            file_id: value.st_ino,
            link_count: value.st_nlink,
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
    use super::{Entry, EntryKind};
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
        let mut attributes = AttrList {
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
            forkattr: 0,
        };
        ATTRIBUTE_BUFFER
            .with(|buffer| read_entries_into(directory, &mut attributes, &mut buffer.borrow_mut()))
    }

    fn read_entries_into(
        directory: &File,
        attributes: &mut AttrList,
        buffer: &mut [u8],
    ) -> io::Result<Vec<Entry>> {
        let mut entries = Vec::new();

        loop {
            let count = unsafe {
                getattrlistbulk(
                    directory.as_raw_fd(),
                    attributes,
                    buffer.as_mut_ptr().cast(),
                    buffer.len(),
                    FSOPT_PACK_INVAL_ATTRS,
                )
            };
            if count < 0 {
                return Err(io::Error::last_os_error());
            }
            if count == 0 {
                return Ok(entries);
            }

            let mut offset = 0_usize;
            for _ in 0..count {
                let entry = parse_entry(buffer, offset)?;
                let length = read::<u32>(buffer, offset)? as usize;
                if length < 4 || offset.saturating_add(length) > buffer.len() {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "invalid bulk entry length",
                    ));
                }
                offset += length;
                if entry.name.as_bytes() != b"." && entry.name.as_bytes() != b".." {
                    entries.push(entry);
                }
            }
        }
    }

    fn parse_entry(buffer: &[u8], start: usize) -> io::Result<Entry> {
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
        let link_count = if (returned.fileattr & ATTR_FILE_LINKCOUNT) != 0 {
            take::<u32>(buffer, &mut cursor)? as u64
        } else {
            1
        };
        let file_allocated_size = if (returned.fileattr & ATTR_FILE_ALLOCSIZE) != 0 {
            take::<i64>(buffer, &mut cursor)?.max(0) as u64
        } else {
            0
        };
        let file_length = if (returned.fileattr & ATTR_FILE_DATALENGTH) != 0 {
            take::<i64>(buffer, &mut cursor)?.max(0) as u64
        } else {
            0
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
        })
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
        }
    }

    fn scan(request: Request) -> CompactNode {
        Scanner::new(request, |_| Ok(())).unwrap().scan().unwrap()
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
            result
                .children
                .iter()
                .filter(|child| child.hard_link.is_some())
                .count(),
            2
        );
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
