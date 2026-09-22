// Движок сверки импорта (docs/plans/v2-backend.md §7.3). Ключ — (kind, reg_number).
// NEW — нет в DOCUMENT (данного вида); SAME — есть и все 7 сравниваемых полей совпадают;
// CHANGED — иначе + diff. Сравнение ПОСЛЕ trim и нормализации даты (обе стороны уже нормализованы).
// kind по построению совпадает (сверка идёт внутри вида); import_batch_id/created_at/updated_at не входят.

use crate::import::parser::ParsedRow;
use crate::model::DocumentRecord;

/// Одно изменившееся поле. field — camelCase-имя (как в DTO).
pub struct FieldDiff {
    pub field: &'static str,
    pub old: String,
    pub new: String,
}

pub enum DiffClass {
    New,
    Same,
    Changed(Vec<FieldDiff>),
}

pub fn classify(row: &ParsedRow, existing: Option<&DocumentRecord>) -> DiffClass {
    match existing {
        None => DiffClass::New,
        Some(doc) => {
            let mut diffs = Vec::new();
            compare(&mut diffs, "regDate", &doc.reg_date, &row.reg_date);
            compare(&mut diffs, "counterparty", &doc.counterparty, &row.counterparty);
            compare(&mut diffs, "topic", &doc.topic, &row.topic);
            compare(&mut diffs, "signer", &doc.signer, &row.signer);
            compare(&mut diffs, "addressees", &doc.addressees, &row.addressees);
            compare(&mut diffs, "deadlineSrc", &doc.deadline_src, &row.deadline_src);
            compare(&mut diffs, "ref", &doc.ref_, &row.ref_);

            if diffs.is_empty() {
                DiffClass::Same
            } else {
                DiffClass::Changed(diffs)
            }
        }
    }
}

fn compare(diffs: &mut Vec<FieldDiff>, field: &'static str, old: &str, new: &str) {
    if old != new {
        diffs.push(FieldDiff {
            field,
            old: old.to_string(),
            new: new.to_string(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dto::DocKind;

    fn rec() -> DocumentRecord {
        DocumentRecord {
            kind: DocKind::Outgoing,
            reg_number: "1".into(),
            reg_date: "2026-01-01".into(),
            counterparty: "A".into(),
            topic: "t".into(),
            signer: "s".into(),
            addressees: "".into(),
            deadline_src: "".into(),
            ref_: "r".into(),
            import_batch_id: 1,
            created_at: "x".into(),
            updated_at: "x".into(),
        }
    }

    fn row() -> ParsedRow {
        ParsedRow {
            kind: DocKind::Outgoing,
            reg_number: "1".into(),
            reg_date: "2026-01-01".into(),
            counterparty: "A".into(),
            topic: "t".into(),
            signer: "s".into(),
            addressees: "".into(),
            deadline_src: "".into(),
            ref_: "r".into(),
        }
    }

    #[test]
    fn new_when_absent() {
        assert!(matches!(classify(&row(), None), DiffClass::New));
    }

    #[test]
    fn same_when_all_equal() {
        assert!(matches!(classify(&row(), Some(&rec())), DiffClass::Same));
    }

    #[test]
    fn changed_reports_counterparty() {
        let mut r = row();
        r.counterparty = "B".into();
        match classify(&r, Some(&rec())) {
            DiffClass::Changed(d) => assert!(d.iter().any(|f| f.field == "counterparty")),
            _ => panic!("ожидался Changed"),
        }
    }

    #[test]
    fn changed_reports_deadline_src() {
        let mut r = row();
        r.deadline_src = "2026-02-02".into();
        match classify(&r, Some(&rec())) {
            DiffClass::Changed(d) => assert!(d.iter().any(|f| f.field == "deadlineSrc")),
            _ => panic!("ожидался Changed"),
        }
    }
}
