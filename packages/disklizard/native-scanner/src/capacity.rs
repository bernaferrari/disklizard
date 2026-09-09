//! Read-only macOS capacity estimate, including storage the OS can reclaim.
#[cfg(target_os = "macos")]
pub fn available(path: &str) -> Option<i64> {
    use std::ffi::c_void;
    type Ref = *const c_void;
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        static kCFURLVolumeAvailableCapacityForImportantUsageKey: Ref;
        fn CFURLCreateFromFileSystemRepresentation(
            allocator: Ref,
            bytes: *const u8,
            len: isize,
            directory: u8,
        ) -> Ref;
        fn CFURLCopyResourcePropertyForKey(
            url: Ref,
            key: Ref,
            value: *mut Ref,
            error: *mut Ref,
        ) -> u8;
        fn CFNumberGetValue(number: Ref, kind: isize, value: *mut i64) -> u8;
        fn CFGetTypeID(value: Ref) -> usize;
        fn CFNumberGetTypeID() -> usize;
        fn CFRelease(value: Ref);
    }
    unsafe {
        let url = CFURLCreateFromFileSystemRepresentation(
            std::ptr::null(),
            path.as_ptr(),
            path.len() as isize,
            1,
        );
        if url.is_null() {
            return None;
        }
        let mut value = std::ptr::null();
        let ok = CFURLCopyResourcePropertyForKey(
            url,
            kCFURLVolumeAvailableCapacityForImportantUsageKey,
            &mut value,
            std::ptr::null_mut(),
        );
        CFRelease(url);
        if value.is_null() {
            return None;
        }
        let mut bytes = -1;
        // kCFNumberSInt64Type = 4. Verify the dynamic type before conversion.
        let converted = ok != 0
            && CFGetTypeID(value) == CFNumberGetTypeID()
            && CFNumberGetValue(value, 4, &mut bytes) != 0;
        CFRelease(value);
        (converted && bytes >= 0).then_some(bytes)
    }
}
#[cfg(not(target_os = "macos"))]
pub fn available(_path: &str) -> Option<i64> {
    None
}
