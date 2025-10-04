import dayjs from "dayjs";
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

type StatusAndHeatProps = {
    kyivTz: string;
    latest: Latest | null;
    heatData: { hour: number; online_points: number }[];
};

export default function StatusAndHeat({
    kyivTz,
    latest,
    heatData,
}: StatusAndHeatProps) {
    return (
        <section className="grid md:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-white/10 py-4 px-2 md:col-span-1">
                <h2 className="text-lg font-medium mb-2">Статус зараз</h2>
                {latest ? (
                    <div className="space-y-1">
                        <div
                            className={`text-xl ${
                                latest.is_online ? "text-emerald-400" : "text-neutral-300"
                            }`}
                        >
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

            <div className="rounded-2xl border border-white/10 py-4 px-2 md:col-span-2">
                <h2 className="text-lg font-medium mb-2">Активні години (Kyiv)</h2>
                <div className="h-56">
                    <ResponsiveContainer>
                        <BarChart data={heatData}>
                            <XAxis dataKey="hour" tickFormatter={(v: number) => `${v}:00`}/>
                            <YAxis/>
                            <Tooltip
                                formatter={(val: number) => [`${val} точок`, "online"]}
                                labelFormatter={(l: number) => `${l}:00`}
                            />
                            <Bar dataKey="online_points"/>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </section>
    );
}
