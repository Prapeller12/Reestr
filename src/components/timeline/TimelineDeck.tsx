import { useLayoutEffect, useRef, useState } from 'react';
import type { DocKind } from '../../api/types';
import { CHIP_GAP, CHIP_W, chipSpan } from '../../lib/timeline';
import type { TimelineChipModel, TimelineUnfoldChain } from '../../lib/timeline';
import { formatEpochDay } from '../../lib/dates';
import TimelineChip from './TimelineChip';

interface Props {
  chip: TimelineChipModel;
  chains: TimelineUnfoldChain[];
  onExpandedHeight: (id: string, height: number) => void;
  onOpen: (kind: DocKind, regNumber: string) => void;
}

/** Непрерывная область наведения, включая промежутки между раскрытыми письмами. */
export default function TimelineDeck({ chip, chains, onOpen, onExpandedHeight }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState({ left: 0, width: CHIP_W, height: 88 });
  const widest = Math.max(1, ...chains.map(chain => chain.members.length));
  useLayoutEffect(() => {
    if (!open || !root.current) return;
    const group = root.current;
    const scroll = group.closest('.timeline__scroll');
    if (!(scroll instanceof HTMLElement)) return;
    const measure = () => {
      const box = scroll.getBoundingClientRect();
      const anchor = group.getBoundingClientRect();
      const start = box.left + 230;
      const end = box.left + scroll.clientWidth;
      const width = Math.min(widest * (CHIP_W + CHIP_GAP) - CHIP_GAP + 16,
        Math.max(CHIP_W + 16, end - start));
      const left = Math.max(start, Math.min(anchor.left - 8, end - width));
      const height = Math.min(chains.length * 94 + 8, Math.max(100, window.innerHeight - box.top - 64));
      setPanel({ left: left - anchor.left, width, height });
      onExpandedHeight(chip.id, height + 8);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    scroll.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); scroll.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); onExpandedHeight(chip.id, 0); };
  }, [open, widest, chains.length, chip.id, onExpandedHeight]);

  return (
    <div
      ref={root}
      className={`timeline__deck${open ? ' timeline__deck_open' : ''}`}
      style={{ left: chipSpan(chip).left, top: 4, height: open ? panel.height : 76 }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!root.current?.contains(document.activeElement)) setOpen(false);
      }}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          root.current?.querySelector<HTMLButtonElement>('.timeline__deck-face button')?.focus();
          setOpen(false);
          event.stopPropagation();
        }
      }}
    >
      <div className="timeline__deck-face">
        <TimelineChip chip={{ ...chip, left: chip.flip ? CHIP_W : 0, top: 32 }}
          onOpen={onOpen} onDeck={() => setOpen(true)} expanded={open} />
      </div>
      {open ? (
        <div className="timeline__unfold" role="group" aria-label="Письма в стопке"
          style={{ left: panel.left, width: panel.width, maxHeight: panel.height }}>
          {chains.map((chain, index) => (
            <section className="timeline__unfold-chain" key={chain.id} aria-label={`Цепочка ${index + 1}`}>
              <div className="timeline__unfold-heading">{chain.label}</div>
              <div className="timeline__unfold-row">
          {chain.members.map((member) => (
            <div className="timeline__unfold-item" key={member.id}>
              <TimelineChip chip={{ ...member, left: 0, top: 24, flip: false }}
                onOpen={onOpen} onDeck={() => {}} />
              <div className="timeline__unfold-date">{formatEpochDay(member.firstEpoch)}</div>
            </div>
          ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
