// Парсер выгрузки 1С (.txt) — docs/plans/v2-backend.md §3. Два формата под вид импорта:
// исходящие (9 колонок, §2.1) и входящие (8 колонок, §2.2). Реальные эталоны — Список исх./вхд.
//
// Общий алгоритм (§2.3):
//   1) снять BOM EF BB BF;
//   2) декодировать UTF-8; строки по '\n' (снимаем возможный '\r');
//   3) отбросить хвостовые пустые строки;
//   4) заголовок — ровно N ожидаемых колонок выбранного вида, иначе PARSE_HEADER;
//   5) строка данных — split по TAB строго в N полей, иначе PARSE_FIELDS с номером строки;
//   6) trim каждого поля; служебную колонку «Количество связей…» (поле[0]) читаем, но не используем;
//   7) Дата: исх. ДД.ММ.ГГ → 20ГГ; вх. ДД.ММ.ГГГГ as-is; непарсимая → PARSE_DATE;
//   8) Срок исполнения (deadline_src) — дата или пусто;
//   9) Получатель/Корреспондент/Адресаты — сырой текст (без split по запятой); опечатки дословно.
// Ошибка парсинга — ошибка ВСЕГО файла (атомарно): ни превью, ни записи.

use std::path::Path;

use chrono::NaiveDate;

use crate::dto::DocKind;
use crate::error::ApiError;
use crate::model::DocFacts;

/// Одна распарсенная строка. reg_date/deadline_src уже нормализованы в ISO 'YYYY-MM-DD' (или '').
#[derive(Debug)]
pub struct ParsedRow {
    pub kind: DocKind,
    pub reg_number: String,
    pub reg_date: String,
    pub counterparty: String,
    pub topic: String,
    pub signer: String,
    pub addressees: String,
    pub deadline_src: String,
    pub ref_: String,
}

impl ParsedRow {
    /// Заимствованный срез фактов для repo::document::{insert,update_fields}.
    pub fn as_facts(&self) -> DocFacts<'_> {
        DocFacts {
            kind: self.kind,
            reg_number: &self.reg_number,
            reg_date: &self.reg_date,
            counterparty: &self.counterparty,
            topic: &self.topic,
            signer: &self.signer,
            addressees: &self.addressees,
            deadline_src: &self.deadline_src,
            ref_: &self.ref_,
        }
    }
}

/// Ожидаемые 9 заголовков исходящих (§2.1) в фиксированном порядке.
pub const OUTGOING_HEADERS: [&str; 9] = [
    "Количество связей, поясняющих суть документа",
    "Регистрационный номер",
    "Дата",
    "Получатель исходящего",
    "Заголовок",
    "Подписант",
    "Срок исполнения",
    "Адресаты",
    "Ссылка",
];

/// Ожидаемые 8 заголовков входящих (§2.2) в фиксированном порядке.
pub const INCOMING_HEADERS: [&str; 8] = [
    "Количество связей, поясняющих суть документа",
    "Краткое содержание",
    "Рег. номер",
    "Дата регистрации",
    "Корреспондент",
    "Адресаты",
    "Срок исполнения",
    "Ссылка",
];

/// Прочитать и разобрать файл целиком под выбранный вид.
pub fn parse_file(path: &Path, kind: DocKind) -> Result<Vec<ParsedRow>, ApiError> {
    let bytes = std::fs::read(path)
        .map_err(|e| ApiError::io(format!("Не удалось прочитать файл {}: {e}", path.display())))?;
    parse_bytes(&bytes, kind)
}

/// Разбор сырых байтов (снятие BOM + UTF-8) — выделено для тестируемости на include_bytes!.
pub fn parse_bytes(bytes: &[u8], kind: DocKind) -> Result<Vec<ParsedRow>, ApiError> {
    let bytes = strip_bom(bytes);
    let text = std::str::from_utf8(bytes)
        .map_err(|_| {
            ApiError::io("Файл не в кодировке UTF-8. Сохраните выгрузку в UTF-8 и повторите.".to_string())
        })?;
    parse_text(text, kind)
}

/// Снять BOM EF BB BF, если он в начале.
fn strip_bom(bytes: &[u8]) -> &[u8] {
    if bytes.len() >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF {
        &bytes[3..]
    } else {
        bytes
    }
}

/// Разбор уже декодированного текста под выбранный вид (выделено для тестируемости).
pub fn parse_text(text: &str, kind: DocKind) -> Result<Vec<ParsedRow>, ApiError> {
    let expected: &[&str] = match kind {
        DocKind::Outgoing => &OUTGOING_HEADERS,
        DocKind::Incoming => &INCOMING_HEADERS,
    };
    let ncols = expected.len();

    // Строки по '\n'; снимаем возможный '\r' (CRLF → терпим и одиночный LF).
    let mut lines: Vec<&str> = text
        .split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l))
        .collect();

    // Отбросить хвостовые пустые строки (в конце файла — завершающий перевод строки).
    while matches!(lines.last(), Some(l) if l.trim().is_empty()) {
        lines.pop();
    }

    if lines.is_empty() {
        return Err(ApiError::parse_header(
            "Файл пуст: нет строки с заголовками колонок.".to_string(),
        ));
    }

    // Заголовок: ровно N ожидаемых колонок выбранного вида (сравнение по trimmed-ячейкам).
    let header: Vec<&str> = lines[0].split('\t').map(str::trim).collect();
    let header_ok = header.len() == ncols
        && header.iter().zip(expected.iter()).all(|(got, exp)| got == exp);
    if !header_ok {
        return Err(ApiError::parse_header(format!(
            "Заголовки колонок не совпадают с ожидаемыми. Проверьте тип выгрузки \
             (исходящие или входящие). Ожидалось {ncols} колонок: {}. Получено: {}",
            expected.join(" | "),
            header.join(" | ")
        )));
    }

    let mut rows = Vec::with_capacity(lines.len().saturating_sub(1));
    for (idx, line) in lines[1..].iter().enumerate() {
        let lineno = idx + 2; // 1-based, +1 за строку заголовка

        let fields: Vec<&str> = line.split('\t').collect();
        if fields.len() != ncols {
            return Err(ApiError::parse_fields(format!(
                "Строка {lineno}: ожидалось {ncols} полей, получено {}",
                fields.len()
            )));
        }

        // Поле[0] «Количество связей…» — служебное, читаем, но в логику не идёт (§2.3).
        let row = match kind {
            DocKind::Outgoing => ParsedRow {
                kind,
                reg_number: fields[1].trim().to_string(),
                reg_date: parse_date(fields[2].trim(), lineno)?,
                counterparty: fields[3].trim().to_string(),
                topic: fields[4].trim().to_string(),
                signer: fields[5].trim().to_string(),
                deadline_src: parse_optional_date(fields[6].trim(), lineno)?,
                addressees: fields[7].trim().to_string(),
                ref_: fields[8].trim().to_string(),
            },
            DocKind::Incoming => ParsedRow {
                kind,
                topic: fields[1].trim().to_string(),
                reg_number: fields[2].trim().to_string(),
                reg_date: parse_date(fields[3].trim(), lineno)?,
                counterparty: fields[4].trim().to_string(),
                addressees: fields[5].trim().to_string(),
                deadline_src: parse_optional_date(fields[6].trim(), lineno)?,
                ref_: fields[7].trim().to_string(),
                signer: String::new(), // у входящих колонки «Подписант» нет
            },
        };
        rows.push(row);
    }

    Ok(rows)
}

/// Срок исполнения из выгрузки: пусто → '', иначе разбор как даты (оба формата).
fn parse_optional_date(raw: &str, lineno: usize) -> Result<String, ApiError> {
    if raw.is_empty() {
        Ok(String::new())
    } else {
        parse_date(raw, lineno)
    }
}

/// Дата ДД.ММ.ГГ / ДД.ММ.ГГГГ → ISO 'YYYY-MM-DD' (2-значный год → 20ГГ). Валидируется chrono.
fn parse_date(raw: &str, lineno: usize) -> Result<String, ApiError> {
    let parts: Vec<&str> = raw.split('.').collect();
    if parts.len() != 3 {
        return Err(ApiError::parse_date(format!(
            "Строка {lineno}: некорректная дата «{raw}». Ожидается формат ДД.ММ.ГГ или ДД.ММ.ГГГГ."
        )));
    }

    let day: u32 = parts[0].trim().parse().map_err(|_| {
        ApiError::parse_date(format!("Строка {lineno}: некорректный день в дате «{raw}»"))
    })?;
    let month: u32 = parts[1].trim().parse().map_err(|_| {
        ApiError::parse_date(format!("Строка {lineno}: некорректный месяц в дате «{raw}»"))
    })?;

    let year_raw = parts[2].trim();
    let year: i32 = match year_raw.len() {
        2 => {
            2000 + year_raw.parse::<i32>().map_err(|_| {
                ApiError::parse_date(format!("Строка {lineno}: некорректный год в дате «{raw}»"))
            })?
        }
        4 => year_raw.parse::<i32>().map_err(|_| {
            ApiError::parse_date(format!("Строка {lineno}: некорректный год в дате «{raw}»"))
        })?,
        _ => {
            return Err(ApiError::parse_date(format!(
                "Строка {lineno}: некорректный год в дате «{raw}»"
            )))
        }
    };

    match NaiveDate::from_ymd_opt(year, month, day) {
        Some(d) => Ok(d.format("%Y-%m-%d").to_string()),
        None => Err(ApiError::parse_date(format!(
            "Строка {lineno}: несуществующая дата «{raw}»"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Тесты на реальных выгрузках 1С. Фикстуры содержат данные организации и в
    // репозиторий не выкладываются (см. .gitignore), поэтому модуль закрыт фичей.
    // Запуск на машине разработчика: cargo test --features real-fixtures
    #[cfg(feature = "real-fixtures")]
    mod real_fixtures {
    use super::*;

    // Реальные образцы выгрузок (с BOM/CRLF/кириллицей), скопированные как фикстуры.
    const OUT: &[u8] = include_bytes!("../../tests/fixtures/spisok_ish.txt");
    const INC: &[u8] = include_bytes!("../../tests/fixtures/spisok_vhd.txt");
    const LEGACY: &[u8] = include_bytes!("../../tests/fixtures/legacy_7col.txt");

    #[test]
    fn parse_outgoing_real() {
        let rows = parse_bytes(OUT, DocKind::Outgoing).expect("исходящие должны разобраться");
        assert!(rows.len() >= 3, "ожидаем несколько строк");
        let r = &rows[0];
        assert_eq!(r.reg_number, "100/48");
        assert_eq!(r.reg_date, "2026-01-12"); // 2-значный год 26 → 2026
        assert!(r.counterparty.contains("Гранит-Электрон"));
        assert!(!r.signer.is_empty());
        assert_eq!(r.deadline_src, ""); // Срок исполнения в образце пуст
        assert!(r.ref_.contains("100/48"));
        assert_eq!(r.kind, DocKind::Outgoing);
    }

    #[test]
    fn parse_incoming_real() {
        let rows = parse_bytes(INC, DocKind::Incoming).expect("входящие должны разобраться");
        assert!(rows.len() >= 3);
        let r = &rows[0];
        assert_eq!(r.reg_number, "182");
        assert_eq!(r.reg_date, "2026-01-06"); // 4-значный год as-is
        assert!(r.topic.contains("о согласовании"));
        assert!(r.counterparty.contains("711 АРЗ"));
        assert_eq!(r.signer, ""); // у входящих подписанта нет
        assert_eq!(r.deadline_src, "");
        assert_eq!(r.kind, DocKind::Incoming);
    }

    #[test]
    fn legacy_7col_rejected_as_outgoing() {
        let e = parse_bytes(LEGACY, DocKind::Outgoing).unwrap_err();
        assert_eq!(e.code, "PARSE_HEADER");
    }

    #[test]
    fn legacy_7col_rejected_as_incoming() {
        let e = parse_bytes(LEGACY, DocKind::Incoming).unwrap_err();
        assert_eq!(e.code, "PARSE_HEADER");
    }

    #[test]
    fn incoming_file_rejected_as_outgoing() {
        let e = parse_bytes(INC, DocKind::Outgoing).unwrap_err();
        assert_eq!(e.code, "PARSE_HEADER");
        // Текст подсказывает самую частую причину — выбран не тот тип выгрузки (QA-4 §9.4).
        assert!(
            e.message
                .starts_with("Заголовки колонок не совпадают с ожидаемыми. Проверьте тип выгрузки (исходящие или входящие)."),
            "{}",
            e.message
        );
    }

    #[test]
    fn outgoing_file_rejected_as_incoming() {
        let e = parse_bytes(OUT, DocKind::Incoming).unwrap_err();
        assert_eq!(e.code, "PARSE_HEADER");
    }
    } // mod real_fixtures

    #[test]
    fn optional_deadline_src_parsed_when_present() {
        let text = format!(
            "{}\r\n\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}",
            OUTGOING_HEADERS.join("\t"),
            "200/1",
            "01.02.26",
            "АО X",
            "тема",
            "Подписант",
            "15.03.26", // Срок исполнения заполнен
            "Адресат",
            "ref"
        );
        let rows = parse_text(&text, DocKind::Outgoing).unwrap();
        assert_eq!(rows[0].deadline_src, "2026-03-15");
    }

    #[test]
    fn empty_addressees_and_deadline_ok() {
        let text = format!(
            "{}\r\n\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}",
            OUTGOING_HEADERS.join("\t"),
            "200/2",
            "01.02.26",
            "АО X",
            "тема",
            "Подписант",
            "", // Срок исполнения пуст
            "", // Адресаты пусты (двойной TAB)
            "ref"
        );
        let rows = parse_text(&text, DocKind::Outgoing).unwrap();
        assert_eq!(rows[0].addressees, "");
        assert_eq!(rows[0].deadline_src, "");
    }

    #[test]
    fn empty_text_is_header_error() {
        let e = parse_text("", DocKind::Outgoing).unwrap_err();
        assert_eq!(e.code, "PARSE_HEADER");
    }

    #[test]
    fn bad_date_is_parse_date_error() {
        let text = format!(
            "{}\r\n\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}",
            OUTGOING_HEADERS.join("\t"),
            "200/3",
            "xx.yy.zz",
            "АО X",
            "тема",
            "Подписант",
            "",
            "Адресат",
            "ref"
        );
        let e = parse_text(&text, DocKind::Outgoing).unwrap_err();
        assert_eq!(e.code, "PARSE_DATE");
    }
}
