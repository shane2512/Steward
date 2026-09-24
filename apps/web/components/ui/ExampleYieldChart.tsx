'use client';
// Visual language borrowed from a 21st.dev glass/area-chart component, but the data is static and
// labelled "Example" (matching the precedent already on this page for the balance card) rather than
// fetched live — this app has no time-series API yet, and a marketing page is not the place to
// fabricate a financial chart that looks real. Never used on an authenticated screen.
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const EXAMPLE_APY: { day: string; apy: number }[] = [
  { day: 'Mon', apy: 3.8 },
  { day: 'Tue', apy: 3.95 },
  { day: 'Wed', apy: 4.02 },
  { day: 'Thu', apy: 3.9 },
  { day: 'Fri', apy: 4.08 },
  { day: 'Sat', apy: 4.1 },
  { day: 'Sun', apy: 4.12 },
];

export function ExampleYieldChart() {
  return (
    <div className="h-24 w-full" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={EXAMPLE_APY} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="apyFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--st-accent)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--st-accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="day" hide />
          <YAxis hide domain={['dataMin - 0.2', 'dataMax + 0.2']} />
          <Tooltip
            formatter={(v) => [`${Number(v).toFixed(2)}%`, 'APY']}
            contentStyle={{
              background: 'var(--st-surface)',
              border: '1px solid var(--st-line)',
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Area
            type="monotone"
            dataKey="apy"
            stroke="var(--st-accent)"
            strokeWidth={2}
            fill="url(#apyFill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
