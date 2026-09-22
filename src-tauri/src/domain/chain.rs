// Сборка цепочек «Связи писем» (docs/plans/v2-backend.md §5.8).
// Чистые функции над предзагруженными картами (никакого I/O): карты строит view::load.
//
// Модель LINK v2: привязка (task_reg → letter_reg, letter_kind). Цепочка идёт по повторным
// исходящим, а привязанное ВХОДЯЩЕЕ замыкает её (§3: входящее переводит задачу в «Выполнено»):
//   - Предшественники (backward): задачи, которые привязали данный документ как письмо
//     (по links_by_letter). Рекурсивно назад. Есть и у входящего письма.
//   - Продолжения (forward): письма, привязанные данной задачей — сначала повторные исходящие
//     (рекурсивно вперёд), затем входящие-листья.
// Задачей (task_reg) всегда выступает исходящее, поэтому вглубь обходятся только исходящие.
// Циклы отсекаются множеством посещённых (kind, reg_number): номер уникален лишь в пределах вида.

use std::collections::{HashMap, HashSet};

use crate::domain::status;
use crate::dto::{ChainNode, DocKind};
use crate::model::{DocumentRecord, LinkRecord};

/// Предзагруженные индексы для обхода (все — заимствования из ViewContext).
pub struct ChainMaps<'a> {
    pub docs_by_key: &'a HashMap<(DocKind, String), DocumentRecord>,
    /// task_reg -> его привязки (forward: продолжения). Ключ всегда исходящий.
    pub links_by_task: &'a HashMap<String, Vec<LinkRecord>>,
    /// (kind, letter_reg) -> [task_reg] (backward: кто привязал этот документ как письмо).
    pub links_by_letter: &'a HashMap<(DocKind, String), Vec<String>>,
    /// Дедлайн-оверлей: ключ — голый doc_reg, по схеме относится только к исходящим.
    pub deadline_by_doc: &'a HashMap<String, String>,
    pub today: &'a str,
}

/// Узел цепочки для документа (kind, reg) — None, если такого документа нет.
/// У входящего статуса нет (§2), и оверлей дедлайна к нему не применяется.
fn node_for(kind: DocKind, reg: &str, maps: &ChainMaps) -> Option<ChainNode> {
    let doc = maps.docs_by_key.get(&(kind, reg.to_string()))?;
    Some(ChainNode {
        reg_number: doc.reg_number.clone(),
        kind,
        ref_: doc.ref_.clone(),
        topic: doc.topic.clone(),
        status: if kind == DocKind::Outgoing {
            Some(status_of_task(doc, reg, maps))
        } else {
            None
        },
    })
}

/// Статус исходящей задачи по её привязкам и дедлайну (§3).
fn status_of_task(doc: &DocumentRecord, reg: &str, maps: &ChainMaps) -> crate::dto::DocStatus {
    let end_date = maps.deadline_by_doc.get(reg).map(String::as_str);
    let tl = maps.links_by_task.get(reg);
    let has_in = tl.map_or(false, |v| v.iter().any(|l| l.letter_kind == DocKind::Incoming));
    let has_out = tl.map_or(false, |v| v.iter().any(|l| l.letter_kind == DocKind::Outgoing));
    let ds = if doc.deadline_src.is_empty() {
        None
    } else {
        Some(doc.deadline_src.as_str())
    };
    status::compute(&doc.reg_date, ds, end_date, has_in, has_out, maps.today).status
}

/// Предшественники документа (рекурсивно назад: задачи, привязавшие его как письмо).
pub fn predecessors(kind: DocKind, reg: &str, maps: &ChainMaps) -> Vec<ChainNode> {
    let mut out = Vec::new();
    let mut visited: HashSet<(DocKind, String)> = HashSet::new();
    visited.insert((kind, reg.to_string()));
    collect_predecessors(kind, reg, maps, &mut visited, &mut out);
    out
}

fn collect_predecessors(
    kind: DocKind,
    reg: &str,
    maps: &ChainMaps,
    visited: &mut HashSet<(DocKind, String)>,
    out: &mut Vec<ChainNode>,
) {
    if let Some(tasks) = maps.links_by_letter.get(&(kind, reg.to_string())) {
        for task in tasks {
            // Привязать письмо может только исходящая задача (task_reg всегда исходящий).
            if !visited.insert((DocKind::Outgoing, task.clone())) {
                continue;
            }
            if let Some(node) = node_for(DocKind::Outgoing, task, maps) {
                out.push(node);
            }
            collect_predecessors(DocKind::Outgoing, task, maps, visited, out);
        }
    }
}

/// Продолжения задачи: повторные исходящие (рекурсивно) и замыкающие входящие.
/// У входящего письма продолжений нет — оно лист цепочки.
pub fn successors(kind: DocKind, reg: &str, maps: &ChainMaps) -> Vec<ChainNode> {
    let mut out = Vec::new();
    if kind != DocKind::Outgoing {
        return out;
    }
    let mut visited: HashSet<(DocKind, String)> = HashSet::new();
    visited.insert((kind, reg.to_string()));
    collect_successors(reg, maps, &mut visited, &mut out);
    out
}

fn collect_successors(
    reg: &str,
    maps: &ChainMaps,
    visited: &mut HashSet<(DocKind, String)>,
    out: &mut Vec<ChainNode>,
) {
    let Some(links) = maps.links_by_task.get(reg) else {
        return;
    };
    // Два прохода: сначала вглубь по повторным исходящим, затем входящие-листья — чтобы
    // письмо, которым задача закрыта, оказалось в конце цепочки, а не в её середине.
    for l in links.iter().filter(|l| l.letter_kind == DocKind::Outgoing) {
        if !visited.insert((DocKind::Outgoing, l.letter_reg.clone())) {
            continue;
        }
        if let Some(node) = node_for(DocKind::Outgoing, &l.letter_reg, maps) {
            out.push(node);
        }
        collect_successors(&l.letter_reg, maps, visited, out);
    }
    for l in links.iter().filter(|l| l.letter_kind == DocKind::Incoming) {
        if !visited.insert((DocKind::Incoming, l.letter_reg.clone())) {
            continue;
        }
        if let Some(node) = node_for(DocKind::Incoming, &l.letter_reg, maps) {
            out.push(node);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dto::DocStatus;

    const TODAY: &str = "2026-09-08";

    fn doc(kind: DocKind, reg: &str, reg_date: &str) -> DocumentRecord {
        DocumentRecord {
            kind,
            reg_number: reg.to_string(),
            reg_date: reg_date.to_string(),
            counterparty: String::new(),
            topic: format!("тема {reg}"),
            signer: String::new(),
            addressees: String::new(),
            deadline_src: String::new(),
            ref_: String::new(),
            import_batch_id: 1,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    fn link(id: i64, task: &str, letter: &str, letter_kind: DocKind) -> LinkRecord {
        LinkRecord {
            id,
            task_reg: task.to_string(),
            letter_reg: letter.to_string(),
            letter_kind,
            created_at: format!("2026-01-01 00:00:0{id}"),
        }
    }

    /// Собрать индексы ровно так, как это делает view::load.
    struct Fixture {
        docs_by_key: HashMap<(DocKind, String), DocumentRecord>,
        links_by_task: HashMap<String, Vec<LinkRecord>>,
        links_by_letter: HashMap<(DocKind, String), Vec<String>>,
        deadline_by_doc: HashMap<String, String>,
    }

    impl Fixture {
        fn new(docs: Vec<DocumentRecord>, links: Vec<LinkRecord>) -> Self {
            let mut docs_by_key = HashMap::new();
            for d in docs {
                docs_by_key.insert((d.kind, d.reg_number.clone()), d);
            }
            let mut links_by_task: HashMap<String, Vec<LinkRecord>> = HashMap::new();
            let mut links_by_letter: HashMap<(DocKind, String), Vec<String>> = HashMap::new();
            for l in links {
                links_by_letter
                    .entry((l.letter_kind, l.letter_reg.clone()))
                    .or_default()
                    .push(l.task_reg.clone());
                links_by_task.entry(l.task_reg.clone()).or_default().push(l);
            }
            Fixture {
                docs_by_key,
                links_by_task,
                links_by_letter,
                deadline_by_doc: HashMap::new(),
            }
        }

        fn maps(&self) -> ChainMaps<'_> {
            ChainMaps {
                docs_by_key: &self.docs_by_key,
                links_by_task: &self.links_by_task,
                links_by_letter: &self.links_by_letter,
                deadline_by_doc: &self.deadline_by_doc,
                today: TODAY,
            }
        }
    }

    #[test]
    fn attached_incoming_closes_successors() {
        // Задача 100/1310 закрыта входящим 1531 — оно и есть продолжение цепочки.
        let f = Fixture::new(
            vec![
                doc(DocKind::Outgoing, "100/1310", "2026-01-21"),
                doc(DocKind::Incoming, "1531", "2026-02-10"),
            ],
            vec![link(1, "100/1310", "1531", DocKind::Incoming)],
        );
        let out = successors(DocKind::Outgoing, "100/1310", &f.maps());
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].reg_number, "1531");
        assert_eq!(out[0].kind, DocKind::Incoming);
        assert_eq!(out[0].status, None); // у входящего статуса нет (§2)
    }

    #[test]
    fn incoming_goes_after_outgoing_thread() {
        // У задачи есть и повторное исходящее, и закрывающее входящее: входящее — последним.
        let f = Fixture::new(
            vec![
                doc(DocKind::Outgoing, "100/1", "2026-01-10"),
                doc(DocKind::Outgoing, "100/2", "2026-02-10"),
                doc(DocKind::Incoming, "500", "2026-03-10"),
            ],
            vec![
                link(1, "100/1", "500", DocKind::Incoming),
                link(2, "100/1", "100/2", DocKind::Outgoing),
            ],
        );
        let out = successors(DocKind::Outgoing, "100/1", &f.maps());
        let regs: Vec<&str> = out.iter().map(|n| n.reg_number.as_str()).collect();
        assert_eq!(regs, vec!["100/2", "500"]);
    }

    #[test]
    fn incoming_card_shows_closed_tasks_as_predecessors() {
        // Одно входящее может закрывать несколько задач — все они предшественники.
        let f = Fixture::new(
            vec![
                doc(DocKind::Outgoing, "100/1", "2026-01-10"),
                doc(DocKind::Outgoing, "100/2", "2026-01-11"),
                doc(DocKind::Incoming, "500", "2026-02-10"),
            ],
            vec![
                link(1, "100/1", "500", DocKind::Incoming),
                link(2, "100/2", "500", DocKind::Incoming),
            ],
        );
        let maps = f.maps();
        let preds = predecessors(DocKind::Incoming, "500", &maps);
        let mut regs: Vec<&str> = preds.iter().map(|n| n.reg_number.as_str()).collect();
        regs.sort();
        assert_eq!(regs, vec!["100/1", "100/2"]);
        assert!(preds.iter().all(|n| n.kind == DocKind::Outgoing));
        assert_eq!(preds[0].status, Some(DocStatus::Done)); // закрыта входящим
        // У самого входящего продолжений нет — оно лист.
        assert!(successors(DocKind::Incoming, "500", &maps).is_empty());
    }

    #[test]
    fn same_reg_number_across_kinds_does_not_collide() {
        // ВХ 1451 и ИСХ 1451 — разные документы (§5.6): цепочки не должны смешиваться.
        let f = Fixture::new(
            vec![
                doc(DocKind::Outgoing, "100/9", "2026-01-10"),
                doc(DocKind::Outgoing, "1451", "2026-01-12"),
                doc(DocKind::Incoming, "1451", "2026-02-12"),
            ],
            vec![link(1, "100/9", "1451", DocKind::Incoming)],
        );
        let maps = f.maps();
        // Предшественник есть только у ВХОДЯЩЕГО 1451.
        assert_eq!(predecessors(DocKind::Incoming, "1451", &maps).len(), 1);
        assert!(predecessors(DocKind::Outgoing, "1451", &maps).is_empty());
    }

    #[test]
    fn cycle_is_broken() {
        // Взаимные привязки исходящих не должны зациклить обход.
        let f = Fixture::new(
            vec![
                doc(DocKind::Outgoing, "100/1", "2026-01-10"),
                doc(DocKind::Outgoing, "100/2", "2026-01-20"),
            ],
            vec![
                link(1, "100/1", "100/2", DocKind::Outgoing),
                link(2, "100/2", "100/1", DocKind::Outgoing),
            ],
        );
        let maps = f.maps();
        assert_eq!(successors(DocKind::Outgoing, "100/1", &maps).len(), 1);
        assert_eq!(predecessors(DocKind::Outgoing, "100/1", &maps).len(), 1);
    }
}
