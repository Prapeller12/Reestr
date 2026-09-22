import { describe, expect, it } from 'vitest';
import { stepValue } from './segmented';

const V = ['all', 'outgoing', 'incoming'] as const;

describe('stepValue', () => {
  it('вперёд и назад по кругу', () => {
    expect(stepValue(V, 'all', 'ArrowRight')).toBe('outgoing');
    expect(stepValue(V, 'incoming', 'ArrowRight')).toBe('all');
    expect(stepValue(V, 'incoming', 'ArrowDown')).toBe('all');
    expect(stepValue(V, 'all', 'ArrowLeft')).toBe('incoming');
    expect(stepValue(V, 'outgoing', 'ArrowUp')).toBe('all');
  });

  it('Home / End', () => {
    expect(stepValue(V, 'outgoing', 'Home')).toBe('all');
    expect(stepValue(V, 'outgoing', 'End')).toBe('incoming');
  });

  it('текущего нет в списке → первый; чужая клавиша → null', () => {
    const values: string[] = [...V];
    expect(stepValue(values, 'x', 'ArrowRight')).toBe('all');
    expect(stepValue(values, 'x', 'ArrowLeft')).toBe('all');
    expect(stepValue(V, 'all', 'Enter')).toBeNull();
    expect(stepValue([], 'x', 'Home')).toBeNull();
  });
});
