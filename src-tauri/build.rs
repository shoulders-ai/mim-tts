fn main() {
    tauri_build::build();

    #[cfg(target_os = "macos")]
    {
        cc::Build::new()
            .file("src/permissions_bridge.m")
            .flag("-fobjc-arc")
            .compile("permissions_bridge");
        println!("cargo:rustc-link-lib=framework=AVFoundation");
        println!("cargo:rustc-link-lib=framework=ApplicationServices");
        println!("cargo:rustc-link-lib=framework=CoreAudio");
    }
}
