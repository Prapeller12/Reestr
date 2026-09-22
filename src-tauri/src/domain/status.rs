// Вычисление статуса и производных (КОНЦЕПЦИЯ §3, docs/plans/v2-backend.md §4).
// Статус НИГДЕ не хранится — вычисляется из (regDate + deadlineSrc? + endDate? + привязки + today).
// Драйвер статуса — ПРИВЯЗАННЫЕ ПИСЬМА: входящее → Выполнено, повторное исходящее → В доработке.
// Чистые функции: вход — факты + флаги привязок + «сегодня», выход — статус/срок/алерты/тексты.

use chrono::{Duration, NaiveDate};

use crate::dto::{AlertLevel, DocStatus};

/// Срок по умолчанию: regDate + 30 КАЛЕНДАРНЫХ дней (число фиксировано, §8 КОНЦЕПЦИИ).
const DEFAULT_DEADLINE_DAYS: i64 = 30;

/// Порог «жёлтой» зоны для InWork (дней до срока). На контракт не влияет.
const AMBER_THRESHOLD_DAYS: i64 = 7;

/// Результат расчёта — всё, что нужно для DocumentView (исходящего).
pub struct StatusComputation {
    pub status: DocStatus,
    pub due_date: String,
    pub days_remaining: i64,
    pub alert_level: AlertLevel,
    pub remaining_text: String,
    pub status_label: String,
}

fn parse_iso(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
}

/// dueDate — приоритет источника (§3, флип 2026-09-08): ручной endDate → deadlineSrc из выгрузки →
/// regDate + 30 дней. Ручной срок авторитетнее выгрузки — иначе выставленный пользователем срок был
/// бы неэффективен при непустом «Срок исполнения» из 1С.
pub fn due_date(reg_date: &str, deadline_src: Option<&str>, end_date: Option<&str>) -> String {
    if let Some(ed) = end_date {
        if !ed.is_empty() {
            return ed.to_string();
        }
    }
    if let Some(ds) = deadline_src {
        if !ds.is_empty() {
            return ds.to_string();
        }
    }
    match parse_iso(reg_date) {
        Some(d) => (d + Duration::days(DEFAULT_DEADLINE_DAYS))
            .format("%Y-%m-%d")
            .to_string(),
        // Деградация: если regDate почему-то не ISO — возвращаем как есть.
        None => reg_date.to_string(),
    }
}

/// Полный расчёт статуса и производных для ИСХОДЯЩЕЙ задачи (§3).
/// Приоритет: привязано ВХОДЯЩЕЕ → Done; иначе привязано ИСХОДЯЩЕЕ → Reworked;
/// иначе срок прошёл → Overdue; иначе → InWork. Входящее «сильнее» исходящего (порядок веток).
pub fn compute(
    reg_date: &str,
    deadline_src: Option<&str>,
    end_date: Option<&str>,
    has_incoming_link: bool,
    has_outgoing_link: bool,
    today: &str,
) -> StatusComputation {
    let due = due_date(reg_date, deadline_src, end_date);
    let due_d = parse_iso(&due);
    let today_d = parse_iso(today);

    let days_remaining = match (due_d, today_d) {
        (Some(due), Some(now)) => (due - now).num_days(),
        _ => 0,
    };

    let status = if has_incoming_link {
        DocStatus::Done
    } else if has_outgoing_link {
        DocStatus::Reworked
    } else {
        match (today_d, due_d) {
            (Some(now), Some(due)) if now > due => DocStatus::Overdue,
            _ => DocStatus::InWork,
        }
    };

    StatusComputation {
        status,
        due_date: due,
        days_remaining,
        alert_level: alert_level(status, days_remaining),
        remaining_text: remaining_text(status, days_remaining),
        status_label: status_label(status).to_string(),
    }
}

/// Русская подпись статуса для UI.
pub fn status_label(status: DocStatus) -> &'static str {
    match status {
        DocStatus::InWork => "В работе",
        DocStatus::Overdue => "Не выполнено",
        DocStatus::Done => "Выполнено",
        DocStatus::Reworked => "В доработке",
    }
}

fn alert_level(status: DocStatus, days_remaining: i64) -> AlertLevel {
    match status {
        // Конечные статусы — без тревоги (позднее входящее → Done без красной даты).
        DocStatus::Done | DocStatus::Reworked => AlertLevel::None,
        // Просрочено — всегда красный.
        DocStatus::Overdue => AlertLevel::Red,
        // В работе: сегодня-крайний → red; близко к сроку → amber; иначе none.
        DocStatus::InWork => {
            if days_remaining <= 0 {
                AlertLevel::Red
            } else if days_remaining <= AMBER_THRESHOLD_DAYS {
                AlertLevel::Amber
            } else {
                AlertLevel::None
            }
        }
    }
}

fn remaining_text(status: DocStatus, days_remaining: i64) -> String {
    match status {
        // Конечные статусы — пустая строка: слово «выполнено» / «в доработке» дублировало бы
        // бейдж статуса в соседней колонке той же строки (решение пользователя 2026-09-20, п.8).
        DocStatus::Done | DocStatus::Reworked => String::new(),
        DocStatus::Overdue => format!("просрочено на {} дн.", days_remaining.abs()),
        DocStatus::InWork => {
            if days_remaining == 0 {
                "сегодня последний день".to_string()
            } else {
                format!("осталось {} дн.", days_remaining)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn incoming_link_done_even_when_overdue() {
        // Позднее входящее (после срока) всё равно Выполнено; красной даты нет.
        let c = compute("2026-01-01", None, None, true, false, "2026-09-01");
        assert_eq!(c.status, DocStatus::Done);
        assert_eq!(c.alert_level, AlertLevel::None);
    }

    #[test]
    fn incoming_beats_outgoing() {
        let c = compute("2026-01-01", None, None, true, true, "2026-09-01");
        assert_eq!(c.status, DocStatus::Done);
    }

    #[test]
    fn outgoing_link_reworked() {
        let c = compute("2026-01-01", None, None, false, true, "2026-01-05");
        assert_eq!(c.status, DocStatus::Reworked);
    }

    #[test]
    fn no_link_overdue_label_is_ne_vypolneno() {
        let c = compute("2026-01-01", None, None, false, false, "2026-09-01");
        assert_eq!(c.status, DocStatus::Overdue);
        assert_eq!(c.alert_level, AlertLevel::Red);
        assert_eq!(status_label(DocStatus::Overdue), "Не выполнено");
    }

    #[test]
    fn no_link_inwork_before_due() {
        let c = compute("2026-08-30", None, None, false, false, "2026-09-01");
        assert_eq!(c.status, DocStatus::InWork);
    }

    #[test]
    fn due_priority_end_over_src_over_default() {
        // Флип 2026-09-08: ручной endDate побеждает deadlineSrc из выгрузки.
        assert_eq!(
            due_date("2026-01-01", Some("2026-02-02"), Some("2026-03-03")),
            "2026-03-03"
        );
        // Нет ручного — берём deadlineSrc.
        assert_eq!(due_date("2026-01-01", Some("2026-02-02"), None), "2026-02-02");
        // Ни ручного, ни src — regDate + 30.
        assert_eq!(due_date("2026-01-01", None, None), "2026-01-31");
    }

    #[test]
    fn manual_end_date_beats_deadline_src() {
        // Ручной срок эффективен даже при заполненном «Срок исполнения» из 1С.
        let c = compute(
            "2026-01-01",
            Some("2026-02-02"), // deadlineSrc из выгрузки
            Some("2026-05-05"), // ручной endDate (позже) — должен победить
            false,
            false,
            "2026-03-01",
        );
        assert_eq!(c.due_date, "2026-05-05");
        // На 2026-03-01 до ручного срока ещё далеко → в работе, не просрочено.
        assert_eq!(c.status, DocStatus::InWork);
    }

    #[test]
    fn remaining_text_is_empty_for_done_and_reworked() {
        // Решение пользователя 2026-09-20, п.8: колонка «Осталось дней» у конечных статусов
        // пустая — слово дублировало бы бейдж статуса в той же строке.
        let done = compute("2026-01-01", None, None, true, false, "2026-09-01");
        assert_eq!(done.status, DocStatus::Done);
        assert_eq!(done.remaining_text, "");

        let reworked = compute("2026-01-01", None, None, false, true, "2026-01-05");
        assert_eq!(reworked.status, DocStatus::Reworked);
        assert_eq!(reworked.remaining_text, "");
    }

    #[test]
    fn remaining_text_wording_for_open_statuses() {
        let overdue = compute("2026-01-01", None, None, false, false, "2026-02-05");
        assert_eq!(overdue.status, DocStatus::Overdue);
        assert_eq!(overdue.remaining_text, "просрочено на 5 дн.");

        // regDate + 30 = 2026-01-31; «сегодня» = срок → последний день.
        let last_day = compute("2026-01-01", None, None, false, false, "2026-01-31");
        assert_eq!(last_day.status, DocStatus::InWork);
        assert_eq!(last_day.remaining_text, "сегодня последний день");

        let in_work = compute("2026-01-01", None, None, false, false, "2026-01-21");
        assert_eq!(in_work.remaining_text, "осталось 10 дн.");
    }
}
