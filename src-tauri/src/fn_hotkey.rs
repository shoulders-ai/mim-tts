use std::sync::atomic::{AtomicBool, Ordering};

static HOTKEY_CAPTURE_ACTIVE: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "macos")]
mod platform {
    use std::{
        ffi::c_void,
        ptr,
        sync::atomic::{AtomicBool, Ordering},
        thread,
        time::Duration,
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
    const CG_EVENT_FLAG_ALTERNATE: u64 = 0x0008_0000;
    const VK_FUNCTION: i64 = 0x3F;
    const VK_OPTION_LEFT: i64 = 0x3A;
    const VK_OPTION_RIGHT: i64 = 0x3D;

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
            .name("modifier-hotkey".to_string())
            .spawn(move || loop {
                if !super::is_capturing() && configured_modifier(&app).is_none() {
                    thread::sleep(Duration::from_secs(1));
                    continue;
                }

                if !run_event_tap(app.clone()) {
                    thread::sleep(Duration::from_secs(2));
                }
            });
    }

    fn run_event_tap(app: tauri::AppHandle) -> bool {
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
                eprintln!("Modifier hotkey unavailable. Enable Accessibility/Input Monitoring permissions.");
                return false;
            }

            let source = CFMachPortCreateRunLoopSource(ptr::null(), tap, 0);
            if source.is_null() {
                CFRelease(tap.cast());
                drop(Box::from_raw(callback_state));
                eprintln!(
                    "Modifier hotkey unavailable. Could not create event tap run loop source."
                );
                return false;
            }

            let run_loop = CFRunLoopGetCurrent();
            CFRunLoopAddSource(run_loop, source, kCFRunLoopCommonModes);
            CGEventTapEnable(tap, true);
            CFRunLoopRun();

            CFRelease(source.cast());
            CFRelease(tap.cast());
            drop(Box::from_raw(callback_state));
        }
        true
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

        if super::is_capturing() {
            let Some(modifier) = modifier_from_event(flags, key_code) else {
                return event;
            };
            let down = modifier.is_down(flags);
            let was_down = state.pressed.load(Ordering::SeqCst);
            let relevant = modifier.matches_key_code(key_code) || down || was_down;
            if relevant {
                state.pressed.store(down, Ordering::SeqCst);
            }
            if relevant && down && !was_down {
                super::finish_capture();
                let _ = state.app.emit(
                    "hotkey-captured",
                    CapturedHotkey {
                        hotkey: modifier.label().to_string(),
                    },
                );
            }
            return event;
        }

        let Some(modifier) = configured_modifier(&state.app) else {
            state.pressed.store(false, Ordering::SeqCst);
            return event;
        };

        let down = modifier.is_down(flags);
        let was_down = state.pressed.load(Ordering::SeqCst);
        let relevant = modifier.matches_key_code(key_code) || down || was_down;
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

    #[derive(Debug, Clone, Copy)]
    enum ModifierHotkey {
        Fn,
        Option,
    }

    impl ModifierHotkey {
        fn label(self) -> &'static str {
            match self {
                Self::Fn => "Fn",
                Self::Option => "Option",
            }
        }

        fn flag(self) -> u64 {
            match self {
                Self::Fn => CG_EVENT_FLAG_SECONDARY_FN,
                Self::Option => CG_EVENT_FLAG_ALTERNATE,
            }
        }

        fn is_down(self, flags: u64) -> bool {
            flags & self.flag() != 0
        }

        fn matches_key_code(self, key_code: i64) -> bool {
            match self {
                Self::Fn => key_code == VK_FUNCTION,
                Self::Option => matches!(key_code, VK_OPTION_LEFT | VK_OPTION_RIGHT),
            }
        }
    }

    fn modifier_from_event(flags: u64, key_code: i64) -> Option<ModifierHotkey> {
        if key_code == VK_FUNCTION || flags & CG_EVENT_FLAG_SECONDARY_FN != 0 {
            Some(ModifierHotkey::Fn)
        } else if matches!(key_code, VK_OPTION_LEFT | VK_OPTION_RIGHT)
            || flags & CG_EVENT_FLAG_ALTERNATE != 0
        {
            Some(ModifierHotkey::Option)
        } else {
            None
        }
    }

    fn configured_modifier(app: &tauri::AppHandle) -> Option<ModifierHotkey> {
        app.try_state::<AppState>().and_then(|state| {
            state
                .settings
                .lock()
                .ok()
                .and_then(|settings| modifier_from_setting(&settings.hotkey))
        })
    }

    fn modifier_from_setting(value: &str) -> Option<ModifierHotkey> {
        match super::normalize_modifier_hotkey(value)?.as_str() {
            "Fn" => Some(ModifierHotkey::Fn),
            "Option" => Some(ModifierHotkey::Option),
            _ => None,
        }
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

pub fn is_modifier_hotkey(value: &str) -> bool {
    normalize_modifier_hotkey(value).is_some()
}

pub fn normalize_modifier_hotkey(value: &str) -> Option<String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "fn" | "globe" | "function" => Some("Fn".to_string()),
        "option" | "alt" => Some("Option".to_string()),
        _ => None,
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
