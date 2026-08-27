//! Compact scanner-to-host protocol model.

use serde::Serialize;

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DeveloperArtifactKind {
    Dependencies,
    BuildOutput,
    ToolchainCache,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DeveloperArtifactConfidence {
    Verified,
    Likely,
    Ambiguous,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DeveloperArtifactCleanupReadiness {
    Eligible,
    Review,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DeveloperArtifactEcosystem {
    Node,
    Python,
    Rust,
    Jvm,
    Cpp,
    Go,
    Dotnet,
    Dart,
    Apple,
    Web,
    Containers,
    Tooling,
    Generic,
    Agent,
    Git,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeveloperArtifactDirectoryIdentity {
    /// The native Windows scanner intentionally omits identities: Windows
    /// volume/file indexes are not proven equivalent to Node's lstat dev/ino
    /// values used by the desktop Trash guard.
    pub platform: &'static str,
    pub device: String,
    pub file_id: String,
    pub modified_at: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeveloperArtifact {
    pub name: String,
    pub path: String,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logical_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub directory_identity: Option<DeveloperArtifactDirectoryIdentity>,
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signatures: Option<Vec<String>>,
    pub kind: DeveloperArtifactKind,
    pub ecosystem: DeveloperArtifactEcosystem,
    pub confidence: DeveloperArtifactConfidence,
    pub cleanup: DeveloperArtifactCleanupReadiness,
    pub evidence: Vec<String>,
    pub inventory_only: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeveloperArtifactInventoryStatus {
    pub state: ArtifactInventoryState,
    pub max_items: usize,
    pub scanned_directories: usize,
    pub matched_directories: usize,
    pub truncated: bool,
    pub unreadable_count: usize,
    pub unreadable_sample_paths: Vec<String>,
    pub skipped_symlink_count: usize,
    pub skipped_symlink_sample_paths: Vec<String>,
    pub skipped_directory_count: usize,
    pub skipped_directory_sample_paths: Vec<String>,
    /// Retained records without a direct directory identity cannot support a
    /// stale-safe delete. Keep this separate from traversal scope skips so
    /// the desktop can reconcile it after bounded Windows identity hydration.
    pub unavailable_directory_identity_count: usize,
    pub unavailable_directory_identity_sample_paths: Vec<String>,
    pub excluded_count: usize,
    pub excluded_sample_paths: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ArtifactInventoryState {
    Complete,
    Partial,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeveloperArtifactInventory {
    pub items: Vec<DeveloperArtifact>,
    pub status: DeveloperArtifactInventoryStatus,
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
    /// Clone metadata is evidence. It does not itself change `size`: only the
    /// separate accounting field is emitted after a complete group is proven.
    #[serde(rename = "v", skip_serializing_if = "Option::is_none")]
    pub clone_evidence: Option<CloneEvidence>,
    /// Present only after a complete, proven full-clone group is normalized.
    /// It partitions the map and is never a per-path deletion/reclaim claim.
    #[serde(rename = "a", skip_serializing_if = "Option::is_none")]
    pub clone_accounting: Option<CloneAccounting>,
    /// Scan-root clone metadata capability. It intentionally appears once,
    /// rather than repeating inert availability state on every file.
    #[serde(rename = "k", skip_serializing_if = "Option::is_none")]
    pub clone_metadata: Option<CloneMetadataCapability>,
    /// Root-only boundary for reclaim-relevant shared-storage evidence. A
    /// `partial` result means a lossy or unreadable branch may hide a hard
    /// link or clone relationship, never a byte estimate.
    #[serde(rename = "e", skip_serializing_if = "Option::is_none")]
    pub shared_storage_evidence: Option<SharedStorageEvidence>,
    /// Root-only bounded deep developer artifact index. It stays outside
    /// `children` so the visual tree remains compact at arbitrary depth.
    #[serde(rename = "i", skip_serializing_if = "Option::is_none")]
    pub developer_artifact_inventory: Option<DeveloperArtifactInventory>,
    /// Scanner-only inode identity used to make complete hard-link groups
    /// deterministic before serialization. Never crosses the wire.
    #[serde(skip)]
    pub(crate) hard_link_identity: Option<(u64, u64)>,
    #[serde(skip)]
    pub(crate) reported_hard_link_count: Option<u64>,
    #[serde(skip)]
    pub(crate) hard_link_physical_size: Option<u64>,
    /// Scanner-only risk propagated through aggregate/collapsed nodes so a
    /// later tree cutoff can tell whether it hid sharing evidence.
    #[serde(skip)]
    pub(crate) has_shared_storage_risk: bool,
    #[serde(rename = "d", skip_serializing_if = "is_false")]
    pub is_dir: bool,
    #[serde(rename = "c", skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<CompactNode>,
    #[serde(rename = "o", skip_serializing_if = "is_false")]
    pub is_other: bool,
    /// Total direct items represented by a synthetic `Other` node.
    #[serde(rename = "r", skip_serializing_if = "Option::is_none")]
    pub other_count: Option<usize>,
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

/// The compact wire form of `DiskNode.clone`.
///
/// APFS reports whether a file may share blocks, but not which bytes inside a
/// partial scan are safely owned by one path. Preserve that distinction rather
/// than guessing a de-duplicated size; accounting happens only after proof.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum CloneEvidence {
    Unavailable {
        reason: CloneUnavailableReason,
    },
    Unknown,
    NotShared,
    MayShareBlocks {
        #[serde(rename = "cloneId", skip_serializing_if = "Option::is_none")]
        clone_id: Option<String>,
    },
    SharesAllBlocks {
        #[serde(rename = "cloneId", skip_serializing_if = "Option::is_none")]
        clone_id: Option<String>,
        #[serde(
            rename = "reportedFullCloneCount",
            skip_serializing_if = "Option::is_none"
        )]
        reported_full_clone_count: Option<u32>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CloneUnavailableReason {
    Platform,
    Filesystem,
    Scanner,
}

/// The compact wire form of a scan root's `DiskNode.cloneMetadata` field.
/// This says whether the scanner could inspect clone metadata at all; it does
/// not make a reclaimability or complete-accounting claim.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum CloneMetadataCapability {
    Available,
    Unknown,
    Unavailable { reason: CloneUnavailableReason },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CloneAccounting {
    Primary,
    Secondary,
}

/// Root-only compact wire form of `DiskNode.sharedStorageEvidence`.
/// Complete means all sharing evidence relevant to the retained tree remains
/// visible; it does not promise that deleting a path will reclaim its size.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SharedStorageEvidence {
    Complete,
    Partial,
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
        root: Box<CompactNode>,
    },
    Error {
        message: String,
    },
}

impl CompactNode {
    pub(crate) fn directory(
        name: String,
        size: u64,
        logical_size: u64,
        modified_at: Option<u64>,
        children: Vec<CompactNode>,
        is_collapsed: bool,
        signatures: Option<Vec<String>>,
    ) -> Self {
        Self {
            name,
            size,
            logical_size: (logical_size != size).then_some(logical_size),
            modified_at,
            hard_link: None,
            clone_evidence: None,
            clone_accounting: None,
            clone_metadata: None,
            shared_storage_evidence: None,
            developer_artifact_inventory: None,
            hard_link_identity: None,
            reported_hard_link_count: None,
            hard_link_physical_size: None,
            has_shared_storage_risk: false,
            is_dir: true,
            children,
            is_other: false,
            other_count: None,
            is_collapsed,
            signatures,
            scan_issues: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn compact_node_wire_keys_are_exact() {
        let mut node = CompactNode::directory(
            "Other (13 items)".into(),
            7,
            9,
            Some(123),
            Vec::new(),
            true,
            Some(vec!["package.json".into()]),
        );
        node.hard_link = Some(HardLink::Primary);
        node.clone_evidence = Some(CloneEvidence::SharesAllBlocks {
            clone_id: Some("42".into()),
            reported_full_clone_count: Some(2),
        });
        node.clone_accounting = Some(CloneAccounting::Secondary);
        node.clone_metadata = Some(CloneMetadataCapability::Available);
        node.shared_storage_evidence = Some(SharedStorageEvidence::Partial);
        node.is_other = true;
        node.other_count = Some(13);
        node.scan_issues = Some(ScanIssueSummary {
            unreadable_count: 1,
            sample_paths: vec!["/root/nope".into()],
        });

        assert_eq!(
            serde_json::to_value(node).unwrap(),
            json!({
                "n": "Other (13 items)",
                "s": 7,
                "l": 9,
                "m": 123,
                "h": "primary",
                "v": {
                    "state": "shares-all-blocks",
                    "cloneId": "42",
                    "reportedFullCloneCount": 2
                },
                "a": "secondary",
                "k": { "state": "available" },
                "e": "partial",
                "d": true,
                "o": true,
                "r": 13,
                "x": true,
                "g": ["package.json"],
                "q": { "unreadableCount": 1, "samplePaths": ["/root/nope"] }
            })
        );
    }

    #[test]
    fn done_message_envelope_is_exact() {
        let root = CompactNode::directory("root".into(), 0, 0, None, Vec::new(), false, None);
        let message = ServerMessage::Done {
            protocol: 1,
            root_path: "/root".into(),
            root: Box::new(root),
        };

        assert_eq!(
            serde_json::to_value(message).unwrap(),
            json!({
                "type": "done",
                "protocol": 1,
                "rootPath": "/root",
                "root": { "n": "root", "s": 0, "d": true }
            })
        );
    }
}
