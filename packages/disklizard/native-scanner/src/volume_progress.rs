/// A mounted volume supplies an object count without another filesystem walk.
/// Arbitrary directories have no such count and must use the traversal fallback.
pub fn expected_objects(path: &std::path::Path) -> Option<u64> {
    #[cfg(target_os = "macos")]
    {
        let (source, mut total) = mounted_objects(path)?;
        if path == std::path::Path::new("/") {
            // The startup namespace traverses Data through firmlinks. Count
            // its objects once even though its duplicate mount is excluded.
            if let Some((data_source, data_total)) =
                mounted_objects(std::path::Path::new("/System/Volumes/Data"))
            {
                if data_source != source {
                    total = total.checked_add(data_total)?;
                }
            }
        }
        (total > 0).then_some(total)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        None
    }
}

#[cfg(target_os = "macos")]
fn mounted_objects(path: &std::path::Path) -> Option<(Vec<u8>, u64)> {
    use std::{
        ffi::{CStr, CString},
        os::unix::ffi::OsStrExt,
    };
    let canonical = std::fs::canonicalize(path).ok()?;
    let name = CString::new(canonical.as_os_str().as_bytes()).ok()?;
    let mut info = std::mem::MaybeUninit::<libc::statfs>::uninit();
    if unsafe { libc::statfs(name.as_ptr(), info.as_mut_ptr()) } != 0 {
        return None;
    }
    let info = unsafe { info.assume_init() };
    let filesystem = unsafe { CStr::from_ptr(info.f_fstypename.as_ptr()) };
    if filesystem.to_bytes() != b"apfs" && filesystem.to_bytes() != b"hfs" {
        return None;
    }
    let mount = unsafe { CStr::from_ptr(info.f_mntonname.as_ptr()) };
    if mount.to_bytes() != canonical.as_os_str().as_bytes() {
        return None;
    }
    let objects = info.f_files.checked_sub(info.f_ffree)?;
    // st_dev is synthesized across startup firmlinks; use the mount source.
    Some((
        unsafe { CStr::from_ptr(info.f_mntfromname.as_ptr()) }
            .to_bytes()
            .to_vec(),
        objects,
    ))
}

pub fn percent(completed: u64, expected: u64) -> f64 {
    // Concurrent filesystem changes can outgrow the initial inventory. Only
    // the scanner's explicit done event is allowed to report completion.
    (completed as f64 / expected.max(1) as f64 * 100.0).min(99.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tiny_root_branches_do_not_complete_half_a_volume() {
        assert!(percent(39 + 12, 13_000_000) < 0.001);
        assert!((percent(6_500_000, 13_000_000) - 50.0).abs() < 0.001);
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn startup_count_includes_data_even_when_stat_devices_match() {
        if let Some((_, data)) = mounted_objects(std::path::Path::new("/System/Volumes/Data")) {
            let startup = expected_objects(std::path::Path::new("/")).unwrap();
            assert!(startup as f64 >= data as f64 * 0.9);
        }
    }
    #[test]
    fn growth_cannot_claim_completion() {
        assert_eq!(percent(150, 100), 99.0);
        assert_eq!(percent(0, 100), 0.0);
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn only_mount_roots_receive_volume_estimates() {
        let temp = tempfile::tempdir().unwrap();
        assert_eq!(expected_objects(temp.path()), None);
        assert!(expected_objects(std::path::Path::new("/")).unwrap() > 0);
    }
}
