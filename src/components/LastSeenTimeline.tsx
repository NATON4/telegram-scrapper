import {useMemo, useState} from "react";
import dayjs from "dayjs";
import {
    ResponsiveContainer,
    ComposedChart,
    CartesianGrid,
    XAxis,
    YAxis,
    Tooltip,
    ReferenceLine,
    ReferenceArea,
    Area,
    Line,
} from "recharts";
import LastSeenTooltip from "./LastSeenTooltip.tsx";

type LastSeenTimelineProps = {
    kyivTz: string;
    rangeFromISO: string;
    rangeToISO: string;
    lastSeenSeries: { x: number; y: number }[];
};

export default function LastSeenTimeline({
    kyivTz,
    rangeFromISO,
    rangeToISO,
    lastSeenSeries,
}: LastSeenTimelineProps) {
    const SAMPLE_STEP_MIN = 5;
    const HYSTERESIS_MS = 90_000;
    const JITTER_MIN = 0.5;

    const [winHrs, setWinHrs] = useState<number>(6);
    const [winEnd, setWinEnd] = useState<number>(dayjs(rangeToISO).valueOf());

    const fromTs = dayjs(rangeFromISO).valueOf();
    const toTs = dayjs(rangeToISO).valueOf();
    const yTick = {fontSize: 12, fill: '#cfcfcf' as const}
    const xTick = {fontSize: 12, fill: '#cfcfcf' as const};

    const bucket = (m: number) => (m <= 15 ? 0 : m <= 30 ? 1 : m <= 60 ? 2 : 3);
    const signed = (m: number) => (m <= 30 ? +m : -m); // 0..30 вгору, 30+ вниз
    const clampWinEnd = (end: number, from: number, to: number, width: number) =>
        Math.max(from + width, Math.min(end, to));

    function p90(values: number[]) {
        if (!values.length) return 0;
        const arr = [...values].sort((a, b) => a - b);
        const idx = Math.floor(0.9 * (arr.length - 1));
        return arr[idx];
    }

    type W = { x: number; ageMin: number; lastTs: number };

    function buildSamples(
        raw: { x: number; y: number }[],
        rFrom: number,
        rTo: number,
        stepMin = SAMPLE_STEP_MIN
    ): W[] {
        if (!raw.length) return [];
        const sorted = [...raw].sort((a, b) => a.x - b.x);
        let i = 0;
        while (i + 1 < sorted.length && sorted[i + 1].x <= rFrom) i++;
        let currentLastSeen = sorted[i].y;

        const out: W[] = [];
        for (let t = rFrom; t <= rTo; t += stepMin * 60_000) {
            while (i + 1 < sorted.length && sorted[i + 1].x <= t) {
                i++;
                currentLastSeen = sorted[i].y;
            }
            if (t < sorted[0].x) {
                out.push({x: t, ageMin: NaN, lastTs: currentLastSeen});
            } else {
                const ageMin = Math.max(0, Math.floor((t - currentLastSeen) / 60_000));
                out.push({x: t, ageMin, lastTs: currentLastSeen});
            }
        }
        return out;
    }

    function stabilise(raw: W[]): W[] {
        const out: W[] = [];
        let prev: W | null = null;
        for (const cur of raw) {
            if (!prev) {
                out.push(cur);
                prev = cur;
                continue;
            }
            if (Math.abs(cur.ageMin - prev.ageMin) < JITTER_MIN) continue;

            const bPrev = bucket(prev.ageMin);
            const bCur = bucket(cur.ageMin);
            if (bPrev !== bCur && (cur.x - prev.x) < HYSTERESIS_MS) continue;

            out.push(cur);
            prev = cur;
        }
        return out;
    }

    function maskToExclusiveBands(windowed: W[]) {
        const g0_15: any[] = [];
        const y15_30: any[] = [];
        const o30_60: any[] = [];
        const r60p: any[] = [];
        for (const d of windowed) {
            const b = bucket(d.ageMin);
            const v = signed(d.ageMin);
            g0_15.push({x: d.x, vSigned: b === 0 ? v : null, lastTs: d.lastTs});
            y15_30.push({x: d.x, vSigned: b === 1 ? v : null, lastTs: d.lastTs});
            o30_60.push({x: d.x, vSigned: b === 2 ? v : null, lastTs: d.lastTs});
            r60p.push({x: d.x, vSigned: b === 3 ? v : null, lastTs: d.lastTs});
        }
        return {g0_15, y15_30, o30_60, r60p};
    }

    const chartData = useMemo(() => {
        const widthMs = winHrs * 60 * 60 * 1000;
        const samples = buildSamples(lastSeenSeries, fromTs, toTs, SAMPLE_STEP_MIN);

        const vTo = clampWinEnd(winEnd, fromTs, toTs, widthMs);
        const vFrom = Math.max(fromTs, vTo - widthMs);

        const windowed = samples.filter(d => d.x >= vFrom && d.x <= vTo && !isNaN(d.ageMin));
        const stable = stabilise(windowed);

        const y90 = p90(windowed.map(d => d.ageMin));
        const yMax = Math.max(15, Math.min(180, Math.ceil((y90 + 10) / 5) * 5));
        const signedMax = Math.max(15, Math.min(180, Math.ceil(yMax / 5) * 5));

        const {g0_15, y15_30, o30_60, r60p} = maskToExclusiveBands(stable);

        return {
            vFrom,
            vTo,
            signedMax,
            windowed,
            g0_15,
            y15_30,
            o30_60,
            r60p,
        };
    }, [winHrs, winEnd, lastSeenSeries, fromTs, toTs]);

    const {vFrom, vTo, signedMax, windowed, g0_15, y15_30, o30_60, r60p} = chartData;

    return (
        <section className="rounded-2xl border border-white/10 py-4 px-2">
            <div className="flex items-center justify-between gap-3 mb-3">
                <div className="justify-end w-full flex items-center gap-2 text-xs">
                    <span className="text-neutral-400 hidden sm:inline">Діапазон:</span>
                    {[
                        {label: "6h", hrs: 6},
                        {label: "24h", hrs: 24},
                        {label: "3d", hrs: 72},
                        {label: "7d", hrs: 24 * 7},
                    ].map(({label, hrs}) => (
                        <button
                            key={label}
                            onClick={() => {
                                setWinHrs(hrs);
                                setWinEnd(dayjs(rangeToISO).valueOf());
                            }}
                            className={`px-2 py-1 rounded-md border ${
                                winHrs === hrs
                                    ? "border-white/40 bg-white/10"
                                    : "border-white/10 hover:border-white/20"
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            <h2 className="text-lg font-medium mb-2">Коли востаннє бачили</h2>

            <div className="flex items-center gap-2 mb-2">
                <button
                    className="px-2 py-1 rounded-md border border-white/10 hover:border-white/20"
                    onClick={() => setWinEnd(prev => prev - 60 * 60 * 1000)}
                >
                    ← 1h
                </button>
                <button
                    className="px-2 py-1 rounded-md border border-white/10 hover:border-white/20"
                    onClick={() => setWinEnd(prev => prev + 60 * 60 * 1000)}
                >
                    1h →
                </button>
            </div>

            <div
                className="h-[260px] sm:h-[320px]"
                onWheel={(e) => {
                    const delta = e.deltaY > 0 ? 30 : -30;
                    setWinEnd(prev => prev + delta * 60 * 1000);
                }}
            >
                <ResponsiveContainer>
                    <ComposedChart
                        margin={{top: 2, right: 4, bottom: 8, left: 4}}
                    >

                        <CartesianGrid strokeDasharray="3 3"/>
                        <XAxis
                            type="number"
                            dataKey="x"
                            domain={[vFrom, vTo]}
                            tickFormatter={(v) =>
                                dayjs(v).tz(kyivTz).format(winHrs <= 24 ? "DD HH:mm" : "MM-DD HH:mm")
                            }
                            allowDataOverflow
                            tick={xTick}
                            tickMargin={8}
                            minTickGap={10}
                            interval="preserveStartEnd"
                            tickCount={winHrs <= 6 ? 9 : winHrs <= 24 ? 10 : 8}
                        />

                        <YAxis
                            type="number"
                            domain={[-signedMax, signedMax]}
                            tickFormatter={(v) => `${Math.abs(v)} хв`}
                            width={54}
                            tick={yTick}
                            tickMargin={10}
                        />

                        <Tooltip
                            content={<LastSeenTooltip kyivTz={kyivTz}/>}
                            cursor={{stroke: '#ffffff25', strokeWidth: 1}}
                            allowEscapeViewBox={{x: true, y: true}}
                        />

                        <ReferenceLine y={0} stroke="#ffffff30"/>

                        <ReferenceArea y1={0} y2={signedMax} fill="#16a34a12" ifOverflow="extendDomain"/>
                        <ReferenceArea y1={0} y2={30} fill="#16a34a10"/>
                        <ReferenceArea y1={30} y2={15} fill="#eab30810"/>
                        <ReferenceArea y1={-15} y2={-30} fill="#f59e0b10"/>
                        <ReferenceArea y1={-30} y2={-signedMax} fill="#ef444410"/>

                        <Area
                            type="stepAfter"
                            data={windowed.map(d => ({
                                x: d.x,
                                vSigned: d.ageMin < 30 ? d.ageMin : -d.ageMin,
                                lastTs: d.lastTs,
                            }))}
                            dataKey="vSigned"
                            stroke="#9ca3af40"
                            fill="#9ca3af15"
                            dot={false}
                            connectNulls
                        />

                        <Line type="stepAfter" data={g0_15} dataKey="vSigned" dot={false}
                              connectNulls={false} stroke="#22c55e" strokeWidth={2.5}/>
                        <Line type="stepAfter" data={y15_30} dataKey="vSigned" dot={false}
                              connectNulls={false} stroke="#eab308" strokeWidth={2.5}/>
                        <Line type="stepAfter" data={o30_60} dataKey="vSigned" dot={false}
                              connectNulls={false} stroke="#f59e0b" strokeWidth={2.5}/>
                        <Line type="stepAfter" data={r60p} dataKey="vSigned" dot={false}
                              connectNulls={false} stroke="#ef4444" strokeWidth={2.5}/>
                    </ComposedChart>
                </ResponsiveContainer>
            </div>

            <div className="mt-3 text-xs flex flex-wrap gap-3 text-neutral-400">
                <span><span className="inline-block w-3 h-3 rounded-sm align-[-1px]" style={{background: "#22c55e"}}/> 0–15 хв</span>
                <span><span className="inline-block w-3 h-3 rounded-sm align-[-1px]" style={{background: "#eab308"}}/> 15–30 хв</span>
                <span><span className="inline-block w-3 h-3 rounded-sm align-[-1px]" style={{background: "#f59e0b"}}/> 30–60 хв</span>
                <span><span className="inline-block w-3 h-3 rounded-sm align-[-1px]" style={{background: "#ef4444"}}/> 60+ хв</span>
            </div>
        </section>
    );
}
