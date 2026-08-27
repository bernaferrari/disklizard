//! Bounded visual-tree materialization.

use super::clone_metadata::compare_utf16;
use super::CompactNode;
use std::collections::HashSet;

const HIDDEN_SAMPLE_LIMIT: usize = 12;

pub(crate) struct RetainedDirectory {
    pub(crate) node: CompactNode,
    pub(crate) evidence_became_partial: bool,
}

pub(crate) struct ChildRetention {
    max_children: usize,
    top: Vec<CompactNode>,
    preserved: Vec<CompactNode>,
    hidden_sample: Vec<CompactNode>,
    hidden_count: usize,
    hidden_size: u64,
    hidden_logical_size: u64,
    hidden_modified_at: Option<u64>,
    hidden_has_shared_storage_risk: bool,
    omitted_has_shared_storage_risk: bool,
    total: u64,
    logical_size: u64,
    modified_at: Option<u64>,
    has_shared_storage_risk: bool,
}

impl ChildRetention {
    pub(crate) fn new(max_children: usize) -> Self {
        Self {
            max_children,
            top: Vec::with_capacity(max_children.saturating_add(1)),
            preserved: Vec::new(),
            hidden_sample: Vec::with_capacity(HIDDEN_SAMPLE_LIMIT + 1),
            hidden_count: 0,
            hidden_size: 0,
            hidden_logical_size: 0,
            hidden_modified_at: None,
            hidden_has_shared_storage_risk: false,
            omitted_has_shared_storage_risk: false,
            total: 0,
            logical_size: 0,
            modified_at: None,
            has_shared_storage_risk: false,
        }
    }

    pub(crate) fn push(&mut self, node: CompactNode, preserve_names: &HashSet<String>) {
        if node.size == 0
            && node.children.is_empty()
            && node.hard_link.is_none()
            && !node.has_shared_storage_risk
        {
            return;
        }
        self.total = self.total.saturating_add(node.size);
        self.logical_size = self
            .logical_size
            .saturating_add(node.logical_size.unwrap_or(node.size));
        self.modified_at = latest(self.modified_at, node.modified_at);
        self.has_shared_storage_risk |= node.has_shared_storage_risk;

        let Some(overflow) = insert_sorted(&mut self.top, node, self.max_children) else {
            return;
        };
        if contains_preserved(&overflow, preserve_names) {
            self.preserved.push(overflow);
        } else {
            self.push_hidden(overflow);
        }
    }

    pub(crate) fn finish(mut self, name: String) -> RetainedDirectory {
        self.preserved.sort_unstable_by(compare_nodes);
        self.top.extend(self.preserved);

        let evidence_became_partial = if self.hidden_size == 0 {
            self.hidden_has_shared_storage_risk
        } else {
            self.top.push(other_node(
                self.hidden_count,
                self.hidden_size,
                self.hidden_logical_size,
                self.hidden_modified_at,
                self.hidden_has_shared_storage_risk,
                self.hidden_sample,
            ));
            self.omitted_has_shared_storage_risk
        };

        let mut node = CompactNode::directory(
            name,
            self.total,
            self.logical_size,
            self.modified_at,
            self.top,
            false,
            None,
        );
        node.has_shared_storage_risk = self.has_shared_storage_risk;
        RetainedDirectory {
            node,
            evidence_became_partial,
        }
    }

    fn push_hidden(&mut self, node: CompactNode) {
        self.hidden_count += 1;
        self.hidden_size = self.hidden_size.saturating_add(node.size);
        self.hidden_logical_size = self
            .hidden_logical_size
            .saturating_add(node.logical_size.unwrap_or(node.size));
        self.hidden_modified_at = latest(self.hidden_modified_at, node.modified_at);
        self.hidden_has_shared_storage_risk |= node.has_shared_storage_risk;
        if let Some(omitted) = insert_sorted(&mut self.hidden_sample, node, HIDDEN_SAMPLE_LIMIT) {
            self.omitted_has_shared_storage_risk |= omitted.has_shared_storage_risk;
        }
    }
}

fn compare_nodes(left: &CompactNode, right: &CompactNode) -> std::cmp::Ordering {
    right
        .size
        .cmp(&left.size)
        .then_with(|| compare_utf16(&left.name, &right.name))
}

fn insert_sorted(
    nodes: &mut Vec<CompactNode>,
    node: CompactNode,
    limit: usize,
) -> Option<CompactNode> {
    let mut low = 0;
    let mut high = nodes.len();
    while low < high {
        let middle = (low + high) / 2;
        if compare_nodes(&node, &nodes[middle]).is_lt() {
            high = middle;
        } else {
            low = middle + 1;
        }
    }
    nodes.insert(low, node);
    (nodes.len() > limit).then(|| nodes.pop().expect("bounded child retention overflow"))
}

fn contains_preserved(node: &CompactNode, preserve_names: &HashSet<String>) -> bool {
    preserve_names.contains(&node.name.to_lowercase())
        || node
            .children
            .iter()
            .any(|child| contains_preserved(child, preserve_names))
}

fn other_node(
    count: usize,
    size: u64,
    logical_size: u64,
    modified_at: Option<u64>,
    has_shared_storage_risk: bool,
    children: Vec<CompactNode>,
) -> CompactNode {
    let mut node = CompactNode::directory(
        format!(
            "Other ({count} {})",
            if count == 1 { "item" } else { "items" }
        ),
        size,
        logical_size,
        modified_at,
        children,
        false,
        None,
    );
    node.is_other = true;
    node.other_count = Some(count);
    node.has_shared_storage_risk = has_shared_storage_risk;
    node
}

fn latest(left: Option<u64>, right: Option<u64>) -> Option<u64> {
    match (left, right) {
        (Some(left), Some(right)) => Some(left.max(right)),
        (Some(value), None) | (None, Some(value)) => Some(value),
        (None, None) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(name: &str, size: u64, logical_size: u64, risk: bool) -> CompactNode {
        CompactNode {
            name: name.into(),
            size,
            logical_size: (logical_size != size).then_some(logical_size),
            modified_at: None,
            hard_link: None,
            clone_evidence: None,
            clone_accounting: None,
            clone_metadata: None,
            shared_storage_evidence: None,
            developer_artifact_inventory: None,
            hard_link_identity: None,
            reported_hard_link_count: None,
            hard_link_physical_size: None,
            has_shared_storage_risk: risk,
            is_dir: false,
            children: Vec::new(),
            is_other: false,
            other_count: None,
            is_collapsed: false,
            signatures: None,
            scan_issues: None,
        }
    }

    #[test]
    fn materializes_top_k_preserved_ancestry_and_exact_totals() {
        let mut retention = ChildRetention::new(2);
        retention.push(file("large-a", 50, 60, false), &HashSet::new());
        retention.push(file("large-b", 40, 50, false), &HashSet::new());
        retention.push(file("large-c", 30, 30, false), &HashSet::new());

        let mut project = CompactNode::directory(
            "project".into(),
            1,
            2,
            None,
            vec![CompactNode::directory(
                "node_modules".into(),
                1,
                1,
                None,
                Vec::new(),
                false,
                None,
            )],
            false,
            None,
        );
        project.modified_at = Some(40);
        retention.push(project, &HashSet::from(["node_modules".into()]));

        let retained = retention.finish("root".into());

        assert!(!retained.evidence_became_partial);
        assert_eq!(retained.node.size, 121);
        assert_eq!(retained.node.logical_size, Some(142));
        assert_eq!(retained.node.modified_at, Some(40));
        assert_eq!(
            retained
                .node
                .children
                .iter()
                .map(|node| node.name.as_str())
                .collect::<Vec<_>>(),
            ["large-a", "large-b", "project", "Other (1 item)"]
        );
        assert_eq!(retained.node.children[3].size, 30);
    }

    #[test]
    fn bounds_other_samples_and_reports_omitted_sharing_evidence() {
        let mut retention = ChildRetention::new(1);
        retention.push(file("largest", 2, 2, false), &HashSet::new());
        for index in (0..13).rev() {
            retention.push(
                file(&format!("linked-{index:02}"), 1, 1, true),
                &HashSet::new(),
            );
        }

        let retained = retention.finish("root".into());
        let other = retained
            .node
            .children
            .iter()
            .find(|node| node.is_other)
            .expect("Other node");

        assert!(retained.evidence_became_partial);
        assert_eq!(other.name, "Other (13 items)");
        assert_eq!(other.other_count, Some(13));
        assert_eq!(other.children.len(), HIDDEN_SAMPLE_LIMIT);
        assert_eq!(other.children[0].name, "linked-00");
        assert_eq!(other.children[11].name, "linked-11");
    }
}
