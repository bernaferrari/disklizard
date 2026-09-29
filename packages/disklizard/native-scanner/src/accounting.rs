//! Deterministic physical-storage accounting for complete sharing groups.

use super::clone_metadata::{compare_path_segments, compare_utf16};
use super::{CloneAccounting, CloneEvidence, CompactNode, HardLink};
use std::collections::{HashMap, HashSet};

#[derive(Clone)]
struct CloneCandidate {
    indices: Vec<usize>,
    sort_key: Vec<String>,
    reported_full_clone_count: u32,
    size: u64,
    logical_size: u64,
}

#[derive(Default)]
struct CloneGroup {
    candidates: Vec<CloneCandidate>,
    /// Another visible pathname has this clone ID, but does not meet every
    /// full-clone invariant. Its presence makes the group incomplete.
    has_non_candidate_member: bool,
}

#[derive(Clone)]
struct HardLinkCandidate {
    indices: Vec<usize>,
    sort_key: Vec<String>,
    reported_hard_link_count: u64,
    physical_size: u64,
    logical_size: u64,
    charged_size: u64,
    hard_link: HardLink,
}

/// Normalize complete hard-link and APFS full-clone groups without making
/// claims about incomplete, inconsistent, or lossy trees.
pub(crate) fn normalize_complete_groups(root: &mut CompactNode) {
    normalize_complete_hard_link_groups(root);
    normalize_complete_clone_groups(root);
}

/// Hard-link discovery happens during parallel traversal, so the first
/// pathname to claim an inode is inherently scheduling-dependent. Reassign
/// that one physical charge to the lexical first path only when the entire
/// inode group is provably represented in the retained tree.
fn normalize_complete_hard_link_groups(root: &mut CompactNode) {
    let mut groups = HashMap::<(u64, u64), Vec<HardLinkCandidate>>::new();
    let mut affected_directories = HashSet::<Vec<usize>>::new();
    collect_hard_link_candidates(root, &mut Vec::new(), &mut Vec::new(), &mut groups);

    for members in groups.values_mut() {
        let Some(first) = members.first() else {
            continue;
        };
        let reported_hard_link_count = first.reported_hard_link_count;
        let physical_size = first.physical_size;
        let logical_size = first.logical_size;
        let Some(expected_count) = usize::try_from(reported_hard_link_count)
            .ok()
            .filter(|count| *count > 1)
        else {
            continue;
        };
        let distinct_paths = members
            .iter()
            .map(|member| member.indices.clone())
            .collect::<HashSet<_>>();
        let primary_count = members
            .iter()
            .filter(|member| member.hard_link == HardLink::Primary)
            .count();
        if members.len() != expected_count
            || distinct_paths.len() != members.len()
            || primary_count != 1
            || members.iter().any(|member| {
                member.reported_hard_link_count != reported_hard_link_count
                    || member.physical_size != physical_size
                    || member.logical_size != logical_size
                    || member.charged_size
                        != if member.hard_link == HardLink::Primary {
                            physical_size
                        } else {
                            0
                        }
            })
        {
            continue;
        }

        let Some(current_primary) = members
            .iter()
            .find(|member| member.hard_link == HardLink::Primary)
            .cloned()
        else {
            continue;
        };
        members
            .sort_unstable_by(|left, right| compare_path_segments(&left.sort_key, &right.sort_key));
        let desired_primary = members[0].clone();

        if current_primary.indices != desired_primary.indices {
            if !can_transfer_hard_link_charge(
                root,
                &current_primary.indices,
                &desired_primary.indices,
                physical_size,
            ) {
                continue;
            }
            subtract_hard_link_charge(root, &current_primary.indices, physical_size);
            add_hard_link_charge(root, &desired_primary.indices, physical_size);
            mark_affected_directories(&mut affected_directories, &current_primary.indices);
            mark_affected_directories(&mut affected_directories, &desired_primary.indices);
        }

        for member in members.iter() {
            let is_primary = member.indices == desired_primary.indices;
            let Some(node) = compact_node_mut(root, &member.indices) else {
                continue;
            };
            node.size = if is_primary { physical_size } else { 0 };
            node.logical_size = (logical_size != node.size).then_some(logical_size);
            node.hard_link = Some(if is_primary {
                HardLink::Primary
            } else {
                HardLink::Secondary
            });
        }
    }

    if !affected_directories.is_empty() {
        sort_affected_directories(root, &mut Vec::new(), &affected_directories);
    }
}

fn mark_affected_directories(affected_directories: &mut HashSet<Vec<usize>>, indices: &[usize]) {
    for depth in 0..indices.len() {
        affected_directories.insert(indices[..depth].to_vec());
    }
}

fn sort_affected_directories(
    node: &mut CompactNode,
    indices: &mut Vec<usize>,
    affected_directories: &HashSet<Vec<usize>>,
) {
    for (index, child) in node.children.iter_mut().enumerate() {
        indices.push(index);
        sort_affected_directories(child, indices, affected_directories);
        indices.pop();
    }
    if affected_directories.contains(indices) {
        node.children.sort_unstable_by(|left, right| {
            right
                .size
                .cmp(&left.size)
                .then_with(|| compare_utf16(&left.name, &right.name))
        });
    }
}

fn collect_hard_link_candidates(
    node: &CompactNode,
    indices: &mut Vec<usize>,
    sort_key: &mut Vec<String>,
    groups: &mut HashMap<(u64, u64), Vec<HardLinkCandidate>>,
) {
    // `Other` is a visualization wrapper, not a pathname segment.
    let pushed_name = !node.is_other;
    if pushed_name {
        sort_key.push(node.name.clone());
    }
    if !node.is_dir {
        if let (
            Some(identity),
            Some(reported_hard_link_count),
            Some(physical_size),
            Some(hard_link),
        ) = (
            node.hard_link_identity,
            node.reported_hard_link_count,
            node.hard_link_physical_size,
            node.hard_link,
        ) {
            groups.entry(identity).or_default().push(HardLinkCandidate {
                indices: indices.clone(),
                sort_key: sort_key.clone(),
                reported_hard_link_count,
                physical_size,
                logical_size: node.logical_size.unwrap_or(node.size),
                charged_size: node.size,
                hard_link,
            });
        }
    }
    for (index, child) in node.children.iter().enumerate() {
        indices.push(index);
        collect_hard_link_candidates(child, indices, sort_key, groups);
        indices.pop();
    }
    if pushed_name {
        sort_key.pop();
    }
}

fn can_transfer_hard_link_charge(
    root: &CompactNode,
    source: &[usize],
    destination: &[usize],
    size: u64,
) -> bool {
    if root.size < size {
        return false;
    }
    let mut source_node = root;
    for index in source {
        source_node = &source_node.children[*index];
        if source_node.is_dir && source_node.size < size {
            return false;
        }
    }

    let mut destination_node = root;
    let mut shared_prefix = true;
    for (depth, index) in destination.iter().enumerate() {
        destination_node = &destination_node.children[*index];
        shared_prefix &= source.get(depth) == Some(index);
        if destination_node.is_dir
            && !shared_prefix
            && destination_node.size > u64::MAX.saturating_sub(size)
        {
            return false;
        }
    }
    true
}

fn subtract_hard_link_charge(root: &mut CompactNode, indices: &[usize], size: u64) {
    adjust_directory_size(root, -(size as i128));
    let mut current = root;
    for index in indices {
        current = &mut current.children[*index];
        if current.is_dir {
            adjust_directory_size(current, -(size as i128));
        }
    }
}

fn add_hard_link_charge(root: &mut CompactNode, indices: &[usize], size: u64) {
    adjust_directory_size(root, size as i128);
    let mut current = root;
    for index in indices {
        current = &mut current.children[*index];
        if current.is_dir {
            adjust_directory_size(current, size as i128);
        }
    }
}

fn adjust_directory_size(node: &mut CompactNode, delta: i128) {
    let logical_size = node.logical_size.unwrap_or(node.size);
    node.size = if delta < 0 {
        node.size - (-delta as u64)
    } else {
        node.size + delta as u64
    };
    node.logical_size = (logical_size != node.size).then_some(logical_size);
}

/// Charge a complete APFS full-clone data stream once for visualization only.
fn normalize_complete_clone_groups(root: &mut CompactNode) {
    let mut groups = HashMap::<String, CloneGroup>::new();
    collect_clone_candidates(root, &mut Vec::new(), &mut Vec::new(), &mut groups);

    for group in groups.values_mut() {
        if group.has_non_candidate_member {
            continue;
        }
        let members = &mut group.candidates;
        let Some(expected_count) = u32::try_from(members.len()).ok().filter(|count| *count > 1)
        else {
            continue;
        };
        let Some(first) = members.first() else {
            continue;
        };
        let distinct_paths = members
            .iter()
            .map(|member| member.indices.clone())
            .collect::<HashSet<_>>();
        if first.size == 0
            || distinct_paths.len() != members.len()
            || members.iter().any(|member| {
                member.reported_full_clone_count != expected_count
                    || member.size != first.size
                    || member.logical_size != first.logical_size
            })
            || members
                .iter()
                .skip(1)
                .any(|member| !can_subtract_clone_bytes(root, &member.indices, member.size))
        {
            continue;
        }

        members
            .sort_unstable_by(|left, right| compare_path_segments(&left.sort_key, &right.sort_key));
        let primary = &members[0];
        if let Some(node) = compact_node_mut(root, &primary.indices) {
            node.clone_accounting = Some(CloneAccounting::Primary);
        }

        for member in members.iter().skip(1) {
            let Some(node) = compact_node_mut(root, &member.indices) else {
                continue;
            };
            let logical_size = node.logical_size.unwrap_or(node.size);
            node.size = 0;
            node.logical_size = Some(logical_size);
            node.clone_accounting = Some(CloneAccounting::Secondary);
            subtract_clone_bytes(root, &member.indices, member.size);
        }
    }
}

fn collect_clone_candidates(
    node: &CompactNode,
    indices: &mut Vec<usize>,
    sort_key: &mut Vec<String>,
    groups: &mut HashMap<String, CloneGroup>,
) {
    let pushed_name = !node.is_other;
    if pushed_name {
        sort_key.push(node.name.clone());
    }
    if !node.is_dir {
        match node.clone_evidence.as_ref() {
            Some(CloneEvidence::SharesAllBlocks {
                clone_id: Some(clone_id),
                reported_full_clone_count: Some(reported_full_clone_count),
            }) if node.hard_link.is_none() && !clone_id.is_empty() => {
                groups
                    .entry(clone_id.clone())
                    .or_default()
                    .candidates
                    .push(CloneCandidate {
                        indices: indices.clone(),
                        sort_key: sort_key.clone(),
                        reported_full_clone_count: *reported_full_clone_count,
                        size: node.size,
                        logical_size: node.logical_size.unwrap_or(node.size),
                    });
            }
            Some(CloneEvidence::SharesAllBlocks {
                clone_id: Some(clone_id),
                ..
            })
            | Some(CloneEvidence::MayShareBlocks {
                clone_id: Some(clone_id),
            }) if !clone_id.is_empty() => {
                groups
                    .entry(clone_id.clone())
                    .or_default()
                    .has_non_candidate_member = true;
            }
            _ => {}
        }
    }
    for (index, child) in node.children.iter().enumerate() {
        indices.push(index);
        collect_clone_candidates(child, indices, sort_key, groups);
        indices.pop();
    }
    if pushed_name {
        sort_key.pop();
    }
}

fn compact_node_mut<'a>(
    node: &'a mut CompactNode,
    indices: &[usize],
) -> Option<&'a mut CompactNode> {
    let mut current = node;
    for index in indices {
        current = current.children.get_mut(*index)?;
    }
    Some(current)
}

fn can_subtract_clone_bytes(node: &CompactNode, indices: &[usize], size: u64) -> bool {
    if node.size < size {
        return false;
    }
    let mut current = node;
    for index in indices {
        current = &current.children[*index];
        if current.is_dir && current.size < size {
            return false;
        }
    }
    true
}

fn subtract_clone_bytes(root: &mut CompactNode, indices: &[usize], size: u64) {
    reduce_size_preserving_logical(root, size);
    let mut current = root;
    for index in indices {
        current = &mut current.children[*index];
        if current.is_dir {
            reduce_size_preserving_logical(current, size);
        }
    }
}

fn reduce_size_preserving_logical(node: &mut CompactNode, size: u64) {
    let logical_size = node.logical_size.unwrap_or(node.size);
    node.size -= size;
    node.logical_size = (logical_size != node.size).then_some(logical_size);
}

/// Add `delta` bytes along the retained branch that holds `path`, stopping at
/// the deepest materialized ancestor (or its `Other` aggregate). When the
/// file itself is materialized, its size and clone marker are set directly.
/// Returns false when the path is outside the tree or the charge cannot move
/// without underflow, in which case nothing changes.
pub(crate) fn adjust_path_charge(
    root: &mut CompactNode,
    root_path: &std::path::Path,
    path: &std::path::Path,
    delta: i128,
    leaf: Option<(CloneAccounting, u64)>,
) -> bool {
    let Ok(relative) = path.strip_prefix(root_path) else {
        return false;
    };
    let components: Vec<String> = relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .collect();
    // Validate first so a failed move never leaves a half-adjusted branch.
    {
        let mut node: &CompactNode = root;
        if (node.size as i128) + delta < 0 {
            return false;
        }
        for name in &components {
            let next = node
                .children
                .iter()
                .find(|child| !child.is_other && child.name == *name)
                .or_else(|| node.children.iter().find(|child| child.is_other));
            let Some(next) = next else { break };
            if (next.size as i128) + delta < 0 {
                return false;
            }
            if next.is_other {
                break;
            }
            node = next;
        }
    }
    let apply = |node: &mut CompactNode| {
        let logical = node.logical_size.unwrap_or(node.size);
        node.size = ((node.size as i128) + delta) as u64;
        node.logical_size = (logical != node.size).then_some(logical);
    };
    apply(root);
    let mut node = root;
    for (depth, name) in components.iter().enumerate() {
        let index = node
            .children
            .iter()
            .position(|child| !child.is_other && child.name == *name)
            .or_else(|| node.children.iter().position(|child| child.is_other));
        let Some(index) = index else { break };
        node = &mut node.children[index];
        apply(node);
        if node.is_other {
            break;
        }
        if depth + 1 == components.len() && !node.is_dir {
            if let Some((marker, logical_size)) = leaf {
                node.clone_accounting = Some(marker);
                node.logical_size = (logical_size != node.size).then_some(logical_size);
            }
        }
    }
    true
}

#[cfg(test)]
mod tests;
