//! Scan request parsing and bounded defaults.

use serde::Deserialize;
use std::path::PathBuf;

pub(crate) const MAX_ARTIFACT_INVENTORY_ITEMS: usize = 20_000;
const DEFAULT_ARTIFACT_INVENTORY_ITEMS: usize = 2_000;

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
    /// Opt-in bounded index of recognized developer artifact directories.
    #[serde(default)]
    pub developer_artifact_inventory: Option<DeveloperArtifactInventoryRequest>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
pub enum DeveloperArtifactInventoryRequest {
    Enabled(bool),
    Options(DeveloperArtifactInventoryOptions),
}

impl DeveloperArtifactInventoryRequest {
    pub(crate) fn max_items(&self) -> Option<usize> {
        match self {
            Self::Enabled(false) => None,
            Self::Enabled(true) => Some(DEFAULT_ARTIFACT_INVENTORY_ITEMS),
            Self::Options(options) => Some(
                options
                    .max_items
                    .unwrap_or(DEFAULT_ARTIFACT_INVENTORY_ITEMS)
                    .clamp(1, MAX_ARTIFACT_INVENTORY_ITEMS),
            ),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeveloperArtifactInventoryOptions {
    pub max_items: Option<usize>,
}

fn default_max_depth() -> usize {
    10
}

fn default_concurrency() -> usize {
    std::thread::available_parallelism()
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
