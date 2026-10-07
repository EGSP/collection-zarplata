//! Потоковый импорт универсальной XML-выгрузки 1С через единый API приложения.
//! В памяти находится один выбранный объект и порция до 500 записей.
use anyhow::{Context, Result, bail, ensure};
use clap::Parser;
use quick_xml::{Reader, Writer, events::Event};
use reqwest::blocking::Client;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{collections::BTreeMap, fs::File, io::BufReader, path::PathBuf, time::Duration};

/// Параметры запуска. PIN приходит из окружения или скрытого ввода.
#[derive(Parser)]
#[command(about = "Импорт справочника из XML 1С")]
struct Arguments {
    #[arg(long)]
    xml: PathBuf,
    #[arg(long)]
    mapping: PathBuf,
    #[arg(long)]
    server: String,
    #[arg(long, default_value_t = 100)]
    batch_size: usize,
}

/// Описание сопоставления: пути относительны корню одного объекта 1С.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Mapping {
    #[serde(rename = "$schema")]
    _schema: Option<String>,
    source_object: String,
    target_catalog: String,
    external_system: String,
    fields: BTreeMap<String, Field>,
}

/// Поле выбирается по пути, при необходимости по строке табличной части и её типу.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Field {
    path: Option<String>,
    row_path: Option<String>,
    where_field: Option<String>,
    where_value: Option<String>,
    constant: Option<Value>,
    #[serde(default)]
    date_only: bool,
    values: Option<BTreeMap<String, Value>>,
}

fn child_path<'a>(
    mut node: roxmltree::Node<'a, 'a>,
    path: &str,
) -> Option<roxmltree::Node<'a, 'a>> {
    for name in path.split('/') {
        node = node.children().find(|child| child.has_tag_name(name))?;
    }
    Some(node)
}

fn mapped_value(root: roxmltree::Node<'_, '_>, field: &Field) -> Result<Value> {
    if let Some(value) = &field.constant {
        return Ok(value.clone());
    }
    let path = field
        .path
        .as_deref()
        .context("Нужно задать path или constant")?;
    let node = if let Some(row_path) = &field.row_path {
        let (parent_path, row_name) = row_path
            .rsplit_once('/')
            .context("rowPath должен включать таблицу и строку")?;
        child_path(root, parent_path).and_then(|parent| {
            parent
                .children()
                .filter(|row| row.has_tag_name(row_name))
                .find(|row| {
                    field.where_field.as_deref().is_none_or(|name| {
                        child_path(*row, name).and_then(|item| item.text())
                            == field.where_value.as_deref()
                    })
                })
        })
    } else {
        Some(root)
    };
    let text = node
        .and_then(|node| child_path(node, path))
        .and_then(|node| node.text())
        .unwrap_or("")
        .trim();
    if text.is_empty() || (field.date_only && text.starts_with("0001-01-01")) {
        return Ok(Value::Null);
    }
    if let Some(values) = &field.values {
        return values
            .get(text)
            .cloned()
            .with_context(|| format!("Нет сопоставления значения «{text}»"));
    }
    if field.date_only {
        return Ok(Value::String(
            text.get(..10).context("Неверная дата")?.to_owned(),
        ));
    }
    Ok(Value::String(text.to_owned()))
}

/// При истечении доступа обновляет cookie и повторяет запрос только после ответа 401.
fn send_batch(
    client: &Client,
    server: &str,
    mapping: &Mapping,
    items: &mut Vec<Value>,
    counts: &mut [usize; 2],
) -> Result<()> {
    let body = json!({"target": {"kind": "catalog", "name": mapping.target_catalog}, "action": "import", "payload": {"externalSystem": mapping.external_system, "items": items}});
    let mut response = client
        .post(format!("{server}/api/perform"))
        .json(&body)
        .send()?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        client
            .post(format!("{server}/api/authentication/refresh"))
            .send()?
            .error_for_status()?;
        response = client
            .post(format!("{server}/api/perform"))
            .json(&body)
            .send()?;
    }
    if !response.status().is_success() {
        bail!(
            "Импорт остановлен: {} {}",
            response.status(),
            response.text()?
        );
    }
    let results: Vec<Value> = response.json()?;
    ensure!(
        results.len() == items.len(),
        "Сервер вернул неверное число результатов"
    );
    for result in results {
        match result["status"].as_str() {
            Some("created") => counts[0] += 1,
            Some("updated") => counts[1] += 1,
            _ => bail!("Сервер вернул неизвестный результат импорта"),
        }
    }
    items.clear();
    Ok(())
}

fn run() -> Result<()> {
    let arguments = Arguments::parse();
    ensure!(
        (1..=500).contains(&arguments.batch_size),
        "Размер порции должен быть от 1 до 500"
    );
    let mapping: Mapping = serde_json::from_reader(File::open(&arguments.mapping)?)?;
    ensure!(
        !mapping.fields.is_empty()
            && !mapping.external_system.trim().is_empty()
            && !mapping.target_catalog.trim().is_empty()
            && mapping.source_object.starts_with("CatalogObject."),
        "Неверное описание сопоставления"
    );
    for (name, field) in &mapping.fields {
        ensure!(
            field.path.is_some() != field.constant.is_some(),
            "Поле {name}: задайте ровно одно из path и constant"
        );
        ensure!(field.path.as_deref().is_none_or(|path| !path.is_empty() && path.split('/').all(|part| !part.is_empty())), "Поле {name}: неверный путь");
        ensure!(
            field.row_path.is_some() == field.where_field.is_some()
                && field.row_path.is_some() == field.where_value.is_some(),
            "Поле {name}: rowPath, whereField и whereValue задаются вместе"
        );
        ensure!(
            field.constant.is_none()
                || (!field.date_only && field.values.is_none() && field.row_path.is_none()),
            "Поле {name}: преобразование константы не поддерживается"
        );
    }
    let server = arguments.server.trim_end_matches('/');
    let address = reqwest::Url::parse(server)?;
    ensure!(
        address.scheme() == "https"
            || (address.scheme() == "http"
                && matches!(
                    address.host_str(),
                    Some("127.0.0.1" | "localhost" | "[::1]")
                )),
        "Для удалённого сервера требуется HTTPS"
    );
    let client = Client::builder()
        .cookie_store(true)
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let pin = match std::env::var("COLLECTION_IMPORT_PIN") {
        Ok(pin) => pin,
        Err(_) => rpassword::prompt_password("PIN: ")?,
    };
    let login = client
        .post(format!("{server}/api/authentication/login"))
        .json(&json!({"pin": pin}))
        .send()?;
    ensure!(
        login.status().is_success(),
        "Вход не выполнен: {}",
        login.status()
    );
    let mut reader = Reader::from_reader(BufReader::new(File::open(&arguments.xml)?));
    let mut buffer = Vec::new();
    let mut selected: Option<Writer<Vec<u8>>> = None;
    let mut depth = 0;
    let mut items = Vec::new();
    let mut counts = [0, 0];
    let mut matched = 0;
    loop {
        let event = reader
            .read_event_into(&mut buffer)
            .context("Ошибка чтения XML")?;
        if let Event::Start(start) = &event {
            if selected.is_none() && start.name().as_ref() == mapping.source_object.as_bytes() {
                selected = Some(Writer::new(Vec::new()));
                depth = 0;
            }
            if selected.is_some() {
                depth += 1;
            }
        }
        if let Some(writer) = &mut selected {
            if depth == 1
                && let Event::Start(start) = &event
            {
                let mut start = start.clone().into_owned();
                // Отдельный объект теряет объявления пространств имён оболочки выгрузки 1С.
                start.push_attribute(("xmlns:xsi", "http://www.w3.org/2001/XMLSchema-instance"));
                start.push_attribute(("xmlns:v8", "http://v8.1c.ru/data"));
                writer.write_event(Event::Start(start))?;
            } else {
                writer.write_event(event.clone())?;
            }
        }
        if matches!(event, Event::End(_)) && selected.is_some() {
            depth -= 1;
            if depth == 0 {
                matched += 1;
                let bytes = selected.take().unwrap().into_inner();
                let xml = std::str::from_utf8(&bytes)?;
                let document = roxmltree::Document::parse(xml)?;
                let root = document.root_element();
                if child_path(root, "IsFolder").and_then(|node| node.text()) != Some("true") {
                    let identifier = child_path(root, "Ref")
                        .and_then(|node| node.text())
                        .context("Объект без Ref")?;
                    let mut fields = serde_json::Map::new();
                    for (name, field) in &mapping.fields {
                        fields.insert(
                            name.clone(),
                            mapped_value(root, field)
                                .with_context(|| format!("Элемент {matched}, поле {name}"))?,
                        );
                    }
                    items.push(json!({"sourceObject": mapping.source_object, "externalIdentifier": identifier, "fields": fields}));
                    if items.len() == arguments.batch_size {
                        send_batch(&client, server, &mapping, &mut items, &mut counts)?;
                    }
                }
            }
        }
        if matches!(event, Event::Eof) {
            ensure!(selected.is_none(), "XML оборван внутри объекта");
            break;
        }
        buffer.clear();
    }
    if !items.is_empty() {
        send_batch(&client, server, &mapping, &mut items, &mut counts)?;
    }
    ensure!(matched > 0, "В XML нет объектов {}", mapping.source_object);
    println!("Создано: {}, обновлено: {}", counts[0], counts[1]);
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error:#}");
        std::process::exit(1);
    }
}
