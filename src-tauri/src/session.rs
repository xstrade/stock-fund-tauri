use std::sync::Mutex;

use keyring::{Entry, Error};
use serde::{Deserialize, Serialize};

static STORE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    token: String,
    account_id: String,
}

fn entry(scope: &str) -> Result<Entry, String> {
    Entry::new("org.stockfund.desktop", scope).map_err(|_| "无法打开系统凭据存储".into())
}

async fn access<T: Send + 'static>(
    scope: String,
    operation: impl FnOnce(Entry) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = STORE_LOCK.lock().map_err(|_| "凭据存储暂不可用")?;
        operation(entry(&scope)?)
    })
    .await
    .map_err(|_| "读取凭据任务失败")?
}

#[tauri::command]
pub async fn load_session(scope: String) -> Result<Option<Session>, String> {
    access(scope, |entry| match entry.get_password() {
        Ok(encoded) => serde_json::from_str(&encoded)
            .map(Some)
            .map_err(|_| "保存的会话格式无效，请重新登录".into()),
        Err(Error::NoEntry) => Ok(None),
        Err(_) => Err("无法读取系统凭据，请重新登录".into()),
    })
    .await
}

#[tauri::command]
pub async fn save_session(scope: String, session: Session) -> Result<(), String> {
    access(scope, move |entry| {
        let encoded = serde_json::to_string(&session).map_err(|_| "无法保存会话")?;
        entry
            .set_password(&encoded)
            .map_err(|_| "系统凭据存储不可用，本次登录将在退出后失效".into())
    })
    .await
}

#[tauri::command]
pub async fn clear_session(scope: String) -> Result<(), String> {
    access(scope, |entry| match entry.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(_) => Err("无法清除已保存的会话，请检查系统凭据存储".into()),
    })
    .await
}
