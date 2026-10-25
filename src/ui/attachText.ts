import { t, type MessageKey } from '@/i18n';
import type { AttachDef } from '@/weapons/attachments';

/** One line of what an attachment does: good or bad for the one carrying it, or neither. */
export interface EffectLine {
  text: string;
  tone: 'good' | 'bad' | 'plain';
}

const pct = (x: number) => `${x > 1 ? '+' : '−'}${Math.round(Math.abs(x - 1) * 100)}%`;

/**
 * The kit picker's lines for an attachment (attachments.ts `AttachEffect`):
 * a multiplier on a time or a recoil is good below 1, on capacity above 1.
 */
export function effectLines(a: AttachDef): EffectLine[] {
  const e = a.effect;
  const out: EffectLine[] = [];
  const line = (key: string, x: number | undefined, lowerIsBetter = true) => {
    if (x === undefined || x === 1) return;
    out.push({ text: `${t(`attachFx.${key}` as MessageKey)} ${pct(x)}`, tone: x < 1 === lowerIsBetter ? 'good' : 'bad' });
  };
  const flag = (key: string, tone: EffectLine['tone']) => out.push({ text: t(`attachFx.${key}` as MessageKey), tone });
  if (e.zoom !== undefined && e.zoom !== 1) out.push({ text: t('attachFx.zoom').replace('{n}', String(e.zoom)), tone: 'plain' });
  if (e.zoom === 1) flag('sight', 'plain');
  if (e.suppressed) flag('suppressed', 'good');
  if (e.flash === 'small') flag('flashSmall', 'good');
  if (e.bipod) flag('bipod', 'good');
  line('up', e.up);
  line('side', e.side);
  line('hip', e.hip);
  line('pellets', e.pellets);
  line('mag', e.mag, false);
  line('reload', e.reload);
  line('insert', e.insert);
  line('ads', e.ads);
  line('sprintOut', e.sprintOut);
  line('falloff', e.falloff, false);
  if (e.hear) out.push({ text: `${t('attachFx.hear')} ${pct(e.hear)}`, tone: 'bad' });
  if (e.laser === 'hip') flag('laserHip', 'bad');
  if (e.laser === 'tac') flag('laserTac', 'bad');
  if (e.scope) flag('scope', 'plain');
  return out;
}
