fn main() {
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/WannaCut/lib/wannacut/libs");
    tauri_build::build()
}