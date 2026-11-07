// The template writer: what Sundial says when there is no model.
//
// Every sentence is assembled from facts, so it is duller than a language
// model and never wrong. It is also the fallback whenever a request fails
// validation or the kill switch is on.

import { h1, hourLabel, pct } from './format.js';

const ACTIONS = {
  D01: {
    id: 'shift-evening',
    action: 'Move your late-evening session 90 minutes earlier',
    amount: '3 nights this week',
    effort: 'medium',
  },
  D02: {
    id: 'protect-morning',
    action: 'Protect one 50-minute block before chat opens',
    amount: 'Tuesday to Thursday',
    effort: 'medium',
  },
  D03: {
    id: 'batch-tools',
    action: 'Batch the tool cycling into two 20-minute windows',
    amount: 'twice a day',
    effort: 'low',
  },
  D04: {
    id: 'repeat-block',
    action: 'Repeat your best focus block on two more days',
    amount: '2 extra days',
    effort: 'low',
  },
  D05: {
    id: 'stand-at-ninety',
    action: 'Stand up at the 90-minute mark',
    amount: '3 days this week',
    effort: 'low',
  },
  D06: {
    id: 'one-task-alone',
    action: 'Do one task a day without the assistant',
    amount: '15 minutes each',
    effort: 'low',
  },
  D07: {
    id: 'keep-gap',
    action: 'Keep the long afternoon gap',
    amount: '4 days this week',
    effort: 'low',
  },
  D08: {
    id: 'clear-sunday',
    action: 'Move two hours of weekend browsing to Saturday morning',
    amount: 'leave Sunday clear',
    effort: 'medium',
  },
  default: {
    id: 'one-thing',
    action: 'Pick the pattern that annoys you most and change it by 30 minutes',
    amount: 'one week',
    effort: 'low',
  },
};

export function suggestionFor(facts, accepted = {}) {
  const pattern = facts.patterns.find((p) => p.severity !== 'positive') || facts.patterns[0];
  const base = ACTIONS[pattern?.id] || ACTIONS.default;
  const smaller = accepted[`${base.id}:smaller`] ? true : false;

  return {
    ...base,
    amount: smaller ? halve(base.amount) : base.amount,
    why: pattern ? pattern.evidence.join('; ') : 'no pattern crossed a threshold this week',
    fact_refs: pattern ? [pattern.id] : [],
    source: 'template',
  };
}

function halve(amount) {
  const match = amount.match(/^(\d+)/);
  if (match) {
    const n = Math.max(1, Math.round(Number(match[1]) / 2));
    return amount.replace(/^\d+/, String(n));
  }
  return `half of: ${amount}`;
}

export function narrative(facts) {
  const { totals, shape, coverage, patterns } = facts;
  const lines = [];

  const delta =
    totals.delta_pct === null
      ? 'no baseline yet to compare against'
      : `${totals.delta_pct > 0 ? 'up' : 'down'} ${Math.abs(totals.delta_pct).toFixed(1)}% on the four-week median`;

  lines.push(
    `${h1(totals.active_h)} of active time across ${coverage.days} days, ${delta}. ` +
      `Your busiest hour was ${hourLabel(shape.peak_hour)} and ${pct(shape.late_night_share)} of that time fell after 10pm.`,
  );

  const worst = patterns.filter((p) => p.severity === 'high' || p.severity === 'medium');
  if (worst.length) {
    const [first] = worst;
    lines.push(
      `The pattern worth naming is ${first.name.replace(/_/g, ' ')}: ${first.evidence.join(', ')}. ` +
        `${coverage.complete_days} of ${coverage.days} days were fully captured, so treat the shape as indicative rather than exact.`,
    );
  } else if (patterns.length) {
    lines.push(
      `Nothing crossed a threshold this week. ${patterns[0].evidence.join(', ')} — worth keeping rather than changing.`,
    );
  } else {
    lines.push(
      'No pattern crossed its threshold this week, which is usually what a steady week looks like rather than an absence of data.',
    );
  }

  return lines;
}

/** The whole reflection as plain text, for copying into a note or a chat. */
export function asText(facts, suggestion) {
  const body = narrative(facts);
  return [
    `Sundial — ${facts.window.start} to ${facts.window.end}`,
    '',
    ...body,
    '',
    `One change: ${suggestion.action} (${suggestion.amount}).`,
    suggestion.why ? `Why: ${suggestion.why}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
