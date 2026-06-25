use std::sync::atomic::{AtomicBool, Ordering};

static DID_MUTE: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "macos")]
extern "C" {
    fn mim_get_system_mute() -> i32;
    fn mim_set_system_mute(mute: i32) -> i32;
}

pub fn mute_if_needed(should_mute: bool) {
    if !should_mute {
        return;
    }

    #[cfg(target_os = "macos")]
    {
        let already_muted = unsafe { mim_get_system_mute() };
        if already_muted == 0 {
            unsafe { mim_set_system_mute(1) };
            DID_MUTE.store(true, Ordering::Relaxed);
        }
    }
}

pub fn restore() {
    if DID_MUTE.swap(false, Ordering::Relaxed) {
        #[cfg(target_os = "macos")]
        unsafe {
            mim_set_system_mute(0);
        }
    }
}
