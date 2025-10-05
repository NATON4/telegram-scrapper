import {useEffect, useMemo, useState} from 'react'
import {API_BASE, DEFAULT_IDENT} from './config'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import Kpis from "./components/Kpis.tsx";
import StatusAndHeat from "./components/StatusAndHeat.tsx";
import LastSeenTimeline from "./components/LastSeenTimeline.tsx";

dayjs.extend(utc)
dayjs.extend(timezone)

type Latest = { captured_at?: string; is_online?: boolean; kind?: string; last_seen_at?: string | null }
type Heat = { hour_kyiv: number; online_points: number }
type Period = { online_from: string; online_to: string; duration_sec: number }

const kyiv = 'Europe/Kyiv'
const LS_KEY = 'tg-last-ident';

type LastSeenPoint = { captured_at: string; last_seen_at: string }

async function getJSON<T>(url: string): Promise<T> {
    const res = await fetch(url, {credentials: 'omit'})
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
}

export default function App() {
    const [ident, setIdent] = useState(() => localStorage.getItem(LS_KEY) ?? DEFAULT_IDENT);
    const [inputIdent, setInputIdent] = useState(() => localStorage.getItem(LS_KEY) ?? DEFAULT_IDENT);

    const [latest, setLatest] = useState<Latest | null>(null)
    const [heat, setHeat] = useState<Heat[]>([])
    const [periods, setPeriods] = useState<Period[]>([])
    const [loading, setLoading] = useState(false)
    const [err, setErr] = useState<string | null>(null)
    const [lastSeen, setLastSeen] = useState<LastSeenPoint[]>([])

    function normalizeIdent(s: string) {
        const v = s.trim();
        if (!v) return '';

        return v.startsWith('@') ? '@' + v.slice(1).replace(/\s+/g, '') : v.replace(/\s+/g, '');
    }

    useEffect(() => {
        if (ident) localStorage.setItem(LS_KEY, ident);
    }, [ident]);

    const range = useMemo(() => {
        const to = dayjs().utc()
        const from = to.subtract(7, 'day')
        return {from: from.toISOString(), to: to.toISOString()}
    }, [])

    function applyIdent(next: string) {
        const cleaned = normalizeIdent(next);
        if (!cleaned || cleaned === ident) return;
        setIdent(cleaned);
        setInputIdent(cleaned);
        localStorage.setItem(LS_KEY, cleaned);
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

    const lastSeenSeries = useMemo(() => {
        if (lastSeen.length === 0) return []

        const pts = lastSeen.map(p => ({
            x: dayjs(p.captured_at).valueOf(),
            y: dayjs(p.last_seen_at).valueOf(),
        }))
        const stepped: { x: number; y: number }[] = []

        let prevY = pts[0].y

        stepped.push({x: pts[0].x, y: prevY})

        for (let i = 0; i < pts.length; i++) {
            const {x, y} = pts[i]
            if (y !== prevY) {
                stepped.push({x, y: prevY})
                stepped.push({x, y})
                prevY = y
            } else {
            }
        }
        return stepped
    }, [lastSeen])

    const lastSeenAgeSeries = useMemo(() => {
        if (lastSeen.length === 0) return []

        const pts = lastSeen.map(p => {
            const x = dayjs(p.captured_at).valueOf()
            const last = dayjs(p.last_seen_at).valueOf()
            const ageMin = Math.max(0, Math.round((x - last) / 60000))
            return {x, yAgeMin: ageMin, lastTs: last}
        })

        const res: { x: number; yAgeMin: number; lastTs: number }[] = []
        let prev = -1
        for (const p of pts) {
            if (p.yAgeMin !== prev) res.push(p)
            prev = p.yAgeMin
        }
        return res
    }, [lastSeen])

    const ENTRANCE_JUMP_MIN_MS = 4 * 60_000;
    const ENTRANCE_YOUNG_MAX_MS = 20 * 60_000;

    function computeEntriesByHourFromLastSeen(ls: LastSeenPoint[], kyivTz: string) {
        const buckets = new Array(24).fill(0);

        if (!ls || ls.length === 0) {
            return Array.from({length: 24}, (_, h) => ({hour: h, entries: 0}));
        }

        const pts = [...ls]
            .map(p => ({
                captured: dayjs(p.captured_at).valueOf(),
                last: dayjs(p.last_seen_at).valueOf(),
            }))
            .sort((a, b) => a.captured - b.captured);

        let prev = pts[0];
        for (let i = 1; i < pts.length; i++) {
            const cur = pts[i];

            const ageCur = Math.max(0, cur.captured - cur.last);
            const jumpForward = cur.last - prev.last;

            if (jumpForward >= ENTRANCE_JUMP_MIN_MS && ageCur <= ENTRANCE_YOUNG_MAX_MS) {
                const hourKyiv = dayjs(cur.last).tz(kyivTz).hour();
                buckets[hourKyiv] += 1;
            }

            prev = cur;
        }

        return buckets.map((cnt, hour) => ({hour, entries: cnt}));
    }


    const entriesByHour = useMemo(
        () => computeEntriesByHourFromLastSeen(lastSeen, kyiv),
        [lastSeen]
    );

    const lastEntryAtISO = useMemo(() => {
        const pts = [...lastSeen]
            .map(p => ({
                captured: dayjs(p.captured_at).valueOf(),
                last: dayjs(p.last_seen_at).toISOString(),
                ageMs: Math.max(0, dayjs(p.captured_at).valueOf() - dayjs(p.last_seen_at).valueOf())
            }))
            .filter(p => p.ageMs <= ENTRANCE_YOUNG_MAX_MS)
            .sort((a, b) => dayjs(a.last).valueOf() - dayjs(b.last).valueOf());

        return pts.length ? pts.at(-1)!.last : null;
    }, [lastSeen]);

    return (
        <div className="min-h-screen p-1 lg:p-10">
            <div className="max-w-5xl mx-auto space-y-6">
                <header className="flex flex-col sm:flex-row sm:items-end gap-4 justify-between">
                    <div>
                        <h1 className="text-2xl md:text-3xl font-semibold">TG Online</h1>
                        <p className="text-neutral-400">Період: останні 7 днів (Kyiv time)</p>
                    </div>
                    <div className="flex gap-2">
                        <input
                            className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 outline-none"
                            placeholder="@username або 380..."
                            // value={inputIdent}
                            onChange={(e) => setInputIdent(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    applyIdent(inputIdent)
                                }
                            }}
                        />
                        <button
                            className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 transition"
                            onClick={() => applyIdent(inputIdent)}
                            title="Застосувати і оновити дані"
                        >
                            ↵
                        </button>
                    </div>
                </header>

                {err && <div className="p-3 rounded-xl bg-red-900/30 border border-red-800">Помилка: {err}</div>}
                {loading && <div className="p-3 rounded-xl bg-white/5 border border-white/10">Завантаження…</div>}

                <StatusAndHeat
                    kyivTz={kyiv}
                    latest={latest}
                    heatData={entriesByHour}
                    lastEntryAtISO={lastEntryAtISO}
                />

                <Kpis
                    kyivTz={kyiv}
                    latestLastSeenISO={latest?.last_seen_at ?? null}
                    lastSeenAgeSeries={lastSeenAgeSeries}
                    observationsCount={lastSeen.length}
                />

                <LastSeenTimeline
                    kyivTz={kyiv}
                    rangeFromISO={range.from}
                    rangeToISO={range.to}
                    lastSeenSeries={lastSeenSeries}
                />

                <footer className="text-neutral-500 text-sm">
                    Дані кешуються ~30–60s. API: {API_BASE}
                </footer>
            </div>
        </div>
    )
}
