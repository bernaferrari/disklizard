//! Global bound on the materialized visual tree.
//!
//! Per-directory retention keeps each level readable, but depth multiplies
//! it: a home folder full of checkouts can retain millions of nodes, which
//! overflows the protocol line and makes the renderer slow. This pass keeps
//! the largest nodes across the whole tree, folds the rest into the existing
//! `Other` aggregates, and marks fully-trimmed folders collapsed so the app
//! rescans them on demand. Byte totals never change.

use super::retention::other_node;
use super::CompactNode;
use std::collections::{BinaryHeap, HashSet};

/// Roughly 20 MB of compact JSON; comfortably under the protocol line cap.
pub(crate) const DEFAULT_MAX_NODES: usize = 150_000;

fn count_nodes(node: &CompactNode) -> usize {
    1 + node.children.iter().map(count_nodes).sum::<usize>()
}

fn expandable(node: &CompactNode) -> bool {
    node.is_dir && !node.is_other && !node.children.is_empty()
}

/// Returns whether trimming hid nodes that carried shared-storage risk.
pub(crate) fn prune_to_budget(root: &mut CompactNode, budget: usize) -> bool {
    if count_nodes(root) <= budget.max(1) {
        return false;
    }
    let mut keep = HashSet::<Vec<u32>>::new();
    let mut frontier = BinaryHeap::<(u64, Vec<u32>)>::new();
    let push_children = |frontier: &mut BinaryHeap<(u64, Vec<u32>)>, node: &CompactNode, path: &[u32]| {
        if expandable(node) {
            for (index, child) in node.children.iter().enumerate() {
                let mut child_path = path.to_vec();
                child_path.push(index as u32);
                frontier.push((child.size, child_path));
            }
        }
    };
    push_children(&mut frontier, root, &[]);
    let mut kept = 1;
    while kept < budget {
        let Some((_, path)) = frontier.pop() else { break };
        let mut node = &*root;
        for index in &path {
            node = &node.children[*index as usize];
        }
        push_children(&mut frontier, node, &path);
        keep.insert(path);
        kept += 1;
    }
    let mut hidden_risk = false;
    apply(root, &mut Vec::new(), &keep, &mut hidden_risk);
    hidden_risk
}

fn apply(node: &mut CompactNode, path: &mut Vec<u32>, keep: &HashSet<Vec<u32>>, hidden_risk: &mut bool) {
    if !expandable(node) {
        return;
    }
    let children = std::mem::take(&mut node.children);
    let mut retained = Vec::with_capacity(children.len());
    let mut dropped = Vec::new();
    for (index, child) in children.into_iter().enumerate() {
        path.push(index as u32);
        if keep.contains(path.as_slice()) {
            retained.push((index as u32, child));
        } else {
            dropped.push(child);
        }
        path.pop();
    }
    if retained.is_empty() {
        // Nothing below earned a place: open this folder with a focused rescan.
        *hidden_risk |= node.has_shared_storage_risk;
        node.is_collapsed = true;
        return;
    }
    if !dropped.is_empty() {
        let mut count = 0usize;
        let mut size = 0u64;
        let mut logical_size = 0u64;
        let mut modified_at: Option<u64> = None;
        let mut risk = false;
        for child in &dropped {
            count += if child.is_other { child.other_count.unwrap_or(1) } else { 1 };
            size += child.size;
            logical_size += child.logical_size.unwrap_or(child.size);
            modified_at = match (modified_at, child.modified_at) {
                (Some(left), Some(right)) => Some(left.max(right)),
                (left, right) => left.or(right),
            };
            risk |= child.has_shared_storage_risk;
        }
        *hidden_risk |= risk;
        let mut rebuilt = Vec::with_capacity(retained.len() + 1);
        for (index, mut child) in retained {
            path.push(index);
            apply(&mut child, path, keep, hidden_risk);
            path.pop();
            rebuilt.push(child);
        }
        // A directory has at most one `Other`; fold the trimmed tail into it.
        if let Some(other) = rebuilt.iter_mut().find(|child| child.is_other) {
            let merged_logical = other.logical_size.unwrap_or(other.size) + logical_size;
            other.size += size;
            other.logical_size = (merged_logical != other.size).then_some(merged_logical);
            other.other_count = Some(other.other_count.unwrap_or(0) + count);
            other.name = format!("Other ({} items)", other.other_count.unwrap_or(count));
            other.modified_at = match (other.modified_at, modified_at) {
                (Some(left), Some(right)) => Some(left.max(right)),
                (left, right) => left.or(right),
            };
            other.has_shared_storage_risk |= risk;
        } else {
            rebuilt.push(other_node(count, size, logical_size, modified_at, risk, Vec::new()));
        }
        node.children = rebuilt;
        return;
    }
    let mut rebuilt = Vec::with_capacity(retained.len());
    for (index, mut child) in retained {
        path.push(index);
        apply(&mut child, path, keep, hidden_risk);
        path.pop();
        rebuilt.push(child);
    }
    node.children = rebuilt;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn leaf(name: &str, size: u64) -> CompactNode {
        let mut node = CompactNode::directory(name.into(), size, size, None, Vec::new(), false, None);
        node.is_dir = false;
        node
    }

    fn dir(name: &str, children: Vec<CompactNode>) -> CompactNode {
        let size = children.iter().map(|child| child.size).sum();
        CompactNode::directory(name.into(), size, size, None, children, false, None)
    }

    #[test]
    fn leaves_small_trees_untouched() {
        let mut root = dir("root", vec![leaf("a", 1), leaf("b", 2)]);
        assert!(!prune_to_budget(&mut root, 10));
        assert_eq!(root.children.len(), 2);
    }

    #[test]
    fn keeps_the_largest_nodes_and_preserves_totals() {
        let deep = dir("deep", (0..20).map(|index| leaf(&format!("f{index}"), 1)).collect());
        let big = dir("big", vec![leaf("x", 500), leaf("y", 400)]);
        let mut root = dir("root", vec![big, deep, leaf("tiny", 1)]);
        let before = root.size;
        prune_to_budget(&mut root, 6);
        assert_eq!(root.size, before);
        assert_eq!(
            root.children.iter().map(|child| child.size).sum::<u64>(),
            before
        );
        let big = root.children.iter().find(|child| child.name == "big").unwrap();
        assert_eq!(big.children.len(), 2);
        let deep = root.children.iter().find(|child| child.name == "deep");
        match deep {
            Some(deep) => assert!(deep.is_collapsed && deep.children.is_empty()),
            None => {
                let other = root.children.iter().find(|child| child.is_other).unwrap();
                assert!(other.size >= 20);
            }
        }
        assert!(count_nodes(&root) <= 8);
    }
}
