import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getRegistry, listThemes } from './api/commands';
import type { DocKind, DocumentView, RegistryResult, ThemeDto } from './api/types';
import { useCommand } from './hooks/useCommand';
import { useDocFilters } from './hooks/useDocFilters';
import { docKey, isClosed } from './lib/format';
import { NO_THEME, themesStartFor } from './lib/docFilters';
import type { ThemesStart } from './lib/docFilters';
import { lettersLabel, themesLabel } from './lib/texts';
import { isoToEpochDay } from './lib/dates';
import { laneCount, withAttachedIncoming } from './lib/timeline';
import type { TimelineLaneInput, TimelineZoom } from './lib/timeline';
import ErrorState from './components/common/ErrorState';
import LoadingState from './components/common/LoadingState';
import PageHeader from './components/common/PageHeader';
import RefreshAlert from './components/common/RefreshAlert';
import TabStrip from './components/common/TabStrip';
import type { Tab } from './components/common/TabStrip';
import RegistryView from './components/registry/RegistryView';
import type { RegistryGroupModel } from './components/registry/RegistryView';
import TimelineView from './components/timeline/TimelineView';
import DocumentDrawer from './components/drawer/DocumentDrawer';
import ThemesModal from './components/themes/ThemesModal';
import ImportModal from './components/import/ImportModal';

interface DocRef {
  kind: DocKind;
  regNumber: string;
}

function App() {
  const registry = useCommand<RegistryResult>(() => getRegistry(), []);
  const themes = useCommand<ThemeDto[]>(() => listThemes(), []);

  const [tab, setTab] = useState<Tab>('registry');
  const [closedGroups, setClosedGroups] = useState<Record<string, boolean>>({});
  const [zoom, setZoom] = useState<TimelineZoom>('quarter');
  // Скрыть завершённые — ОБЩЕЕ состояние для обеих вкладок (тумблер в тулбаре «Реестр» и в
  // панели масштаба «Хронология» — одна и та же настройка). Сортировка «вниз» идёт всегда,
  // тумблер дополнительно скрывает закрытые.
  const [hideClosed, setHideClosed] = useState(false);
  const [detail, setDetail] = useState<DocRef | null>(null);
  // Открытие окна тем: копия фильтров реестра + предвыбор (QA-3 п.5). Окно монтируется заново
  // при каждом открытии, поэтому его useDocFilters читает initial один раз — это и есть копия.
  // Если окно перестанут размонтировать — нужен key на ThemesModal (счётчик открытий).
  const [themesReq, setThemesReq] = useState<ThemesStart | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // reload из useCommand стабильны (useCallback без deps) — reloadAll тоже стабилен.
  const { reload: reloadRegistry } = registry;
  const { reload: reloadThemes } = themes;
  const reloadAll = useCallback(() => {
    reloadRegistry();
    reloadThemes();
  }, [reloadRegistry, reloadThemes]);

  const result = registry.state.status === 'ok' ? registry.state.data : null;
  const themeList = themes.state.status === 'ok' ? themes.state.data : [];
  // Повторная загрузка упала, данные прежние — плашка «Не удалось обновить данные».
  const registryRefreshError = registry.state.status === 'ok' ? registry.state.refreshError : null;
  const themesRefreshError = themes.state.status === 'ok' ? themes.state.refreshError : null;
  const refreshing =
    (registry.state.status === 'ok' && registry.state.refreshing) ||
    (themes.state.status === 'ok' && themes.state.refreshing);

  // Дефолт (п.15а): при первой загрузке данных все темы свёрнуты. Один раз — дальше
  // пользователь раскрывает/сворачивает вручную; повторные reload состояние не сбрасывают.
  const groupsInitialized = useRef(false);
  useEffect(() => {
    if (!result || groupsInitialized.current) return;
    groupsInitialized.current = true;
    const collapsed: Record<string, boolean> = {};
    result.groups.forEach((g) => {
      collapsed[g.theme ?? NO_THEME] = true;
    });
    setClosedGroups(collapsed);
  }, [result]);

  // Плоский список в порядке серверных групп: порядковый номер строки стабилен
  // и не зависит от фильтрации (как data-num прототипа).
  const allDocs = useMemo<DocumentView[]>(() => {
    if (!result) return [];
    return result.groups.reduce<DocumentView[]>((acc, g) => acc.concat(g.documents), []);
  }, [result]);

  // Ключ уникален в пределах вида (§5.6): исх. и вх. могут делить один regNumber.
  const byReg = useMemo(() => {
    const map = new Map<string, DocumentView>();
    allDocs.forEach((d) => map.set(docKey(d.kind, d.regNumber), d));
    return map;
  }, [allDocs]);

  const numByReg = useMemo(() => {
    const map = new Map<string, number>();
    allDocs.forEach((d, i) => map.set(docKey(d.kind, d.regNumber), i + 1));
    return map;
  }, [allDocs]);

  // Ключи «закрывающих» входящих: входящее, привязанное к любой задаче (попало в links
  // какого-либо исходящего, letterKind==='incoming'), считается ответом-закрытием и
  // ведёт себя как закрытое. Непривязанное входящее — не закрыто.
  const closingIncoming = useMemo(() => {
    const set = new Set<string>();
    for (const doc of allDocs) {
      if (doc.kind !== 'outgoing') continue;
      for (const link of doc.links) {
        if (link.letterKind === 'incoming') set.add(docKey('incoming', link.letterReg));
      }
    }
    return set;
  }, [allDocs]);

  // «Закрыто» для строки реестра: исходящее done ИЛИ входящее-ответ (ключ в closingIncoming).
  const closed = useCallback(
    (doc: DocumentView): boolean =>
      isClosed(doc) ||
      (doc.kind === 'incoming' && closingIncoming.has(docKey(doc.kind, doc.regNumber))),
    [closingIncoming],
  );

  // «Сегодня» восстанавливается из фактов backend: dueDate − daysRemaining (только исходящие,
  // у которых срок и остаток заданы). Системные часы фронт не читает (инвариант §5.6).
  const todayEpoch = useMemo<number | null>(() => {
    for (const doc of allDocs) {
      if (doc.kind !== 'outgoing' || doc.daysRemaining === null) continue;
      const due = isoToEpochDay(doc.dueDate ?? '');
      if (due !== null) return due - doc.daysRemaining;
    }
    return null;
  }, [allDocs]);

  // Фильтр реестра (QA-3 пп.4, 5): поиск, вид, выпадающие; своё независимое состояние.
  const reg = useDocFilters(allDocs);
  const { matches } = reg;

  const visibleGroups = useMemo<RegistryGroupModel[]>(() => {
    if (!result) return [];
    return result.groups
      .map((g) => {
        // Закрытые строки — всегда вниз внутри группы (стабильная сортировка сохраняет
        // исходный порядок среди открытых и среди закрытых). num берётся из numByReg
        // (по allDocs) — сортировка не влияет на нумерацию.
        const rows = g.documents
          .filter(matches)
          .map((doc) => ({ num: numByReg.get(docKey(doc.kind, doc.regNumber)) ?? 0, doc }))
          .sort((a, b) => Number(closed(a.doc)) - Number(closed(b.doc)))
          .filter((r) => !hideClosed || !closed(r.doc));
        return { name: g.theme ?? NO_THEME, rows };
      })
      .filter((g) => g.rows.length > 0);
  }, [result, matches, numByReg, closed, hideClosed]);

  // Дорожки таймлайна — темы исходящих (тема есть только у них, §5.6.9); привязанные входящие
  // подмешиваются в дорожку своей задачи (§6).
  const timelineGroups = useMemo<TimelineLaneInput[]>(() => {
    if (!result) return [];
    const lanes = result.groups.map((g) => ({
      name: g.theme ?? NO_THEME,
      docs: g.documents.filter((d) => d.kind === 'outgoing'),
    }));
    const withIncoming = withAttachedIncoming(lanes, byReg);
    // Порядок ТЕМ-ДОРОЖЕК между собой: полностью закрытые темы — вниз (стабильная сортировка).
    // Тема закрыта, если ВСЕ её исходящие выполнены (done); без исходящих — не закрыта.
    // Сортировка/скрытие ЦЕПОЧЕК внутри дорожки (в т.ч. тумблер «Скрыть завершённые») теперь
    // делает buildTimeline на уровне цепочек — здесь дорожки по hideClosed не фильтруем.
    const themeClosed = (lane: TimelineLaneInput): boolean => {
      const outs = lane.docs.filter((d) => d.kind === 'outgoing');
      return outs.length > 0 && outs.every(isClosed);
    };
    return withIncoming
      .slice()
      .sort((a, b) => Number(themeClosed(a)) - Number(themeClosed(b)));
  }, [result, byReg]);

  const shown = visibleGroups.reduce((n, g) => n + g.rows.length, 0);
  // «Без темы» — не тема (п.9): и в шапке, и в подсказке вкладки «Связи» считаются только
  // именованные темы (решение пользователя F4 + финальный QA: везде одно число).
  const themeCount = result ? result.groups.filter((g) => g.theme !== null).length : 0;
  const namedLanes = laneCount(timelineGroups.filter((g) => g.name !== NO_THEME));

  const handleToggleGroup = useCallback((name: string) => {
    setClosedGroups((prev) => ({ ...prev, [name]: !prev[name] }));
  }, []);

  // Шестерёнка темы (QA-3 п.5): окно получает КОПИЮ фильтров реестра. «Без темы» → Тема =
  // «Без темы»; именованная тема → предвыбраны ровно строки её группы в реестре (с учётом
  // «Скрыть завершённые»; сам тумблер в окно не переносится). Меню реестра закрываем — путь
  // с клавиатуры (меню открыто, Tab до шестерёнки, Enter).
  const { state: regState, closeMenu: closeRegMenu } = reg;
  const handleConfigureTheme = useCallback(
    (name: string) => {
      closeRegMenu();
      setThemesReq(themesStartFor(name, regState, allDocs, hideClosed ? closed : null));
    },
    [closeRegMenu, regState, allDocs, hideClosed, closed],
  );

  // Удалённая тема снимается из фильтра «Тема» реестра (иначе фильтр по несуществующей теме).
  const { dropValue: dropRegValue } = reg;
  const handleThemeDeleted = useCallback(
    (name: string) => dropRegValue('theme', name),
    [dropRegValue],
  );

  const handleOpenDoc = useCallback((kind: DocKind, regNumber: string) => {
    setDetail({ kind, regNumber });
  }, []);

  // Загрузка/ошибка на весь экран — только пока данных ещё нет (первая загрузка). reloadAll после
  // действий идёт по stale-while-revalidate (useCommand): данные остаются 'ok', открытые окна
  // (темы, drawer, импорт) не размонтируются и не теряют своё состояние (фикс QA F3 (л)).
  if (registry.state.status === 'loading') {
    return (
      <div className="page">
        <LoadingState />
      </div>
    );
  }
  if (registry.state.status === 'error') {
    return (
      <div className="page">
        <ErrorState error={registry.state.error} onRetry={reloadAll} />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        totalLabel={`${lettersLabel(allDocs.length)} · ${themesLabel(themeCount)}`}
        onPrint={() => window.print()}
        onOpenImport={() => setImportOpen(true)}
      />
      <RefreshAlert
        errors={[registryRefreshError, themesRefreshError]}
        busy={refreshing}
        onRetry={reloadAll}
      />
      <TabStrip
        tab={tab}
        registryHint={lettersLabel(allDocs.length)}
        graphHint={themesLabel(namedLanes)}
        onPick={setTab}
      />

      {tab === 'registry' ? (
        <RegistryView
          groups={visibleGroups}
          docFilters={reg}
          shownLabel={`Показано ${shown} из ${allDocs.length}`}
          hideClosed={hideClosed}
          onToggleHideClosed={() => setHideClosed((v) => !v)}
          closedGroups={closedGroups}
          onToggleGroup={handleToggleGroup}
          onConfigureTheme={handleConfigureTheme}
          onOpenDoc={handleOpenDoc}
        />
      ) : (
        <TimelineView
          groups={timelineGroups}
          todayEpoch={todayEpoch}
          zoom={zoom}
          onZoom={setZoom}
          hideClosed={hideClosed}
          onToggleHideClosed={() => setHideClosed((v) => !v)}
          onOpenDoc={handleOpenDoc}
        />
      )}

      {themesReq ? (
        <ThemesModal
          docs={allDocs}
          themes={themeList}
          initialFilters={themesReq.initial}
          preselect={themesReq.preselect}
          onClose={() => setThemesReq(null)}
          onChanged={reloadAll}
          onThemeDeleted={handleThemeDeleted}
        />
      ) : null}

      {importOpen ? (
        <ImportModal byReg={byReg} onClose={() => setImportOpen(false)} onApplied={reloadAll} />
      ) : null}

      {detail ? (
        <DocumentDrawer
          kind={detail.kind}
          regNumber={detail.regNumber}
          byReg={byReg}
          todayEpoch={todayEpoch}
          onNavigate={handleOpenDoc}
          onClose={() => setDetail(null)}
          onChanged={reloadAll}
        />
      ) : null}
    </div>
  );
}

export default App;
