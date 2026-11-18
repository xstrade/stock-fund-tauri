use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{async_runtime::Mutex, App, AppHandle, Manager, State};
use tauri_plugin_updater::{Config, Update, UpdaterExt};

#[derive(Default)]
pub(crate) struct PendingUpdate(Mutex<UpdateState>);

#[derive(Default)]
struct UpdateState {
    available: Option<Update>,
    installed: bool,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub(crate) enum CheckResult {
    Disabled,
    Current,
    Available {
        version: String,
        notes: Option<String>,
    },
}

fn is_loopback_fixture(url: &tauri::Url) -> bool {
    cfg!(debug_assertions)
        && url.scheme() == "http"
        && matches!(url.host_str(), Some("127.0.0.1" | "[::1]"))
}

pub(crate) fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let Some(raw) = app.config().plugins.0.get("updater") else {
        return Ok(());
    };
    let config = Config::deserialize(raw.clone())?;
    let fixture = config.dangerous_insecure_transport_protocol
        && !config.endpoints.is_empty()
        && config.endpoints.iter().all(is_loopback_fixture);
    let production = !config.dangerous_insecure_transport_protocol
        && !config.endpoints.is_empty()
        && config.endpoints.iter().all(|url| url.scheme() == "https");
    if config.pubkey.trim().is_empty()
        || !config.require_signed_version
        || config.allow_downgrades
        || config.dangerous_accept_invalid_certs
        || config.dangerous_accept_invalid_hostnames
        || config
            .endpoints
            .iter()
            .any(|url| !url.username().is_empty() || url.password().is_some())
        || (!fixture && !production)
    {
        return Err("更新配置需要签名公钥、版本签名和 HTTPS 更新源".into());
    }
    app.handle()
        .plugin(tauri_plugin_updater::Builder::new().build())?;
    app.manage(UpdateMode { fixture });
    Ok(())
}

struct UpdateMode {
    fixture: bool,
}

#[tauri::command]
pub(crate) async fn check_app_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<CheckResult, String> {
    let Some(mode) = app.try_state::<UpdateMode>() else {
        return Ok(CheckResult::Disabled);
    };
    let mut pending = pending.0.try_lock().map_err(|_| "更新操作正在进行")?;
    if pending.installed {
        return Err("更新已安装，请重新启动应用".into());
    }
    pending.available = None;
    let fixture = mode.fixture;
    let updater = app
        .updater_builder()
        .timeout(Duration::from_secs(90))
        .configure_client(move |client| {
            let client = client.https_only(!fixture);
            if fixture {
                client.redirect(reqwest::redirect::Policy::none())
            } else {
                client
            }
        })
        .build()
        .map_err(|error| error.to_string())?;
    let update = updater.check().await.map_err(|error| error.to_string())?;
    if let Some(update) = update {
        let url = &update.download_url;
        if (fixture && !is_loopback_fixture(url))
            || (!fixture && url.scheme() != "https")
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("更新包下载地址不符合当前更新源配置".into());
        }
        let result = CheckResult::Available {
            version: update.version.clone(),
            notes: update.body.clone(),
        };
        pending.available = Some(update);
        Ok(result)
    } else {
        Ok(CheckResult::Current)
    }
}

#[tauri::command]
pub(crate) async fn install_app_update(
    pending: State<'_, PendingUpdate>,
    version: String,
) -> Result<(), String> {
    let mut pending = pending.0.try_lock().map_err(|_| "更新操作正在进行")?;
    let update = pending
        .available
        .as_ref()
        .filter(|update| update.version == version)
        .ok_or("更新版本已变化，请重新检查")?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())?;
    pending.available = None;
    pending.installed = true;
    Ok(())
}

#[tauri::command]
pub(crate) fn restart_after_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<(), String> {
    let installed = pending
        .0
        .try_lock()
        .map_err(|_| "更新操作正在进行")?
        .installed;
    if !installed {
        return Err("尚未完成更新安装".into());
    }
    app.restart();
}
