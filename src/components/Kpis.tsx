import {useEffect, useMemo, useState} from "react";
import dayjs from "dayjs";

type KpisProps = {
    kyivTz: string;
    latestLastSeenISO?: string | null;
    lastSeenAgeSeries: { x: number; yAgeMin: number; lastTs: number }[];
    observationsCount: number;
};

export default function Kpis({
    kyivTz,
    latestLastSeenISO,
    lastSeenAgeSeries,
    observationsCount,
}: KpisProps) {
    const [nowTs, setNowTs] = useState(() => dayjs().valueOf());
    useEffect(() => {
        const t = setInterval(() => setNowTs(dayjs().valueOf()), 30_000);
        return () => clearInterval(t);
    }, []);

    const lastSeenTs: number | null = useMemo(() => {
        if (latestLastSeenISO) return dayjs(latestLastSeenISO).valueOf();
        const tail = lastSeenAgeSeries.at(-1);
        return tail ? tail.lastTs : null;
    }, [latestLastSeenISO, lastSeenAgeSeries]);

    const nowKyiv = dayjs(nowTs).tz(kyivTz);

    const minutesSinceLastSeen: number | null = useMemo(() => {
        if (lastSeenTs == null) return null;
        const diffMin = Math.max(0, Math.floor((nowTs - lastSeenTs) / 60_000));
        return diffMin;
    }, [nowTs, lastSeenTs]);

    const lastSeenHuman =
        lastSeenTs != null
            ? dayjs(lastSeenTs).tz(kyivTz).format("YYYY-MM-DD HH:mm")
            : "—";

    return (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-white/10 p-3">
                <div className="text-xs text-neutral-400">Зараз</div>
                <div className="text-lg">{nowKyiv.format("HH:mm")}</div>
            </div>

            <div className="rounded-2xl border border-white/10 p-3">
                <div className="text-xs text-neutral-400">Остання поява</div>
                <div className="text-lg">{lastSeenHuman}</div>
            </div>

            <div className="rounded-2xl border border-white/10 p-3">
                <div className="text-xs text-neutral-400">Минуло від останньої появи</div>
                <div className="text-lg">
                    {minutesSinceLastSeen != null ? `${minutesSinceLastSeen} хв` : "—"}
                </div>
            </div>

            <div className="rounded-2xl border border-white/10 p-3">
                <div className="text-xs text-neutral-400">Точок спостереження</div>
                <div className="text-lg">{observationsCount}</div>
            </div>
        </section>
    );
}
