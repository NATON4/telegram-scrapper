import dayjs from "dayjs";
import {useMemo} from "react";
import {
    ResponsiveContainer,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
} from "recharts";

type Latest = {
    captured_at?: string;
    is_online?: boolean;
    kind?: string;
    last_seen_at?: string | null;
};

type HourRow =
    | { hour: number; entries: number }
    | { hour: number; online_points: number }; // бек-компат

type StatusAndHeatProps = {
    kyivTz: string;
    latest: Latest | null;
    /** Агрегація ВХОДІВ за годинами (0–23). */
    heatData: HourRow[];
    /** ISO часу останнього входу (online_from), якщо хочеш показувати підпис зверху графіка. */
    lastEntryAtISO?: string | null;
};

export default function StatusAndHeat({
                                          kyivTz,
                                          latest,
                                          heatData,
                                          lastEntryAtISO,
                                      }: StatusAndHeatProps) {
    // 1) нормалізуємо і гарантуємо 24 бакети
    const normalized = useMemo(() => {
        const base = new Map<number, number>();
        for (let h = 0; h < 24; h++) base.set(h, 0);

        for (const row of heatData || []) {
            const hour = (row as any).hour as number;
            const entries =
                (row as any).entries != null
                    ? (row as any).entries
                    : (row as any).online_points ?? 0;
            if (hour >= 0 && hour <= 23) {
                base.set(hour, (base.get(hour) || 0) + entries);
            }
        }
        return Array.from(base.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([hour, entries]) => ({hour, entries}));
    }, [heatData]);

    const lastEntryHuman =
        lastEntryAtISO
            ? dayjs(lastEntryAtISO).tz(kyivTz).format("YYYY-MM-DD HH:mm")
            : null;

    return (
        <section className="grid md:grid-cols-3 gap-4">
            {/* Статус зараз */}
            <div className="rounded-2xl border border-white/10 py-4 px-2 md:col-span-1">
                <h2 className="text-lg font-medium mb-2">Статус зараз</h2>
                {latest ? (
                    <div className="space-y-1">
                        <div className={`text-xl ${latest.is_online ? "text-emerald-400" : "text-neutral-300"}`}>
                            {latest.is_online ? "Online" : latest.kind || "Offline"}
                        </div>
                        <div className="text-neutral-400">
                            Оновлено:{" "}
                            {latest.captured_at
                                ? dayjs(latest.captured_at).tz(kyivTz).format("YYYY-MM-DD HH:mm")
                                : "—"}{" "}
                            (Kyiv)
                        </div>
                        <div className="text-neutral-400">
                            Поява:{" "}
                            {latest.last_seen_at
                                ? dayjs(latest.last_seen_at).tz(kyivTz).format("YYYY-MM-DD HH:mm")
                                : "—"}
                        </div>
                    </div>
                ) : (
                    <div>—</div>
                )}
            </div>

            {/* Входи за годинами */}
            <div className="rounded-2xl border border-white/10 py-4 px-2 md:col-span-2">
                <div className="flex items-baseline justify-between">
                    <h2 className="text-lg font-medium mb-2">Входи за годинами (Kyiv)</h2>
                    {lastEntryHuman && (
                        <div className="text-xs text-neutral-400">Останній вхід: {lastEntryHuman}</div>
                    )}
                </div>
                <div className="h-56">
                    <ResponsiveContainer>
                        <BarChart data={normalized}>
                            <XAxis
                                dataKey="hour"
                                tickFormatter={(v: number) => `${v}:00`}
                                stroke="#9ca3af"
                            />
                            <YAxis allowDecimals={false} stroke="#9ca3af"/>
                            <Tooltip
                                wrapperStyle={{outline: "none"}}
                                contentStyle={{
                                    background: "#111827",
                                    border: "1px solid #374151",
                                    color: "#e5e7eb",
                                    borderRadius: 8,
                                }}
                                cursor={{fill: "rgba(255,255,255,0.04)"}}
                                formatter={(val: number) => [`${val} входів`, "за годину"]}
                                labelFormatter={(l: number) => `${l}:00`}
                            />
                            {/* видимий колір + minPointSize щоб "тонкі" стовпчики не зникали */}
                            <Bar dataKey="entries" fill="#22c55e" radius={[6, 6, 0, 0]} minPointSize={2}/>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
                {/* якщо за день немає входів — підпис */}
                {normalized.every(d => d.entries === 0) && (
                    <div className="mt-2 text-xs text-neutral-500">За обраний період входів не зафіксовано.</div>
                )}
            </div>
        </section>
    );
}
