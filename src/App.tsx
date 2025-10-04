import {useEffect, useMemo, useState} from 'react'
import {API_BASE, DEFAULT_IDENT} from './config'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    Line,
    LineChart,
    CartesianGrid,
    AreaChart, ReferenceLine, Area, Brush, ReferenceArea, ComposedChart
} from 'recharts'

dayjs.extend(utc)
dayjs.extend(timezone)

type Latest = { captured_at?: string; is_online?: boolean; kind?: string; last_seen_at?: string | null }
type Heat = { hour_kyiv: number; online_points: number }
type Period = { online_from: string; online_to: string; duration_sec: number }

const kyiv = 'Europe/Kyiv'
type LastSeenPoint = { captured_at: string; last_seen_at: string }

async function getJSON<T>(url: string): Promise<T> {
    const res = await fetch(url, {credentials: 'omit'})
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
}

export default function App() {
    const [ident, setIdent] = useState(DEFAULT_IDENT)
    const [latest, setLatest] = useState<Latest | null>(null)
    const [heat, setHeat] = useState<Heat[]>([])
    const [periods, setPeriods] = useState<Period[]>([])
    const [viewHrs, setViewHrs] = useState<number>(6)
    const [loading, setLoading] = useState(false)
    const [err, setErr] = useState<string | null>(null)
    const [lastSeen, setLastSeen] = useState<LastSeenPoint[]>([])
    const [winHrs, setWinHrs] = useState<number>(6);
    const [winEnd, setWinEnd] = useState<number>(() => dayjs().valueOf());

    function clampWinEnd(next: number, fromTs: number, toTs: number, widthMs: number) {
        // не даємо вийти за межі
        const minEnd = Math.min(toTs, fromTs + widthMs);
        const maxEnd = toTs;
        return Math.max(minEnd, Math.min(maxEnd, next));
    }

    const range = useMemo(() => {
        const to = dayjs().utc()
        const from = to.subtract(7, 'day')
        return {from: from.toISOString(), to: to.toISOString()}
    }, [])
    const HYSTERESIS_MS = 90_000;
    const JITTER_MIN = 0.5;
    const EPS = 1;
    const bucket = (m: number) => (m <= 15 ? 0 : m <= 30 ? 1 : m <= 60 ? 2 : 3);

// 0..30 -> ↑ (плюс), 30+ -> ↓ (мінус)
    const signed = (m: number) => (m <= 30 ? +m : -m);
// піввідкриті/закриті межі так, щоб 30 ще було "вгору"

// 0..30 -> ↑ (плюс), 30+ -> ↓ (мінус)

    function stabilise(raw: W[]): W[] {
        const out: W[] = [];
        let prev: W | null = null;

        const bucket = (m: number) => (m <= 15 ? 0 : m <= 30 ? 1 : m <= 60 ? 2 : 3);

        for (const cur of raw) {
            if (!prev) {
                out.push(cur);
                prev = cur;
                continue;
            }

            // дріб’язкові коливання по Y викидаємо
            if (Math.abs(cur.ageMin - prev.ageMin) < JITTER_MIN) continue;

            const bPrev = bucket(prev.ageMin);
            const bCur = bucket(cur.ageMin);

            // якщо перехід у новий бакет занадто швидкий — ігноруємо
            if (bPrev !== bCur && (cur.x - prev.x) < HYSTERESIS_MS) {
                continue;
            }

            out.push(cur);
            prev = cur;
        }
        return out;
    }

    function makePusher() {
        let lastX = -Infinity;
        return (arr: any[], p: { x: number; vSigned: number; lastTs?: number }) => {
            if (p.x <= lastX) p.x = lastX + EPS;
            lastX = p.x;
            arr.push(p);
        };
    }

    useEffect(() => {
        let abort = false

        async function load() {
            setLoading(true);
            setErr(null)

            try {
                const [l, h, p, ls] = await Promise.all([
                    getJSON<Latest>(`${API_BASE}/contacts/${encodeURIComponent(ident)}/latest`),
                    getJSON<Heat[]>(`${API_BASE}/contacts/${encodeURIComponent(ident)}/heatmap?from=${range.from}&to=${range.to}`),
                    getJSON<Period[]>(`${API_BASE}/contacts/${encodeURIComponent(ident)}/periods?from=${range.from}&to=${range.to}`),
                    getJSON<LastSeenPoint[]>(`${API_BASE}/contacts/${encodeURIComponent(ident)}/lastseen/changes?from=${range.from}&to=${range.to}`),
                ])
                setLastSeen(ls)
                if (!abort) {
                    setLatest(l);
                    setHeat(h);
                    setPeriods(p)
                }
            } catch (e: never) {
                if (!abort) setErr(e.message || 'Fetch error')
            } finally {
                if (!abort) setLoading(false)
            }
        }

        load()
        return () => {
            abort = true
        }
    }, [ident, range.from, range.to])

    const SAMPLE_STEP_MIN = 5; // крок семплування (5 хв відповідає нашій БД)
    type W = { x: number; ageMin: number; lastTs: number };

    function splitSigned(windowed: W[]) {
        const g0_15: any[] = [], y15_30: any[] = [], o30_60: any[] = [], r60p: any[] = [];

        // межі кожного бакета (у хв)
        const BOUNDS = {
            0: {lo: 0, hi: 15},  // [0,15]
            1: {lo: 15, hi: 30},  // (15,30]
            2: {lo: 30, hi: 60},  // (30,60]
            3: {lo: 60, hi: Infinity},
        } as const;

        const push = (b: number, x: number, m: number, lastTs?: number) => {
            const row = {x, vSigned: signed(m), lastTs};
            (b === 0 ? g0_15 : b === 1 ? y15_30 : b === 2 ? o30_60 : r60p).push(row);
        };

        // коли закриваємо попередній бакет на x-ε, притискаємося до його межі з мікро-зсувом,
        // щоб точно лишитись у "своєму" знаку (без стрибка в інший)
        const closeAtBoundary = (b: number, x: number, m: number, lastTs?: number) => {
            const {lo, hi} = BOUNDS[b];
            // для ↑ бакетів (0,1) — беремо максимум з lo і мін( m, hi - 1e-6 )
            // для ↓ бакетів (2,3) — беремо мінімум з hi і макс( m, lo + 1e-6 )
            let capped: number;
            if (b === 0 || b === 1) {
                capped = Math.min(Math.max(m, lo), hi - 1e-6); // залишаємося в ↑
            } else {
                capped = Math.max(Math.min(m, hi), lo + 1e-6); // залишаємося в ↓
            }
            push(b, x, capped, lastTs);
        };

        let prev: W | null = null;
        for (const cur of windowed) {
            if (!prev) {
                const b0 = bucket(cur.ageMin);
                push(b0, cur.x, cur.ageMin, cur.lastTs);
                prev = cur;
                continue;
            }

            const bPrev = bucket(prev.ageMin);
            const bCur = bucket(cur.ageMin);

            if (bPrev === bCur) {
                if (cur.ageMin !== prev.ageMin) {
                    push(bCur, cur.x, cur.ageMin, cur.lastTs);
                }
            } else {
                // закриваємо попередню серію за мить до переходу у своїй межі
                closeAtBoundary(bPrev, Math.max(cur.x - EPS, prev.x), prev.ageMin, prev.lastTs);
                // і відкриваємо нову з фактичного значення прямо на x
                push(bCur, cur.x, cur.ageMin, cur.lastTs);
            }

            prev = cur;
        }

        return {g0_15, y15_30, o30_60, r60p};
    }

    function buildSamples(
        raw: { x: number; y: number }[],
        fromTs: number,
        toTs: number,
        stepMin = SAMPLE_STEP_MIN
    ) {
        // raw: масив з твоєї lastSeenSeries [{x: captured_ms, y: last_seen_ms}, ...]
        if (!raw.length) return [];
        const sorted = [...raw].sort((a, b) => a.x - b.x);

        // початкове значення — найсвіжіше last_seen до fromTs (або перше з масиву)
        let i = 0;
        while (i + 1 < sorted.length && sorted[i + 1].x <= fromTs) i++;
        let currentLastSeen = sorted[i].y;

        const samples: { x: number; ageMin: number; lastTs: number }[] = [];
        for (let t = fromTs; t <= toTs; t += stepMin * 60_000) {
            // оновлюємо currentLastSeen, коли “сходинка” потрапляє в майбутнє
            while (i + 1 < sorted.length && sorted[i + 1].x <= t) {
                i++;
                currentLastSeen = sorted[i].y;
            }
            // якщо до першого спостереження (до sorted[0].x), не фарбуємо
            if (t < sorted[0].x) {
                samples.push({x: t, ageMin: NaN, lastTs: currentLastSeen});
            } else {
                const ageMin = Math.max(0, Math.floor((t - currentLastSeen) / 60_000));
                samples.push({x: t, ageMin, lastTs: currentLastSeen});
            }
        }
        return samples;
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

    function p90(values: number[]) {
        if (!values.length) return 0;
        const arr = [...values].sort((a, b) => a - b);
        const idx = Math.floor(0.9 * (arr.length - 1));
        return arr[idx];
    }

    const lastSeenSeries = useMemo(() => {
        if (lastSeen.length === 0) return []
        // Перетворюємо в епохи (ms) — так простіше робити форматування осей
        const pts = lastSeen.map(p => ({
            x: dayjs(p.captured_at).valueOf(),
            y: dayjs(p.last_seen_at).valueOf(),
        }))
        // Побудуємо ступінчасту лінію (з двома точками на зміну)
        const stepped: { x: number; y: number }[] = []
        let prevY = pts[0].y
        // Стартова точка
        stepped.push({x: pts[0].x, y: prevY})
        for (let i = 0; i < pts.length; i++) {
            const {x, y} = pts[i]
            if (y !== prevY) {
                // вертикальна грань: дублюємо X зі старим Y...
                stepped.push({x, y: prevY})
                // ...і одразу крок зі новим Y
                stepped.push({x, y})
                prevY = y
            } else {
                // якщо не змінилось — можна пропустити, бо ми і так тримаємо попер. рівень
            }
        }
        return stepped
    }, [lastSeen])

    const lastSeenAgeSeries = useMemo(() => {
        if (lastSeen.length === 0) return []
        // робимо з «captured_at / last_seen_at»:
        // x — коли ми зафіксували, yAgeMin — скільки хв. пройшло з last_seen до моменту спостереження
        const pts = lastSeen.map(p => {
            const x = dayjs(p.captured_at).valueOf()
            const last = dayjs(p.last_seen_at).valueOf()
            const ageMin = Math.max(0, Math.round((x - last) / 60000))
            return {x, yAgeMin: ageMin, lastTs: last}
        })

        // невелика деградація шуму: зберігаємо «сходинку», видаляючи дублікати yAgeMin
        const res: { x: number; yAgeMin: number; lastTs: number }[] = []
        let prev = -1
        for (const p of pts) {
            if (p.yAgeMin !== prev) res.push(p)
            prev = p.yAgeMin
        }
        return res
    }, [lastSeen])

    const heatData = useMemo(() => {
        const map = new Map<number, number>()
        for (let i = 0; i < 24; i++) map.set(i, 0)
        heat.forEach(h => map.set(h.hour_kyiv, h.online_points))
        return Array.from(map.entries()).map(([hour, online_points]) => ({hour, online_points}))
    }, [heat])

    return (
        <div className="min-h-screen p-6 lg:p-10">
            <div className="max-w-5xl mx-auto space-y-6">
                <header className="flex flex-col sm:flex-row sm:items-end gap-4 justify-between">
                    <div>
                        <h1 className="text-2xl md:text-3xl font-semibold">TG Online — @{ident.replace(/^@/, '')}</h1>
                        <p className="text-neutral-400">Період: останні 7 днів (Kyiv time)</p>
                    </div>
                    <div className="flex gap-2">
                        <input
                            className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 outline-none"
                            placeholder="@username або 380..."
                            value={ident}
                            onChange={e => setIdent(e.target.value.trim())}
                        />
                        <button
                            className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 transition"
                            onClick={() => location.reload()}
                            title="Перезавантажити сторінку"
                        >
                            ⟳
                        </button>
                    </div>
                </header>

                {err && <div className="p-3 rounded-xl bg-red-900/30 border border-red-800">Помилка: {err}</div>}
                {loading && <div className="p-3 rounded-xl bg-white/5 border border-white/10">Завантаження…</div>}

                {/* Latest status */}
                <section className="grid md:grid-cols-3 gap-4">
                    <div className="rounded-2xl border border-white/10 p-4 md:col-span-1">
                        <h2 className="text-lg font-medium mb-2">Статус зараз</h2>
                        {latest ? (
                            <div className="space-y-1">
                                <div
                                    className={`text-xl ${latest.is_online ? 'text-emerald-400' : 'text-neutral-300'}`}>
                                    {latest.is_online ? 'Online' : (latest.kind || 'Offline')}
                                </div>
                                <div className="text-neutral-400">
                                    Оновлено: {latest.captured_at ? dayjs(latest.captured_at).tz(kyiv).format('YYYY-MM-DD HH:mm') : '—'} (Kyiv)
                                </div>
                                <div className="text-neutral-400">
                                    Поява: {latest.last_seen_at ? dayjs(latest.last_seen_at).tz(kyiv).format('YYYY-MM-DD HH:mm') : '—'}
                                </div>
                            </div>
                        ) : <div>—</div>}
                    </div>

                    {/* Heatmap/bar by hour */}
                    <div className="rounded-2xl border border-white/10 p-4 md:col-span-2">
                        <h2 className="text-lg font-medium mb-2">Активні години (Kyiv)</h2>
                        <div className="h-56">
                            <ResponsiveContainer>
                                <BarChart data={heatData}>
                                    <XAxis dataKey="hour" tickFormatter={(v) => `${v}:00`}/>
                                    <YAxis/>
                                    <Tooltip formatter={(val: number) => [`${val} точок`, 'online']}
                                             labelFormatter={(l) => `${l}:00`}/>
                                    <Bar dataKey="online_points"/>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </section>
                {/* KPIs */}
                <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {(() => {
                        const now = dayjs()
                        const latestPoint = lastSeenAgeSeries.at(-1)
                        const minutes = latestPoint ? latestPoint.yAgeMin : null
                        const lastSeenHuman = latest?.last_seen_at
                            ? dayjs(latest.last_seen_at).tz(kyiv).format('YYYY-MM-DD HH:mm')
                            : '—'
                        return (
                            <>
                                <div className="rounded-2xl border border-white/10 p-3">
                                    <div className="text-xs text-neutral-400">Зараз</div>
                                    <div className="text-lg">{now.tz(kyiv).format('HH:mm')}</div>
                                </div>
                                <div className="rounded-2xl border border-white/10 p-3">
                                    <div className="text-xs text-neutral-400">Остання поява</div>
                                    <div className="text-lg">{lastSeenHuman}</div>
                                </div>
                                <div className="rounded-2xl border border-white/10 p-3">
                                    <div className="text-xs text-neutral-400">Минуло від останньої появи</div>
                                    <div className="text-lg">{minutes != null ? `${minutes} хв` : '—'}</div>
                                </div>
                                <div className="rounded-2xl border border-white/10 p-3">
                                    <div className="text-xs text-neutral-400">Точок спостереження</div>
                                    <div className="text-lg">{lastSeen.length}</div>
                                </div>
                            </>
                        )
                    })()}
                </section>

                {/* LAST SEEN — COLORED BANDS BY “AGE MINUTES” */}
                <section className="rounded-2xl border border-white/10 p-4">
                    <div className="flex items-center justify-between gap-3 mb-3">
                        <h2 className="text-lg font-medium">Коли востаннє бачили</h2>
                        <div className="flex items-center gap-2 text-xs">
                            <span className="text-neutral-400 hidden sm:inline">Діапазон:</span>
                            {[
                                {label: '6h', hrs: 6},
                                {label: '24h', hrs: 24},
                                {label: '3d', hrs: 72},
                                {label: '7d', hrs: 24 * 7},
                            ].map(({label, hrs}) => (
                                <button
                                    key={label}
                                    onClick={() => {
                                        setWinHrs(hrs);
                                        setWinEnd(dayjs(range.to).valueOf());
                                    }}
                                    className={`px-2 py-1 rounded-md border ${winHrs === hrs ? 'border-white/40 bg-white/10' : 'border-white/10 hover:border-white/20'}`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {(() => {
                        // 1) готуємо семпли
                        const fromTs = dayjs(range.from).valueOf();
                        const toTs = dayjs(range.to).valueOf();
                        const widthMs = winHrs * 60 * 60 * 1000;
                        const samples = buildSamples(lastSeenSeries, fromTs, toTs, SAMPLE_STEP_MIN);

                        const vTo = clampWinEnd(winEnd, fromTs, toTs, widthMs);
                        const vFrom = Math.max(fromTs, vTo - widthMs);

                        // 3) обрізаємо під вікно і рахуємо перцентиль для Y
                        const windowed = samples.filter(d => d.x >= vFrom && d.x <= vTo && !isNaN(d.ageMin));
                        const stable = stabilise(windowed);

                        const y90 = p90(windowed.map(d => d.ageMin));
                        const yMax = Math.max(15, Math.min(180, Math.ceil((y90 + 10) / 5) * 5)); // трохи запасу

                        // 4) фарбуємо по бендах
                        const band = (fn: (m: number) => boolean) => windowed.map(d => ({
                            x: d.x,
                            v: fn(d.ageMin) ? d.ageMin : null,
                            lastTs: d.lastTs
                        }));

                        const signedMax = Math.max(15, Math.min(180, Math.ceil(yMax / 5) * 5)) // симетричний діапазон
                        console.groupCollapsed('[last-seen] debug');
                        console.log('windowed N=%d', windowed.length, windowed.slice(0, 10));
                        console.log('stable   N=%d', stable.length, stable.slice(0, 10));

                        const parts = splitSigned(stable);
                        const {g0_15, y15_30, o30_60, r60p} = maskToExclusiveBands(stable);

                        console.table([
                            {band: '0-15', n: g0_15.length, from: g0_15[0]?.x, to: g0_15.at(-1)?.x},
                            {band: '15-30', n: y15_30.length, from: y15_30[0]?.x, to: y15_30.at(-1)?.x},
                            {band: '30-60', n: o30_60.length, from: o30_60[0]?.x, to: o30_60.at(-1)?.x},
                            {band: '60+', n: r60p.length, from: r60p[0]?.x, to: r60p.at(-1)?.x},
                        ]);
                        console.groupEnd();
                        // маленький «overview» за весь тиждень (сіренький)
                        const overview = samples.map(d => ({
                            x: d.x,
                            v: isNaN(d.ageMin) ? null : Math.min(d.ageMin, 120)
                        }));

                        return (
                            <div className="rounded-2xl border border-white/10 p-4">
                                <h2 className="text-lg font-medium mb-2">Коли востаннє бачили</h2>
                                <div className="flex items-center gap-2">
                                    <button
                                        className="px-2 py-1 rounded-md border border-white/10 hover:border-white/20"
                                        onClick={() => setWinEnd(prev => prev - 60 * 60 * 1000)}>← 1h
                                    </button>
                                    <button
                                        className="px-2 py-1 rounded-md border border-white/10 hover:border-white/20"
                                        onClick={() => setWinEnd(prev => prev + 60 * 60 * 1000)}>1h →
                                    </button>
                                </div>
                                <div className="h-[260px] sm:h-[320px]" onWheel={(e) => {
                                    const delta = e.deltaY > 0 ? 30 : -30; // хвилин
                                    setWinEnd(prev => prev + delta * 60 * 1000);
                                }}>
                                    <ResponsiveContainer>
                                        <ComposedChart>
                                            <CartesianGrid strokeDasharray="3 3"/>
                                            <XAxis
                                                type="number"
                                                dataKey="x"
                                                domain={[vFrom, vTo]}
                                                tickFormatter={(v) => dayjs(v).tz(kyiv).format(viewHrs <= 24 ? 'DD HH:mm' : 'MM-DD HH:mm')}
                                                allowDataOverflow
                                            />
                                            <YAxis
                                                type="number"
                                                domain={[-signedMax, signedMax]}
                                                tickFormatter={(v) => `${Math.abs(v)} хв`}   // показуємо модуль
                                                width={60}
                                            />

                                            <Tooltip
                                                labelFormatter={(v) => dayjs(v).tz(kyiv).format('YYYY-MM-DD HH:mm')}
                                                formatter={(val: number, _name, ctx: any) => {
                                                    const mins = Math.abs(val)
                                                    const last = ctx?.payload?.lastTs ? dayjs(ctx.payload.lastTs).tz(kyiv).format('YYYY-MM-DD HH:mm') : ''
                                                    return [`${mins} хв від ${last}`, 'Давність']
                                                }}
                                            />

                                            {/* Нульова лінія по центру */}
                                            <ReferenceLine y={0} stroke="#ffffff30"/>

                                            {/* М’які підкладки для зон (не перекривають лінії) */}
                                            <ReferenceArea y1={0} y2={signedMax} fill="#16a34a12"
                                                           ifOverflow="extendDomain"/>
                                            <ReferenceArea y1={0} y2={30} fill="#16a34a10"/>
                                            <ReferenceArea y1={30} y2={15} fill="#eab30810"/>
                                            <ReferenceArea y1={-15} y2={-30} fill="#f59e0b10"/>
                                            <ReferenceArea y1={-30} y2={-signedMax} fill="#ef444410"/>

                                            {/* Одна тонка сіра “форма”, щоб було видно контур сходинок */}
                                            <Area
                                                type="stepAfter"
                                                data={windowed.map(d => ({
                                                    x: d.x,
                                                    vSigned: (d.ageMin < 30 ? d.ageMin : -d.ageMin)
                                                }))}
                                                dataKey="vSigned"
                                                stroke="#9ca3af40"
                                                fill="#9ca3af15"
                                                dot={false}
                                                connectNulls
                                            />

                                            {/* КОЛЬОРОВІ ЛІНІЇ без fill — не накладаються одна на одну */}
                                            {/* сирі семпли точками (сіро-зелені) */}

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

                                {/* Легенда-тлумачення (опційно) */}
                                <div className="flex flex-wrap gap-4 mt-3 text-sm text-neutral-400">
                                    <span><span className="inline-block w-3 h-3 rounded-full align-middle"
                                                style={{background: '#22c55e'}}/> 0–15 хв (вгору)</span>
                                    <span><span className="inline-block w-3 h-3 rounded-full align-middle"
                                                style={{background: '#eab308'}}/> 15–30 хв (вгору)</span>
                                    <span><span className="inline-block w-3 h-3 rounded-full align-middle"
                                                style={{background: '#f59e0b'}}/> 30–60 хв (вниз)</span>
                                    <span><span className="inline-block w-3 h-3 rounded-full align-middle"
                                                style={{background: '#ef4444'}}/> 60+ хв (вниз)</span>
                                </div>
                            </div>
                        );
                    })()}

                    <div className="mt-3 text-xs flex flex-wrap gap-3 text-neutral-400">
                        <span><span className="inline-block w-3 h-3 rounded-sm align-[-1px]"
                                    style={{background: '#22c55e'}}/> 0–15 хв</span>
                        <span><span className="inline-block w-3 h-3 rounded-sm align-[-1px]"
                                    style={{background: '#eab308'}}/> 15–30 хв</span>
                        <span><span className="inline-block w-3 h-3 rounded-sm align-[-1px]"
                                    style={{background: '#f59e0b'}}/> 30–60 хв</span>
                        <span><span className="inline-block w-3 h-3 rounded-sm align-[-1px]"
                                    style={{background: '#ef4444'}}/> 60+ хв</span>
                    </div>
                </section>


                <footer className="text-neutral-500 text-sm">
                    Дані кешуються ~30–60s. API: {API_BASE}
                </footer>
            </div>
        </div>
    )
}
