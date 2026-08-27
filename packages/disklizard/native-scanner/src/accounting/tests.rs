use super::*;

fn full_clone_file(name: &str, size: u64, clone_id: &str, count: u32) -> CompactNode {
    CompactNode {
        name: name.into(),
        size,
        logical_size: None,
        modified_at: None,
        hard_link: None,
        clone_evidence: Some(CloneEvidence::SharesAllBlocks {
            clone_id: Some(clone_id.into()),
            reported_full_clone_count: Some(count),
        }),
        clone_accounting: None,
        clone_metadata: None,
        shared_storage_evidence: None,
        developer_artifact_inventory: None,
        hard_link_identity: None,
        reported_hard_link_count: None,
        hard_link_physical_size: None,
        has_shared_storage_risk: true,
        is_dir: false,
        children: Vec::new(),
        is_other: false,
        other_count: None,
        is_collapsed: false,
        signatures: None,
        scan_issues: None,
    }
}

fn hard_link_file(
    name: &str,
    charged_size: u64,
    physical_size: u64,
    logical_size: u64,
    identity: (u64, u64),
    reported_hard_link_count: u64,
    hard_link: HardLink,
) -> CompactNode {
    CompactNode {
        name: name.into(),
        size: charged_size,
        logical_size: (logical_size != charged_size).then_some(logical_size),
        modified_at: None,
        hard_link: Some(hard_link),
        clone_evidence: None,
        clone_accounting: None,
        clone_metadata: None,
        shared_storage_evidence: None,
        developer_artifact_inventory: None,
        hard_link_identity: Some(identity),
        reported_hard_link_count: Some(reported_hard_link_count),
        hard_link_physical_size: Some(physical_size),
        has_shared_storage_risk: true,
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
fn normalizes_only_a_proven_complete_hard_link_group() {
    let identity = (7, 9);
    let mut root = CompactNode::directory(
        "root".into(),
        100,
        200,
        None,
        vec![
            CompactNode::directory(
                "z".into(),
                100,
                100,
                None,
                vec![hard_link_file(
                    "z.bin",
                    100,
                    100,
                    100,
                    identity,
                    2,
                    HardLink::Primary,
                )],
                false,
                None,
            ),
            CompactNode::directory(
                "a".into(),
                0,
                100,
                None,
                vec![hard_link_file(
                    "a.bin",
                    0,
                    100,
                    100,
                    identity,
                    2,
                    HardLink::Secondary,
                )],
                false,
                None,
            ),
        ],
        false,
        None,
    );

    normalize_complete_groups(&mut root);

    assert_eq!(root.size, 100);
    assert_eq!(root.logical_size, Some(200));
    let a = root.children.iter().find(|node| node.name == "a").unwrap();
    let z = root.children.iter().find(|node| node.name == "z").unwrap();
    assert_eq!(z.size, 0);
    assert_eq!(z.logical_size, Some(100));
    assert_eq!(z.children[0].hard_link, Some(HardLink::Secondary));
    assert_eq!(z.children[0].size, 0);
    assert_eq!(z.children[0].logical_size, Some(100));
    assert_eq!(a.size, 100);
    assert!(a.logical_size.is_none());
    assert_eq!(a.children[0].hard_link, Some(HardLink::Primary));
    assert_eq!(a.children[0].size, 100);
    assert!(a.children[0].logical_size.is_none());
    // Scanner-only group metadata is never inflated into the compact IPC
    // protocol.
    assert!(serde_json::to_value(&root)
        .unwrap()
        .get("hard_link_identity")
        .is_none());
}

#[test]
fn ignores_synthetic_other_when_choosing_a_hard_link_primary() {
    let identity = (7, 10);
    let mut other = CompactNode::directory(
        "Other (1 item)".into(),
        100,
        100,
        None,
        vec![hard_link_file(
            "z.bin",
            100,
            100,
            100,
            identity,
            2,
            HardLink::Primary,
        )],
        false,
        None,
    );
    other.is_other = true;
    let mut root = CompactNode::directory(
        "root".into(),
        100,
        200,
        None,
        vec![
            hard_link_file("a.bin", 0, 100, 100, identity, 2, HardLink::Secondary),
            other,
        ],
        false,
        None,
    );

    normalize_complete_groups(&mut root);

    let a = root
        .children
        .iter()
        .find(|node| node.name == "a.bin")
        .unwrap();
    let other = root.children.iter().find(|node| node.is_other).unwrap();
    assert_eq!(a.hard_link, Some(HardLink::Primary));
    assert_eq!(a.size, 100);
    assert_eq!(other.children[0].hard_link, Some(HardLink::Secondary));
    assert_eq!(other.children[0].size, 0);
}

#[test]
fn matches_javascript_utf16_lexical_order_for_hard_link_primaries() {
    let identity = (7, 12);
    let mut root = CompactNode::directory(
        "root".into(),
        100,
        200,
        None,
        vec![
            hard_link_file(
                "\u{e000}.bin",
                100,
                100,
                100,
                identity,
                2,
                HardLink::Primary,
            ),
            hard_link_file("😀.bin", 0, 100, 100, identity, 2, HardLink::Secondary),
        ],
        false,
        None,
    );

    normalize_complete_groups(&mut root);

    assert_eq!(
        root.children
            .iter()
            .find(|node| node.name == "😀.bin")
            .and_then(|node| node.hard_link),
        Some(HardLink::Primary)
    );
}

#[test]
fn leaves_an_incomplete_hard_link_group_scheduling_accounting_unchanged() {
    let identity = (7, 11);
    let mut root = CompactNode::directory(
        "root".into(),
        100,
        200,
        None,
        vec![
            hard_link_file("first.bin", 100, 100, 100, identity, 3, HardLink::Primary),
            hard_link_file("second.bin", 0, 100, 100, identity, 3, HardLink::Secondary),
        ],
        false,
        None,
    );

    normalize_complete_groups(&mut root);

    assert_eq!(root.size, 100);
    assert_eq!(root.logical_size, Some(200));
    assert_eq!(root.children[0].hard_link, Some(HardLink::Primary));
    assert_eq!(root.children[0].size, 100);
    assert_eq!(root.children[1].hard_link, Some(HardLink::Secondary));
    assert_eq!(root.children[1].size, 0);
}

#[test]
fn deduplicates_only_a_proven_complete_full_clone_group() {
    let mut root = CompactNode::directory(
        "root".into(),
        300,
        300,
        None,
        vec![
            full_clone_file("z.bin", 100, "group", 3),
            full_clone_file("a.bin", 100, "group", 3),
            full_clone_file("m.bin", 100, "group", 3),
        ],
        false,
        None,
    );

    normalize_complete_groups(&mut root);

    assert_eq!(root.size, 100);
    assert_eq!(root.logical_size, Some(300));
    assert_eq!(root.children[0].size, 0);
    assert_eq!(root.children[0].logical_size, Some(100));
    assert_eq!(
        root.children[0].clone_accounting,
        Some(CloneAccounting::Secondary)
    );
    assert_eq!(root.children[1].size, 100);
    assert_eq!(
        root.children[1].clone_accounting,
        Some(CloneAccounting::Primary)
    );
    assert_eq!(root.children[2].size, 0);
    assert_eq!(root.children[2].logical_size, Some(100));
    assert_eq!(
        root.children[2].clone_accounting,
        Some(CloneAccounting::Secondary)
    );
}

#[test]
fn ignores_synthetic_other_when_choosing_a_clone_primary() {
    let mut other = CompactNode::directory(
        "Other (1 item)".into(),
        100,
        100,
        None,
        vec![full_clone_file("z.bin", 100, "group", 2)],
        false,
        None,
    );
    other.is_other = true;
    let mut root = CompactNode::directory(
        "root".into(),
        200,
        200,
        None,
        vec![full_clone_file("a.bin", 100, "group", 2), other],
        false,
        None,
    );

    normalize_complete_groups(&mut root);

    let a = root
        .children
        .iter()
        .find(|node| node.name == "a.bin")
        .unwrap();
    let other = root.children.iter().find(|node| node.is_other).unwrap();
    assert_eq!(a.clone_accounting, Some(CloneAccounting::Primary));
    assert_eq!(a.size, 100);
    assert_eq!(
        other.children[0].clone_accounting,
        Some(CloneAccounting::Secondary)
    );
    assert_eq!(other.children[0].size, 0);
}

#[test]
fn leaves_incomplete_or_mismatched_clone_groups_unchanged() {
    let mut root = CompactNode::directory(
        "root".into(),
        200,
        200,
        None,
        vec![
            full_clone_file("first.bin", 100, "partial", 3),
            full_clone_file("second.bin", 100, "partial", 3),
        ],
        false,
        None,
    );

    normalize_complete_groups(&mut root);

    assert_eq!(root.size, 200);
    assert!(root.logical_size.is_none());
    assert!(root.children.iter().all(|node| node.size == 100));
    assert!(root
        .children
        .iter()
        .all(|node| node.clone_accounting.is_none()));
}

#[test]
fn leaves_a_mismatched_reported_clone_count_unchanged() {
    let mut root = CompactNode::directory(
        "root".into(),
        200,
        200,
        None,
        vec![
            full_clone_file("first.bin", 100, "group", 2),
            full_clone_file("second.bin", 100, "group", 3),
        ],
        false,
        None,
    );

    normalize_complete_groups(&mut root);

    assert_eq!(root.size, 200);
    assert!(root.logical_size.is_none());
    assert!(root
        .children
        .iter()
        .all(|node| node.clone_accounting.is_none()));
}

#[test]
fn leaves_a_group_unchanged_when_any_observed_path_is_not_a_full_clone_candidate() {
    let mut partial = full_clone_file("partial.bin", 100, "group", 3);
    partial.clone_evidence = Some(CloneEvidence::MayShareBlocks {
        clone_id: Some("group".into()),
    });
    let mut root = CompactNode::directory(
        "root".into(),
        300,
        300,
        None,
        vec![
            full_clone_file("first.bin", 100, "group", 2),
            full_clone_file("second.bin", 100, "group", 2),
            partial,
        ],
        false,
        None,
    );

    normalize_complete_groups(&mut root);

    assert_eq!(root.size, 300);
    assert!(root.logical_size.is_none());
    assert!(root.children.iter().all(|node| node.size == 100));
    assert!(root
        .children
        .iter()
        .all(|node| node.clone_accounting.is_none()));
}

#[test]
fn leaves_an_empty_clone_id_unchanged() {
    let mut root = CompactNode::directory(
        "root".into(),
        200,
        200,
        None,
        vec![
            full_clone_file("first.bin", 100, "", 2),
            full_clone_file("second.bin", 100, "", 2),
        ],
        false,
        None,
    );

    normalize_complete_groups(&mut root);

    assert_eq!(root.size, 200);
    assert!(root.logical_size.is_none());
    assert!(root
        .children
        .iter()
        .all(|node| node.clone_accounting.is_none()));
}

#[test]
fn leaves_a_group_unchanged_when_a_hard_link_adds_an_observed_path() {
    let mut linked_path = full_clone_file("linked.bin", 0, "group", 2);
    linked_path.logical_size = Some(100);
    linked_path.hard_link = Some(HardLink::Secondary);
    let mut root = CompactNode::directory(
        "root".into(),
        200,
        300,
        None,
        vec![
            full_clone_file("first.bin", 100, "group", 2),
            full_clone_file("second.bin", 100, "group", 2),
            linked_path,
        ],
        false,
        None,
    );

    normalize_complete_groups(&mut root);

    assert_eq!(root.size, 200);
    assert_eq!(root.logical_size, Some(300));
    assert!(root
        .children
        .iter()
        .all(|node| node.clone_accounting.is_none()));
}
