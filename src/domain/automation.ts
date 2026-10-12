export interface AutomationPoint {
  time: number;
  value: number;
}
export type AutomationLane = 'gain' | 'pan' | 'lowpass';
export type Automation = Record<AutomationLane, AutomationPoint[]>;
export const emptyAutomation = (): Automation => ({ gain: [], pan: [], lowpass: [] });
export const AUTOMATION_BOUNDS = { gain: [0, 2], pan: [-1, 1], lowpass: [20, 20000] } as const;

/** Positions are fractions of the played region; edges hold the nearest point. */
export function automationAt(points: AutomationPoint[], time: number, fallback: number): number {
  if (!points.length) return fallback;
  if (time <= points[0].time) return points[0].value;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    if (time <= b.time)
      return a.value + ((b.value - a.value) * (time - a.time)) / (b.time - a.time);
  }
  return points[points.length - 1].value;
}
export function cropAutomation(automation: Automation, start: number, end: number): Automation {
  return Object.fromEntries(
    Object.entries(automation).map(([lane, points]) => {
      if (!points.length) return [lane, []];
      const kept = points
        .filter((p) => p.time >= start && p.time <= end)
        .map((p) => ({ ...p, time: (p.time - start) / (end - start) }));
      // Add a boundary only when cutting through a ramp. A removed outside point
      // pays for each new boundary, so splitting a full lane never exceeds its cap.
      if (
        start > points[0].time &&
        start < points[points.length - 1].time &&
        !kept.some((p) => p.time === 0)
      )
        kept.unshift({ time: 0, value: automationAt(points, start, 0) });
      if (
        end > points[0].time &&
        end < points[points.length - 1].time &&
        !kept.some((p) => p.time === 1)
      )
        kept.push({ time: 1, value: automationAt(points, end, 0) });
      if (!kept.length) kept.push({ time: 0, value: automationAt(points, start, 0) });
      return [lane, kept];
    }),
  ) as Automation;
}
