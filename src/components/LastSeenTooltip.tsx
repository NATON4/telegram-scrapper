import dayjs from "dayjs";

export default function LastSeenTooltip({
    active,
    payload,
    label,
    kyivTz,
}: {
    active?: boolean;
    payload?: any[];
    label?: number;
    kyivTz: string;
}) {
    if (!active || !payload?.length || label == null) return null;

    const p = payload.find((x) => x?.payload?.lastTs != null) ?? payload[0];
    const v: number = Number(p?.value);
    if (!Number.isFinite(v)) return null;

    const mins = Math.abs(Math.trunc(v));
    let lastTs: number | undefined = p?.payload?.lastTs;

    if (lastTs == null && typeof label === 'number') {
        lastTs = label - mins * 60_000;
    }

    const color =
        mins <= 15 ? '#22c55e' : mins <= 30 ? '#eab308' : mins <= 60 ? '#f59e0b' : '#ef4444';

    const capturedStr = dayjs(label).tz(kyivTz).format('YYYY-MM-DD HH:mm');
    const lastStr = lastTs ? dayjs(lastTs).tz(kyivTz).format('YYYY-MM-DD HH:mm') : '—';

    return (
        <div
            style={{
                background: '#0b0f14',
                border: '1px solid #ffffff26',
                borderRadius: 12,
                padding: '10px 12px',
                boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
                color: '#e5e7eb',
                maxWidth: 320,
                lineHeight: 1.35,
            }}
        >
            <div style={{fontSize: 12, color: '#9ca3af', marginBottom: 4}}>
                {capturedStr}
            </div>
            <div style={{fontSize: 15, fontWeight: 600, color}}>
                Давність: {mins} хв від {lastStr}
            </div>
        </div>
    );
}
