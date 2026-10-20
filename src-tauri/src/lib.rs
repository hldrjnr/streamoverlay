mod commands;
mod innertube;
mod kick;
mod twitch;
mod types;

use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::Manager;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = Arc::new(Mutex::new(AppState::default()));

    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::connect_to_stream,
            commands::connect_to_provider,
            commands::disconnect,
            commands::disconnect_provider,
            commands::get_connection_status,
            commands::get_settings,
            commands::update_settings,
            commands::toggle_chat_window,
            commands::toggle_settings_window,
            commands::set_click_through,
            commands::set_always_on_top,
            commands::snap_to_edge,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // Settings window: intercept close → hide instead of exit
            if let Some(settings_window) = app.get_webview_window("settings") {
                let handle_hide = handle.clone();
                settings_window.on_window_event(move |event| {
                    match event {
                        tauri::WindowEvent::CloseRequested { api, .. } => {
                            api.prevent_close();
                            if let Some(w) = handle_hide.get_webview_window("settings") {
                                let _ = w.hide();
                            }
                        }
                        tauri::WindowEvent::Resized(size) => {
                            if size.width == 0 && size.height == 0 {
                                if let Some(w) = handle_hide.get_webview_window("settings") {
                                    let _ = w.hide();
                                }
                            }
                        }
                        _ => {}
                    }
                });
            }

            // Click-through ativo por padrão no overlay
            if let Some(chat) = app.get_webview_window("chat") {
                let _ = chat.set_ignore_cursor_events(true);
            }

            // Build tray icon with menu
            use tauri::menu::{MenuBuilder, MenuItemBuilder};
            use tauri::tray::MouseButton;

            let toggle = MenuItemBuilder::with_id("toggle", "Mostrar/Ocultar Janela de comando")
                .build(app)?;
            let sair = MenuItemBuilder::with_id("sair", "Sair")
                .build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&toggle)
                .separator()
                .item(&sair)
                .build()?;

            let icon_bytes = include_bytes!("../icons/icon.png");
            let icon = tauri::image::Image::from_bytes(icon_bytes)
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

            let handle_click = handle.clone();
            let handle_quit = handle.clone();

            tauri::tray::TrayIconBuilder::new()
                .icon(icon)
                .icon_as_template(true)
                .menu(&menu)
                .tooltip("Lovert Overlay")
                .on_tray_icon_event(move |_app, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        let app = handle_click.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = commands::toggle_settings_window(app).await;
                        });
                    }
                })
                .on_menu_event(move |_app, event| {
                    match event.id().as_ref() {
                        "toggle" => {
                            let app = handle_quit.clone();
                            tauri::async_runtime::spawn(async move {
                                let _ = commands::toggle_settings_window(app).await;
                            });
                        }
                        "sair" => {
                            handle_quit.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app.handle())?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Erro ao executar a aplicação");
}
