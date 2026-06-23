use std::sync::atomic::{AtomicBool, Ordering};

static HOTKEY_CAPTURE_ACTIVE: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "macos")]
mod platform {
    use std::{
        ffi::c_void,
        ptr,
        sync::atomic::{AtomicBool, Ordering},
        thread,
    };

    use serde::Serialize;
    use tauri::{Emitter, Manager};
    use tauri_plugin_global_shortcut::ShortcutState;

    use crate::{commands, state::AppState};

    const CG_HID_EVENT_TAP: u32 = 0;
    const CG_HEAD_INSERT_EVENT_TAP: u32 = 0;
    const CG_EVENT_TAP_OPTION_LISTEN_ONLY: u32 = 1;
    const CG_EVENT_FLAGS_CHANGED: u32 = 12;
    const CG_EVENT_TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFF_FFFE;
    const CG_EVENT_TAP_DISABLED_BY_USER_INPUT: u32 = 0xFFFF_FFFF;
    const CG_KEYBOARD_EVENT_KEYCODE: u32 = 9;
    const CG_EVENT_FLAG_SECONDARY_FN: u64 = 0x0080_0000;
    const VK_FUNCTION: i64 = 0x3F;

    type CGEventTapCallback =
        unsafe extern "C" fn(*mut c_void, u32, *mut c_void, *mut c_void) -> *mut c_void;

    struct CallbackState {
        app: tauri::AppHandle,
        pressed: AtomicBool,
    }

    #[derive(Clone, Serialize)]
    struct CapturedHotkey {
        hotkey: String,
    }

    pub fn start(app: &tauri::AppHandle) {
        let app = app.clone();
        let _ = thread::Builder::new()
            .name("fn-globe-hotkey".to_string())
            .spawn(move || run_event_tap(app));
    }

    fn run_event_tap(app: tauri::AppHandle) {
        let callback_state = Box::into_raw(Box::new(CallbackState {
            app,
            pressed: AtomicBool::new(false),
        }));

        unsafe {
            let event_mask = 1_u64 << CG_EVENT_FLAGS_CHANGED;
            let tap = CGEventTapCreate(
                CG_HID_EVENT_TAP,
                CG_HEAD_INSERT_EVENT_TAP,
                CG_EVENT_TAP_OPTION_LISTEN_ONLY,
                event_mask,
                Some(callback),
                callback_state.cast(),
            );

            if tap.is_null() {
                drop(Box::from_raw(callback_state));
                eprintln!(
                    "Fn/Globe hotkey unavailable. Enable Accessibility/Input Monitoring permissions, then restart Mim TTS."
                );
                return;
            }

            let source = CFMachPortCreateRunLoopSource(ptr::null(), tap, 0);
            if source.is_null() {
                CFRelease(tap.cast());
                drop(Box::from_raw(callback_state));
                eprintln!(
                    "Fn/Globe hotkey unavailable. Could not create event tap run loop source."
                );
                return;
            }

            let run_loop = CFRunLoopGetCurrent();
            CFRunLoopAddSource(run_loop, source, kCFRunLoopCommonModes);
            CGEventTapEnable(tap, true);
            CFRunLoopRun();

            CFRelease(source.cast());
            CFRelease(tap.cast());
            drop(Box::from_raw(callback_state));
        }
    }

    unsafe extern "C" fn callback(
        _proxy: *mut c_void,
        event_type: u32,
        event: *mut c_void,
        user_info: *mut c_void,
    ) -> *mut c_void {
        if matches!(
            event_type,
            CG_EVENT_TAP_DISABLED_BY_TIMEOUT | CG_EVENT_TAP_DISABLED_BY_USER_INPUT
        ) {
            return event;
        }

        if event_type != CG_EVENT_FLAGS_CHANGED || event.is_null() || user_info.is_null() {
            return event;
        }

        let state = unsafe { &*(user_info.cast::<CallbackState>()) };
        let flags = unsafe { CGEventGetFlags(event) };
        let key_code = unsafe { CGEventGetIntegerValueField(event, CG_KEYBOARD_EVENT_KEYCODE) };
        let down = flags & CG_EVENT_FLAG_SECONDARY_FN != 0;
        let was_down = state.pressed.load(Ordering::SeqCst);
        let relevant = key_code == VK_FUNCTION || down || was_down;

        if super::is_capturing() {
            if relevant {
                state.pressed.store(down, Ordering::SeqCst);
            }
            if relevant && down && !was_down {
                super::finish_capture();
                let _ = state.app.emit(
                    "hotkey-captured",
                    CapturedHotkey {
                        hotkey: "Fn".to_string(),
                    },
                );
            }
            return event;
        }

        if !is_fn_hotkey_enabled(&state.app) {
            state.pressed.store(false, Ordering::SeqCst);
            return event;
        }

        if relevant && down != was_down {
            state.pressed.store(down, Ordering::SeqCst);
            let shortcut_state = if down {
                ShortcutState::Pressed
            } else {
                ShortcutState::Released
            };
            commands::handle_shortcut(state.app.clone(), shortcut_state);
        }

        event
    }

    fn is_fn_hotkey_enabled(app: &tauri::AppHandle) -> bool {
        app.try_state::<AppState>()
            .and_then(|state| {
                state
                    .settings
                    .lock()
                    .ok()
                    .map(|settings| super::is_fn_hotkey(&settings.hotkey))
            })
            .unwrap_or(false)
    }

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn CGEventTapCreate(
            tap: u32,
            place: u32,
            options: u32,
            events_of_interest: u64,
            callback: Option<CGEventTapCallback>,
            user_info: *mut c_void,
        ) -> *mut c_void;
        fn CGEventTapEnable(tap: *mut c_void, enable: bool);
        fn CGEventGetFlags(event: *mut c_void) -> u64;
        fn CGEventGetIntegerValueField(event: *mut c_void, field: u32) -> i64;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        static kCFRunLoopCommonModes: *const c_void;

        fn CFRunLoopGetCurrent() -> *mut c_void;
        fn CFRunLoopAddSource(rl: *mut c_void, source: *mut c_void, mode: *const c_void);
        fn CFRunLoopRun();
        fn CFMachPortCreateRunLoopSource(
            allocator: *const c_void,
            port: *mut c_void,
            order: isize,
        ) -> *mut c_void;
        fn CFRelease(cf: *const c_void);
    }
}

#[cfg(target_os = "macos")]
pub use platform::start;

#[cfg(not(target_os = "macos"))]
pub fn start(_app: &tauri::AppHandle) {}

pub fn is_fn_hotkey(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "fn" | "globe" | "function"
    )
}

pub fn normalize_fn_hotkey(value: &str) -> Option<String> {
    if is_fn_hotkey(value) {
        Some("Fn".to_string())
    } else {
        None
    }
}

pub fn begin_capture() {
    HOTKEY_CAPTURE_ACTIVE.store(true, Ordering::SeqCst);
}

pub fn cancel_capture() {
    HOTKEY_CAPTURE_ACTIVE.store(false, Ordering::SeqCst);
}

pub fn finish_capture() {
    HOTKEY_CAPTURE_ACTIVE.store(false, Ordering::SeqCst);
}

pub fn is_capturing() -> bool {
    HOTKEY_CAPTURE_ACTIVE.load(Ordering::SeqCst)
}
