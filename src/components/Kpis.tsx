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
    const now = dayjs().tz(kyivTz);
    const latestPoint = lastSeenAgeSeries.at(-1);
    const minutes = latestPoint ? latestPoint.yAgeMin : null;

    const lastSeenHuman =
        latestLastSeenISO
            ? dayjs(latestLastSeenISO).tz(kyivTz).format("YYYY-MM-DD HH:mm")
            : "—";

    return (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-white/10 p-3">
                <div className="text-xs text-neutral-400">Зараз</div>
                <div className="text-lg">{now.format("HH:mm")}</div>
            </div>

            <div className="rounded-2xl border border-white/10 p-3">
                <div className="text-xs text-neutral-400">Остання поява</div>
                <div className="text-lg">{lastSeenHuman}</div>
            </div>

            <div className="rounded-2xl border border-white/10 p-3">
                <div className="text-xs text-neutral-400">Минуло від останньої появи</div>
                <div className="text-lg">{minutes != null ? `${minutes} хв` : "—"}</div>
            </div>

            <div className="rounded-2xl border border-white/10 p-3">
                <div className="text-xs text-neutral-400">Точок спостереження</div>
                <div className="text-lg">{observationsCount}</div>
            </div>
        </section>
    );
}
