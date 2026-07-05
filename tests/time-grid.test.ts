// M6D day-view time math — minutes↔HH:MM, snapping, block geometry, and drag (duration-preserving + clamped).
import {describe, expect, it} from 'vitest';
import {hhmm, toMinutes, toTime, snap, applyDrag, applyResize, PX_PER_MIN, DAY_START_H, DAY_END_H} from '@/app/features/scheduling/timeGrid';

describe('time conversions', () => {
  it('trims seconds and round-trips minutes', () => {
    expect(hhmm('08:30:00')).toBe('08:30');
    expect(hhmm(null)).toBe(null);
    expect(toMinutes('08:30')).toBe(510);
    expect(toTime(510)).toBe('08:30');
    expect(toTime(-100)).toBe('00:00'); // clamped
  });
  it('snaps to quarter hours', () => {
    expect(snap(517)).toBe(510); // 8:37 → 8:30
    expect(snap(523)).toBe(525); // 8:43 → 8:45
  });
});

describe('applyDrag', () => {
  it('moves an event down, preserving its duration, snapped', () => {
    // 08:00–10:00, dragged +90min worth of px
    const r = applyDrag('08:00', '10:00', 90 * PX_PER_MIN);
    expect(r.start).toBe('09:30');
    expect(r.end).toBe('11:30'); // 2h duration kept
  });
  it('clamps so the event cannot leave the grid', () => {
    const up = applyDrag('05:15', '06:15', -600 * PX_PER_MIN); // way up
    expect(toMinutes(up.start)).toBe(DAY_START_H * 60); // clamped to grid top
    const down = applyDrag('20:00', '20:30', 600 * PX_PER_MIN); // way down (30-min event)
    expect(toMinutes(down.end!)).toBeLessThanOrEqual(DAY_END_H * 60);
  });
  it('a duration-less event defaults to a 60-min block and stays null-ended', () => {
    const r = applyDrag('08:00', null, 60 * PX_PER_MIN);
    expect(r.start).toBe('09:00');
    expect(r.end).toBe(null);
  });
});

describe('applyResize', () => {
  it('extends/shrinks the end, keeping start fixed and snapping', () => {
    expect(applyResize('08:00', '10:00', 60 * PX_PER_MIN)).toEqual({start: '08:00', end: '11:00'});
    expect(applyResize('08:00', '10:00', -90 * PX_PER_MIN)).toEqual({start: '08:00', end: '08:30'});
  });
  it('never lets the end cross above start+15min, and gives an untimed event a concrete end', () => {
    expect(applyResize('08:00', '08:30', -600 * PX_PER_MIN).end).toBe('08:15'); // clamped to start+15
    expect(applyResize('08:00', null, 30 * PX_PER_MIN).end).toBe('09:30'); // default 60min block + 30
  });
});
