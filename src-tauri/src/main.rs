#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod session;
mod updater;

use std::sync::Mutex;

use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const DEFAULT_TRAY_ICON: &[u8] = include_bytes!("../tray.png");

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn update_tray(app: AppHandle, tooltip: String) -> Result<(), String> {
    app.tray_by_id("quotes")
        .ok_or("托盘尚未初始化")?
        .set_tooltip(Some(tooltip))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_tray_icon(app: AppHandle, rgba: Option<Vec<u8>>) -> Result<(), String> {
    const SIZE: u32 = 32;
    let is_default = rgba.is_none();
    let icon = match rgba {
        Some(pixels) if pixels.len() == (SIZE * SIZE * 4) as usize => {
            Image::new_owned(pixels, SIZE, SIZE)
        }
        Some(_) => return Err("菜单栏图标尺寸无效".into()),
        None => Image::from_bytes(DEFAULT_TRAY_ICON).map_err(|error| error.to_string())?,
    };
    let tray = app.tray_by_id("quotes").ok_or("托盘尚未初始化")?;
    tray.set_icon_with_as_template(Some(icon), is_default)
        .map_err(|error| error.to_string())?;
    tray.set_title(is_default.then_some("管家"))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_shortcut(
    app: AppHandle,
    active: State<'_, Mutex<Option<Shortcut>>>,
    shortcut: Option<String>,
) -> Result<(), String> {
    let next = shortcut
        .map(|value| value.parse::<Shortcut>())
        .transpose()
        .map_err(|error| error.to_string())?;
    let mut current = active.lock().map_err(|error| error.to_string())?;
    if current.as_ref() == next.as_ref() {
        return Ok(());
    }
    let manager = app.global_shortcut();
    if let Some(next) = next {
        manager
            .register(next)
            .map_err(|error| format!("无法注册唤出自选页面的快捷键：{error}"))?;
    }
    if let Some(previous) = *current {
        if let Err(error) = manager.unregister(previous) {
            if let Some(next) = next {
                let _ = manager.unregister(next);
            }
            return Err(error.to_string());
        }
    }
    *current = next;
    Ok(())
}

#[tauri::command]
fn open_chart_credit(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url("https://github.com/jones2000/HQChart", None::<&str>)
        .map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .manage(Mutex::new(None::<Shortcut>))
        .manage(updater::PendingUpdate::default())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state() == ShortcutState::Pressed {
                        let focused = app
                            .get_webview_window("main")
                            .is_some_and(|window| window.is_focused().unwrap_or(false));
                        show_main(app);
                        let action = if focused {
                            "watchlist-focused"
                        } else {
                            "watchlist"
                        };
                        let _ = app.emit_to("main", "tray-action", action);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            update_tray,
            set_tray_icon,
            set_shortcut,
            open_chart_credit,
            session::load_session,
            session::save_session,
            session::clear_session,
            updater::check_app_update,
            updater::install_app_update,
            updater::restart_after_update
        ])
        .setup(|app| {
            updater::setup(app)?;
            let show = MenuItem::with_id(app, "show", "显示盯盘管家", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "应用设置", true, None::<&str>)?;
            let login = MenuItem::with_id(app, "login", "切换账号", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出管家", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &settings, &login, &quit])?;
            TrayIconBuilder::with_id("quotes")
                .icon(Image::from_bytes(DEFAULT_TRAY_ICON)?)
                .icon_as_template(true)
                .title("管家")
                .tooltip("盯盘管家")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "quit" => app.exit(0),
                    "show" => show_main(app),
                    "settings" | "login" => {
                        show_main(app);
                        let _ = app.emit("tray-action", event.id().as_ref());
                    }
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("启动盯盘管家失败");
}
