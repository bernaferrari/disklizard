//! Clone-evidence representation and stable ordering primitives.

use super::CloneEvidence;
#[cfg(any(target_os = "macos", test))]
use super::CloneUnavailableReason;

/// APFS extended attributes are only requested by the macOS bulk reader.
/// Tests on every platform exercise the same decoder, so gate to both.
#[cfg(any(target_os = "macos", test))]
pub(crate) const ATTR_CMNEXT_CLONE_ID: u32 = 0x0000_0100;
#[cfg(any(target_os = "macos", test))]
pub(crate) const ATTR_CMNEXT_EXT_FLAGS: u32 = 0x0000_0200;
#[cfg(any(target_os = "macos", test))]
pub(crate) const ATTR_CMNEXT_CLONE_REFCNT: u32 = 0x0000_1000;
#[cfg(any(target_os = "macos", test))]
pub(crate) const EF_MAY_SHARE_BLOCKS: u64 = 0x0000_0001;
#[cfg(any(target_os = "macos", test))]
pub(crate) const EF_SHARES_ALL_BLOCKS: u64 = 0x0000_0040;

/// Omit inert per-file states from the compact protocol. Absence means no
/// assertion; it never means a file is proven not to share storage.
pub(crate) fn emitted_evidence(evidence: &CloneEvidence) -> Option<CloneEvidence> {
    match evidence {
        CloneEvidence::Unavailable { .. } | CloneEvidence::NotShared => None,
        CloneEvidence::Unknown
        | CloneEvidence::MayShareBlocks { .. }
        | CloneEvidence::SharesAllBlocks { .. } => Some(evidence.clone()),
    }
}

/// JavaScript orders strings by UTF-16 code units. The native scanner uses
/// this ordering so accounting primaries match the TypeScript fallback.
pub(crate) fn compare_utf16(left: &str, right: &str) -> std::cmp::Ordering {
    let mut left_units = left.encode_utf16();
    let mut right_units = right.encode_utf16();
    loop {
        match (left_units.next(), right_units.next()) {
            (Some(left), Some(right)) => {
                let ordering = left.cmp(&right);
                if ordering != std::cmp::Ordering::Equal {
                    return ordering;
                }
            }
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (Some(_), None) => return std::cmp::Ordering::Greater,
            (None, None) => return std::cmp::Ordering::Equal,
        }
    }
}

pub(crate) fn compare_path_segments(left: &[String], right: &[String]) -> std::cmp::Ordering {
    for (left, right) in left.iter().zip(right) {
        let ordering = compare_utf16(left, right);
        if ordering != std::cmp::Ordering::Equal {
            return ordering;
        }
    }
    left.len().cmp(&right.len())
}

#[cfg(any(target_os = "macos", test))]
pub(crate) fn evidence_from_attributes(
    returned_attributes: u32,
    clone_id: u64,
    extended_flags: u64,
    full_clone_count: u32,
) -> CloneEvidence {
    if returned_attributes & ATTR_CMNEXT_EXT_FLAGS == 0 {
        if returned_attributes & (ATTR_CMNEXT_CLONE_ID | ATTR_CMNEXT_CLONE_REFCNT) != 0 {
            return CloneEvidence::Unknown;
        }
        return CloneEvidence::Unavailable {
            reason: CloneUnavailableReason::Filesystem,
        };
    }

    let clone_id = (returned_attributes & ATTR_CMNEXT_CLONE_ID != 0 && clone_id > 0)
        .then(|| clone_id.to_string());
    if extended_flags & EF_SHARES_ALL_BLOCKS != 0 {
        return CloneEvidence::SharesAllBlocks {
            clone_id,
            reported_full_clone_count: (returned_attributes & ATTR_CMNEXT_CLONE_REFCNT != 0
                && full_clone_count > 0)
                .then_some(full_clone_count),
        };
    }
    if extended_flags & EF_MAY_SHARE_BLOCKS != 0 {
        return CloneEvidence::MayShareBlocks { clone_id };
    }
    CloneEvidence::NotShared
}
