use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::webview::WebviewWindowBuilder;
use tauri::{Manager, WebviewUrl};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// Holds sidecar processes — killed automatically when dropped (app exit)
struct Sidecars(Mutex<Vec<Child>>);

impl Drop for Sidecars {
    fn drop(&mut self) {
        if let Ok(mut procs) = self.0.lock() {
            for child in procs.iter_mut() {
                let _ = child.kill();
            }
        }
    }
}

// Cross-platform helper: spawn a command with no console window on Windows.
fn spawn_hidden(cmd: &mut Command) -> std::io::Result<Child> {
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW).spawn()
    }
    #[cfg(not(target_os = "windows"))]
    {
        cmd.spawn()
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Resolve NESTdesktop/ dir relative to the exe.
            // exe lives at NESTdesktop/src-tauri/target/release/<name>.exe
            let exe_path = std::env::current_exe()?;
            let nestdesktop_dir = exe_path
                .parent().unwrap()  // release/
                .parent().unwrap()  // target/
                .parent().unwrap()  // src-tauri/
                .parent().unwrap(); // NESTdesktop/

            println!("NESTdesktop starting...");

            let mut children: Vec<Child> = Vec::new();

            // Start the local agent (dashboard + PC tools sidecar).
            let mut agent_cmd = Command::new("node");
            agent_cmd
                .arg("local-agent.js")
                .current_dir(nestdesktop_dir);
            match spawn_hidden(&mut agent_cmd) {
                Ok(child) => {
                    println!("   ✓ Local agent started (PID {})", child.id());
                    children.push(child);
                }
                Err(e) => {
                    println!("   ⚠ Local agent: {} — may already be running", e);
                }
            }

            // Optional: auto-start a Cloudflare Tunnel if the user configured one.
            // Set NESTDESKTOP_TUNNEL_NAME at build time (e.g. via .cargo/config.toml
            // [env] section, or `NESTDESKTOP_TUNNEL_NAME=mytunnel cargo tauri build`)
            // to your tunnel's name. Skipped silently if not set.
            if let Some(tunnel_name) = option_env!("NESTDESKTOP_TUNNEL_NAME") {
                let mut tunnel_cmd = Command::new("cloudflared");
                tunnel_cmd.args(["tunnel", "run", tunnel_name]);
                match spawn_hidden(&mut tunnel_cmd) {
                    Ok(child) => {
                        println!("   ✓ Tunnel '{}' started (PID {})", tunnel_name, child.id());
                        children.push(child);
                    }
                    Err(e) => {
                        println!("   ⚠ Tunnel: {} — cloudflared may not be installed", e);
                    }
                }
            }

            // Register sidecars for cleanup on app exit.
            app.manage(Sidecars(Mutex::new(children)));

            // Give the local agent a moment to bind ports before opening the window.
            std::thread::sleep(std::time::Duration::from_millis(1500));

            // Open the main window pointed at the local agent.
            let url = WebviewUrl::External("http://localhost:3456".parse().unwrap());
            WebviewWindowBuilder::new(app, "main", url)
                .title("NESTdesktop")
                .inner_size(1600.0, 1000.0)
                .min_inner_size(900.0, 600.0)
                .theme(Some(tauri::Theme::Dark))
                .build()?;

            println!("   Dashboard: http://localhost:3456");
            println!("   PC Agent:  http://localhost:3457");
            println!("   Ready.");

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running NESTdesktop");
}
