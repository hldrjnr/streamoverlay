use reqwest::Client;
use scraper::{Html, Selector};
use serde_json::{json, Value};
use std::time::Duration;

use crate::types::ChatMessage;

const MAX_RETRIES: u32 = 3;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const RETRY_DELAY: Duration = Duration::from_secs(2);

pub struct InnerTubeClient {
    client: Client,
    api_key: String,
    continuation: String,
    visitor_data: String,
    client_version: String,
    skip_media: bool,
}

impl InnerTubeClient {
    pub fn new(skip_media: bool) -> Self {
        Self {
            client: Client::builder()
                .timeout(REQUEST_TIMEOUT)
                .cookie_store(true)
                .gzip(true)
                .brotli(true)
                .build()
                .unwrap(),
            api_key: String::new(),
            continuation: String::new(),
            visitor_data: String::new(),
            client_version: "2.20250325.00.00".to_string(),
            skip_media,
        }
    }

    pub async fn init_from_url(&mut self, url: &str) -> Result<(), String> {
        let video_id = extract_video_id(url)?;
        let watch_url = format!("https://www.youtube.com/watch?v={}", video_id);

        eprintln!("[overlay] Fetching: {}", watch_url);

        let mut last_err = String::new();
        for attempt in 1..=MAX_RETRIES {
            match self.try_fetch_page(&watch_url).await {
                Ok(()) => return Ok(()),
                Err(e) => {
                    eprintln!("[overlay] Tentativa {}/{} falhou: {}", attempt, MAX_RETRIES, e);
                    last_err = e;
                    if attempt < MAX_RETRIES {
                        tokio::time::sleep(RETRY_DELAY).await;
                    }
                }
            }
        }
        Err(format!("Falha após {} tentativas: {}", MAX_RETRIES, last_err))
    }

    async fn try_fetch_page(&mut self, watch_url: &str) -> Result<(), String> {
        let response = self
            .client
            .get(watch_url)
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
            .header("Accept-Language", "pt-BR,pt;q=0.9,en;q=0.5")
            .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
            .header("Accept-Encoding", "gzip, br")
            .send()
            .await
            .map_err(|e| format!("Falha ao buscar página: {}", e))?;

        let status = response.status();
        eprintln!("[overlay] HTTP status: {}", status);
        if !status.is_success() {
            return Err(format!("HTTP {}: {}", status.as_u16(), status.canonical_reason().unwrap_or("")));
        }

        let html = response
            .text()
            .await
            .map_err(|e| format!("Falha ao ler resposta: {}", e))?;

        eprintln!("[overlay] HTML size: {} bytes", html.len());

        self.extract_from_html(&html)
    }

    fn extract_from_html(&mut self, html: &str) -> Result<(), String> {
        let document = Html::parse_document(html);
        let script_selector = Selector::parse("script").unwrap();

        let mut scripts: Vec<String> = Vec::new();
        for element in document.select(&script_selector) {
            for text in element.text() {
                let trimmed = text.trim();
                if trimmed.len() > 100 {
                    scripts.push(trimmed.to_string());
                }
            }
        }

        eprintln!("[overlay] Found {} script blocks", scripts.len());

        self.api_key = self.extract_from_scripts(&scripts, "INNERTUBE_API_KEY")
            .unwrap_or_default();
        if self.api_key.is_empty() {
            return Err("API key não encontrada na página".to_string());
        }
        eprintln!("[overlay] API key: {}...", &self.api_key[..self.api_key.len().min(8)]);

        self.visitor_data = self.extract_string_from_scripts(&scripts, "VISITOR_DATA")
            .unwrap_or_default();
        eprintln!("[overlay] Visitor data: {}...", &self.visitor_data[..self.visitor_data.len().min(20)]);

        self.continuation = self.extract_continuation_from_scripts(&scripts)?;
        eprintln!("[overlay] Continuation token: {}...", &self.continuation[..self.continuation.len().min(30)]);

        Ok(())
    }

    fn extract_from_scripts(&self, scripts: &[String], key: &str) -> Option<String> {
        for script in scripts {
            if let Some(idx) = script.find(key) {
                let after = &script[idx..];
                if let Some(q_start) = after.find('"') {
                    let rest = &after[q_start + 1..];
                    if let Some(q_end) = rest.find('"') {
                        return Some(rest[..q_end].to_string());
                    }
                }
            }
        }
        None
    }

    fn extract_string_from_scripts(&self, scripts: &[String], key: &str) -> Option<String> {
        self.extract_from_scripts(scripts, key)
    }

    fn extract_continuation_from_scripts(&self, scripts: &[String]) -> Result<String, String> {
        for script in scripts {
            if !script.contains("ytInitialData") && !script.contains("liveChatRenderer") {
                continue;
            }

            if let Some(json_str) = extract_json_by_key(script, "ytInitialData") {
                eprintln!("[overlay] Found ytInitialData JSON ({} bytes)", json_str.len());
                if let Ok(data) = serde_json::from_str::<Value>(&json_str) {
                    if let Some(token) = find_continuation_in_json(&data) {
                        return Ok(token);
                    }
                }
            }
        }

        for script in scripts {
            if let Some(json_str) = extract_json_by_key(script, "ytInitialData") {
                if let Ok(data) = serde_json::from_str::<Value>(&json_str) {
                    if let Some(token) = find_continuation_deep(&data) {
                        return Ok(token);
                    }
                }
            }
        }

        Err("Não foi possível encontrar o chat ao vivo. Verifique se o link é de uma live.".to_string())
    }

    pub async fn fetch_messages(&mut self) -> Result<Vec<ChatMessage>, String> {
        if self.api_key.is_empty() || self.continuation.is_empty() {
            return Err("Cliente não inicializado".to_string());
        }

        let body = json!({
            "context": {
                "client": {
                    "clientName": "WEB",
                    "clientVersion": self.client_version,
                    "visitorData": self.visitor_data,
                    "hl": "pt",
                    "gl": "BR"
                }
            },
            "continuation": self.continuation
        });

        let url = format!(
            "https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key={}",
            self.api_key
        );

        let mut last_err = String::new();
        for attempt in 1..=MAX_RETRIES {
            match self.try_fetch_messages(&url, &body).await {
                Ok(msgs) => return Ok(msgs),
                Err(e) => {
                    eprintln!("[overlay] fetch_messages tentativa {}/{} falhou: {}", attempt, MAX_RETRIES, e);
                    last_err = e;
                    if attempt < MAX_RETRIES {
                        tokio::time::sleep(RETRY_DELAY).await;
                    }
                }
            }
        }
        Err(format!("Falha após {} tentativas: {}", MAX_RETRIES, last_err))
    }

    async fn try_fetch_messages(&mut self, url: &str, body: &Value) -> Result<Vec<ChatMessage>, String> {
        let response = self
            .client
            .post(url)
            .header("Content-Type", "application/json")
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
            .header("Origin", "https://www.youtube.com")
            .header("Referer", "https://www.youtube.com/")
            .header("Accept-Encoding", "gzip, br")
            .json(body)
            .send()
            .await
            .map_err(|e| format!("Falha ao conectar com YouTube: {}", e))?;

        let status = response.status();
        if !status.is_success() {
            return Err(format!("YouTube retornou HTTP {}", status.as_u16()));
        }

        let json: Value = response
            .json()
            .await
            .map_err(|e| format!("Resposta inválida da API: {}", e))?;

        if let Some(error) = json.get("error") {
            return Err(format!("Erro da API: {}", error));
        }

        let mut messages = Vec::new();

        if let Some(actions) = json.pointer("/continuationContents/liveChatContinuation/actions") {
            parse_actions(actions, &mut messages, self.skip_media);
        } else if let Some(actions) = json.pointer("/actions") {
            parse_actions(actions, &mut messages, self.skip_media);
        }

        update_continuation(&json, &mut self.continuation);

        Ok(messages)
    }
}

fn extract_json_by_key(script: &str, key: &str) -> Option<String> {
    let idx = script.find(key)?;
    let after_key = &script[idx..];

    let eq_idx = after_key.find('=')?;
    let after_eq = &after_key[eq_idx + 1..].trim_start();

    if !after_eq.starts_with('{') {
        return None;
    }

    let mut depth = 0i32;
    let mut in_string = false;
    let mut escape = false;

    for (i, ch) in after_eq.char_indices() {
        if escape {
            escape = false;
            continue;
        }
        if ch == '\\' && in_string {
            escape = true;
            continue;
        }
        if ch == '"' {
            in_string = !in_string;
            continue;
        }
        if in_string {
            continue;
        }
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(after_eq[..=i].to_string());
                }
            }
            _ => {}
        }
    }

    None
}

fn find_continuation_in_json(data: &Value) -> Option<String> {
    let paths = [
        "/contents/twoColumnWatchNextResults/conversationBar/liveChatRenderer/continuations",
    ];

    for path in &paths {
        if let Some(continuations) = data.pointer(path) {
            if let Some(arr) = continuations.as_array() {
                for item in arr {
                    for key in &["reloadContinuationData", "timedContinuationData"] {
                        if let Some(token) = item.pointer(&format!("/{}/continuation", key))
                            .and_then(|v| v.as_str())
                        {
                            if !token.is_empty() {
                                return Some(token.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    find_continuation_deep(data)
}

fn find_continuation_deep(data: &Value) -> Option<String> {
    match data {
        Value::Object(map) => {
            if let Some(Value::String(s)) = map.get("continuation") {
                if s.len() > 30 && !s.starts_with("http") {
                    return Some(s.clone());
                }
            }
            for (_, v) in map {
                if let Some(token) = find_continuation_deep(v) {
                    return Some(token);
                }
            }
            None
        }
        Value::Array(arr) => {
            for item in arr {
                if let Some(token) = find_continuation_deep(item) {
                    return Some(token);
                }
            }
            None
        }
        _ => None,
    }
}

fn update_continuation(json: &Value, current: &mut String) {
    let paths = [
        "/continuationContents/liveChatContinuation/continuations",
        "/continuation",
    ];

    for path in &paths {
        if let Some(cont) = json.pointer(path) {
            if let Some(arr) = cont.as_array() {
                for c in arr {
                    for key in &[
                        "reloadContinuationData",
                        "timedContinuationData",
                        "liveChatContinuationData",
                        "invalidationContinuationData",
                    ] {
                        if let Some(data) = c.get(*key) {
                            if let Some(s) = data.get("continuation").and_then(|v| v.as_str()) {
                                if !s.is_empty() && s.len() > 10 {
                                    *current = s.to_string();
                                    return;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

fn parse_actions(actions: &Value, messages: &mut Vec<ChatMessage>, skip_media: bool) {
    let arr = match actions.as_array() {
        Some(a) => a,
        None => return,
    };

    for action in arr {
        if let Some(add_chat) = action.get("addChatItemAction") {
            if let Some(item) = add_chat.get("item") {
                if let Some(chat_msg) = item.get("liveChatTextMessageRenderer") {
                    messages.push(parse_chat_message(chat_msg, skip_media));
                }
                if let Some(sc) = item.get("liveChatPaidMessageRenderer") {
                    messages.push(parse_super_chat(sc, skip_media));
                }
                if let Some(membership) = item.get("liveChatMembershipItemRenderer") {
                    messages.push(parse_membership(membership, skip_media));
                }
            }
        }
    }
}

fn parse_chat_message(renderer: &Value, skip_media: bool) -> ChatMessage {
    let id = renderer
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let author_name = renderer
        .pointer("/authorName/simpleText")
        .or_else(|| renderer.pointer("/authorName/runs/0/text"))
        .and_then(|v| v.as_str())
        .unwrap_or("Anônimo")
        .to_string();

    let author_channel_id = renderer
        .pointer("/authorChannelId/value")
        .and_then(|v| v.as_str())
        .or_else(|| renderer.get("authorChannelId").and_then(|v| v.as_str()))
        .unwrap_or("")
        .to_string();

    let author_handle = if !skip_media {
        renderer
            .pointer("/authorEndpoint/browseEndpoint/canonicalBaseUrl")
            .and_then(|v| v.as_str())
            .map(|s| s.trim_start_matches('/').to_string())
            .unwrap_or_default()
    } else {
        String::new()
    };

    let author_photo = if skip_media {
        String::new()
    } else {
        renderer
            .pointer("/authorPhoto/thumbnails/2/url")
            .or_else(|| renderer.pointer("/authorPhoto/thumbnails/1/url"))
            .or_else(|| renderer.pointer("/authorPhoto/thumbnails/0/url"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };

    let message_text = extract_runs_text(renderer.get("message"));

    let timestamp_ms = renderer
        .get("timestampUsec")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<u64>().ok())
        .map(|us| us / 1000)
        .unwrap_or(0);

    let is_moderator = renderer
        .get("authorBadges")
        .and_then(|v| v.as_array())
        .map(|badges| {
            badges.iter().any(|b| {
                b.pointer("/liveChatAuthorBadgeRenderer/icon/iconType")
                    .and_then(|v| v.as_str())
                    .map(|t| t == "MODERATOR" || t == "VERIFIED")
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false);

    let badge_url = if skip_media {
        None
    } else {
        renderer
            .pointer("/authorBadges/0/liveChatAuthorBadgeRenderer/customThumbnail/thumbnails/0/url")
            .or_else(|| renderer.pointer("/authorBadges/0/liveChatAuthorBadgeRenderer/thumbnail/thumbnails/0/url"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    };

    ChatMessage {
        id,
        author: author_channel_id.clone(),
        author_channel_id,
        author_name,
        author_handle,
        author_photo,
        message: message_text,
        timestamp: String::new(),
        timestamp_ms,
        is_super_chat: false,
        super_chat_amount: None,
        is_membership: false,
        is_moderator,
        is_owner: false,
        badge_url,
        provider: "youtube".to_string(),
    }
}

fn parse_super_chat(renderer: &Value, skip_media: bool) -> ChatMessage {
    let mut msg = parse_chat_message(renderer, skip_media);
    msg.is_super_chat = true;
    msg.super_chat_amount = renderer
        .pointer("/purchaseAmountText/runs/0/text")
        .or_else(|| renderer.pointer("/purchaseAmountText/simpleText"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    msg
}

fn parse_membership(renderer: &Value, skip_media: bool) -> ChatMessage {
    let mut msg = parse_chat_message(renderer, skip_media);
    msg.is_membership = true;
    msg.message = renderer
        .pointer("/headerSubtext/runs/0/text")
        .or_else(|| renderer.pointer("/headerPrimaryText/runs/0/text"))
        .and_then(|v| v.as_str())
        .unwrap_or("Entrou como membro")
        .to_string();
    msg
}

fn extract_runs_text(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Object(obj)) => {
            if let Some(runs) = obj.get("runs") {
                if let Some(arr) = runs.as_array() {
                    return arr
                        .iter()
                        .filter_map(|r| r.get("text").and_then(|t| t.as_str()))
                        .collect::<Vec<&str>>()
                        .join("");
                }
            }
            if let Some(text) = obj.get("simpleText") {
                if let Some(s) = text.as_str() {
                    return s.to_string();
                }
            }
            String::new()
        }
        _ => String::new(),
    }
}

fn extract_video_id(url: &str) -> Result<String, String> {
    let patterns = [
        r"(?:v=)([a-zA-Z0-9_-]{11})",
        r"(?:youtu\.be/)([a-zA-Z0-9_-]{11})",
        r"(?:live/)([a-zA-Z0-9_-]{11})",
    ];

    for pattern in &patterns {
        if let Ok(re) = regex::Regex::new(pattern) {
            if let Some(caps) = re.captures(url) {
                return Ok(caps[1].to_string());
            }
        }
    }

    if regex::Regex::new(r"^[a-zA-Z0-9_-]{11}$")
        .unwrap()
        .is_match(url)
    {
        return Ok(url.to_string());
    }

    Err(format!("URL inválida: {}", url))
}
